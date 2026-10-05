import {
  TOKEN_SERVER_URL,
  TOKEN_ENDPOINT_PATH,
  HEALTH_ENDPOINT_PATH,
  isTokenUsable,
  type CopilotProfile,
} from '@ms365copilot/core';
import { registerHandlers } from '@/utils/messaging';
import { getStorage, patchStorage, setStorage } from '@/utils/storage';
import { logger } from '@/utils/logger';
import { t } from '@/utils/i18n';
import {
  describeMinutesLeft,
  forceRefreshNow,
  onTokenCaptured,
  runRefreshCycle,
  setupTokenRefresher,
} from '@/utils/tokenRefresher';

/** `syncState.lastError` when the stored token had already expired (not sent). */
const TOKEN_EXPIRED_SYNC_ERROR = 'token-expired';

export default defineBackground(() => {
  logger.info('M365 Copilot Background Script loaded', { id: chrome.runtime.id });

  // Construye un perfil completo a partir del store crudo.
  function buildProfile(store: any): CopilotProfile | null {
    if (!store || !store.accessToken) return null;
    return {
      version: 1,
      capturedAt: store.capturedAt || new Date().toISOString(),
      accessToken: store.accessToken,
      endpoint: store.endpoint || null,
      origin: store.origin || 'https://m365.cloud.microsoft',
      userAgent: store.userAgent || navigator.userAgent,
      invocationTemplate: store.invocationTemplate || null,
      invocationType: store.invocationType || 4,
      claims: store.claims || null,
    };
  }

  /**
   * Envía el perfil al servidor local de la extensión de VS Code y deja
   * constancia de qué token quedó sincronizado: es lo que permite al
   * auto-renovador saber si hace falta reenviar (p. ej. porque VS Code arrancó
   * después de la captura) sin repetir POSTs a ciegas.
   */
  async function sendProfileToVSCode(store: unknown): Promise<boolean> {
    const profile = buildProfile(store);
    if (!profile) return false;

    await patchStorage('syncState', { lastSyncAttemptAt: Date.now() });

    if (!isTokenUsable(profile)) {
      logger.warn('El token guardado ya caducó: no se envía a VS Code');
      await patchStorage('syncState', { lastError: TOKEN_EXPIRED_SYNC_ERROR });
      return false;
    }

    try {
      const response = await fetch(`${TOKEN_SERVER_URL}${TOKEN_ENDPOINT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      logger.info('Profile sent to VS Code successfully');
      await setStorage('lastSyncedAt', new Date().toISOString());
      await patchStorage('syncState', {
        syncedTokenExp: profile.claims?.exp ?? null,
        lastError: null,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to send profile to VS Code (VS Code may not be running):', message);
      // No es un error crítico; VS Code puede no estar ejecutándose. El
      // auto-renovador reintentará en el siguiente latido.
      await patchStorage('syncState', { lastError: message });
      return false;
    }
  }

  // ¿Está el servidor local de VS Code escuchando?
  async function isVSCodeReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${TOKEN_SERVER_URL}${HEALTH_ENDPOINT_PATH}`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Los handlers se registran ANTES de arrancar nada más: si el arranque del
  // auto-renovador falla (una API que falta, un permiso ausente…), el popup y la
  // sincronización tienen que seguir funcionando. Justamente eso es lo que
  // rompía la extensión entera cuando `chrome.alarms` no existía.
  registerHandlers({
    PING: () => ({ status: 'pong' as const }),

    GET_PROFILE: async () => {
      const profile = await getStorage('currentProfile');
      const lastSyncedAt = await getStorage('lastSyncedAt');
      return { profile, lastSyncedAt };
    },

    GET_STATUS: async () => {
      const profile = await getStorage('currentProfile');
      return {
        profile,
        lastSyncedAt: await getStorage('lastSyncedAt'),
        minutesLeft: describeMinutesLeft(profile),
        refreshState: await getStorage('refreshState'),
        syncState: await getStorage('syncState'),
        autoOpenTab: await getStorage('autoOpenTab'),
      };
    },

    FORCE_REFRESH: async () => {
      const decision = await forceRefreshNow();
      return { action: decision.action, reason: decision.reason };
    },

    SET_AUTO_OPEN: async (enabled: boolean) => {
      await setStorage('autoOpenTab', Boolean(enabled));
      return { autoOpenTab: Boolean(enabled) };
    },

    CHECK_VSCODE: async () => {
      const connected = await isVSCodeReachable();
      return { connected };
    },

    PROFILE_UPDATED: async (data: any) => {
      const previous = await getStorage('currentProfile');
      await setStorage('currentProfile', data);

      const isNewToken = Boolean(data?.accessToken) && data.accessToken !== previous?.accessToken;
      if (isNewToken) {
        // Reinicia el backoff y recoge la pestaña que hubiéramos abierto.
        await onTokenCaptured(data);
      }

      // Un único envío por actualización: antes esto lo hacía además un listener
      // de `chrome.storage.onChanged`, así que cada captura mandaba dos POST.
      await sendProfileToVSCode(data);
      return { status: 'ok' as const };
    },

    COPY_PROFILE: async () => {
      const data = await getStorage('currentProfile');
      const profile = buildProfile(data);
      if (!profile) {
        throw new Error(t('error.noProfile'));
      }
      return { profile, text: JSON.stringify(profile, null, 2) };
    },

    COPY_TOKEN: async () => {
      const data = await getStorage('currentProfile');
      if (!data || !data.accessToken) {
        throw new Error(t('error.noToken'));
      }
      return { token: data.accessToken };
    },

    SEND_TO_VSCODE: async () => {
      const data = await getStorage('currentProfile');
      if (!buildProfile(data)) {
        throw new Error(t('error.noProfile'));
      }
      const ok = await sendProfileToVSCode(data);
      if (!ok) {
        const { lastError } = await getStorage('syncState');
        throw new Error(t(lastError === TOKEN_EXPIRED_SYNC_ERROR ? 'error.tokenExpired' : 'error.vscodeUnreachable'));
      }
      return { status: 'ok' as const };
    },
  });

  chrome.runtime.onInstalled.addListener((details) => {
    logger.info('Extension installed:', details.reason);
    if (details.reason === 'install') {
      void setStorage('installedAt', new Date().toISOString());
    }
    // Reinstalar o actualizar mata la alarma: hay que rearmarla.
    void runRefreshCycle().catch(() => {});
  });

  // Al abrir el navegador el service worker despierta aquí: un ciclo inmediato
  // deja la sesión lista antes de que llegue el primer latido de la alarma.
  chrome.runtime.onStartup?.addListener(() => {
    void runRefreshCycle().catch((error) => logger.error('Ciclo de arranque fallido:', error));
  });

  // Si el usuario cierra a mano la pestaña que abrimos para renovar, olvidarla.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const state = await getStorage('refreshState');
      if (state.openedTabId === tabId) {
        await patchStorage('refreshState', { openedTabId: null, openedAt: null });
      }
    })();
  });

  // Lo último, y aislado: mantiene la sesión viva sin que nadie la toque.
  try {
    setupTokenRefresher(sendProfileToVSCode);
  } catch (error) {
    logger.error('No se pudo arrancar el auto-renovador de token:', error);
  }
});

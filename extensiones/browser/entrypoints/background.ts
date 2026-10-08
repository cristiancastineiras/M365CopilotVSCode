import {
  TOKEN_SERVER_URL,
  TOKEN_ENDPOINT_PATH,
  HEALTH_ENDPOINT_PATH,
  SIGNOUT_ENDPOINT_PATH,
  isTokenUsable,
  profileFromCapture,
  type CopilotProfile,
} from '@m365copilot/core';
import { ext } from '@/utils/api';
import { registerHandlers } from '@/utils/messaging';
import {
  EMPTY_REFRESH_STATE,
  EMPTY_SYNC_STATE,
  getStorage,
  patchStorage,
  setStorage,
} from '@/utils/storage';
import { hardResetMicrosoftSession, type HardResetReport } from '@/utils/hardReset';
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
  logger.info('M365 Copilot Background Script loaded', { id: ext().runtime.id });

  // Construye un perfil completo a partir del store crudo (misma forma que el userscript).
  function buildProfile(store: any): CopilotProfile | null {
    return store ? profileFromCapture(store, navigator.userAgent) : null;
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
    return (await readHealth()) !== null;
  }

  /** El health-check es además por donde VS Code pide cerrar la sesión. */
  interface Health {
    status?: string;
    /** Cierre de sesión pedido desde VS Code y todavía sin atender. */
    pendingSignOut?: { id?: string } | null;
  }

  async function readHealth(): Promise<Health | null> {
    try {
      const res = await fetch(`${TOKEN_SERVER_URL}${HEALTH_ENDPOINT_PATH}`, { method: 'GET' });
      if (!res.ok) return null;
      return (await res.json()) as Health;
    } catch {
      return null;
    }
  }

  /** Id del cierre de sesión que VS Code tiene pendiente, si hay alguno. */
  async function pendingSignOutId(): Promise<string | null> {
    const health = await readHealth();
    const id = health?.pendingSignOut?.id;
    return typeof id === 'string' && id ? id : null;
  }

  /**
   * Avisa a VS Code de que la sesión ya está cerrada, con el informe de lo que
   * se borró: es lo que cierra el aviso de progreso del editor y lo que hace
   * que borre también el token que tenía guardado. Si no está escuchando no
   * pasa nada — su token lo borró antes de pedirlo.
   */
  async function reportSignOutToVSCode(id: string | null, report: HardResetReport): Promise<void> {
    try {
      await fetch(`${TOKEN_SERVER_URL}${SIGNOUT_ENDPOINT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, report }),
      });
    } catch (err) {
      logger.debug('VS Code no recogió el aviso de cierre de sesión:', err);
    }
  }

  /**
   * Cierra la sesión de Microsoft y deja la extensión como recién instalada.
   *
   * El estado guardado se limpia ANTES de borrar el navegador: así, si algo
   * del borrado falla a medias, lo que queda es «no hay token» (que el
   * renovador sabe manejar) y no un token válido con la sesión ya cerrada.
   * `hasEverCaptured` vuelve a false a propósito — es lo que impide que el
   * siguiente latido se ponga a abrir pestañas mientras el usuario está
   * escribiendo su contraseña.
   */
  async function hardReset(options: { requestId?: string | null; driveTabId?: number | null } = {}) {
    const requestId = options.requestId ?? null;
    await setStorage('currentProfile', null);
    await setStorage('lastSyncedAt', null);
    await setStorage('hasEverCaptured', false);
    await setStorage('refreshState', { ...EMPTY_REFRESH_STATE, lastAction: 'needsUser', lastReason: 'sesión cerrada a petición' });
    await setStorage('syncState', { ...EMPTY_SYNC_STATE });
    if (requestId) await setStorage('handledSignOutId', requestId);

    const report = await hardResetMicrosoftSession({ driveTabId: options.driveTabId ?? null });
    await reportSignOutToVSCode(requestId, report);
    return report;
  }

  /**
   * Recoge la petición que VS Code haya dejado en su servidor local. Es el
   * camino de respaldo del marcador en la URL (ver content.ts): si esa pestaña
   * no llega a cargar — el navegador estaba cerrado, la web no responde —, el
   * cierre de sesión llega igual en el siguiente latido.
   */
  async function pollSignOutRequest(): Promise<void> {
    const id = await pendingSignOutId();
    if (!id) return;
    if ((await getStorage('handledSignOutId')) === id) return;
    logger.info(`VS Code pide cerrar la sesión (${id}); atendiéndolo`);
    await hardReset({ requestId: id });
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

    HARD_RESET: async (payload, sender) => {
      const requestId = payload?.requestId ?? null;
      // El marcador viaja en una URL, así que el content script que lo ve no
      // prueba nada por sí mismo: cualquier web podría enlazarla. Sólo se
      // obedece si ese id es el que VS Code tiene pendiente de verdad.
      if (requestId && (await pendingSignOutId()) !== requestId) {
        throw new Error(t('error.signOutNotRequested'));
      }
      return hardReset({
        requestId,
        driveTabId: payload?.driveTabId ?? sender.tab?.id ?? null,
      });
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

  ext().runtime.onInstalled.addListener((details) => {
    logger.info('Extension installed:', details.reason);
    if (details.reason === 'install') {
      void setStorage('installedAt', new Date().toISOString());
    }
    // Reinstalar o actualizar mata la alarma: hay que rearmarla.
    void runRefreshCycle().catch(() => {});
  });

  // Al abrir el navegador el service worker despierta aquí: un ciclo inmediato
  // deja la sesión lista antes de que llegue el primer latido de la alarma.
  ext().runtime.onStartup?.addListener(() => {
    void runRefreshCycle().catch((error) => logger.error('Ciclo de arranque fallido:', error));
  });

  // Si el usuario cierra a mano la pestaña que abrimos para renovar, olvidarla.
  ext().tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const state = await getStorage('refreshState');
      if (state.openedTabId === tabId) {
        await patchStorage('refreshState', { openedTabId: null, openedAt: null });
      }
    })();
  });

  // Lo último, y aislado: mantiene la sesión viva sin que nadie la toque.
  try {
    setupTokenRefresher(sendProfileToVSCode, pollSignOutRequest);
  } catch (error) {
    logger.error('No se pudo arrancar el auto-renovador de token:', error);
  }
});

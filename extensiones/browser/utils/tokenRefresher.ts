/**
 * Auto-renovador del token: mantiene la sesión viva sin que nadie la toque.
 *
 * Cómo funciona, y por qué así:
 *
 *  - En MV3 el background es un **service worker** que Chrome duerme a los
 *    ~30 s. Un `setInterval` no sobrevive, así que el latido es una
 *    `chrome.alarms` de 1 minuto (lo mínimo fiable en producción) que despierta
 *    al worker, mira el estado guardado y decide. La decisión en sí vive en
 *    `refreshPolicy.ts`, que es puro y testeable.
 *
 *  - El ciclo **nunca espera** a que el token llegue: sólo dispara la acción
 *    (re-escaneo, recarga, abrir pestaña) y anota el intento. El token nuevo
 *    entra por el camino de siempre — interceptor → puente → PROFILE_UPDATED —
 *    y el siguiente latido comprueba si funcionó. Un `await` largo aquí moriría
 *    con el worker.
 *
 *  - La escalada va de menos a más invasiva: reenviar lo que ya hay → pedir a la
 *    pestaña que re-escanee la caché de MSAL (la web renueva su propio token
 *    sola) → recargar la pestaña → abrir una en segundo plano.
 */
import { M365_CHAT_URL } from '@ms365copilot/core';
import { logger } from './logger';
import {
  getStorage,
  patchStorage,
  setStorage,
  EMPTY_REFRESH_STATE,
  type RefreshState,
} from './storage';
import {
  decideRefreshAction,
  msUntilExpiry,
  needsResync,
  OPENED_TAB_GRACE_MS,
  RENEW_MARGIN_MS,
  type RefreshDecision,
  type TokenSnapshot,
} from './refreshPolicy';

const ALARM_NAME = 'ms365copilot-token-refresh';
/** 1 minuto es el periodo mínimo que Chrome respeta en extensiones empaquetadas. */
const ALARM_PERIOD_MINUTES = 1;

/** Dónde vive el chat; es la pestaña que sabemos que emite el token de Sydney. */
const M365_TAB_PATTERNS = ['https://m365.cloud.microsoft/*', 'https://*.cloud.microsoft/*'];

/** El background inyecta aquí su envío a VS Code, para no crear un ciclo de imports. */
export type SyncToVSCode = (profile: unknown) => Promise<boolean>;

let syncToVSCode: SyncToVSCode = async () => false;

/**
 * Inyecta el envío a VS Code. Separado de {@link setupTokenRefresher} para poder
 * ejercitar el ciclo sin arrancar alarmas ni latidos.
 */
export function setSyncHandler(sync: SyncToVSCode): void {
  syncToVSCode = sync;
}

// --------------------------------------------------------------- utilidades

async function findM365Tabs(): Promise<chrome.tabs.Tab[]> {
  try {
    return await chrome.tabs.query({ url: M365_TAB_PATTERNS });
  } catch (error) {
    logger.warn('No se pudieron listar las pestañas de M365:', error);
    return [];
  }
}

function snapshotOf(profile: any): TokenSnapshot {
  const exp = profile?.claims?.exp;
  return {
    hasToken: Boolean(profile?.accessToken),
    expEpochSeconds: typeof exp === 'number' ? exp : null,
  };
}

/** Texto corto del estado, para el badge y el popup. */
export function describeMinutesLeft(profile: any, now = Date.now()): number | null {
  const left = msUntilExpiry(snapshotOf(profile), now);
  return left === null ? null : Math.round(left / 60000);
}

/**
 * Badge del icono: es el único aviso que podemos dar sin pedir el permiso
 * `notifications`, y basta para distinguir «todo bien» de «entra tú».
 */
async function setBadge(text: string, color: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* el badge es cosmético: nunca debe tumbar el ciclo */
  }
}

async function reflectStateInBadge(profile: any, decision: RefreshDecision): Promise<void> {
  if (decision.action === 'needsUser') return setBadge('!', '#c4314b');
  if (!profile?.accessToken) return setBadge('·', '#8a8886');
  const minutes = describeMinutesLeft(profile);
  if (minutes !== null && minutes <= 0) return setBadge('!', '#c4314b');
  await setBadge('', '#107c10');
}

// ------------------------------------------------------------------ acciones

/** Pide a las pestañas de M365 que re-escaneen la caché de MSAL. */
async function requestRescan(tabs: readonly chrome.tabs.Tab[]): Promise<void> {
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'RESCAN_TOKEN', payload: undefined });
    } catch {
      // La pestaña puede estar cargando todavía o sin content script; el
      // siguiente latido volverá a intentarlo (o subirá a recargar).
      logger.debug(`La pestaña ${tab.id} no aceptó el re-escaneo`);
    }
  }
}

async function reloadTab(tabs: readonly chrome.tabs.Tab[]): Promise<void> {
  const tab = tabs.find((candidate) => Boolean(candidate.id));
  if (!tab?.id) return;
  logger.info(`Recargando la pestaña ${tab.id} para renovar el token`);
  await chrome.tabs.reload(tab.id);
  await setStorage('lastRefreshedAt', new Date().toISOString());
}

/** Abre M365 en segundo plano. Se cierra sola en cuanto el token entra. */
async function openBackgroundTab(): Promise<number | null> {
  try {
    const tab = await chrome.tabs.create({ url: M365_CHAT_URL, active: false });
    logger.info(`Pestaña de M365 abierta en segundo plano (${tab.id}) para renovar el token`);
    return tab.id ?? null;
  } catch (error) {
    logger.warn('No se pudo abrir la pestaña de M365:', error);
    return null;
  }
}

async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* ya la cerró el usuario */
  }
}

// ------------------------------------------------------------------- ciclo

/**
 * Un latido: reenvía a VS Code si hace falta y decide si hay que renovar.
 * Devuelve la decisión para poder afirmar sobre ella en el popup y en el log.
 */
export async function runRefreshCycle(): Promise<RefreshDecision> {
  const profile = await getStorage('currentProfile');
  const refreshState = await getStorage('refreshState');
  const syncState = await getStorage('syncState');
  const autoOpenTab = await getStorage('autoOpenTab');
  const hasEverCaptured = await getStorage('hasEverCaptured');
  const now = Date.now();
  const token = snapshotOf(profile);

  // 1. Reenviar lo que ya tenemos. Cubre el caso de VS Code arrancando DESPUÉS
  //    de la captura, que antes dejaba el token en el navegador para siempre.
  if (
    needsResync({
      capturedAt: profile?.capturedAt ?? null,
      syncedTokenExp: syncState.syncedTokenExp,
      currentTokenExp: token.expEpochSeconds,
      hasToken: token.hasToken,
      lastSyncAttemptAt: syncState.lastSyncAttemptAt,
      now,
    })
  ) {
    logger.info('El token guardado no está sincronizado con VS Code; reenviando');
    await syncToVSCode(profile);
  }

  // 2. ¿Hay que renovar?
  const decision = decideRefreshAction({
    now,
    token,
    hasM365Tab: false, // se rellena abajo sólo si hace falta consultar pestañas
    hasEverCaptured,
    lastAttemptAt: refreshState.lastAttemptAt,
    attempts: refreshState.attempts,
    autoOpenTab,
  });

  // Consultar pestañas cuesta un IPC: sólo se hace cuando la decisión depende
  // de ello (o sea, cuando de verdad toca renovar).
  const finalDecision =
    decision.action === 'none' || decision.action === 'wait'
      ? decision
      : decideRefreshAction({
          now,
          token,
          hasM365Tab: (await findM365Tabs()).length > 0,
          hasEverCaptured,
          lastAttemptAt: refreshState.lastAttemptAt,
          attempts: refreshState.attempts,
          autoOpenTab,
        });

  await applyDecision(finalDecision, refreshState, now);
  await reflectStateInBadge(profile, finalDecision);
  await pruneStaleOpenedTab(refreshState, now);
  return finalDecision;
}

async function applyDecision(
  decision: RefreshDecision,
  state: RefreshState,
  now: number,
): Promise<void> {
  if (decision.action === 'none' || decision.action === 'wait') {
    if (state.lastAction !== decision.action) {
      await patchStorage('refreshState', { lastAction: decision.action, lastReason: decision.reason });
    }
    return;
  }

  logger.info(`Renovación de token → ${decision.action}: ${decision.reason}`);

  const patch: Partial<RefreshState> = {
    lastAction: decision.action,
    lastReason: decision.reason,
  };

  if (decision.action === 'rescan') {
    await requestRescan(await findM365Tabs());
    patch.attempts = state.attempts + 1;
    patch.lastAttemptAt = now;
  } else if (decision.action === 'reload') {
    await reloadTab(await findM365Tabs());
    patch.attempts = state.attempts + 1;
    patch.lastAttemptAt = now;
  } else if (decision.action === 'open') {
    const tabId = await openBackgroundTab();
    patch.attempts = state.attempts + 1;
    patch.lastAttemptAt = now;
    patch.openedTabId = tabId;
    patch.openedAt = tabId === null ? null : now;
  } else if (decision.action === 'needsUser') {
    // No se toca `attempts`: se queda arriba a propósito para que el backoff
    // largo siga frenando, hasta que una captura real lo reinicie.
    patch.lastAttemptAt = now;
  }

  await patchStorage('refreshState', patch);
}

/**
 * Si abrimos una pestaña y pasado el margen no ha capturado nada, casi siempre
 * es que Microsoft pide iniciar sesión: se deja abierta (cerrarla escondería el
 * problema) y se avisa en el badge.
 */
async function pruneStaleOpenedTab(state: RefreshState, now: number): Promise<void> {
  if (state.openedTabId === null || state.openedAt === null) return;
  if (now - state.openedAt < OPENED_TAB_GRACE_MS) return;

  logger.warn('La pestaña abierta para renovar no capturó ningún token; probablemente haga falta iniciar sesión');
  await patchStorage('refreshState', {
    openedTabId: null,
    openedAt: null,
    // Sin esto el popup se quedaría diciendo «Abriendo M365…» para siempre.
    lastAction: 'needsUser',
    lastReason: 'la pestaña abierta no capturó ningún token: falta iniciar sesión',
  });
  await setBadge('!', '#c4314b');
}

/**
 * Un token nuevo ha entrado: se reinicia el backoff y se recoge la pestaña que
 * hubiéramos abierto nosotros.
 */
export async function onTokenCaptured(profile: any): Promise<void> {
  const state = await getStorage('refreshState');
  await setStorage('hasEverCaptured', true);

  const minutes = describeMinutesLeft(profile);
  logger.info(`Token capturado${minutes === null ? '' : ` (caduca en ${minutes} min)`}`);

  await setStorage('refreshState', {
    ...EMPTY_REFRESH_STATE,
    lastAction: 'captured',
    lastReason: minutes === null ? 'token nuevo' : `token nuevo, ${minutes} min de vida`,
  });

  if (state.openedTabId !== null) {
    // La abrimos nosotros y ya cumplió: fuera, para no dejar pestañas sueltas.
    await closeTab(state.openedTabId);
  }
  await reflectStateInBadge(profile, { action: 'none', reason: 'token nuevo' });
}

/** Fuerza una renovación inmediata (botón del popup), saltándose el backoff. */
export async function forceRefreshNow(): Promise<RefreshDecision> {
  await patchStorage('refreshState', { attempts: 0, lastAttemptAt: null });
  return runRefreshCycle();
}

// ------------------------------------------------------------------- setup

/**
 * Arranca el latido. Es defensivo a propósito: si `chrome.alarms` no está
 * disponible (permiso ausente en el manifest), esto ANTES tiraba una excepción
 * que se llevaba por delante el resto del background — handlers de mensajes y
 * sincronización incluidos — y la extensión entera parecía muerta.
 */
export function setupTokenRefresher(sync: SyncToVSCode): void {
  setSyncHandler(sync);

  if (!chrome.alarms) {
    logger.error(
      'chrome.alarms no está disponible: falta el permiso "alarms" en el manifest. ' +
        'El token NO se renovará solo.',
    );
    return;
  }

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void runRefreshCycle().catch((error) => logger.error('Ciclo de renovación fallido:', error));
  });

  // Al arrancar el navegador la alarma puede tardar un minuto: un ciclo
  // inmediato deja la sesión lista antes.
  void runRefreshCycle().catch((error) => logger.error('Ciclo inicial fallido:', error));

  logger.info(`Auto-renovación activa (cada ${ALARM_PERIOD_MINUTES} min, margen ${RENEW_MARGIN_MS / 60000} min)`);
}

/** Detiene el auto-renovador (debug). */
export async function stopTokenRefresher(): Promise<void> {
  await chrome.alarms?.clear(ALARM_NAME);
  logger.info('Auto-renovación detenida');
}

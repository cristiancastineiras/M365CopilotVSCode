/**
 * Política de renovación del token: qué hacer y cuándo.
 *
 * Vive aparte y sin tocar ninguna API de `chrome` a propósito. El background de
 * MV3 es un service worker que Chrome mata a los pocos segundos de inactividad,
 * así que la decisión tiene que ser una función pura de (estado guardado, reloj)
 * — nada de temporizadores vivos ni de estado en memoria — y así además se puede
 * probar fuera del navegador.
 */

/** Se renueva con margen: un token que caduca a mitad de una respuesta la rompe. */
export const RENEW_MARGIN_MS = 12 * 60 * 1000;

/** Espera mínima entre intentos, y tope del backoff exponencial. */
export const BASE_BACKOFF_MS = 45 * 1000;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

/** Tras tantos intentos seguidos, casi seguro que hace falta que entre el usuario. */
export const ATTEMPTS_BEFORE_HELP = 4;

/** Cuánto se le da a una pestaña abierta por nosotros para capturar antes de rendirse. */
export const OPENED_TAB_GRACE_MS = 90 * 1000;

export type RefreshAction =
  /** Nada que hacer: el token tiene cuerda de sobra. */
  | 'none'
  /** Pedir a la pestaña que re-escanee la caché de MSAL (la web ya renovó por su cuenta). */
  | 'rescan'
  /** Recargar la pestaña de M365 para forzar el flujo de autenticación. */
  | 'reload'
  /** No hay ninguna pestaña de M365: abrir una en segundo plano. */
  | 'open'
  /** Toca renovar, pero el intento anterior es demasiado reciente. */
  | 'wait'
  /** Se han agotado los intentos automáticos: hace falta que el usuario entre. */
  | 'needsUser';

export interface TokenSnapshot {
  readonly hasToken: boolean;
  /** `claims.exp` del token guardado, en segundos epoch. */
  readonly expEpochSeconds: number | null;
}

export interface RefreshContext {
  readonly now: number;
  readonly token: TokenSnapshot;
  /** Hay al menos una pestaña de M365 Copilot abierta. */
  readonly hasM365Tab: boolean;
  /** Alguna vez se capturó un token: sin eso no abrimos pestañas por nuestra cuenta. */
  readonly hasEverCaptured: boolean;
  /** Momento del último intento de renovación (ms epoch), o null. */
  readonly lastAttemptAt: number | null;
  /** Intentos seguidos sin conseguir un token nuevo. */
  readonly attempts: number;
  /** El usuario desactivó la apertura automática de pestañas. */
  readonly autoOpenTab: boolean;
}

export interface RefreshDecision {
  readonly action: RefreshAction;
  readonly reason: string;
  /** Milisegundos que faltan para poder reintentar, cuando `action === 'wait'`. */
  readonly retryInMs?: number;
}

/** Milisegundos hasta la caducidad, o null si el token no dice cuándo caduca. */
export function msUntilExpiry(token: TokenSnapshot, now: number): number | null {
  if (!token.hasToken || token.expEpochSeconds === null) return null;
  return token.expEpochSeconds * 1000 - now;
}

/** Espera exigida antes del siguiente intento, creciente para no entrar en bucle. */
export function backoffFor(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export function decideRefreshAction(context: RefreshContext): RefreshDecision {
  const { now, token, hasM365Tab, attempts } = context;

  const left = msUntilExpiry(token, now);
  const needsRenewal = !token.hasToken || left === null || left <= RENEW_MARGIN_MS;
  if (!needsRenewal) {
    return {
      action: 'none',
      reason: `quedan ${Math.round((left ?? 0) / 60000)} min de token`,
    };
  }

  // Sin ninguna captura previa no hay sesión que mantener: abrir pestañas por
  // nuestra cuenta sería intrusivo y no arreglaría nada.
  if (!token.hasToken && !context.hasEverCaptured) {
    return { action: 'none', reason: 'todavía no se ha capturado ningún token' };
  }

  const waitFor = remainingBackoff(context);
  if (waitFor > 0) {
    return {
      action: 'wait',
      reason: `intento reciente; se reintenta en ${Math.ceil(waitFor / 1000)} s`,
      retryInMs: waitFor,
    };
  }

  if (attempts >= ATTEMPTS_BEFORE_HELP) {
    return {
      action: 'needsUser',
      reason: `${attempts} intentos sin conseguir token nuevo: hace falta iniciar sesión`,
    };
  }

  if (!hasM365Tab) {
    return context.autoOpenTab
      ? { action: 'open', reason: 'no hay ninguna pestaña de M365 Copilot abierta' }
      : { action: 'needsUser', reason: 'no hay pestaña de M365 y la apertura automática está desactivada' };
  }

  // Primero lo barato y no destructivo: la web renueva su propio token cada
  // ~50 min, así que muchas veces ya hay uno nuevo en la caché de MSAL que sólo
  // hay que recoger. Recargar la pestaña se deja para cuando eso no basta.
  return attempts === 0
    ? { action: 'rescan', reason: 'se pide a la pestaña que re-escanee la caché de MSAL' }
    : { action: 'reload', reason: 'el re-escaneo no dio token nuevo: se recarga la pestaña' };
}

function remainingBackoff(context: RefreshContext): number {
  if (context.lastAttemptAt === null) return 0;
  const elapsed = context.now - context.lastAttemptAt;
  // Un reloj que va hacia atrás (suspensión, cambio de hora) no debe bloquear
  // la renovación para siempre.
  if (elapsed < 0) return 0;
  return Math.max(0, backoffFor(context.attempts) - elapsed);
}

export interface SyncContext {
  /** `capturedAt` del perfil guardado (ISO), o null. */
  readonly capturedAt: string | null;
  /** `exp` del token que VS Code confirmó tener, o null. */
  readonly syncedTokenExp: number | null;
  /** `exp` del token guardado ahora. */
  readonly currentTokenExp: number | null;
  readonly hasToken: boolean;
  readonly lastSyncAttemptAt: number | null;
  readonly now: number;
}

/** No martillear al servidor local de VS Code cuando está apagado. */
export const RESYNC_COOLDOWN_MS = 30 * 1000;

/**
 * ¿Hay que (re)enviar el perfil a VS Code? Cubre el caso más molesto: VS Code
 * arranca DESPUÉS de que el navegador capturara el token, y sin esto nadie se lo
 * vuelve a mandar hasta que el token cambia.
 */
export function needsResync(context: SyncContext): boolean {
  if (!context.hasToken) return false;
  if (
    context.lastSyncAttemptAt !== null &&
    context.now - context.lastSyncAttemptAt >= 0 &&
    context.now - context.lastSyncAttemptAt < RESYNC_COOLDOWN_MS
  ) {
    return false;
  }
  // Nunca se sincronizó, o lo que VS Code tiene es un token distinto (más viejo).
  if (context.syncedTokenExp === null) return true;
  if (context.currentTokenExp === null) return true;
  return context.currentTokenExp > context.syncedTokenExp;
}

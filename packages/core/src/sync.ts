/**
 * ¿Hay que (re)enviar el perfil al servidor local de VS Code? Compartido por
 * el background de la extensión de navegador y por el userscript, que deciden
 * igual cuándo sincronizar. Puro: el estado y el reloj llegan como argumentos.
 */
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

/**
 * Wrapper tipado sobre chrome.storage.local con defaults y fallback
 * cuando la API no está disponible (p. ej. fuera del contexto de extensión).
 *
 * En MV3 el background es un service worker que Chrome duerme a los pocos
 * segundos: TODO el estado del auto-renovador vive aquí, nunca en variables de
 * módulo, porque esas no sobreviven al siguiente despertar.
 */
import { ext } from './api';

/** Estado del auto-renovador entre despertares del service worker. */
export interface RefreshState {
  /** Intentos seguidos sin conseguir un token nuevo. */
  attempts: number;
  /** Último intento de renovación (ms epoch). */
  lastAttemptAt: number | null;
  /** Última acción ejecutada y por qué, para el popup y el log. */
  lastAction: string | null;
  lastReason: string | null;
  /** Pestaña que abrimos nosotros y que hay que cerrar al capturar. */
  openedTabId: number | null;
  openedAt: number | null;
}

/** Estado de la sincronización con el servidor local de VS Code. */
export interface SyncState {
  /** `exp` del token que VS Code confirmó haber recibido. */
  syncedTokenExp: number | null;
  lastSyncAttemptAt: number | null;
  lastError: string | null;
}

export const EMPTY_REFRESH_STATE: RefreshState = {
  attempts: 0,
  lastAttemptAt: null,
  lastAction: null,
  lastReason: null,
  openedTabId: null,
  openedAt: null,
};

export const EMPTY_SYNC_STATE: SyncState = {
  syncedTokenExp: null,
  lastSyncAttemptAt: null,
  lastError: null,
};

export interface StorageSchema {
  clickCount: number;
  installedAt: string | null;
  currentProfile: any;
  lastSyncedAt: string | null;
  /** Última recarga forzada de la pestaña para renovar el token. */
  lastRefreshedAt: string | null;
  refreshState: RefreshState;
  syncState: SyncState;
  /** Se capturó un token alguna vez: sin eso no abrimos pestañas por nuestra cuenta. */
  hasEverCaptured: boolean;
  /** Permitir abrir una pestaña en segundo plano cuando no hay ninguna. */
  autoOpenTab: boolean;
}

const DEFAULTS: StorageSchema = {
  clickCount: 0,
  installedAt: null,
  currentProfile: null,
  lastSyncedAt: null,
  lastRefreshedAt: null,
  refreshState: EMPTY_REFRESH_STATE,
  syncState: EMPTY_SYNC_STATE,
  hasEverCaptured: false,
  autoOpenTab: true,
};

const isStorageAvailable = (): boolean => Boolean(ext()?.storage?.local);

export async function getStorage<K extends keyof StorageSchema>(
  key: K,
): Promise<StorageSchema[K]> {
  if (!isStorageAvailable()) return DEFAULTS[key];

  try {
    const result = await ext().storage.local.get({ [key]: DEFAULTS[key] });
    return result[key] as StorageSchema[K];
  } catch (error) {
    console.error(`[storage] get("${key}") failed:`, error);
    return DEFAULTS[key];
  }
}

export async function setStorage<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K],
): Promise<void> {
  if (!isStorageAvailable()) return;

  try {
    await ext().storage.local.set({ [key]: value });
  } catch (error) {
    console.error(`[storage] set("${key}") failed:`, error);
  }
}

/** Fusiona campos en un valor de objeto (estado del renovador, de la sync…). */
export async function patchStorage<K extends 'refreshState' | 'syncState'>(
  key: K,
  patch: Partial<StorageSchema[K]>,
): Promise<StorageSchema[K]> {
  const current = await getStorage(key);
  const merged = { ...current, ...patch } as StorageSchema[K];
  await setStorage(key, merged);
  return merged;
}

/** Incrementa un contador numérico de forma atómica dentro del storage. */
export async function incrementStorage(
  key: keyof Pick<StorageSchema, 'clickCount'>,
): Promise<number> {
  const current = await getStorage(key);
  const next = current + 1;
  await setStorage(key, next);
  return next;
}

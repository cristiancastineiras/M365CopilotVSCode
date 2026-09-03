/**
 * Protocolo de mensajería tipado entre popup, background y content scripts.
 * Evita strings mágicos y respuestas sin validar.
 */

import type { RefreshState, SyncState } from './storage';

/** Lo que el popup necesita para explicar en una pantalla qué está pasando. */
export interface RefreshStatus {
  profile: any;
  lastSyncedAt: string | null;
  /** Minutos hasta la caducidad del token guardado, o null si no se sabe. */
  minutesLeft: number | null;
  refreshState: RefreshState;
  syncState: SyncState;
  autoOpenTab: boolean;
}

export interface MessageMap {
  PING: { request: void; response: { status: 'pong'; url?: string } };
  GET_PROFILE: { request: void; response: { profile: any; lastSyncedAt: string | null } };
  CHECK_VSCODE: { request: void; response: { connected: boolean } };
  PROFILE_UPDATED: { request: any; response: { status: 'ok' } };
  COPY_PROFILE: { request: void; response: { profile: any; text: string } };
  COPY_TOKEN: { request: void; response: { token: string } };
  SEND_TO_VSCODE: { request: void; response: { status: 'ok' } };
  /** Estado completo del auto-renovador, para el popup. */
  GET_STATUS: { request: void; response: RefreshStatus };
  /** Renovar ya, saltándose el backoff (botón del popup). */
  FORCE_REFRESH: { request: void; response: { action: string; reason: string } };
  /** Permitir o no que la extensión abra una pestaña de M365 por su cuenta. */
  SET_AUTO_OPEN: { request: boolean; response: { autoOpenTab: boolean } };
  /**
   * background → content script: vuelve a mirar la caché de MSAL. La web renueva
   * su propio token sola; muchas veces basta con recogerlo, sin recargar nada.
   */
  RESCAN_TOKEN: { request: void; response: { status: 'ok' } };
}

export type MessageType = keyof MessageMap;

type RequestOf<T extends MessageType> = MessageMap[T]['request'];
type ResponseOf<T extends MessageType> = MessageMap[T]['response'];

export interface Envelope<T extends MessageType = MessageType> {
  type: T;
  payload: RequestOf<T>;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}

/** Envía un mensaje tipado al background o al content script. */
export async function sendMessage<T extends MessageType>(
  type: T,
  payload: RequestOf<T>,
  tabId?: number,
): Promise<ResponseOf<T>> {
  const envelope: Envelope<T> = { type, payload };
  try {
    if (tabId !== undefined) {
      return (await chrome.tabs.sendMessage(tabId, envelope)) as ResponseOf<T>;
    }
    return (await chrome.runtime.sendMessage(envelope)) as ResponseOf<T>;
  } catch (error) {
    throw new Error(
      `[messaging] Failed to send "${type}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

type Handler<T extends MessageType> = (
  payload: RequestOf<T>,
  sender: chrome.runtime.MessageSender,
) => ResponseOf<T> | Promise<ResponseOf<T>>;

/**
 * Registra handlers tipados. Devuelve true para respuestas async.
 * Lanza con contexto si el handler falla, en vez de colgar el puerto.
 */
export function registerHandlers(handlers: {
  [K in MessageType]?: Handler<K>;
}): void {
  chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
    if (!isEnvelope(rawMessage)) return false;

    const handler = handlers[rawMessage.type];
    if (!handler) return false;

    Promise.resolve()
      .then(() =>
        (handler as Handler<MessageType>)(rawMessage.payload, sender),
      )
      .then(sendResponse)
      .catch((error: unknown) => {
        console.error(
          `[messaging] Handler for "${rawMessage.type}" failed:`,
          error,
        );
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true; // respuesta asíncrona
  });
}

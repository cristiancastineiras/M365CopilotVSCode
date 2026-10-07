/**
 * Lógica de captura del token, compartida por el interceptor de la extensión
 * de navegador (WXT, mundo MAIN) y por el userscript de Tampermonkey, que se
 * genera a partir de este mismo código (extensiones/vscode/userscript). Antes
 * cada uno tenía su copia y la del userscript se quedó atrás: dejaba de mirar
 * la caché de MSAL en cuanto tenía un token, así que nunca recogía el que la
 * web renueva sola y la sesión se rompía al caducar.
 *
 * Todo es puro — nada de `window`, `localStorage` ni `chrome` —: quien lo usa
 * pasa el estado y el reloj, y se puede probar fuera del navegador.
 */
import type { CopilotProfile, TokenClaims } from './profile';
import { extractClaims } from './jwt';
import { isSydneyToken } from './token';

/** Un JWT de verdad no se acerca a esto; algo mayor no es un token. */
export const MAX_JWT_CHARS = 8 * 1024;
/** Frames SignalR salientes que se llegan a inspeccionar. */
export const MAX_FRAME_CHARS = 1024 * 1024;
/** Plantilla de invocación que merece la pena guardar. */
export const MAX_TEMPLATE_CHARS = 64 * 1024;
const MAX_ENDPOINT_CHARS = 2048;

/** Lo que se va acumulando de la web de M365 (token, endpoint, plantilla). */
export interface CaptureStore {
  accessToken?: string;
  tokenSource?: string;
  claims?: TokenClaims | null;
  endpoint?: string;
  endpointConfirmed?: boolean;
  origin?: string;
  userAgent?: string;
  invocationTemplate?: Record<string, unknown>;
  invocationType?: number;
  capturedAt?: string;
  /** Modelos (`tone`) que la web ha usado, del más antiguo al más reciente. */
  observedTones?: string[];
}

/** Tres partes base64url y un tamaño razonable. */
export function isValidJwt(token: unknown): token is string {
  if (typeof token !== 'string' || token.length > MAX_JWT_CHARS) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

/** `exp` en el futuro y un `iat` coherente con él. */
export function areClaimsUsable(claims: TokenClaims | null | undefined, now = Date.now()): boolean {
  if (!claims || typeof claims.exp !== 'number' || claims.exp <= 0) return false;
  if (claims.exp * 1000 <= now) return false;
  const iat = (claims as { iat?: unknown }).iat;
  if (iat !== undefined && (typeof iat !== 'number' || iat > claims.exp)) return false;
  return true;
}

/**
 * Lo que hay que guardar si `token` merece sustituir al actual, o null: debe
 * ser un JWT válido, de Substrate/Sydney (el de Copilot, no cualquier token de
 * Office), sin caducar, distinto del guardado y no más viejo que él.
 */
export function acceptToken(
  current: CaptureStore,
  token: string,
  now = Date.now(),
): { accessToken: string; claims: TokenClaims } | null {
  const candidate = token.trim();
  if (!isValidJwt(candidate) || !isSydneyToken(candidate)) return null;
  const claims = extractClaims(candidate);
  if (!claims || !areClaimsUsable(claims, now)) return null;
  if (current.accessToken === candidate) return null;
  const currentExp = current.claims?.exp ?? 0;
  if (claims.exp && currentExp && claims.exp < currentExp) return null;
  return { accessToken: candidate, claims };
}

/**
 * Tokens candidatos dentro de un valor de localStorage/sessionStorage: MSAL
 * guarda cada access token como JSON (`secret`), otras librerías como
 * `access_token`/`accessToken`, y algunas entradas son el JWT pelado.
 */
export function tokensInStorageValue(value: string | null | undefined): string[] {
  if (!value || value.length < 40 || !value.includes('eyJ')) return [];
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return [];
    return [parsed.secret, parsed.access_token, parsed.accessToken].filter(
      (candidate): candidate is string => typeof candidate === 'string',
    );
  } catch {
    const raw = value.trim();
    return /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(raw) ? [raw] : [];
  }
}

/** El token que viaja en la query de la URL del WebSocket, si lo hay. */
export function tokenInSocketUrl(url: string): string | null {
  try {
    return new URL(String(url).replace(/^ws/i, 'http')).searchParams.get('access_token');
  } catch {
    return null;
  }
}

/** ¿Es un socket de Substrate/Chathub (y no presencia, notificaciones…)? */
export function isCopilotSocketUrl(url: string): boolean {
  const raw = String(url);
  return /chathub/i.test(raw) || /substrate/i.test(raw);
}

/**
 * Dominios de Microsoft desde los que se acepta un endpoint. El hub del chat
 * vive en `substrate.office.com`: la versión anterior sólo admitía
 * `.microsoft.com`/`.microsoft`, así que lo descartaba y el popup se quedaba
 * con «Endpoint: pendiente» para siempre.
 */
const MICROSOFT_HOST_SUFFIXES = ['.office.com', '.office.net', '.microsoft.com', '.microsoft', '.cloud.microsoft'];

export function isMicrosoftHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return MICROSOFT_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
}

/**
 * La URL del socket sin lo volátil (token, ids de sesión): no hay que guardar
 * un token caducado dentro del endpoint. '' si no es un host de Microsoft.
 */
export function normalizeEndpoint(raw: string): string {
  if (typeof raw !== 'string' || raw.length > MAX_ENDPOINT_CHARS) return '';
  try {
    const url = new URL(raw.replace(/^ws/i, 'http'));
    if (!isMicrosoftHost(url.hostname)) return '';
    for (const param of ['access_token', 'ConversationId', 'chatsessionid', 'clientrequestid', 'X-SessionId']) {
      url.searchParams.delete(param);
    }
    return url.toString().replace(/^http/i, 'ws');
  } catch {
    return '';
  }
}

/** SignalR separa los frames con este carácter (record separator). */
const RS = '\x1e';

/**
 * Mira un envío saliente por el socket: ¿lleva la invocación `chat` (prueba de
 * que es el hub del chat)? Si la lleva, devuelve también su plantilla.
 */
export function inspectOutgoingFrames(data: unknown): {
  sawChat: boolean;
  template?: Record<string, unknown>;
  invocationType?: number;
} {
  if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS) return { sawChat: false };
  let found: { sawChat: boolean; template?: Record<string, unknown>; invocationType?: number } = { sawChat: false };
  for (const chunk of data.split(RS)) {
    if (!chunk) continue;
    let frame: { type?: unknown; target?: unknown; arguments?: unknown };
    try {
      frame = JSON.parse(chunk);
    } catch {
      continue;
    }
    // SignalR: type 4 = StreamInvocation, type 1 = Invocation.
    if ((frame.type !== 4 && frame.type !== 1) || frame.target !== 'chat') continue;
    found = { sawChat: true };
    const args = Array.isArray(frame.arguments) ? frame.arguments[0] : null;
    if (args && typeof args === 'object' && JSON.stringify(args).length <= MAX_TEMPLATE_CHARS) {
      found = { sawChat: true, template: args as Record<string, unknown>, invocationType: frame.type as number };
    }
  }
  return found;
}

/** Un `tone` con forma de identificador de modelo de BizChat (p. ej. `Gpt_5_6_Reasoning`). */
export const TONE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,63}$/;
/** Cuántos modelos distintos se recuerdan. */
const MAX_OBSERVED_TONES = 20;

/** El `tone` (modelo) de una plantilla de invocación `chat`, si es válido. */
export function toneOfTemplate(template: Record<string, unknown> | undefined): string | null {
  const tone = template?.tone;
  return typeof tone === 'string' && TONE_PATTERN.test(tone) ? tone : null;
}

/**
 * `tones` con `tone` añadido como el más reciente (sin duplicados, acotado).
 * Así M365 puede estrenar un modelo y VS Code enterarse sin publicar versión:
 * en cuanto alguien lo usa en la web, la captura lo trae.
 */
export function withObservedTone(tones: readonly string[] | undefined, tone: string | null): string[] {
  const list = (tones ?? []).filter((item) => item !== tone);
  if (tone) list.push(tone);
  return list.slice(-MAX_OBSERVED_TONES);
}

/** El store sin el token si éste ya caducó (para invitar a recapturarlo), o null si no hay que tocarlo. */
export function withoutExpiredToken(store: CaptureStore, now = Date.now()): CaptureStore | null {
  const exp = store.claims?.exp;
  if (!store.accessToken || typeof exp !== 'number' || exp * 1000 > now) return null;
  const cleaned: CaptureStore = { ...store };
  delete cleaned.accessToken;
  delete cleaned.tokenSource;
  delete cleaned.claims;
  return cleaned;
}

/** Misma forma ignorando el sello temporal: sólo se escribe si algo cambió de verdad. */
export function sameCapture(a: CaptureStore, b: CaptureStore): boolean {
  const strip = (store: CaptureStore) => {
    const copy: CaptureStore = { ...store };
    delete copy.capturedAt;
    return JSON.stringify(copy);
  };
  return strip(a) === strip(b);
}

/** El perfil que se envía a VS Code, o null si todavía no hay token. */
export function profileFromCapture(store: CaptureStore, fallbackUserAgent: string): CopilotProfile | null {
  if (!store.accessToken) return null;
  return {
    version: 1,
    capturedAt: store.capturedAt || new Date().toISOString(),
    accessToken: store.accessToken,
    endpoint: store.endpoint || null,
    origin: store.origin || 'https://m365.cloud.microsoft',
    userAgent: store.userAgent || fallbackUserAgent,
    invocationTemplate: store.invocationTemplate || null,
    invocationType: store.invocationType || 4,
    claims: store.claims || null,
    ...(store.observedTones && store.observedTones.length > 0 ? { observedTones: [...store.observedTones] } : {}),
  };
}

// ------------------------------------------------------------- bucle de escaneo

/** Sin token: insistir. Con token fresco: vigilar de lejos. Cerca de caducar: apretar. */
export const SCAN_MISSING_MS = 2_000;
export const SCAN_MISSING_MAX_MS = 15_000;
export const SCAN_FRESH_MS = 60_000;
export const SCAN_EXPIRING_MS = 5_000;
/** A partir de aquí la web ya suele haber renovado su propio token. */
export const EXPIRY_WATCH_MS = 15 * 60 * 1000;

/**
 * Cuándo volver a escanear la caché de MSAL. Se escanea SIEMPRE, haya token o
 * no: el token nuevo que la web renueva sola cada ~50 min sólo se recoge así.
 */
export function nextScan(
  store: CaptureStore,
  missingDelay: number,
  now = Date.now(),
): { delay: number; missingDelay: number } {
  if (!store.accessToken) {
    const grown = Math.min(Math.round(missingDelay * 1.5), SCAN_MISSING_MAX_MS);
    return { delay: grown, missingDelay: grown };
  }
  const exp = store.claims?.exp;
  const left = typeof exp === 'number' ? exp * 1000 - now : null;
  return {
    delay: left !== null && left <= EXPIRY_WATCH_MS ? SCAN_EXPIRING_MS : SCAN_FRESH_MS,
    missingDelay: SCAN_MISSING_MS,
  };
}

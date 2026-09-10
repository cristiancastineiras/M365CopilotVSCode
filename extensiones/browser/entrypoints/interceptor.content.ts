import {
  CAPTURE_STORE_KEY,
  BRIDGE_MESSAGE_MARKER,
  extractClaims,
  isSydneyToken,
} from '@ms365copilot/core';
import { logger } from '@/utils/logger';

/**
 * Interceptor que corre en el mundo MAIN de la página.
 *
 * Aquí SÍ podemos hookear el `fetch`, `WebSocket`, `XMLHttpRequest` y las
 * cachés de MSAL de la propia web (comparten el `window` de la página). Lo que
 * NO tenemos en el mundo MAIN es `chrome.runtime`, así que no podemos hablar
 * con el background directamente: publicamos el perfil con `window.postMessage`
 * y el puente (content.ts, mundo ISOLATED) lo reenvía al background.
 */
export default defineContentScript({
  matches: [
    'https://m365.cloud.microsoft/*',
    'https://*.cloud.microsoft/*',
    'https://www.office.com/*',
    'https://outlook.office.com/*',
    'https://teams.microsoft.com/*',
  ],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    logger.info('M365 Copilot Token Interceptor (MAIN) loaded on:', window.location.href);

    const RS = '\x1e';

    /** Publica el perfil hacia el puente (mundo ISOLATED) para que lo reenvíe al background. */
    function postProfile(profile: any): void {
      try {
        window.postMessage(
          { [BRIDGE_MESSAGE_MARKER]: true, kind: 'PROFILE_UPDATED', payload: profile },
          location.origin,
        );
      } catch (err) {
        logger.error('Error posting profile to bridge:', err);
      }
    }

    // ---------------------------------------------------------------- utilidades

    function readStore(): any {
      try {
        const stored = localStorage.getItem(CAPTURE_STORE_KEY);
        return stored ? JSON.parse(stored) : {};
      } catch {
        return {};
      }
    }

    /** Serializa el store ignorando el sello temporal, para comparar cambios reales. */
    function fingerprint(store: any): string {
      const clone = Object.assign({}, store);
      delete clone.capturedAt;
      return JSON.stringify(clone);
    }

    /** Fusiona `patch` en el store, pero sólo escribe si algo cambió de verdad. */
    function writeStore(patch: any): any {
      const current = readStore();
      const merged = Object.assign({}, current, patch);
      if (fingerprint(current) === fingerprint(merged)) return current;
      merged.capturedAt = new Date().toISOString();
      localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(merged));

      // Publica la actualización hacia el puente (mundo ISOLATED).
      postProfile(merged);

      return merged;
    }

    /** ¿El token guardado ya caducó (según claims.exp)? */
    function tokenExpired(store: any): boolean {
      const exp = store && store.claims && store.claims.exp;
      return typeof exp === 'number' && exp * 1000 <= Date.now();
    }

    /** Si el token guardado caducó, lo descarta para invitar a recapturarlo. */
    function pruneExpiredToken(): boolean {
      const store = readStore();
      if (!store.accessToken || !tokenExpired(store)) return false;
      const cleaned = Object.assign({}, store);
      delete cleaned.accessToken;
      delete cleaned.tokenSource;
      delete cleaned.claims;
      cleaned.capturedAt = new Date().toISOString();
      localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(cleaned));
      return true;
    }

    /** Validación robusta de tokens JWT antes de guardarlos. */
    function isValidJWT(token: string): boolean {
      if (!token || typeof token !== 'string') return false;
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      // Validar que cada parte sea base64url válida
      for (const part of parts) {
        if (!/^[A-Za-z0-9_-]+$/.test(part)) return false;
      }
      // Límite de tamaño razonable para un JWT (evita payloads maliciosos)
      if (token.length > 8192) {
        logger.warn('Token JWT rechazado: excede 8KB');
        return false;
      }
      return true;
    }

    /** Validación de claims del token con tipos seguros. */
    function validateClaims(claims: any): boolean {
      if (!claims || typeof claims !== 'object') return false;
      // exp debe ser un timestamp futuro válido
      if (typeof claims.exp !== 'number' || claims.exp <= 0) return false;
      if (claims.exp * 1000 <= Date.now()) {
        logger.debug('Token rechazado: ya caducó');
        return false;
      }
      // iat (issued at) debe ser coherente
      if (claims.iat && (typeof claims.iat !== 'number' || claims.iat > claims.exp)) {
        logger.warn('Token rechazado: iat inválido');
        return false;
      }
      return true;
    }

    /** Guarda un token sólo si es de Sydney y no es más viejo que el que ya teníamos. */
    function offerToken(token: string, where: string): void {
      try {
        if (!isValidJWT(token)) return;
        if (!isSydneyToken(token)) return;
        
        const claims = extractClaims(token);
        if (!validateClaims(claims)) return;
        
        const current = readStore();
        if (current.accessToken === token) return;
        
        const currentExp = current.claims?.exp ?? 0;
        if (claims?.exp && currentExp && claims.exp < currentExp) {
          logger.debug(`Token de ${where} rechazado: más viejo que el actual`);
          return;
        }
        
        logger.info(`Token capturado desde ${where}, caduca en ${Math.round(((claims?.exp ?? 0) * 1000 - Date.now()) / 60000)} min`);
        writeStore({ accessToken: token, tokenSource: where, claims });
      } catch (error) {
        logger.error(`Error al procesar token desde ${where}:`, error);
      }
    }

    // -------------------------------------------------------- hook de WebSocket

    /** Límite de tamaño para frames de SignalR (evita payloads maliciosos). */
    const MAX_FRAME_SIZE = 1024 * 1024; // 1 MB
    const MAX_TEMPLATE_SIZE = 64 * 1024; // 64 KB para el template

    function inspectOutgoingFrame(data: any): boolean {
      if (typeof data !== 'string') return false;
      if (data.length > MAX_FRAME_SIZE) {
        logger.warn('Frame de SignalR rechazado: excede 1MB');
        return false;
      }
      
      let sawChat = false;
      for (const chunk of data.split(RS)) {
        if (!chunk) continue;
        let frame: any;
        try {
          frame = JSON.parse(chunk);
        } catch {
          continue;
        }
        // SignalR: type 4 = StreamInvocation, type 1 = Invocation.
        if ((frame.type === 4 || frame.type === 1) && frame.target === 'chat') {
          sawChat = true;
          const args = Array.isArray(frame.arguments) ? frame.arguments[0] : null;
          if (args && typeof args === 'object') {
            const templateJson = JSON.stringify(args);
            if (templateJson.length <= MAX_TEMPLATE_SIZE) {
              writeStore({ invocationTemplate: args, invocationType: frame.type });
            } else {
              logger.warn('Template de invocación rechazado: excede 64KB');
            }
          }
        }
      }
      return sawChat;
    }

    /** Quita los parámetros volátiles (token, ids de sesión) para no guardar basura ni un token caducado en el endpoint. */
    function normalizeEndpoint(raw: string): string {
      try {
        // Validar longitud antes de procesar
        if (typeof raw !== 'string' || raw.length > 2048) {
          logger.warn('Endpoint rechazado: longitud inválida');
          return '';
        }
        
        const sanitized = String(raw).replace(/^ws/i, 'http');
        const u = new URL(sanitized);
        
        // Validar que sea un endpoint de Microsoft
        if (!u.hostname.endsWith('.microsoft.com') && !u.hostname.endsWith('.microsoft')) {
          logger.warn(`Endpoint rechazado: hostname sospechoso (${u.hostname})`);
          return '';
        }
        for (const p of ['access_token', 'ConversationId', 'chatsessionid', 'clientrequestid', 'X-SessionId']) {
          u.searchParams.delete(p);
        }
        return u.toString().replace(/^http/i, 'ws');
      } catch {
        return String(raw);
      }
    }

    function captureSocket(url: string, ws: WebSocket): void {
      const raw = String(url);
      if (!/chathub/i.test(raw) && !/substrate/i.test(raw)) return;

      // Extrae el token de la query ANTES de normalizar (ahí es donde viaja).
      try {
        const parsed = new URL(raw.replace(/^ws/i, 'http'));
        const token = parsed.searchParams.get('access_token');
        if (token) offerToken(token, 'websocket-url');
      } catch {
        /* URL rara: nos quedamos igualmente con el endpoint */
      }

      // Substrate abre varios WebSockets (presencia, notificaciones…). Guardamos
      // éste sólo de forma tentativa hasta que veamos que envía un frame `chat`,
      // que es la prueba definitiva de que es el hub del chat. Un endpoint ya
      // confirmado no se pisa con un socket cualquiera.
      const endpoint = normalizeEndpoint(raw);
      if (!readStore().endpointConfirmed) {
        writeStore({ endpoint, origin: location.origin, userAgent: navigator.userAgent });
      }

      const originalSend = ws.send;
      ws.send = function (data: any) {
        try {
          if (inspectOutgoingFrame(data)) {
            // Este socket es, con certeza, el hub del chat: fija su endpoint.
            writeStore({
              endpoint,
              origin: location.origin,
              userAgent: navigator.userAgent,
              endpointConfirmed: true,
            });
          }
        } catch {
          /* nunca romper la web */
        }
        return originalSend.apply(this, arguments as any);
      };
    }

    if (window.WebSocket) {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args);
          try {
            captureSocket(args[0], socket);
          } catch {
            /* ignorar */
          }
          return socket;
        },
      });
    }

    // ------------------------------------------------------------- hook de fetch

    function headerValue(headers: any, name: string): string | null {
      if (!headers) return null;
      try {
        if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
        if (Array.isArray(headers)) {
          const hit = headers.find((h: any) => String(h[0]).toLowerCase() === name.toLowerCase());
          return hit ? hit[1] : null;
        }
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === name.toLowerCase()) return headers[key];
        }
      } catch {
        /* ignorar */
      }
      return null;
    }

    if (window.fetch) {
      const nativeFetch = window.fetch;
      window.fetch = function (input: any, init?: any) {
        try {
          let auth = headerValue(init && init.headers, 'authorization');
          if (!auth && typeof Request !== 'undefined' && input instanceof Request) {
            auth = input.headers.get('authorization');
          }
          if (auth && /^bearer /i.test(auth)) offerToken(auth.slice(7).trim(), 'fetch-header');
        } catch {
          /* ignorar */
        }
        return nativeFetch.apply(this, arguments as any);
      };
    }

    if (window.XMLHttpRequest) {
      const setHeader = window.XMLHttpRequest.prototype.setRequestHeader;
      window.XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
        try {
          if (String(name).toLowerCase() === 'authorization' && /^bearer /i.test(String(value))) {
            offerToken(String(value).slice(7).trim(), 'xhr-header');
          }
        } catch {
          /* ignorar */
        }
        return setHeader.apply(this, arguments as any);
      };
    }

    // --------------------------------------------- rastreo de la caché de MSAL

    /** MSAL guarda los access tokens en localStorage / sessionStorage como JSON. */
    function scanStorages(): void {
      for (const store of [window.localStorage, window.sessionStorage]) {
        let length = 0;
        try {
          length = store.length;
        } catch {
          continue;
        }
        for (let i = 0; i < length; i++) {
          let key: string | null, value: string | null;
          try {
            key = store.key(i);
            value = key ? store.getItem(key) : null;
          } catch {
            continue;
          }
          if (!value || value.length < 40 || !value.includes('eyJ')) continue;
          try {
            const parsed = JSON.parse(value);
            const secret = parsed && (parsed.secret || parsed.access_token || parsed.accessToken);
            if (typeof secret === 'string') offerToken(secret, 'msal-cache');
          } catch {
            // Algunas entradas guardan el JWT pelado.
            if (/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(value.trim())) offerToken(value.trim(), 'storage-raw');
          }
        }
      }
    }

    // ------------------------------------------------- bucle de captura

    /** Sin token: insistir. Con token fresco: vigilar de lejos. Cerca de caducar: apretar. */
    const SCAN_MISSING_MS = 2000;
    const SCAN_MISSING_MAX_MS = 15000;
    const SCAN_FRESH_MS = 60000;
    const SCAN_EXPIRING_MS = 5000;
    /** A partir de aquí la web ya suele haber renovado su propio token. */
    const EXPIRY_WATCH_MS = 15 * 60 * 1000;

    function msLeft(store: any): number | null {
      const exp = store && store.claims && store.claims.exp;
      return typeof exp === 'number' ? exp * 1000 - Date.now() : null;
    }

    let missingDelay = SCAN_MISSING_MS;

    function tick() {
      // Se escanea SIEMPRE, haya token o no. Antes, en cuanto había uno
      // guardado, el bucle dejaba de mirar la caché de MSAL y sólo comprobaba
      // si había caducado: nunca recogía el token nuevo que la web renueva sola
      // cada ~50 min, así que la sesión se rompía sin remedio al caducar el
      // viejo y había que recargar a mano.
      scanStorages();
      pruneExpiredToken();

      const store = readStore();
      let delay: number;
      if (!store.accessToken) {
        missingDelay = Math.min(Math.round(missingDelay * 1.5), SCAN_MISSING_MAX_MS);
        delay = missingDelay;
      } else {
        missingDelay = SCAN_MISSING_MS;
        const left = msLeft(store);
        delay = left !== null && left <= EXPIRY_WATCH_MS ? SCAN_EXPIRING_MS : SCAN_FRESH_MS;
      }
      setTimeout(tick, delay);
    }

    scanStorages();
    setTimeout(tick, missingDelay);

    // MSAL renueva en cuanto la pestaña vuelve a primer plano, y el evento
    // `storage` avisa de lo que escriben OTRAS pestañas del mismo origen: en
    // ambos casos suele haber un token nuevo esperando a que lo recojan.
    for (const [target, event] of [
      [document, 'visibilitychange'],
      [window, 'focus'],
      [window, 'storage'],
    ] as const) {
      target.addEventListener(event, () => {
        if (event === 'visibilitychange' && document.visibilityState !== 'visible') return;
        try {
          scanStorages();
        } catch {
          /* nunca romper la web */
        }
      });
    }

    // Peticiones del puente (mundo ISOLATED), que a su vez vienen del background.
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || data[BRIDGE_MESSAGE_MARKER] !== true) return;

      // Renovación pedida desde el background: mirar otra vez la caché de MSAL y
      // republicar lo que haya, aunque no haya cambiado — así el background
      // puede re-sincronizar con VS Code sin esperar a la siguiente captura.
      if (data.kind === 'RESCAN_REQUEST' || data.kind === 'REQUEST_PROFILE') {
        try {
          scanStorages();
        } catch {
          /* ignorar */
        }
        const store = readStore();
        if (store && store.accessToken) postProfile(store);
      }
    });

    // Si ya había un perfil capturado de una sesión anterior, reenvíalo una vez
    // al arrancar para que el background y VS Code vuelvan a sincronizarse. Se
    // hace con un pequeño retardo para dar tiempo a que el puente (mundo
    // ISOLATED) registre su listener de `window.message`.
    const existing = readStore();
    if (existing && existing.accessToken) {
      setTimeout(() => postProfile(existing), 500);
    }
  },
});

import {
  CAPTURE_STORE_KEY,
  BRIDGE_MESSAGE_MARKER,
  COPILOT_CONTENT_MATCHES,
  SCAN_MISSING_MS,
  diagnoseToken,
  inspectOutgoingFrames,
  isCopilotSocketUrl,
  nextScan,
  normalizeEndpoint,
  sameCapture,
  tokenInSocketUrl,
  tokensInStorageValue,
  toneOfTemplate,
  withObservedTone,
  withoutExpiredToken,
  type CaptureStore,
} from '@m365copilot/core';
import { logger } from '@/utils/logger';

/**
 * Traza de diagnóstico, apagada salvo que alguien ponga
 * `localStorage['m365copilot.debug'] = '1'` y recargue. Es la respuesta al
 * «no captura y no sale ningún log»: con esto se ve cada WebSocket que abre la
 * web, cuántas entradas de MSAL se miran y por qué se descarta cada token,
 * sin tener que hacer un build especial. En producción `logger.debug` está
 * mudo, por eso aquí se usa `logger.info` a propósito.
 */
const VERBOSE = (() => {
  try {
    return localStorage.getItem('m365copilot.debug') === '1';
  } catch {
    return false;
  }
})();
function diag(...args: unknown[]): void {
  if (VERBOSE) logger.info('[diag]', ...args);
}

/**
 * Interceptor que corre en el mundo MAIN de la página.
 *
 * Aquí SÍ podemos hookear el `fetch`, `WebSocket`, `XMLHttpRequest` y las
 * cachés de MSAL de la propia web (comparten el `window` de la página). Lo que
 * NO tenemos en el mundo MAIN es `chrome.runtime`, así que no podemos hablar
 * con el background directamente: publicamos el perfil con `window.postMessage`
 * y el puente (content.ts, mundo ISOLATED) lo reenvía al background.
 *
 * Las decisiones (qué token aceptar, qué frame es el del chat, cuándo volver a
 * escanear) viven en `@m365copilot/core` (capture.ts) y son las mismas que usa
 * el userscript de Tampermonkey; aquí sólo queda el pegamento con la página.
 */
export default defineContentScript({
  matches: [...COPILOT_CONTENT_MATCHES],
  // El chat de Copilot se renderiza dentro de un iframe en varias de estas
  // webs (y en Edge el encuadre no es el mismo que en Chrome). Sin
  // `allFrames` el interceptor sólo corría en el documento de arriba, así que
  // ni veía el WebSocket del chat ni la caché de MSAL del iframe: no capturaba
  // nada y no dejaba ni un log. Con esto corre en cada frame de Microsoft.
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    logger.info('M365 Copilot Token Interceptor (MAIN) loaded on:', window.location.href);
    diag('verbose activado; top frame =', window.top === window.self);

    /** Publica el perfil hacia el puente (mundo ISOLATED) para que lo reenvíe al background. */
    function postProfile(profile: CaptureStore): void {
      try {
        window.postMessage(
          { [BRIDGE_MESSAGE_MARKER]: true, kind: 'PROFILE_UPDATED', payload: profile },
          location.origin,
        );
      } catch (err) {
        logger.error('Error posting profile to bridge:', err);
      }
    }

    // ---------------------------------------------------------------- estado

    function readStore(): CaptureStore {
      try {
        const stored = localStorage.getItem(CAPTURE_STORE_KEY);
        return stored ? (JSON.parse(stored) as CaptureStore) : {};
      } catch {
        return {};
      }
    }

    /** Fusiona `patch` en el store, pero sólo escribe (y publica) si algo cambió de verdad. */
    function writeStore(patch: CaptureStore): CaptureStore {
      const current = readStore();
      const merged: CaptureStore = { ...current, ...patch };
      if (sameCapture(current, merged)) return current;
      merged.capturedAt = new Date().toISOString();
      localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(merged));
      postProfile(merged);
      return merged;
    }

    /** Si el token guardado caducó, lo descarta para invitar a recapturarlo. */
    function pruneExpiredToken(): void {
      const cleaned = withoutExpiredToken(readStore());
      if (!cleaned) return;
      cleaned.capturedAt = new Date().toISOString();
      localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(cleaned));
    }

    /** Guarda un token sólo si es de Sydney, válido y no más viejo que el que ya teníamos. */
    function offerToken(token: string, where: string): void {
      try {
        const { diagnosis, accepted } = diagnoseToken(readStore(), token);
        if (!accepted) {
          // `not-sydney` es de lo más normal (cada fetch a Graph trae su
          // bearer), por eso sólo se registra en modo verboso.
          diag(`token descartado desde ${where}: ${diagnosis}`);
          return;
        }
        const minutes = Math.round(((accepted.claims.exp ?? 0) * 1000 - Date.now()) / 60000);
        logger.info(`Token capturado desde ${where}, caduca en ${minutes} min`);
        writeStore({ ...accepted, tokenSource: where });
      } catch (error) {
        logger.error(`Error al procesar token desde ${where}:`, error);
      }
    }

    // -------------------------------------------------------- hook de WebSocket

    function captureSocket(url: string, ws: WebSocket): void {
      const copilot = isCopilotSocketUrl(url);
      // Se registra TODO socket (recortado) en modo verboso: así se distingue
      // «la web no abre ningún socket aquí» (mal frame/dominio) de «lo abre
      // pero no lo reconozco» (patrón de URL a actualizar).
      diag('WebSocket:', String(url).split('?')[0], copilot ? '(copilot)' : '(ignorado)');
      if (!copilot) return;

      // El token viaja en la query: se extrae ANTES de normalizar la URL.
      const token = tokenInSocketUrl(url);
      diag('socket de copilot; token en la URL:', Boolean(token));
      if (token) offerToken(token, 'websocket-url');

      // Substrate abre varios WebSockets (presencia, notificaciones…). Guardamos
      // éste sólo de forma tentativa hasta que veamos que envía un frame `chat`,
      // que es la prueba definitiva de que es el hub del chat. Un endpoint ya
      // confirmado no se pisa con un socket cualquiera.
      const endpoint = normalizeEndpoint(String(url));
      if (endpoint && !readStore().endpointConfirmed) {
        writeStore({ endpoint, origin: location.origin, userAgent: navigator.userAgent });
      }

      const originalSend = ws.send;
      ws.send = function (data: any) {
        try {
          const frames = inspectOutgoingFrames(data);
          if (frames.sawChat) {
            // Este socket es, con certeza, el hub del chat: fija su endpoint, y
            // apunta qué modelo (`tone`) usó la web para que VS Code lo ofrezca.
            const tone = toneOfTemplate(frames.template);
            writeStore({
              ...(tone ? { observedTones: withObservedTone(readStore().observedTones, tone) } : {}),
              ...(endpoint ? { endpoint, endpointConfirmed: true } : {}),
              origin: location.origin,
              userAgent: navigator.userAgent,
              ...(frames.template ? { invocationTemplate: frames.template, invocationType: frames.invocationType } : {}),
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

    function scanStorages(): void {
      let keysScanned = 0;
      let candidates = 0;
      for (const store of [window.localStorage, window.sessionStorage]) {
        let length = 0;
        try {
          length = store.length;
        } catch {
          continue;
        }
        for (let i = 0; i < length; i++) {
          try {
            const key = store.key(i);
            if (!key || key === CAPTURE_STORE_KEY) continue;
            keysScanned++;
            for (const token of tokensInStorageValue(store.getItem(key))) {
              candidates++;
              offerToken(token, 'msal-cache');
            }
          } catch {
            /* entrada ilegible: la siguiente */
          }
        }
      }
      diag(`escaneo MSAL: ${keysScanned} claves, ${candidates} candidatos`);
    }

    // ------------------------------------------------- bucle de captura

    let missingDelay = SCAN_MISSING_MS;

    function tick() {
      scanStorages();
      pruneExpiredToken();
      const next = nextScan(readStore(), missingDelay);
      missingDelay = next.missingDelay;
      setTimeout(tick, next.delay);
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
        if (store.accessToken) postProfile(store);
      }
    });

    // Si ya había un perfil capturado de una sesión anterior, reenvíalo una vez
    // al arrancar para que el background y VS Code vuelvan a sincronizarse. Se
    // hace con un pequeño retardo para dar tiempo a que el puente (mundo
    // ISOLATED) registre su listener de `window.message`.
    const existing = readStore();
    if (existing.accessToken) {
      setTimeout(() => postProfile(existing), 500);
    }
  },
});

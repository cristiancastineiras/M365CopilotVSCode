// ==UserScript==
// @name         M365 Copilot — Copiar perfil / token
// @namespace    https://github.com/local/m365-vscode
// @version      1.2.0
// @description  Captura el token de acceso (aud: substrate.office.com/sydney), el endpoint WebSocket real y la plantilla de invocación de Microsoft 365 Copilot, y los copia al portapapeles para pegarlos en la extensión de VS Code.
// @author       Cristian Castineiras
// @run-at       document-start
// @match        https://m365.cloud.microsoft/*
// @match        https://*.cloud.microsoft/*
// @match        https://www.office.com/*
// @match        https://outlook.office.com/*
// @match        https://teams.microsoft.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// ==/UserScript==

/*
 * Cómo funciona
 * -------------
 * El chat web de M365 Copilot habla con Substrate ("Sydney" / BizChat) por WebSocket:
 *
 *   wss://substrate.office.com/m365Copilot/Chathub/{oid}@{tid}?access_token=...&ConversationId=...
 *
 * El token viaja en la query string, no en una cabecera. Además cada tenant/anillo
 * usa host, ruta y `variants` distintos, así que en vez de adivinar el protocolo lo
 * CAPTURAMOS: interceptamos `WebSocket`, `fetch` y `XMLHttpRequest` en la página y
 * guardamos:
 *
 *   - accessToken        JWT con aud https://substrate.office.com/sydney
 *   - endpoint           la URL wss completa, tal cual la usa la web
 *   - invocationTemplate el frame SignalR type:4 target:"chat" que envía la web
 *
 * Ese trío es el «perfil» que se pega en VS Code. Con él la extensión reproduce
 * exactamente las mismas llamadas que hace el navegador.
 */

(function () {
  'use strict';

  const STORE_KEY = 'm365copilot.capture.v1';
  const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const IS_TOP = (() => {
    try {
      return window.top === window.self;
    } catch {
      return false;
    }
  })();

  // ---------------------------------------------------------------- utilidades

  /** Decodifica el payload de un JWT sin validar la firma (UTF-8 vía TextDecoder). */
  function decodeJwt(token) {
    try {
      const part = String(token).split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
      const binary = atob(b64);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
      return null;
    }
  }

  /** ¿Es un token de Substrate/Sydney, el que usa Copilot? */
  function isSydneyToken(token) {
    const claims = decodeJwt(token);
    if (!claims) return false;
    const aud = String(claims.aud || '');
    const scp = String(claims.scp || claims.scope || '');
    return (
      aud.includes('substrate.office.com') ||
      aud.includes('substrate.svc.cloud.microsoft') ||
      /sydney|m365chat/i.test(scp)
    );
  }

  function readStore() {
    try {
      return JSON.parse(GM_getValue(STORE_KEY, '{}')) || {};
    } catch {
      return {};
    }
  }

  /** Serializa el store ignorando el sello temporal, para comparar cambios reales. */
  function fingerprint(store) {
    const clone = Object.assign({}, store);
    delete clone.capturedAt;
    return JSON.stringify(clone);
  }

  /** Fusiona `patch` en el store, pero sólo escribe si algo cambió de verdad. */
  function writeStore(patch) {
    const current = readStore();
    const merged = Object.assign({}, current, patch);
    // Escribir un valor idéntico dispararía el listener y haría crecer el
    // almacenamiento sin motivo; comparamos todo menos `capturedAt`.
    if (fingerprint(current) === fingerprint(merged)) return current;
    merged.capturedAt = new Date().toISOString();
    GM_setValue(STORE_KEY, JSON.stringify(merged));
    return merged;
  }

  /** ¿El token guardado ya caducó (según claims.exp)? */
  function tokenExpired(store) {
    const exp = store && store.claims && store.claims.exp;
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  }

  /** Si el token guardado caducó, lo descarta para invitar a recapturarlo. */
  function pruneExpiredToken() {
    const store = readStore();
    if (!store.accessToken || !tokenExpired(store)) return false;
    const cleaned = Object.assign({}, store);
    delete cleaned.accessToken;
    delete cleaned.tokenSource;
    delete cleaned.claims;
    cleaned.capturedAt = new Date().toISOString();
    GM_setValue(STORE_KEY, JSON.stringify(cleaned));
    return true;
  }

  /** Guarda un token sólo si es de Sydney y no es más viejo que el que ya teníamos. */
  function offerToken(token, where) {
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) return;
    if (!isSydneyToken(token)) return;
    const claims = decodeJwt(token) || {};
    const current = readStore();
    if (current.accessToken === token) return;
    const currentExp = current.claims && current.claims.exp ? current.claims.exp : 0;
    if (claims.exp && currentExp && claims.exp < currentExp) return;
    writeStore({
      accessToken: token,
      tokenSource: where,
      claims: {
        oid: claims.oid,
        tid: claims.tid,
        aud: claims.aud,
        exp: claims.exp,
        upn: claims.upn || claims.unique_name || claims.preferred_username,
      },
    });
  }

  // -------------------------------------------------------- hook de WebSocket

  const RS = '';

  function inspectOutgoingFrame(data) {
    if (typeof data !== 'string') return false;
    let sawChat = false;
    for (const chunk of data.split(RS)) {
      if (!chunk) continue;
      let frame;
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
          writeStore({ invocationTemplate: args, invocationType: frame.type });
        }
      }
    }
    return sawChat;
  }

  /** Quita los parámetros volátiles (token, ids de sesión) para no guardar basura ni un token caducado en el endpoint. */
  function normalizeEndpoint(raw) {
    try {
      const u = new URL(String(raw).replace(/^ws/i, 'http'));
      for (const p of ['access_token', 'ConversationId', 'chatsessionid', 'clientrequestid', 'X-SessionId']) {
        u.searchParams.delete(p);
      }
      return u.toString().replace(/^http/i, 'ws');
    } catch {
      return String(raw);
    }
  }

  function captureSocket(url, ws) {
    const raw = String(url);
    if (!/chathub/i.test(raw) && !/substrate/i.test(raw)) return;

    // Extrae el token de la query ANTES de normalizar (ahí es donde viaja).
    try {
      const parsed = new URL(raw.replace(/^ws/i, 'http'));
      offerToken(parsed.searchParams.get('access_token'), 'websocket-url');
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
    ws.send = function (data) {
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
      return originalSend.apply(this, arguments);
    };
  }

  if (PAGE.WebSocket) {
    const NativeWebSocket = PAGE.WebSocket;
    // El Proxy conserva `prototype` y estáticos, así que `instanceof` sigue
    // funcionando; sólo cambia la identidad `window.WebSocket === nativo`, que
    // esta web no comprueba.
    PAGE.WebSocket = new Proxy(NativeWebSocket, {
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

  function headerValue(headers, name) {
    if (!headers) return null;
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
      if (Array.isArray(headers)) {
        const hit = headers.find((h) => String(h[0]).toLowerCase() === name.toLowerCase());
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

  if (PAGE.fetch) {
    const nativeFetch = PAGE.fetch;
    PAGE.fetch = function (input, init) {
      try {
        let auth = headerValue(init && init.headers, 'authorization');
        if (!auth && typeof Request !== 'undefined' && input instanceof Request) {
          auth = input.headers.get('authorization');
        }
        if (auth && /^bearer /i.test(auth)) offerToken(auth.slice(7).trim(), 'fetch-header');
      } catch {
        /* ignorar */
      }
      return nativeFetch.apply(this, arguments);
    };
  }

  if (PAGE.XMLHttpRequest) {
    const setHeader = PAGE.XMLHttpRequest.prototype.setRequestHeader;
    PAGE.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        if (String(name).toLowerCase() === 'authorization' && /^bearer /i.test(String(value))) {
          offerToken(String(value).slice(7).trim(), 'xhr-header');
        }
      } catch {
        /* ignorar */
      }
      return setHeader.apply(this, arguments);
    };
  }

  // --------------------------------------------- rastreo de la caché de MSAL

  /** MSAL guarda los access tokens en localStorage / sessionStorage como JSON. */
  function scanStorages() {
    for (const store of [PAGE.localStorage, PAGE.sessionStorage]) {
      let length = 0;
      try {
        length = store.length;
      } catch {
        continue;
      }
      for (let i = 0; i < length; i++) {
        let key, value;
        try {
          key = store.key(i);
          value = store.getItem(key);
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

  // ------------------------------------------------------------------- interfaz

  function buildProfile() {
    const s = readStore();
    if (!s.accessToken) return null;
    return {
      version: 1,
      capturedAt: s.capturedAt || new Date().toISOString(),
      accessToken: s.accessToken,
      endpoint: s.endpoint || null,
      origin: s.origin || 'https://m365.cloud.microsoft',
      userAgent: s.userAgent || navigator.userAgent,
      invocationTemplate: s.invocationTemplate || null,
      invocationType: s.invocationType || 4,
      claims: s.claims || null,
    };
  }

  function copy(text) {
    try {
      GM_setClipboard(text, 'text');
      return true;
    } catch {
      try {
        PAGE.navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  function minutesLeft(exp) {
    if (!exp) return null;
    return Math.round((exp * 1000 - Date.now()) / 60000);
  }

  function mountUi() {
    if (!IS_TOP || document.getElementById('m365copilot-grabber')) return;

    const host = document.createElement('div');
    host.id = 'm365copilot-grabber';
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    const style = document.createElement('style');
    style.textContent = [
      '.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;',
      '  width: 268px; padding: 12px 14px; border-radius: 10px; background: #1f1f1f;',
      '  color: #f3f3f3; box-shadow: 0 6px 24px rgba(0,0,0,.4);',
      '  font: 12px/1.45 "Segoe UI", system-ui, sans-serif; }',
      '.title { font-weight: 600; margin-bottom: 8px; display: flex;',
      '  justify-content: space-between; align-items: center; }',
      '.close { cursor: pointer; opacity: .55; background: none; border: 0; color: inherit; font-size: 14px; }',
      '.close:hover { opacity: 1; }',
      '.row { display: flex; gap: 6px; align-items: baseline; }',
      '.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }',
      '.ok { background: #4ec26a; } .no { background: #d9534f; }',
      'button.act { width: 100%; margin-top: 10px; padding: 7px 10px; border: 0; border-radius: 6px;',
      '  background: #0f6cbd; color: #fff; font: 600 12px "Segoe UI", system-ui, sans-serif; cursor: pointer; }',
      'button.act:hover { background: #115ea3; }',
      'button.act:disabled { background: #3a3a3a; color: #999; cursor: not-allowed; }',
      'button.ghost { background: transparent; border: 1px solid #4a4a4a; color: #ddd; margin-top: 6px; }',
      'button.ghost:hover:enabled { background: #2b2b2b; }',
      '.hint { margin-top: 8px; font-size: 11px; opacity: .7; }',
    ].join('\n');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = [
      '<div class="title"><span>M365 Copilot → VS Code</span><button class="close" title="Ocultar">✕</button></div>',
      '<div class="row"><span class="dot no" data-dot="token"></span><span data-label="token">Token: sin capturar</span></div>',
      '<div class="row"><span class="dot no" data-dot="endpoint"></span><span data-label="endpoint">Endpoint: sin capturar</span></div>',
      '<div class="row"><span class="dot no" data-dot="frame"></span><span data-label="frame">Plantilla: sin capturar</span></div>',
      '<button class="act" data-action="profile" disabled>Copiar perfil completo</button>',
      '<button class="act ghost" data-action="token" disabled>Copiar sólo el token</button>',
      '<div class="hint" data-hint>Envía un mensaje en el chat para capturarlo todo.</div>',
    ].join('');

    root.appendChild(style);
    root.appendChild(panel);
    (document.body || document.documentElement).appendChild(host);

    const q = (sel) => panel.querySelector(sel);

    function render() {
      const s = readStore();
      const hasToken = Boolean(s.accessToken);
      const hasEndpoint = Boolean(s.endpoint);
      const hasFrame = Boolean(s.invocationTemplate);
      const left = hasToken && s.claims ? minutesLeft(s.claims.exp) : null;

      const set = (name, ok, text) => {
        q('[data-dot="' + name + '"]').className = 'dot ' + (ok ? 'ok' : 'no');
        q('[data-label="' + name + '"]').textContent = text;
      };

      set(
        'token',
        hasToken,
        hasToken
          ? 'Token: ok' + (left === null ? '' : left > 0 ? ' (' + left + ' min)' : ' (caducado)')
          : 'Token: sin capturar',
      );
      set('endpoint', hasEndpoint, hasEndpoint ? 'Endpoint: capturado' : 'Endpoint: sin capturar');
      set('frame', hasFrame, hasFrame ? 'Plantilla: capturada' : 'Plantilla: sin capturar');

      q('[data-action="profile"]').disabled = !hasToken;
      q('[data-action="token"]').disabled = !hasToken;
      q('[data-hint]').textContent =
        hasEndpoint && hasFrame
          ? 'Listo. Pégalo en VS Code: «M365 Copilot: Pegar perfil o token».'
          : 'Envía un mensaje en el chat para capturarlo todo.';
    }

    q('.close').addEventListener('click', () => host.remove());

    q('[data-action="profile"]').addEventListener('click', (e) => {
      const profile = buildProfile();
      if (!profile) return;
      copy(JSON.stringify(profile, null, 2));
      e.target.textContent = '¡Copiado!';
      setTimeout(() => (e.target.textContent = 'Copiar perfil completo'), 1600);
    });

    q('[data-action="token"]').addEventListener('click', (e) => {
      const s = readStore();
      if (!s.accessToken) return;
      copy(s.accessToken);
      e.target.textContent = '¡Copiado!';
      setTimeout(() => (e.target.textContent = 'Copiar sólo el token'), 1600);
    });

    render();

    // Bucle de captura autorregulado. Mientras no haya token, escanea la caché
    // MSAL con un intervalo que crece (2s → 15s). En cuanto hay token, deja de
    // escanear (los hooks de WebSocket/fetch ya mantienen endpoint y plantilla)
    // y sólo refresca despacio para la cuenta atrás, purgando el token caducado.
    let scanDelay = 2000;
    const SCAN_MAX = 15000;
    function tick() {
      if (readStore().accessToken) {
        scanDelay = pruneExpiredToken() ? 2000 : 30000;
      } else {
        scanStorages();
        scanDelay = Math.min(Math.round(scanDelay * 1.5), SCAN_MAX);
      }
      render();
      setTimeout(tick, scanDelay);
    }
    setTimeout(tick, scanDelay);

    try {
      GM_addValueChangeListener(STORE_KEY, render);
    } catch {
      /* el intervalo ya cubre el refresco */
    }
  }

  scanStorages();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountUi, { once: true });
  } else {
    mountUi();
  }
})();

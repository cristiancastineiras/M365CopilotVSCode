/**
 * M365 Copilot → VS Code, Tampermonkey/Violentmonkey userscript.
 *
 * The alternative to the browser extension, with the same behaviour: it
 * captures the Copilot (Substrate/Sydney) token from the page — the WebSocket
 * URL, request headers and the MSAL cache — keeps scanning so the token the
 * web app renews by itself every ~50 min is picked up, and SENDS it to the VS
 * Code extension's local server, so there is nothing to copy and paste.
 *
 * Every decision (which token to accept, which frame is the chat, when to scan
 * again, when to re-sync with VS Code) comes from `@m365copilot/core`, the
 * same code the browser extension runs. This file is bundled into
 * `../m365copilot-token.user.js` by scripts/build-userscript.mjs — edit this
 * one, never the generated file.
 *
 * State lives in GM storage, shared by every tab and frame where the script
 * runs: any frame can capture, the top-level frames sync and draw the panel.
 */
import {
  CAPTURE_STORE_KEY,
  HEALTH_ENDPOINT_PATH,
  M365_CHAT_URL,
  SCAN_MISSING_MS,
  TOKEN_ENDPOINT_PATH,
  TOKEN_SERVER_URL,
  acceptToken,
  accountKind,
  connectionArtSvg,
  connectionState,
  inspectOutgoingFrames,
  isCapturedTokenUsable,
  isCopilotSocketUrl,
  needsResync,
  nextScan,
  normalizeEndpoint,
  profileFromCapture,
  rejectedByVSCode,
  sameCapture,
  tokenInSocketUrl,
  tokenStamp,
  tokensInStorageValue,
  withoutExpiredToken,
  type CaptureStore,
} from "@m365copilot/core";

const SYNC_KEY = "m365copilot.sync.v1";
const UI_KEY = "m365copilot.ui.v1";
const HEALTH_EVERY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 4_000;
/** Reload a hidden tab whose token expired at most this often (shared by all tabs). */
const RELOAD_EVERY_MS = 10 * 60_000;
/** Never reload a page that has been open for less than this (no reload loops). */
const MIN_PAGE_AGE_MS = 2 * 60_000;

interface SyncState {
  /** `exp` of the token VS Code confirmed it received. */
  syncedTokenExp: number | null;
  lastSyncAttemptAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
  /** null until the first health check answers. */
  vscodeReachable: boolean | null;
  lastReloadAt: number | null;
}

interface UiState {
  minimized: boolean;
  autoReload: boolean;
}

const EMPTY_SYNC: SyncState = {
  syncedTokenExp: null,
  lastSyncAttemptAt: null,
  lastSyncedAt: null,
  lastError: null,
  vscodeReachable: null,
  lastReloadAt: null,
};

const PAGE: Window & typeof globalThis =
  typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
const IS_TOP = (() => {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
})();
const LOADED_AT = Date.now();

// ------------------------------------------------------------------ texts

const TEXTS = {
  en: {
    title: "M365 Copilot → VS Code",
    art: "Connection between Microsoft 365 Copilot and VS Code",
    minimize: "Minimize",
    expand: "Show the M365 Copilot panel",
    close: "Hide until the next page load",
    waitingTitle: "Waiting for the token",
    waitingSub: "Send a message in the chat to capture it.",
    capturedTitle: "Token ready",
    capturedSub: "VS Code is not answering. Open it with the M365 Copilot extension enabled.",
    connectedTitle: "Connected to VS Code",
    connectedSub: "The token is sent automatically whenever it is renewed.",
    connectedSubPersonal: "The token is sent automatically each time you chat here.",
    warningTitle: "Token expired",
    warningSub: "Reload this page or sign in again to renew it.",
    rejectedTitle: "VS Code rejected the token",
    rejectedSub: "Update the M365 Copilot extension in VS Code and reload the window.",
    account: "Account",
    accountNone: "—",
    accountPersonal: "personal",
    accountEnterprise: "work or school",
    token: "Token",
    tokenNone: "not captured",
    tokenLeft: "{0} min left",
    tokenExpired: "expired",
    vscode: "VS Code",
    vscodeOk: "connected",
    vscodeDown: "not answering",
    vscodeRejected: "rejected the token",
    vscodeChecking: "checking…",
    sync: "Last sync",
    syncNever: "never",
    syncJustNow: "just now",
    syncAgo: "{0} min ago",
    send: "Send to VS Code",
    sent: "✓ Sent",
    sendFailed: "VS Code did not answer",
    copyToken: "Copy token",
    copyProfile: "Copy profile",
    copied: "✓ Copied",
    renew: "Reload to renew",
    menuShow: "Show panel",
    menuSend: "Send token to VS Code now",
    menuAutoReloadOn: "Auto-renew: reload this tab when hidden and expired — currently ON",
    menuAutoReloadOff: "Auto-renew: reload this tab when hidden and expired — currently OFF",
    openM365: "Open M365 Copilot",
  },
  es: {
    title: "M365 Copilot → VS Code",
    art: "Conexión entre Microsoft 365 Copilot y VS Code",
    minimize: "Minimizar",
    expand: "Mostrar el panel de M365 Copilot",
    close: "Ocultar hasta la próxima carga de la página",
    waitingTitle: "Esperando el token",
    waitingSub: "Envía un mensaje en el chat para capturarlo.",
    capturedTitle: "Token listo",
    capturedSub: "VS Code no responde. Ábrelo con la extensión M365 Copilot activa.",
    connectedTitle: "Conectado con VS Code",
    connectedSub: "El token se envía solo cada vez que se renueva.",
    connectedSubPersonal: "El token se envía solo cada vez que chateas aquí.",
    warningTitle: "Token caducado",
    warningSub: "Recarga esta página o vuelve a iniciar sesión para renovarlo.",
    rejectedTitle: "VS Code rechazó el token",
    rejectedSub: "Actualiza la extensión M365 Copilot en VS Code y recarga la ventana.",
    account: "Cuenta",
    accountNone: "—",
    accountPersonal: "personal",
    accountEnterprise: "profesional",
    token: "Token",
    tokenNone: "sin capturar",
    tokenLeft: "quedan {0} min",
    tokenExpired: "caducado",
    vscode: "VS Code",
    vscodeOk: "conectado",
    vscodeDown: "no responde",
    vscodeRejected: "rechazó el token",
    vscodeChecking: "comprobando…",
    sync: "Última sincronización",
    syncNever: "nunca",
    syncJustNow: "ahora mismo",
    syncAgo: "hace {0} min",
    send: "Enviar a VS Code",
    sent: "✓ Enviado",
    sendFailed: "VS Code no respondió",
    copyToken: "Copiar token",
    copyProfile: "Copiar perfil",
    copied: "✓ Copiado",
    renew: "Recargar para renovar",
    menuShow: "Mostrar el panel",
    menuSend: "Enviar el token a VS Code ahora",
    menuAutoReloadOn: "Auto-renovar: recargar esta pestaña oculta si caduca — ahora ACTIVADO",
    menuAutoReloadOff: "Auto-renovar: recargar esta pestaña oculta si caduca — ahora DESACTIVADO",
    openM365: "Abrir M365 Copilot",
  },
};
const T = /^es\b/i.test(navigator.language || "") ? TEXTS.es : TEXTS.en;
function fill(template: string, value: number): string {
  return template.replace("{0}", String(value));
}
function flash(button: HTMLButtonElement, text: string, restore: () => void): void {
  button.textContent = text;
  setTimeout(restore, 1600);
}

// ------------------------------------------------------------------ storage

function readJson<V>(key: string, fallback: V): V {
  try {
    const raw = GM_getValue<string>(key, "");
    return raw ? { ...fallback, ...(JSON.parse(raw) as V) } : fallback;
  } catch {
    return fallback;
  }
}

const readStore = (): CaptureStore => readJson<CaptureStore>(CAPTURE_STORE_KEY, {});
const readSync = (): SyncState => readJson<SyncState>(SYNC_KEY, EMPTY_SYNC);
const readUi = (): UiState => readJson<UiState>(UI_KEY, { minimized: false, autoReload: true });
const writeSync = (patch: Partial<SyncState>) =>
  GM_setValue(SYNC_KEY, JSON.stringify({ ...readSync(), ...patch }));
const writeUi = (patch: Partial<UiState>) =>
  GM_setValue(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));

/** Merge `patch` into the capture, writing only when something really changed. */
function writeStore(patch: CaptureStore): CaptureStore {
  const current = readStore();
  const merged: CaptureStore = { ...current, ...patch };
  if (sameCapture(current, merged)) return current;
  merged.capturedAt = new Date().toISOString();
  GM_setValue(CAPTURE_STORE_KEY, JSON.stringify(merged));
  return merged;
}

function pruneExpiredToken(): void {
  const cleaned = withoutExpiredToken(readStore());
  if (!cleaned) return;
  cleaned.capturedAt = new Date().toISOString();
  GM_setValue(CAPTURE_STORE_KEY, JSON.stringify(cleaned));
}

function offerToken(token: string | null, source: string, socketUrl?: string): void {
  if (!token) return;
  try {
    const accepted = acceptToken(readStore(), token, undefined, socketUrl);
    if (!accepted) return;
    writeStore({ ...accepted, tokenSource: source });
    if (IS_TOP) void syncToVSCode(hasUnsentToken());
  } catch {
    /* never break the page */
  }
}

// ------------------------------------------------------------------ capture hooks

function captureSocket(url: unknown, socket: WebSocket): void {
  const raw = String(url);
  if (!isCopilotSocketUrl(raw)) return;

  // Substrate opens several sockets (presence, notifications…): keep this one
  // only tentatively, until it sends a `chat` frame — the proof it is the hub.
  // Before the token, so that the first send to VS Code is already complete.
  const endpoint = normalizeEndpoint(raw);
  if (endpoint && !readStore().endpointConfirmed) {
    writeStore({ endpoint, origin: location.origin, userAgent: navigator.userAgent });
  }
  offerToken(tokenInSocketUrl(raw), "websocket-url", raw);

  const originalSend = socket.send;
  socket.send = function (this: WebSocket, ...args: Parameters<WebSocket["send"]>) {
    try {
      const frames = inspectOutgoingFrames(args[0]);
      if (frames.sawChat) {
        writeStore({
          ...(endpoint ? { endpoint, endpointConfirmed: true } : {}),
          origin: location.origin,
          userAgent: navigator.userAgent,
          ...(frames.template
            ? { invocationTemplate: frames.template, invocationType: frames.invocationType }
            : {}),
        });
      }
    } catch {
      /* never break the page */
    }
    return originalSend.apply(this, args);
  };
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  try {
    const wanted = name.toLowerCase();
    if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name);
    if (Array.isArray(headers)) {
      const hit = headers.find((entry) => String(entry[0]).toLowerCase() === wanted);
      return hit ? String(hit[1]) : null;
    }
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() === wanted) return String(value);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function offerBearer(value: string | null, source: string): void {
  if (value && /^bearer /i.test(value)) offerToken(value.slice(7), source);
}

function installHooks(): void {
  if (PAGE.WebSocket) {
    const NativeWebSocket = PAGE.WebSocket;
    // A Proxy keeps `prototype` and the statics, so `instanceof` still works.
    PAGE.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        try {
          captureSocket(args[0], socket);
        } catch {
          /* ignore */
        }
        return socket;
      },
    });
  }

  if (PAGE.fetch) {
    const nativeFetch = PAGE.fetch;
    PAGE.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      try {
        let auth = headerValue(init?.headers, "authorization");
        if (!auth && typeof Request !== "undefined" && input instanceof Request)
          auth = input.headers.get("authorization");
        offerBearer(auth, "fetch-header");
      } catch {
        /* ignore */
      }
      return nativeFetch.call(this, input, init);
    } as typeof fetch;
  }

  if (PAGE.XMLHttpRequest) {
    const setHeader = PAGE.XMLHttpRequest.prototype.setRequestHeader;
    PAGE.XMLHttpRequest.prototype.setRequestHeader = function (
      this: XMLHttpRequest,
      name: string,
      value: string,
    ) {
      try {
        if (String(name).toLowerCase() === "authorization")
          offerBearer(String(value), "xhr-header");
      } catch {
        /* ignore */
      }
      return setHeader.call(this, name, value);
    };
  }
}

/** MSAL keeps access tokens in localStorage / sessionStorage. */
function scanStorages(): void {
  for (const storeName of ["localStorage", "sessionStorage"] as const) {
    let store: Storage;
    let length = 0;
    try {
      store = PAGE[storeName];
      length = store.length;
    } catch {
      continue;
    }
    for (let index = 0; index < length; index += 1) {
      try {
        const key = store.key(index);
        if (!key || key === CAPTURE_STORE_KEY) continue;
        for (const token of tokensInStorageValue(store.getItem(key)))
          offerToken(token, "msal-cache");
      } catch {
        /* unreadable entry: next one */
      }
    }
  }
}

// ------------------------------------------------------------------ sync with VS Code

function request(method: "GET" | "POST", path: string, body?: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      GM_xmlhttpRequest({
        method,
        url: `${TOKEN_SERVER_URL}${path}`,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        data: body,
        timeout: REQUEST_TIMEOUT_MS,
        onload: (response) => resolve(response.status),
        onerror: () => resolve(0),
        ontimeout: () => resolve(0),
      });
    } catch {
      resolve(0);
    }
  });
}

let syncing = false;

/**
 * The stored token is one VS Code has not received yet, and VS Code was not
 * down a moment ago: send it now instead of waiting out the re-sync cooldown,
 * which only exists not to hammer a VS Code that is not running.
 */
function hasUnsentToken(): boolean {
  const stamp = tokenStamp(readStore());
  const sync = readSync();
  return stamp !== null && stamp !== sync.syncedTokenExp && sync.vscodeReachable !== false;
}

/**
 * Send the profile to VS Code when it needs it: a token it does not have yet,
 * or VS Code started after the capture — the same rule (and cooldown) as the
 * browser extension. `force` is the panel's "Send to VS Code" button.
 */
async function syncToVSCode(force = false): Promise<boolean> {
  const store = readStore();
  const profile = profileFromCapture(store, navigator.userAgent);
  if (!profile || !isCapturedTokenUsable(store) || syncing) return false;
  const sync = readSync();
  const now = Date.now();
  if (
    !force &&
    !needsResync({
      capturedAt: store.capturedAt ?? null,
      syncedTokenExp: sync.syncedTokenExp,
      currentTokenExp: tokenStamp(store),
      hasToken: true,
      lastSyncAttemptAt: sync.lastSyncAttemptAt,
      now,
    })
  ) {
    return false;
  }

  syncing = true;
  writeSync({ lastSyncAttemptAt: now });
  try {
    const status = await request("POST", TOKEN_ENDPOINT_PATH, JSON.stringify(profile));
    if (status >= 200 && status < 300) {
      writeSync({
        syncedTokenExp: tokenStamp(store),
        lastSyncedAt: Date.now(),
        lastError: null,
        vscodeReachable: true,
      });
      return true;
    }
    writeSync({
      lastError: status ? `HTTP ${status}` : "unreachable",
      vscodeReachable: status !== 0,
    });
    return false;
  } finally {
    syncing = false;
  }
}

async function checkHealth(): Promise<void> {
  const status = await request("GET", HEALTH_ENDPOINT_PATH);
  const reachable = status >= 200 && status < 300;
  if (readSync().vscodeReachable !== reachable) writeSync({ vscodeReachable: reachable });
  if (reachable) await syncToVSCode();
}

// ------------------------------------------------------------------ renewal

/**
 * The page renews its own token while it is in use; a tab left in the
 * background can sit on an expired one. Reloading it (only while hidden, at
 * most every 10 min across tabs, never right after it loaded) makes MSAL
 * fetch a new one — the same last resort the browser extension uses.
 */
function maybeReloadToRenew(): void {
  if (!IS_TOP || !readUi().autoReload || document.visibilityState !== "hidden") return;
  const store = readStore();
  const hadSession = Boolean(store.endpoint || store.invocationTemplate);
  const expired = !isCapturedTokenUsable(store);
  if (!hadSession || !expired || Date.now() - LOADED_AT < MIN_PAGE_AGE_MS) return;
  const { lastReloadAt } = readSync();
  if (lastReloadAt && Date.now() - lastReloadAt < RELOAD_EVERY_MS) return;
  writeSync({ lastReloadAt: Date.now() });
  location.reload();
}

// ------------------------------------------------------------------ scan loop

let missingDelay = SCAN_MISSING_MS;

function tick(): void {
  try {
    scanStorages();
    pruneExpiredToken();
    maybeReloadToRenew();
  } catch {
    /* never break the page */
  }
  const next = nextScan(readStore(), missingDelay);
  missingDelay = next.missingDelay;
  setTimeout(tick, next.delay);
}

// ------------------------------------------------------------------ panel

// Claro, limpio y con aspecto nativo de Windows 11: Segoe UI y los colores,
// radios, sombras y controles de Fluent 2 (los mismos que el popup).
const FONT = `'Segoe UI Variable Text', 'Segoe UI', -apple-system, system-ui, sans-serif`;
const STYLE = `
:host { all: initial; }
.panel, .mini { box-sizing: border-box; z-index: 2147483647; position: fixed; right: 16px; bottom: 16px;
  background: #fff; color: #242424; border: 1px solid #e0e0e0; border-radius: 8px;
  font: 13px/18px ${FONT}; -webkit-font-smoothing: antialiased; }
.panel *, .mini * { box-sizing: border-box; }
.panel { width: 296px; padding: 10px 16px 16px; box-shadow: 0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12); }
.head { display: flex; align-items: center; justify-content: space-between; margin: 0 -8px 4px 0;
  color: #424242; font-size: 12px; font-weight: 600; }
.icons { display: flex; gap: 2px; }
.icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
  border: 0; border-radius: 4px; background: transparent; color: #616161; cursor: pointer; }
.icon:hover { background: #f5f5f5; color: #242424; }
.icon:active { background: #e0e0e0; }
.art { color: #616161; margin: 4px 8px; }
.status { text-align: center; margin: 4px 0 12px; }
.status-title { font-size: 15px; line-height: 20px; font-weight: 600; }
.status-title[data-busy] { background: linear-gradient(90deg, #242424 0 35%, #0f6cbd 50%, #242424 65% 100%);
  background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: us-shimmer 2.6s ease-in-out infinite; }
.status-sub { margin-top: 2px; color: #616161; font-size: 12px; line-height: 16px; }
.rows { margin: 0 0 12px; padding: 0; border: 1px solid #ebebeb; border-radius: 8px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; padding: 0 12px; }
.row + .row { border-top: 1px solid #ebebeb; }
.row dt { color: #424242; }
.row dd { margin: 0; display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #bdbdbd; }
.dot[data-tone="ok"] { background: #107c10; }
.dot[data-tone="warn"] { background: #bc4b09; }
.dot[data-tone="bad"] { background: #c50f1f; }
.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
button.act { min-height: 32px; padding: 5px 12px; border: 1px solid #d1d1d1; border-radius: 4px; background: #fff;
  color: #242424; font: 600 13px/18px ${FONT}; cursor: pointer; transition: background .1s, border-color .1s; }
button.act:hover:enabled { background: #f5f5f5; border-color: #c7c7c7; }
button.act:active:enabled { background: #e0e0e0; }
button.primary { border-color: transparent; background: #0f6cbd; color: #fff; }
button.primary:hover:enabled { background: #115ea3; border-color: transparent; }
button.primary:active:enabled { background: #0c3b5e; }
button.act:disabled { border-color: #f0f0f0; background: #f0f0f0; color: #bdbdbd; cursor: default; }
button.wide { grid-column: 1 / -1; }
button:focus-visible { outline: 2px solid #242424; outline-offset: 1px; }
.mini { width: 136px; padding: 8px 10px 6px; color: #616161; cursor: pointer;
  box-shadow: 0 4px 8px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12); transition: box-shadow .15s; }
.mini:hover { box-shadow: 0 8px 16px rgba(0,0,0,.14), 0 0 2px rgba(0,0,0,.12); }
.hidden { display: none !important; }
@keyframes us-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .status-title[data-busy] { animation: none; background: none; color: #242424; }
}`;

const ICON_MINIMIZE =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const ICON_CLOSE =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

function mountUi(): void {
  if (!IS_TOP || document.getElementById("m365copilot-grabber")) return;
  const host = document.createElement("div");
  host.id = "m365copilot-grabber";
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  const style = document.createElement("style");
  style.textContent = STYLE;
  const panel = document.createElement("div");
  panel.className = "panel";
  const mini = document.createElement("div");
  mini.className = "mini";

  // Fixed structure; every text goes in with textContent, never as HTML. The
  // only markup injected is our own static SVG.
  panel.innerHTML = [
    '<div class="head"><span data-text="title"></span><span class="icons">',
    `<button class="icon" data-action="minimize">${ICON_MINIMIZE}</button>`,
    `<button class="icon" data-action="close">${ICON_CLOSE}</button></span></div>`,
    `<div class="art">${connectionArtSvg({ idPrefix: "us-art", title: T.art })}</div>`,
    '<div class="status"><div class="status-title"></div><div class="status-sub"></div></div>',
    '<dl class="rows">',
    ...(["account", "token", "vscode", "sync"] as const).map(
      (row) =>
        `<div class="row"><dt data-text="${row}"></dt><dd><span class="dot" data-dot="${row}"></span><span data-value="${row}"></span></dd></div>`,
    ),
    "</dl>",
    '<div class="buttons">',
    '<button class="act primary wide" data-action="send"></button>',
    '<button class="act" data-action="token"></button>',
    '<button class="act" data-action="profile"></button>',
    "</div>",
  ].join("");
  mini.innerHTML = connectionArtSvg({ idPrefix: "us-mini", title: T.expand });
  mini.title = T.expand;

  const q = <E extends Element>(selector: string) => panel.querySelector(selector) as E;
  for (const node of Array.from(panel.querySelectorAll("[data-text]"))) {
    node.textContent = T[node.getAttribute("data-text") as keyof typeof T];
  }
  for (const [action, label] of [
    ["minimize", T.minimize],
    ["close", T.close],
  ] as const) {
    const button = q<HTMLButtonElement>(`[data-action="${action}"]`);
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  const sendButton = q<HTMLButtonElement>('[data-action="send"]');
  const tokenButton = q<HTMLButtonElement>('[data-action="token"]');
  const profileButton = q<HTMLButtonElement>('[data-action="profile"]');
  tokenButton.textContent = T.copyToken;
  profileButton.textContent = T.copyProfile;

  root.appendChild(style);
  root.appendChild(panel);
  root.appendChild(mini);
  (document.body || document.documentElement).appendChild(host);

  function render(): void {
    const store = readStore();
    const sync = readSync();
    const hasToken = Boolean(store.accessToken);
    const usable = isCapturedTokenUsable(store);
    const expired = hasToken && !usable;
    const kind = accountKind(store);
    // VS Code answers, so it looks connected, but the token is not reaching it.
    const rejected = usable && sync.vscodeReachable !== false && rejectedByVSCode(sync.lastError);
    const state = connectionState({
      hasToken,
      expired,
      vscodeConnected: sync.vscodeReachable === true,
      needsUser: rejected,
    });
    panel.dataset.state = state;
    mini.dataset.state = state;

    const { minimized } = readUi();
    panel.classList.toggle("hidden", minimized);
    mini.classList.toggle("hidden", !minimized);

    const [title, sub] = (
      rejected
        ? [T.rejectedTitle, T.rejectedSub]
        : {
            waiting: [T.waitingTitle, T.waitingSub],
            captured: [T.capturedTitle, T.capturedSub],
            connected: [
              T.connectedTitle,
              kind === "personal" ? T.connectedSubPersonal : T.connectedSub,
            ],
            warning: [T.warningTitle, T.warningSub],
          }[state]
    ) as [string, string];
    q(".status-title").textContent = title;
    q<HTMLElement>(".status-title").toggleAttribute("data-busy", state === "waiting");
    q(".status-sub").textContent = sub;

    const exp = store.claims?.exp;
    const minutes = typeof exp === "number" ? Math.round((exp * 1000 - Date.now()) / 60000) : null;
    q('[data-value="account"]').textContent = !kind
      ? T.accountNone
      : kind === "personal"
        ? T.accountPersonal
        : T.accountEnterprise;
    q('[data-value="token"]').textContent = !hasToken
      ? T.tokenNone
      : !usable
        ? T.tokenExpired
        : minutes === null
          ? "✓"
          : fill(T.tokenLeft, minutes);
    q('[data-value="vscode"]').textContent = rejected
      ? T.vscodeRejected
      : sync.vscodeReachable === null
        ? T.vscodeChecking
        : sync.vscodeReachable
          ? T.vscodeOk
          : T.vscodeDown;
    const ago = sync.lastSyncedAt ? Math.floor((Date.now() - sync.lastSyncedAt) / 60000) : null;
    q('[data-value="sync"]').textContent =
      ago === null ? T.syncNever : ago < 1 ? T.syncJustNow : fill(T.syncAgo, ago);
    const tones = {
      account: kind ? "ok" : "neutral",
      token: !hasToken ? "neutral" : usable ? "ok" : "warn",
      vscode:
        sync.vscodeReachable === null
          ? "neutral"
          : sync.vscodeReachable && !rejected
            ? "ok"
            : "bad",
      sync: ago === null ? "neutral" : "ok",
    };
    for (const [row, tone] of Object.entries(tones))
      q<HTMLElement>(`[data-dot="${row}"]`).dataset.tone = tone;

    if (!sendButton.dataset.flashing) sendButton.textContent = expired ? T.renew : T.send;
    sendButton.disabled = !hasToken;
    tokenButton.disabled = !usable;
    profileButton.disabled = !usable;
  }

  q('[data-action="close"]').addEventListener("click", () => host.remove());
  q('[data-action="minimize"]').addEventListener("click", () => {
    writeUi({ minimized: true });
    render();
  });
  mini.addEventListener("click", () => {
    writeUi({ minimized: false });
    render();
  });
  sendButton.addEventListener("click", async () => {
    if (!isCapturedTokenUsable(readStore())) {
      location.reload();
      return;
    }
    sendButton.dataset.flashing = "1";
    const ok = await syncToVSCode(true);
    render();
    const failure = rejectedByVSCode(readSync().lastError) ? T.rejectedTitle : T.sendFailed;
    flash(sendButton, ok ? T.sent : failure, () => {
      delete sendButton.dataset.flashing;
      render();
    });
  });
  tokenButton.addEventListener("click", () => {
    const token = readStore().accessToken;
    if (!token || !copy(token)) return;
    flash(tokenButton, T.copied, () => (tokenButton.textContent = T.copyToken));
  });
  profileButton.addEventListener("click", () => {
    const profile = profileFromCapture(readStore(), navigator.userAgent);
    if (!profile || !copy(JSON.stringify(profile, null, 2))) return;
    flash(profileButton, T.copied, () => (profileButton.textContent = T.copyProfile));
  });

  render();
  // Other tabs/frames write the same GM keys: redraw on any change, plus a
  // slow timer for the minute countdowns.
  for (const key of [CAPTURE_STORE_KEY, SYNC_KEY, UI_KEY]) {
    try {
      GM_addValueChangeListener(key, () => render());
    } catch {
      /* the timer below still refreshes the panel */
    }
  }
  setInterval(render, 15_000);
}

function copy(text: string): boolean {
  try {
    GM_setClipboard(text, "text");
    return true;
  } catch {
    try {
      void navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

function registerMenu(): void {
  if (!IS_TOP) return;
  try {
    GM_registerMenuCommand(T.menuShow, () => writeUi({ minimized: false }));
    GM_registerMenuCommand(T.menuSend, () => void syncToVSCode(true));
    GM_registerMenuCommand(readUi().autoReload ? T.menuAutoReloadOn : T.menuAutoReloadOff, () =>
      writeUi({ autoReload: !readUi().autoReload }),
    );
    GM_registerMenuCommand(T.openM365, () => window.open(M365_CHAT_URL, "_blank"));
  } catch {
    /* menu commands not granted: the panel has the same actions */
  }
}

// ------------------------------------------------------------------ start

installHooks();
scanStorages();
setTimeout(tick, missingDelay);

// MSAL renews when the tab comes back to the foreground, and `storage` reports
// what OTHER tabs of the same origin wrote: often a fresh token is waiting.
for (const [target, event] of [
  [document, "visibilitychange"],
  [window, "focus"],
  [PAGE, "storage"],
] as const) {
  target.addEventListener(event, () => {
    if (event === "visibilitychange" && document.visibilityState !== "visible") return;
    try {
      scanStorages();
    } catch {
      /* never break the page */
    }
  });
}

if (IS_TOP) {
  registerMenu();
  // A token captured by an iframe (or another tab) reaches GM storage first:
  // sync right away instead of waiting for the next health check.
  try {
    GM_addValueChangeListener(CAPTURE_STORE_KEY, () => void syncToVSCode(hasUnsentToken()));
  } catch {
    /* the health check below syncs too */
  }
  void checkHealth();
  setInterval(() => void checkHealth(), HEALTH_EVERY_MS);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mountUi, { once: true });
  else mountUi();
}

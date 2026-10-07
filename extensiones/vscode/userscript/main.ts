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
	areClaimsUsable,
	connectionArtSvg,
	connectionState,
	inspectOutgoingFrames,
	isCopilotSocketUrl,
	needsResync,
	nextScan,
	normalizeEndpoint,
	profileFromCapture,
	sameCapture,
	tokenInSocketUrl,
	tokensInStorageValue,
	toneOfTemplate,
	withObservedTone,
	withoutExpiredToken,
	type CaptureStore,
} from '@m365copilot/core';

const SYNC_KEY = 'm365copilot.sync.v1';
const UI_KEY = 'm365copilot.ui.v1';
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
	/** Models (`tone`s) VS Code already received, so a new one is sent right away. */
	syncedTones: string[];
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
	syncedTones: [],
};

const PAGE: Window & typeof globalThis = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
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
		title: 'M365 Copilot → VS Code',
		art: 'Connection between Microsoft 365 Copilot and VS Code',
		minimize: 'Minimize',
		expand: 'Show the M365 Copilot panel',
		close: 'Hide until the next page load',
		waitingTitle: 'Waiting for the token',
		waitingSub: 'Send a message in the chat to capture it.',
		capturedTitle: 'Token ready',
		capturedSub: 'VS Code is not answering. Open it with the M365 Copilot extension enabled.',
		connectedTitle: 'Connected to VS Code',
		connectedSub: 'The token is sent automatically whenever it is renewed.',
		warningTitle: 'Token expired',
		warningSub: 'Reload this page or sign in again to renew it.',
		token: 'Token',
		tokenNone: 'not captured',
		tokenLeft: '{0} min left',
		tokenExpired: 'expired',
		vscode: 'VS Code',
		vscodeOk: 'connected',
		vscodeDown: 'not answering',
		vscodeChecking: 'checking…',
		sync: 'Last sync',
		syncNever: 'never',
		syncJustNow: 'just now',
		syncAgo: '{0} min ago',
		send: 'Send to VS Code',
		sent: '✓ Sent',
		sendFailed: 'VS Code did not answer',
		copyToken: 'Copy token',
		copyProfile: 'Copy profile',
		copied: '✓ Copied',
		renew: 'Reload to renew',
		menuShow: 'Show panel',
		menuSend: 'Send token to VS Code now',
		menuAutoReloadOn: 'Auto-renew: reload this tab when hidden and expired — currently ON',
		menuAutoReloadOff: 'Auto-renew: reload this tab when hidden and expired — currently OFF',
		openM365: 'Open M365 Copilot',
	},
	es: {
		title: 'M365 Copilot → VS Code',
		art: 'Conexión entre Microsoft 365 Copilot y VS Code',
		minimize: 'Minimizar',
		expand: 'Mostrar el panel de M365 Copilot',
		close: 'Ocultar hasta la próxima carga de la página',
		waitingTitle: 'Esperando el token',
		waitingSub: 'Envía un mensaje en el chat para capturarlo.',
		capturedTitle: 'Token listo',
		capturedSub: 'VS Code no responde. Ábrelo con la extensión M365 Copilot activa.',
		connectedTitle: 'Conectado con VS Code',
		connectedSub: 'El token se envía solo cada vez que se renueva.',
		warningTitle: 'Token caducado',
		warningSub: 'Recarga esta página o vuelve a iniciar sesión para renovarlo.',
		token: 'Token',
		tokenNone: 'sin capturar',
		tokenLeft: 'quedan {0} min',
		tokenExpired: 'caducado',
		vscode: 'VS Code',
		vscodeOk: 'conectado',
		vscodeDown: 'no responde',
		vscodeChecking: 'comprobando…',
		sync: 'Última sincronización',
		syncNever: 'nunca',
		syncJustNow: 'ahora mismo',
		syncAgo: 'hace {0} min',
		send: 'Enviar a VS Code',
		sent: '✓ Enviado',
		sendFailed: 'VS Code no respondió',
		copyToken: 'Copiar token',
		copyProfile: 'Copiar perfil',
		copied: '✓ Copiado',
		renew: 'Recargar para renovar',
		menuShow: 'Mostrar el panel',
		menuSend: 'Enviar el token a VS Code ahora',
		menuAutoReloadOn: 'Auto-renovar: recargar esta pestaña oculta si caduca — ahora ACTIVADO',
		menuAutoReloadOff: 'Auto-renovar: recargar esta pestaña oculta si caduca — ahora DESACTIVADO',
		openM365: 'Abrir M365 Copilot',
	},
};
const T = /^es\b/i.test(navigator.language || '') ? TEXTS.es : TEXTS.en;
const fill = (template: string, value: number) => template.replace('{0}', String(value));

// ------------------------------------------------------------------ storage

function readJson<V>(key: string, fallback: V): V {
	try {
		const raw = GM_getValue<string>(key, '');
		return raw ? { ...fallback, ...(JSON.parse(raw) as V) } : fallback;
	} catch {
		return fallback;
	}
}

const readStore = (): CaptureStore => readJson<CaptureStore>(CAPTURE_STORE_KEY, {});
const readSync = (): SyncState => readJson<SyncState>(SYNC_KEY, EMPTY_SYNC);
const readUi = (): UiState => readJson<UiState>(UI_KEY, { minimized: false, autoReload: true });
const writeSync = (patch: Partial<SyncState>) => GM_setValue(SYNC_KEY, JSON.stringify({ ...readSync(), ...patch }));
const writeUi = (patch: Partial<UiState>) => GM_setValue(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));

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

function offerToken(token: string | null, source: string): void {
	if (!token) return;
	try {
		const accepted = acceptToken(readStore(), token);
		if (!accepted) return;
		writeStore({ ...accepted, tokenSource: source });
		if (IS_TOP) void syncToVSCode(hasUnsentChanges());
	} catch {
		/* never break the page */
	}
}

// ------------------------------------------------------------------ capture hooks

function captureSocket(url: unknown, socket: WebSocket): void {
	const raw = String(url);
	if (!isCopilotSocketUrl(raw)) return;
	offerToken(tokenInSocketUrl(raw), 'websocket-url');

	// Substrate opens several sockets (presence, notifications…): keep this one
	// only tentatively, until it sends a `chat` frame — the proof it is the hub.
	const endpoint = normalizeEndpoint(raw);
	if (endpoint && !readStore().endpointConfirmed) {
		writeStore({ endpoint, origin: location.origin, userAgent: navigator.userAgent });
	}

	const originalSend = socket.send;
	socket.send = function (this: WebSocket, ...args: Parameters<WebSocket['send']>) {
		try {
			const frames = inspectOutgoingFrames(args[0]);
			if (frames.sawChat) {
				// The model (`tone`) the web app used: VS Code offers it if it is new.
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
			/* never break the page */
		}
		return originalSend.apply(this, args);
	};
}

function headerValue(headers: unknown, name: string): string | null {
	if (!headers) return null;
	try {
		const wanted = name.toLowerCase();
		if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name);
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
				let auth = headerValue(init?.headers, 'authorization');
				if (!auth && typeof Request !== 'undefined' && input instanceof Request) auth = input.headers.get('authorization');
				offerBearer(auth, 'fetch-header');
			} catch {
				/* ignore */
			}
			return nativeFetch.call(this, input, init);
		} as typeof fetch;
	}

	if (PAGE.XMLHttpRequest) {
		const setHeader = PAGE.XMLHttpRequest.prototype.setRequestHeader;
		PAGE.XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
			try {
				if (String(name).toLowerCase() === 'authorization') offerBearer(String(value), 'xhr-header');
			} catch {
				/* ignore */
			}
			return setHeader.call(this, name, value);
		};
	}
}

/** MSAL keeps access tokens in localStorage / sessionStorage. */
function scanStorages(): void {
	for (const storeName of ['localStorage', 'sessionStorage'] as const) {
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
				for (const token of tokensInStorageValue(store.getItem(key))) offerToken(token, 'msal-cache');
			} catch {
				/* unreadable entry: next one */
			}
		}
	}
}

// ------------------------------------------------------------------ sync with VS Code

function request(method: 'GET' | 'POST', path: string, body?: string): Promise<number> {
	return new Promise((resolve) => {
		try {
			GM_xmlhttpRequest({
				method,
				url: `${TOKEN_SERVER_URL}${path}`,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
	const exp = readStore().claims?.exp;
	const sync = readSync();
	return (
		typeof exp === 'number' && (sync.syncedTokenExp === null || exp > sync.syncedTokenExp) && sync.vscodeReachable !== false
	);
}

/**
 * The web app used a model (`tone`) VS Code has not been told about. The chat
 * frame that reveals it arrives AFTER the token was sent, so without this VS
 * Code would only learn it at the next token renewal, ~50 min later.
 */
function hasUnsentTone(): boolean {
	const sync = readSync();
	return sync.vscodeReachable !== false && (readStore().observedTones ?? []).some((tone) => !sync.syncedTones.includes(tone));
}

const hasUnsentChanges = () => hasUnsentToken() || hasUnsentTone();

/**
 * Send the profile to VS Code when it needs it: a token it does not have yet,
 * or VS Code started after the capture — the same rule (and cooldown) as the
 * browser extension. `force` is the panel's "Send to VS Code" button.
 */
async function syncToVSCode(force = false): Promise<boolean> {
	const store = readStore();
	const profile = profileFromCapture(store, navigator.userAgent);
	if (!profile || !areClaimsUsable(store.claims) || syncing) return false;
	const sync = readSync();
	const now = Date.now();
	if (
		!force &&
		!needsResync({
			capturedAt: store.capturedAt ?? null,
			syncedTokenExp: sync.syncedTokenExp,
			currentTokenExp: store.claims?.exp ?? null,
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
		const status = await request('POST', TOKEN_ENDPOINT_PATH, JSON.stringify(profile));
		if (status >= 200 && status < 300) {
			writeSync({
				syncedTokenExp: store.claims?.exp ?? null,
				syncedTones: profile.observedTones ?? [],
				lastSyncedAt: Date.now(),
				lastError: null,
				vscodeReachable: true,
			});
			return true;
		}
		writeSync({ lastError: status ? `HTTP ${status}` : 'unreachable', vscodeReachable: status !== 0 });
		return false;
	} finally {
		syncing = false;
	}
}

async function checkHealth(): Promise<void> {
	const status = await request('GET', HEALTH_ENDPOINT_PATH);
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
	if (!IS_TOP || !readUi().autoReload || document.visibilityState !== 'hidden') return;
	const store = readStore();
	const hadSession = Boolean(store.endpoint || store.invocationTemplate);
	const expired = !store.accessToken || !areClaimsUsable(store.claims);
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

const STYLE = `
:host { all: initial; }
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 280px; box-sizing: border-box;
  padding: 12px 14px 14px; border-radius: 14px; background: #161b22; color: #e6edf3;
  border: 1px solid #30363d; box-shadow: 0 10px 30px rgba(0,0,0,.45);
  font: 12px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; }
.head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; margin-bottom: 4px; }
.icons { display: flex; gap: 2px; }
.icon { cursor: pointer; background: none; border: 0; color: #9198a1; font-size: 14px; width: 24px; height: 24px; border-radius: 6px; }
.icon:hover { background: #21262d; color: #e6edf3; }
.art { color: #9198a1; margin: 2px 4px 6px; }
.status { text-align: center; margin-bottom: 8px; }
.status-title { font-weight: 600; font-size: 13px; }
.status-sub { color: #9198a1; font-size: 11.5px; }
[data-state="connected"] .status-title { color: #3fb950; }
[data-state="warning"] .status-title { color: #d29922; }
.rows { border: 1px solid #21262d; border-radius: 10px; padding: 2px 10px; margin-bottom: 10px; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 5px 0; }
.row + .row { border-top: 1px solid #21262d; }
.row-label { color: #9198a1; }
.row-value { font-variant-numeric: tabular-nums; }
.buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
button.act { padding: 7px 10px; border: 0; border-radius: 8px; background: #1f6feb; color: #fff;
  font: 600 12px -apple-system, "Segoe UI", system-ui, sans-serif; cursor: pointer; }
button.act:hover:enabled { background: #388bfd; }
button.act:disabled { background: #30363d; color: #6e7681; cursor: not-allowed; }
button.wide { grid-column: 1 / -1; }
button.ghost { background: transparent; border: 1px solid #30363d; color: #c9d1d9; }
button.ghost:hover:enabled { background: #21262d; }
.mini { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 132px; padding: 6px 8px 4px;
  border-radius: 12px; background: #161b22; border: 1px solid #30363d; box-shadow: 0 6px 18px rgba(0,0,0,.4);
  color: #9198a1; cursor: pointer; }
.mini:hover { border-color: #1f6feb; }
.hidden { display: none !important; }
@media (prefers-color-scheme: light) {
  .panel, .mini { background: #ffffff; color: #1f2328; border-color: #d1d9e0; box-shadow: 0 10px 30px rgba(31,35,40,.18); }
  .art, .status-sub, .row-label, .icon, .mini { color: #59636e; }
  .rows, .row + .row { border-color: #e4e8ec; }
  .icon:hover, button.ghost:hover:enabled { background: #f6f8fa; color: #1f2328; }
  button.ghost { border-color: #d1d9e0; color: #1f2328; }
  button.act:disabled { background: #eff2f5; color: #818b98; }
  [data-state="connected"] .status-title { color: #1a7f37; }
  [data-state="warning"] .status-title { color: #9a6700; }
}`;

function mountUi(): void {
	if (!IS_TOP || document.getElementById('m365copilot-grabber')) return;
	const host = document.createElement('div');
	host.id = 'm365copilot-grabber';
	const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

	const style = document.createElement('style');
	style.textContent = STYLE;
	const panel = document.createElement('div');
	panel.className = 'panel';
	const mini = document.createElement('div');
	mini.className = 'mini';

	// Fixed structure; every text goes in with textContent, never as HTML. The
	// only markup injected is our own static SVG.
	panel.innerHTML = [
		'<div class="head"><span data-text="title"></span><span class="icons">',
		'<button class="icon" data-action="minimize">–</button><button class="icon" data-action="close">✕</button></span></div>',
		`<div class="art">${connectionArtSvg({ idPrefix: 'us-art', title: T.art })}</div>`,
		'<div class="status"><div class="status-title"></div><div class="status-sub"></div></div>',
		'<div class="rows">',
		'<div class="row"><span class="row-label" data-text="token"></span><span class="row-value" data-value="token"></span></div>',
		'<div class="row"><span class="row-label" data-text="vscode"></span><span class="row-value" data-value="vscode"></span></div>',
		'<div class="row"><span class="row-label" data-text="sync"></span><span class="row-value" data-value="sync"></span></div>',
		'</div>',
		'<div class="buttons">',
		'<button class="act wide" data-action="send"></button>',
		'<button class="act ghost" data-action="token"></button>',
		'<button class="act ghost" data-action="profile"></button>',
		'</div>',
	].join('');
	mini.innerHTML = connectionArtSvg({ idPrefix: 'us-mini', title: T.expand });
	mini.title = T.expand;

	const q = <E extends Element>(selector: string) => panel.querySelector(selector) as E;
	for (const node of Array.from(panel.querySelectorAll('[data-text]'))) {
		node.textContent = T[node.getAttribute('data-text') as keyof typeof T];
	}
	q<HTMLButtonElement>('[data-action="minimize"]').title = T.minimize;
	q<HTMLButtonElement>('[data-action="close"]').title = T.close;
	const sendButton = q<HTMLButtonElement>('[data-action="send"]');
	const tokenButton = q<HTMLButtonElement>('[data-action="token"]');
	const profileButton = q<HTMLButtonElement>('[data-action="profile"]');
	tokenButton.textContent = T.copyToken;
	profileButton.textContent = T.copyProfile;

	root.appendChild(style);
	root.appendChild(panel);
	root.appendChild(mini);
	(document.body || document.documentElement).appendChild(host);

	const flash = (button: HTMLButtonElement, text: string, restore: () => void) => {
		button.textContent = text;
		setTimeout(restore, 1600);
	};

	function render(): void {
		const store = readStore();
		const sync = readSync();
		const hasToken = Boolean(store.accessToken);
		const usable = hasToken && areClaimsUsable(store.claims);
		const state = connectionState({ hasToken, expired: hasToken && !usable, vscodeConnected: sync.vscodeReachable === true });
		panel.dataset.state = state;
		mini.dataset.state = state;

		const { minimized } = readUi();
		panel.classList.toggle('hidden', minimized);
		mini.classList.toggle('hidden', !minimized);

		const [title, sub] = {
			waiting: [T.waitingTitle, T.waitingSub],
			captured: [T.capturedTitle, T.capturedSub],
			connected: [T.connectedTitle, T.connectedSub],
			warning: [T.warningTitle, T.warningSub],
		}[state];
		q('.status-title').textContent = title;
		q('.status-sub').textContent = sub;

		const exp = store.claims?.exp;
		const minutes = typeof exp === 'number' ? Math.round((exp * 1000 - Date.now()) / 60000) : null;
		q('[data-value="token"]').textContent = !hasToken
			? T.tokenNone
			: !usable
				? T.tokenExpired
				: minutes === null
					? '✓'
					: fill(T.tokenLeft, minutes);
		q('[data-value="vscode"]').textContent =
			sync.vscodeReachable === null ? T.vscodeChecking : sync.vscodeReachable ? T.vscodeOk : T.vscodeDown;
		const ago = sync.lastSyncedAt ? Math.floor((Date.now() - sync.lastSyncedAt) / 60000) : null;
		q('[data-value="sync"]').textContent = ago === null ? T.syncNever : ago < 1 ? T.syncJustNow : fill(T.syncAgo, ago);

		if (!sendButton.dataset.flashing) sendButton.textContent = state === 'warning' ? T.renew : T.send;
		sendButton.disabled = !hasToken && state !== 'warning';
		tokenButton.disabled = !usable;
		profileButton.disabled = !usable;
	}

	q('[data-action="close"]').addEventListener('click', () => host.remove());
	q('[data-action="minimize"]').addEventListener('click', () => {
		writeUi({ minimized: true });
		render();
	});
	mini.addEventListener('click', () => {
		writeUi({ minimized: false });
		render();
	});
	sendButton.addEventListener('click', async () => {
		if (panel.dataset.state === 'warning') {
			location.reload();
			return;
		}
		sendButton.dataset.flashing = '1';
		const ok = await syncToVSCode(true);
		render();
		flash(sendButton, ok ? T.sent : T.sendFailed, () => {
			delete sendButton.dataset.flashing;
			render();
		});
	});
	tokenButton.addEventListener('click', () => {
		const token = readStore().accessToken;
		if (!token || !copy(token)) return;
		flash(tokenButton, T.copied, () => (tokenButton.textContent = T.copyToken));
	});
	profileButton.addEventListener('click', () => {
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
		GM_setClipboard(text, 'text');
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
		GM_registerMenuCommand(T.openM365, () => window.open(M365_CHAT_URL, '_blank'));
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
	[document, 'visibilitychange'],
	[window, 'focus'],
	[PAGE, 'storage'],
] as const) {
	target.addEventListener(event, () => {
		if (event === 'visibilitychange' && document.visibilityState !== 'visible') return;
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
		GM_addValueChangeListener(CAPTURE_STORE_KEY, () => void syncToVSCode(hasUnsentChanges()));
	} catch {
		/* the health check below syncs too */
	}
	void checkHealth();
	setInterval(() => void checkHealth(), HEALTH_EVERY_MS);
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUi, { once: true });
	else mountUi();
}

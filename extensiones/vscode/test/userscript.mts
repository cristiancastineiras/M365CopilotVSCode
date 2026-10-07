/**
 * Black-box tests of the GENERATED userscript (ms365copilot-token.user.js):
 * it runs in a `vm` context with a fake page (WebSocket, fetch, XHR, MSAL
 * cache) and a fake Tampermonkey (GM_* storage, GM_xmlhttpRequest), and the
 * assertions look only at what it stores and what it sends to VS Code.
 *
 * Run: node --experimental-strip-types --import ./test/register.mjs test/userscript.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../ms365copilot-token.user.js', import.meta.url), 'utf8');
const CAPTURE_KEY = 'ms365copilot.capture.v1';
const SYNC_KEY = 'ms365copilot.sync.v1';

const b64url = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwt(minutes: number, extra: Record<string, unknown> = {}): string {
	return `${b64url({ alg: 'none' })}.${b64url({
		aud: 'https://substrate.office.com/sydney',
		oid: 'o',
		tid: 't',
		upn: 'someone@contoso.com',
		exp: Math.floor(Date.now() / 1000) + minutes * 60,
		...extra,
	})}.sig`;
}

function storage(entries: Record<string, string> = {}) {
	const map = new Map(Object.entries(entries));
	return {
		get length() {
			return map.size;
		},
		key: (index: number) => [...map.keys()][index] ?? null,
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, String(value)),
		removeItem: (key: string) => void map.delete(key),
	};
}

interface Request {
	method: string;
	url: string;
	data?: string;
}

/** Load the userscript into a fake page. `vscode` decides what the local server answers (0 = down). */
function load(options: { top?: boolean; localStorage?: Record<string, string>; vscode?: (request: Request) => number } = {}) {
	const gm = new Map<string, unknown>();
	const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
	const requests: Request[] = [];
	const timers: { fn: () => void; ms: number }[] = [];
	const menus: string[] = [];
	const answer = options.vscode ?? (() => 200);

	class FakeSocket {
		readonly url: string;
		readonly sent: unknown[] = [];
		constructor(url: string) {
			this.url = url;
		}
		send(data: unknown) {
			this.sent.push(data);
		}
	}
	class FakeXhr {
		readonly headers: Record<string, string> = {};
		setRequestHeader(name: string, value: string) {
			this.headers[name] = value;
		}
	}
	const window: Record<string, unknown> = {
		localStorage: storage(options.localStorage),
		sessionStorage: storage(),
		WebSocket: FakeSocket,
		XMLHttpRequest: FakeXhr,
		fetch: () => Promise.resolve('fetched'),
		addEventListener() {},
		open() {},
	};
	window.self = window;
	window.top = options.top === false ? {} : window;

	const sandbox = {
		window,
		unsafeWindow: window,
		document: { readyState: 'loading', visibilityState: 'visible', addEventListener() {}, getElementById: () => null },
		location: { origin: 'https://m365.cloud.microsoft', href: 'https://m365.cloud.microsoft/chat/', reload() {} },
		navigator: { language: 'en-US', userAgent: 'Test UA' },
		URL,
		TextDecoder,
		atob,
		Headers,
		Request: globalThis.Request,
		setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
		setInterval: () => 0,
		clearTimeout() {},
		GM_getValue: (key: string, fallback: unknown) => (gm.has(key) ? gm.get(key) : fallback),
		GM_setValue: (key: string, value: unknown) => {
			const old = gm.get(key);
			gm.set(key, value);
			for (const listener of listeners.get(key) ?? []) listener(key, old, value, false);
		},
		GM_addValueChangeListener: (key: string, listener: (...args: unknown[]) => void) => {
			listeners.set(key, [...(listeners.get(key) ?? []), listener]);
			return 1;
		},
		GM_setClipboard() {},
		GM_registerMenuCommand: (caption: string) => menus.push(caption),
		GM_xmlhttpRequest: (details: Request & { onload: (r: unknown) => void; onerror: (r: unknown) => void }) => {
			requests.push({ method: details.method, url: details.url, data: details.data });
			const status = answer(details);
			queueMicrotask(() => (status ? details.onload({ status, responseText: '' }) : details.onerror({})));
		},
	};
	vm.createContext(sandbox);
	vm.runInContext(SCRIPT, sandbox);

	const read = (key: string) => {
		const raw = gm.get(key);
		return typeof raw === 'string' ? JSON.parse(raw) : {};
	};
	return {
		window,
		requests,
		timers,
		menus,
		capture: () => read(CAPTURE_KEY),
		sync: () => read(SYNC_KEY),
		posts: () => requests.filter((request) => request.method === 'POST'),
		openSocket: (url: string) => new (window.WebSocket as typeof FakeSocket)(url),
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function testWebSocketCaptureAndSync() {
	const page = load();
	const token = jwt(60);
	const socket = page.openSocket(
		`wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=${token}&ConversationId=c1&source=officeweb`,
	);
	await settle();
	const capture = page.capture();
	assert.equal(capture.accessToken, token);
	assert.equal(capture.tokenSource, 'websocket-url');
	assert.equal(capture.claims.upn, 'someone@contoso.com');
	// substrate.office.com is a Microsoft host: kept, without the volatile params.
	assert.equal(capture.endpoint, 'wss://substrate.office.com/m365Copilot/Chathub/o@t?source=officeweb');

	// Sent to VS Code right away, with the profile the extension expects.
	const [post] = page.posts();
	assert.equal(post.url, 'http://localhost:51827/token');
	const profile = JSON.parse(post.data!);
	assert.equal(profile.accessToken, token);
	assert.equal(profile.userAgent, 'Test UA');
	assert.equal(page.sync().syncedTokenExp, capture.claims.exp);
	assert.equal(page.sync().vscodeReachable, true);

	// The chat frame confirms the hub and stores the invocation template.
	socket.send(`${JSON.stringify({ type: 4, target: 'chat', arguments: [{ tone: 'magic' }] })}\x1e`);
	assert.equal(page.capture().endpointConfirmed, true);
	assert.deepEqual(page.capture().invocationTemplate, { tone: 'magic' });
	assert.equal(socket.sent.length, 1, 'the page still sends its frame');
	await settle();

	// The web app uses a model VS Code does not know: it is remembered and sent
	// right away (not at the next token renewal, ~50 min later).
	const before = page.posts().length;
	socket.send(`${JSON.stringify({ type: 4, target: 'chat', arguments: [{ tone: 'Gpt_5_7_Chat' }] })}\x1e`);
	await settle();
	assert.deepEqual(page.capture().observedTones, ['magic', 'Gpt_5_7_Chat']);
	assert.equal(page.posts().length, before + 1, 'the new model is sent to VS Code');
	assert.deepEqual(JSON.parse(page.posts().at(-1)!.data!).observedTones, ['magic', 'Gpt_5_7_Chat']);
	// Using it again changes nothing and sends nothing.
	socket.send(`${JSON.stringify({ type: 4, target: 'chat', arguments: [{ tone: 'Gpt_5_7_Chat' }] })}\x1e`);
	await settle();
	assert.equal(page.posts().length, before + 1);

	// Same token again: nothing new is sent.
	const posts = page.posts().length;
	page.openSocket(`wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=${token}`);
	await settle();
	assert.equal(page.posts().length, posts);
	console.log('  ✓ captura del WebSocket y envío inmediato a VS Code (una sola vez por token)');
}

async function testMsalCacheAndRenewal() {
	const first = jwt(30);
	const page = load({
		localStorage: {
			'msal.token.keys': '[]',
			'abc-login.windows.net-accesstoken-sydney': JSON.stringify({ credentialType: 'AccessToken', secret: first }),
		},
	});
	await settle();
	assert.equal(page.capture().accessToken, first, 'picked up from the MSAL cache at load');
	assert.equal(page.capture().tokenSource, 'msal-cache');

	// The web app renews its token in the cache: the next scan picks it up even
	// though a token is already stored — the bug the old userscript had.
	const renewed = jwt(75);
	(page.window.localStorage as ReturnType<typeof storage>).setItem(
		'abc-login.windows.net-accesstoken-sydney',
		JSON.stringify({ secret: renewed }),
	);
	const tick = page.timers.find((timer) => timer.ms === 2000);
	assert.ok(tick, 'a scan is scheduled');
	tick!.fn();
	await settle();
	assert.equal(page.capture().accessToken, renewed);
	assert.equal(JSON.parse(page.posts().at(-1)!.data!).accessToken, renewed, 'the renewed token is sent too');

	// Older and expired tokens never replace the current one.
	page.openSocket(`wss://substrate.office.com/Chathub/o@t?access_token=${jwt(10)}`);
	page.openSocket(`wss://substrate.office.com/Chathub/o@t?access_token=${jwt(-5)}`);
	assert.equal(page.capture().accessToken, renewed);
	// Nor does a token for another audience.
	page.openSocket(`wss://substrate.office.com/Chathub/o@t?access_token=${jwt(90, { aud: 'https://graph.microsoft.com' })}`);
	assert.equal(page.capture().accessToken, renewed);
	console.log('  ✓ caché de MSAL: recoge el token renovado, y nunca uno más viejo, caducado o de otra audiencia');
}

async function testHeadersAndVsCodeDown() {
	const page = load({ vscode: () => 0 });
	const token = jwt(60);
	await (page.window.fetch as (input: string, init: unknown) => Promise<unknown>)('https://substrate.office.com/x', {
		headers: { Authorization: `Bearer ${token}` },
	});
	await settle();
	assert.equal(page.capture().accessToken, token);
	assert.equal(page.capture().tokenSource, 'fetch-header');
	assert.equal(page.sync().vscodeReachable, false);
	assert.equal(page.sync().lastError, 'unreachable');
	assert.equal(page.sync().syncedTokenExp, null);

	const xhr = new (page.window.XMLHttpRequest as new () => { setRequestHeader(n: string, v: string): void })();
	const newer = jwt(80);
	xhr.setRequestHeader('Authorization', `Bearer ${newer}`);
	assert.equal(page.capture().accessToken, newer);
	assert.equal(page.capture().tokenSource, 'xhr-header');
	console.log('  ✓ cabeceras fetch/XHR capturadas; con VS Code apagado no se da el token por sincronizado');
}

async function testFramesAndMenu() {
	const frame = load({ top: false });
	frame.openSocket(`wss://substrate.office.com/Chathub/o@t?access_token=${jwt(60)}`);
	await settle();
	assert.ok(frame.capture().accessToken, 'iframes capture too');
	assert.equal(frame.requests.length, 0, 'but only the top frame talks to VS Code');
	assert.equal(frame.menus.length, 0);

	const top = load();
	await settle();
	assert.ok(top.requests.some((request) => request.method === 'GET' && request.url.endsWith('/health')));
	assert.equal(top.menus.length, 4);
	console.log('  ✓ iframes capturan sin hablar con VS Code; el marco principal comprueba la conexión y registra el menú');
}

await testWebSocketCaptureAndSync();
await testMsalCacheAndRenewal();
await testHeadersAndVsCodeDown();
await testFramesAndMenu();
console.log('All userscript tests passed.');

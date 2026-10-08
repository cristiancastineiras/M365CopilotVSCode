/**
 * Tests del cierre de sesión completo contra un `chrome` de mentira.
 *
 * Aquí está lo que de verdad hace que «renovar» vuelva a pedir la sesión, y
 * lo que es fácil de romper sin que se note en el navegador:
 *
 *  - el ORDEN: por los endpoints de logout antes de borrar las cookies (si no,
 *    la sesión del servidor sobrevive y Microsoft vuelve a entrar en silencio);
 *  - las cookies se borran en TODOS los contenedores y con la URL correcta
 *    (`https` para las `secure`, sin el punto del dominio, con `partitionKey`);
 *  - `remove` que resuelve a `null` NO ha borrado nada: cuenta como fallo;
 *  - un navegador que no conoce un tipo de dato (Firefox y `cacheStorage`) no
 *    puede hacer que no se borre nada: se reintenta tipo a tipo;
 *  - sin los permisos `cookies` / `browsingData` se informa, no se lanza.
 *
 * Run: node --experimental-strip-types --import ./test/register.mjs test/hardReset.mts
 */
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- chrome falso

interface FakeCookie {
	name: string;
	domain: string;
	path: string;
	secure: boolean;
	storeId?: string;
	partitionKey?: unknown;
}

interface FakeTab {
	id: number;
	url: string;
}

interface Calls {
	/** Cada paso en el orden en que ocurrió: es la mitad del test. */
	steps: string[];
	navigated: { tabId: number; url: string }[];
	removedTabs: number[];
	removedCookies: { url: string; name: string; storeId?: string; partitionKey?: unknown }[];
	browsingData: { filter: Record<string, unknown>; types: string[] }[];
	created: string[];
}

interface FakeOptions {
	cookies?: FakeCookie[];
	tabs?: FakeTab[];
	stores?: string[];
	/** Cookies cuyo borrado el navegador rechaza devolviendo null. */
	unremovable?: string[];
	/** Tipos de dato que este navegador no conoce (los rechaza). */
	unsupportedTypes?: string[];
	/** Como Firefox: no implementa el filtro `origins`, sólo `hostnames`. */
	noOriginFilter?: boolean;
	withCookies?: boolean;
	withBrowsingData?: boolean;
}

function installFakeChrome(options: FakeOptions = {}) {
	const calls: Calls = {
		steps: [],
		navigated: [],
		removedTabs: [],
		removedCookies: [],
		browsingData: [],
		created: [],
	};
	const tabs = [...(options.tabs ?? [])];
	const cookies = [...(options.cookies ?? [])];
	const unremovable = new Set(options.unremovable ?? []);
	const unsupported = new Set(options.unsupportedTypes ?? []);
	let nextTabId = 500;
	/** Oyentes de `tabs.onUpdated`: la navegación se confirma por aquí. */
	const updateListeners: ((tabId: number, info: { status: string }) => void)[] = [];

	const chrome: any = {
		runtime: { id: 'test-extension' },
		tabs: {
			async query() {
				return tabs.map((tab) => ({ ...tab }));
			},
			async get(tabId: number) {
				const tab = tabs.find((candidate) => candidate.id === tabId);
				if (!tab) throw new Error(`No tab with id ${tabId}`);
				return { ...tab };
			},
			async update(tabId: number, { url }: { url?: string }) {
				const tab = tabs.find((candidate) => candidate.id === tabId);
				if (tab && url) tab.url = url;
				if (url) {
					calls.steps.push(`navigate:${url}`);
					calls.navigated.push({ tabId, url });
				}
				// El navegador avisa de que terminó de cargar en otro turno.
				setTimeout(() => {
					for (const listener of [...updateListeners]) listener(tabId, { status: 'complete' });
				}, 0);
				return { id: tabId, url };
			},
			async create({ url }: { url: string }) {
				calls.steps.push(`create:${url}`);
				calls.created.push(url);
				const tab = { id: nextTabId++, url };
				tabs.push(tab);
				return { ...tab };
			},
			async remove(ids: number | number[]) {
				const list = Array.isArray(ids) ? ids : [ids];
				calls.steps.push(`closeTabs:${list.join(',')}`);
				calls.removedTabs.push(...list);
				for (const id of list) {
					const index = tabs.findIndex((tab) => tab.id === id);
					if (index >= 0) tabs.splice(index, 1);
				}
			},
			onUpdated: {
				addListener(listener: (tabId: number, info: { status: string }) => void) {
					updateListeners.push(listener);
				},
				removeListener(listener: unknown) {
					const index = updateListeners.indexOf(listener as never);
					if (index >= 0) updateListeners.splice(index, 1);
				},
			},
		},
	};

	if (options.withCookies !== false) {
		chrome.cookies = {
			async getAllCookieStores() {
				return (options.stores ?? ['0']).map((id) => ({ id, tabIds: [] }));
			},
			async getAll({ domain, storeId }: { domain: string; storeId?: string }) {
				return cookies.filter(
					(cookie) =>
						(cookie.domain === domain || cookie.domain.endsWith(`.${domain}`)) &&
						(storeId === undefined || (cookie.storeId ?? '0') === storeId),
				);
			},
			async remove(details: { url: string; name: string; storeId?: string; partitionKey?: unknown }) {
				calls.steps.push(`cookie:${details.name}`);
				calls.removedCookies.push(details);
				if (unremovable.has(details.name)) return null;
				const index = cookies.findIndex((cookie) => cookie.name === details.name);
				if (index >= 0) cookies.splice(index, 1);
				return { name: details.name };
			},
		};
	}

	if (options.withBrowsingData !== false) {
		chrome.browsingData = {
			async remove(filter: Record<string, unknown>, types: Record<string, boolean>) {
				const names = Object.keys(types);
				if (options.noOriginFilter && 'origins' in filter) {
					throw new Error('Unsupported filter: origins');
				}
				const rejected = names.filter((name) => unsupported.has(name));
				if (rejected.length > 0) throw new Error(`Unsupported data type: ${rejected[0]}`);
				calls.steps.push(`wipe:${names.join('+')}`);
				calls.browsingData.push({ filter, types: names });
			},
		};
	}

	(globalThis as any).chrome = chrome;
	return { calls, tabs, cookies };
}

// Los módulos leen `chrome` al ejecutarse, así que el stub va antes del import.
installFakeChrome();
const { hardResetMicrosoftSession } = await import('../utils/hardReset.ts');
const { SIGN_OUT_URLS, cookieUrl, isMicrosoftSessionDomain, signOutRequestId, signOutUrl } = await import(
	'@m365copilot/core'
);

const SESSION_COOKIES: FakeCookie[] = [
	{ name: 'ESTSAUTH', domain: '.login.microsoftonline.com', path: '/', secure: true },
	{ name: '__Host-MSAL', domain: 'login.microsoftonline.com', path: '/', secure: true },
	{ name: 'MUID', domain: '.bing.com', path: '/', secure: false },
	{ name: 'OIDC', domain: '.cloud.microsoft', path: '/chat', secure: true, partitionKey: { topLevelSite: 'https://m365.cloud.microsoft' } },
];

// -------------------------------------------------------------------- tests

async function testFullSignOutOrder() {
	const { calls } = installFakeChrome({
		cookies: SESSION_COOKIES,
		tabs: [
			{ id: 1, url: 'https://m365.cloud.microsoft/chat/' },
			{ id: 2, url: 'https://outlook.office.com/mail/' },
			{ id: 3, url: 'https://example.com/' },
		],
	});

	const report = await hardResetMicrosoftSession({ driveTabId: 1 });

	// 1. Los endpoints de logout, en orden, en la pestaña que nos pasaron.
	assert.deepEqual(
		calls.navigated.filter((nav) => SIGN_OUT_URLS.includes(nav.url as never)).map((nav) => nav.url),
		[...SIGN_OUT_URLS],
		'se visita cada endpoint de logout, en orden',
	);
	assert.ok(
		calls.navigated.every((nav) => nav.tabId === 1),
		'todo ocurre en la pestaña que pidió el cierre: no se abren pestañas de la nada',
	);
	assert.deepEqual(calls.created, [], 'con una pestaña que conducir no se crea ninguna');
	assert.deepEqual(report.signedOutFrom, [...SIGN_OUT_URLS]);

	// 2. El ORDEN es el punto: logout del servidor ANTES de borrar las cookies.
	const lastLogout = calls.steps.lastIndexOf(`navigate:${SIGN_OUT_URLS[SIGN_OUT_URLS.length - 1]}`);
	const firstCookie = calls.steps.findIndex((step) => step.startsWith('cookie:'));
	const firstWipe = calls.steps.findIndex((step) => step.startsWith('wipe:'));
	assert.ok(lastLogout >= 0 && firstCookie > lastLogout, 'las cookies se borran después del logout');
	assert.ok(firstWipe > firstCookie, 'el almacenamiento, después de las cookies');

	// 3. Las demás pestañas de Microsoft se cierran (MSAL vivo las resucitaba);
	//    las que no son de Microsoft, ni se tocan.
	assert.deepEqual(report.tabsClosed, 1);
	assert.deepEqual(calls.removedTabs, [2], 'sólo la otra pestaña de Microsoft');

	// 4. Cookies: todas, y con la URL que el navegador necesita para encontrarlas.
	assert.equal(report.cookiesRemoved, SESSION_COOKIES.length);
	assert.equal(report.cookiesFailed, 0);
	const estsauth = calls.removedCookies.find((cookie) => cookie.name === 'ESTSAUTH');
	assert.equal(estsauth?.url, 'https://login.microsoftonline.com/', 'sin el punto del dominio y en https');
	const muid = calls.removedCookies.find((cookie) => cookie.name === 'MUID');
	assert.equal(muid?.url, 'http://bing.com/', 'una cookie no-secure se busca en http');
	const partitioned = calls.removedCookies.find((cookie) => cookie.name === 'OIDC');
	assert.ok(partitioned?.partitionKey, 'una cookie particionada se borra con su partitionKey');
	assert.equal(partitioned?.url, 'https://cloud.microsoft/chat');

	// 5. Almacenamiento por origen, con todos los tipos de una vez.
	assert.equal(calls.browsingData.length, 1, 'un solo lote cuando el navegador lo acepta');
	assert.ok((calls.browsingData[0].filter as { origins?: string[] }).origins?.length);
	assert.ok(calls.browsingData[0].types.includes('localStorage'));
	assert.ok(calls.browsingData[0].types.includes('indexedDB'), 'la caché de MSAL vive también en IndexedDB');
	assert.ok(report.originsCleared > 0);
	assert.deepEqual(report.skippedDataTypes, []);

	// 6. Y acaba en el login, que es lo que el usuario tiene que ver.
	assert.equal(calls.steps[calls.steps.length - 1], 'navigate:https://m365.cloud.microsoft/chat/');
	assert.deepEqual(report.errors, []);

	console.log('  ✓ logout del servidor → cerrar pestañas → cookies → almacenamiento → login');
}

async function testCookiesAcrossStoresAndRefusals() {
	const { calls } = installFakeChrome({
		cookies: [
			{ name: 'ESTSAUTH', domain: '.login.microsoftonline.com', path: '/', secure: true, storeId: '0' },
			{ name: 'ESTSAUTH', domain: '.login.microsoftonline.com', path: '/', secure: true, storeId: 'firefox-container-1' },
			{ name: 'PROTECTED', domain: '.office.com', path: '/', secure: true, storeId: '0' },
		],
		stores: ['0', 'firefox-container-1'],
		unremovable: ['PROTECTED'],
		tabs: [{ id: 9, url: 'https://m365.cloud.microsoft/chat/' }],
	});

	const report = await hardResetMicrosoftSession({ driveTabId: 9 });

	// El contenedor aparte es una sesión distinta: si no se recorre, la sesión
	// «borrada» seguía viva ahí.
	assert.deepEqual(
		[...new Set(calls.removedCookies.map((cookie) => cookie.storeId))].sort(),
		['0', 'firefox-container-1'],
		'se recorren todos los contenedores de cookies',
	);
	// `remove` → null no ha borrado nada: cuenta como fallo, no como éxito.
	assert.equal(report.cookiesRemoved, 2);
	assert.equal(report.cookiesFailed, 1);

	console.log('  ✓ cookies en todos los contenedores, y un borrado rechazado cuenta como fallo');
}

async function testFirefoxStyleFallbacks() {
	// Firefox: no conoce el filtro `origins` ni los tipos `cacheStorage` /
	// `fileSystems`. Antes, un lote rechazado dejaba el almacenamiento intacto.
	const { calls } = installFakeChrome({
		cookies: SESSION_COOKIES,
		tabs: [{ id: 4, url: 'https://m365.cloud.microsoft/chat/' }],
		noOriginFilter: true,
		unsupportedTypes: ['cacheStorage', 'fileSystems', 'webSQL'],
	});

	const report = await hardResetMicrosoftSession({ driveTabId: 4 });

	assert.ok(
		calls.browsingData.every((call) => 'hostnames' in call.filter),
		'sin `origins` se reintenta con `hostnames`',
	);
	assert.deepEqual(report.dataTypes.sort(), ['cookies', 'indexedDB', 'localStorage', 'serviceWorkers']);
	assert.deepEqual(report.skippedDataTypes.sort(), ['cacheStorage', 'fileSystems', 'webSQL']);
	assert.ok(report.originsCleared > 0, 'lo que sí se pudo borrar, se borró');
	assert.deepEqual(report.errors, [], 'un tipo que el navegador no implementa no es un fallo');

	console.log('  ✓ Firefox: `hostnames` en vez de `origins`, y tipo a tipo cuando rechaza el lote');
}

async function testMissingPermissionsAreReported() {
	installFakeChrome({
		tabs: [{ id: 5, url: 'https://m365.cloud.microsoft/chat/' }],
		withCookies: false,
		withBrowsingData: false,
	});

	// Sin los permisos nuevos no se puede borrar nada, pero esto NO puede
	// lanzar: el informe es lo que permite decirle al usuario qué falta.
	const report = await hardResetMicrosoftSession({ driveTabId: 5 });

	assert.equal(report.cookiesRemoved, 0);
	assert.equal(report.originsCleared, 0);
	assert.equal(report.errors.length, 2);
	assert.ok(report.errors.some((error) => error.includes('cookies')));
	assert.ok(report.errors.some((error) => error.includes('browsingData')));
	// Aun así se pasó por el logout del servidor, que es lo único que quedaba.
	assert.deepEqual(report.signedOutFrom, [...SIGN_OUT_URLS]);

	console.log('  ✓ sin los permisos «cookies»/«browsingData» informa, pero no lanza');
}

async function testOpensItsOwnTabWhenThereIsNone() {
	const { calls } = installFakeChrome({ cookies: [], tabs: [] });

	await hardResetMicrosoftSession({ driveTabId: null });

	assert.deepEqual(calls.created, ['about:blank'], 'se abre una pestaña propia para conducir el logout');
	assert.equal(calls.navigated[calls.navigated.length - 1].url, 'https://m365.cloud.microsoft/chat/');

	console.log('  ✓ sin ninguna pestaña abierta, se abre una y se conduce igual');
}

function testPureHelpers() {
	// El marcador: lo que distingue «lo pide VS Code» de «lo enlaza una web».
	const url = signOutUrl('https://m365.cloud.microsoft/chat/', 'abc-123');
	assert.equal(url, 'https://m365.cloud.microsoft/chat/?m365copilot-signout=abc-123');
	assert.equal(signOutRequestId(url), 'abc-123');
	assert.equal(signOutRequestId('https://m365.cloud.microsoft/chat/'), null);
	assert.equal(signOutRequestId('no es una url'), null);
	assert.equal(signOutRequestId('https://m365.cloud.microsoft/chat/?m365copilot-signout=  '), null);

	assert.ok(isMicrosoftSessionDomain('login.microsoftonline.com'));
	assert.ok(isMicrosoftSessionDomain('.login.microsoftonline.com'), 'el punto del dominio de cookie no estorba');
	assert.ok(isMicrosoftSessionDomain('m365.cloud.microsoft'));
	assert.ok(!isMicrosoftSessionDomain('example.com'));
	// Un dominio que sólo TERMINA en uno de los nuestros no vale: borrar sus
	// cookies sería tocar a un tercero.
	assert.ok(!isMicrosoftSessionDomain('notmicrosoft.com'));
	assert.ok(!isMicrosoftSessionDomain('evil-office.com'));

	assert.equal(cookieUrl({ domain: '.office.com', path: '', secure: true }), 'https://office.com/');

	console.log('  ✓ marcador con id, y los dominios ajenos no se confunden con los de Microsoft');
}

console.log('hardReset.ts (cierre de sesión completo)');
await testFullSignOutOrder();
await testCookiesAcrossStoresAndRefusals();
await testFirefoxStyleFallbacks();
await testMissingPermissionsAreReported();
await testOpensItsOwnTabWhenThereIsNone();
testPureHelpers();
console.log('\nAll tests passed.');

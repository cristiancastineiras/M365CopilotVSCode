/**
 * El cierre de sesión completo: borra todo lo que sostiene la sesión de
 * Microsoft en este navegador y deja al usuario en la pantalla de login.
 *
 * El **qué** y el **por qué** viven en `signOut.ts` de `@m365copilot/core`
 * (listas de dominios, orígenes y endpoints de logout). Aquí está sólo el
 * pegamento con las APIs del navegador, y el orden, que es lo delicado:
 *
 *   1. pasar por los endpoints de logout — **antes** de borrar nada, porque
 *      necesitan las cookies para saber qué sesión cerrar en el servidor;
 *   2. cerrar las demás pestañas de Microsoft, para que no quede ninguna
 *      instancia de MSAL viva volviendo a escribir su caché detrás de
 *      nosotros (era lo que resucitaba la sesión «borrada»);
 *   3. borrar las cookies, una por una y en todos los contenedores;
 *   4. borrar localStorage, IndexedDB, Cache Storage, service workers… de
 *      cada origen de Microsoft (ahí vive la caché de tokens de MSAL y el
 *      store de captura de esta extensión);
 *   5. navegar a M365 Copilot, que ya sin sesión pide iniciar sesión.
 *
 * Nada aquí lanza: un navegador puede no implementar un tipo de dato
 * (Firefox no tiene `cacheStorage` en `browsingData`) o negar un permiso, y
 * un cierre de sesión a medias con un informe honesto es mucho más útil que
 * una excepción. Todo lo que falla se cuenta en {@link HardResetReport}.
 */
import {
	cookieUrl,
	isMicrosoftTabUrl,
	M365_CHAT_URL,
	MICROSOFT_COOKIE_DOMAINS,
	MICROSOFT_SESSION_ORIGINS,
	SESSION_DATA_TYPES,
	SIGN_OUT_URLS,
	type SessionDataType,
	type SignOutReport,
} from '@m365copilot/core';
import { ext } from './api';
import { logger } from './logger';

/** Cuánto se espera a que cargue cada página de logout antes de seguir. */
const LOGOUT_STEP_TIMEOUT_MS = 15_000;

/**
 * Qué se consiguió borrar. La forma es {@link SignOutReport}, que vive en
 * `@m365copilot/core` porque VS Code lee este mismo informe para resumirlo.
 */
export type HardResetReport = SignOutReport & { dataTypes: SessionDataType[]; skippedDataTypes: SessionDataType[] };

function emptyReport(): HardResetReport {
	return {
		cookiesRemoved: 0,
		cookiesFailed: 0,
		originsCleared: 0,
		dataTypes: [],
		skippedDataTypes: [],
		tabsClosed: 0,
		signedOutFrom: [],
		errors: [],
	};
}

export interface HardResetOptions {
	/**
	 * Pestaña desde la que se pidió el cierre de sesión, si la hay: se
	 * reutiliza para la cadena de logout en vez de abrir una nueva, que es lo
	 * que hace que al usuario no le aparezcan pestañas de la nada.
	 */
	readonly driveTabId?: number | null;
	/** Dejar al usuario en la pantalla de login al terminar (por defecto, sí). */
	readonly openSignIn?: boolean;
}

/**
 * Borra la sesión de Microsoft de este navegador. Devuelve el informe de lo
 * que se pudo hacer; nunca lanza.
 */
export async function hardResetMicrosoftSession(
	options: HardResetOptions = {},
): Promise<HardResetReport> {
	const report = emptyReport();
	logger.info('Cierre de sesión completo: empezando');

	// --- 1. una pestaña que conducir, y la cadena de logout del servidor
	const driver = await resolveDriverTab(options.driveTabId ?? null, report);
	if (driver !== null) await visitSignOutUrls(driver, report);

	// --- 2. ninguna instancia de MSAL viva mientras borramos
	report.tabsClosed = await closeMicrosoftTabs(driver, report);

	// --- 3. cookies (la sesión de Entra ID / Microsoft Account)
	await removeSessionCookies(report);

	// --- 4. almacenamiento por origen (la caché de tokens de MSAL)
	await removeOriginData(report);

	// --- 5. y de vuelta al login
	if (options.openSignIn !== false) await openSignIn(driver, report);

	logger.info('Cierre de sesión completo: terminado', report);
	return report;
}

// ------------------------------------------------------------------ pestañas

async function microsoftTabs(): Promise<chrome.tabs.Tab[]> {
	try {
		const all = await ext().tabs.query({});
		return all.filter((tab) => isMicrosoftTabUrl(tab.url));
	} catch (error) {
		logger.warn('No se pudieron listar las pestañas:', error);
		return [];
	}
}

/**
 * La pestaña que vamos a conducir por el logout. Se prefiere la que pidió el
 * cierre de sesión; si no vale (ya no existe, o nadie la pasó), se reutiliza
 * cualquier pestaña de Microsoft abierta, y en último caso se abre una.
 */
async function resolveDriverTab(
	preferred: number | null,
	report: HardResetReport,
): Promise<number | null> {
	if (preferred !== null) {
		try {
			const tab = await ext().tabs.get(preferred);
			if (tab?.id !== undefined) return tab.id;
		} catch {
			/* la pestaña ya no está: se busca otra */
		}
	}
	const existing = (await microsoftTabs()).find((tab) => tab.id !== undefined);
	if (existing?.id !== undefined) return existing.id;

	try {
		// Activa a propósito: el usuario tiene que ver el logout y poder
		// resolver cualquier pantalla intermedia («¿con qué cuenta?»).
		const created = await ext().tabs.create({ url: 'about:blank', active: true });
		return created.id ?? null;
	} catch (error) {
		report.errors.push(`No se pudo abrir una pestaña para cerrar la sesión: ${describe(error)}`);
		return null;
	}
}

/** Navega una pestaña y espera a que termine de cargar (o a que se agote el plazo). */
function navigateAndWait(tabId: number, url: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				ext().tabs.onUpdated.removeListener(listener);
			} catch {
				/* ya retirado */
			}
			if (error) reject(error);
			else resolve();
		};

		const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
			// `complete` llega al final de la navegación, redirecciones
			// incluidas: es lo más cerca que estamos de «ya ha cerrado sesión».
			if (updatedTabId === tabId && info.status === 'complete') finish();
		};
		const timer = setTimeout(() => finish(new Error(`tiempo agotado cargando ${url}`)), timeoutMs);

		try {
			ext().tabs.onUpdated.addListener(listener);
			void Promise.resolve(ext().tabs.update(tabId, { url })).catch(finish);
		} catch (error) {
			finish(error);
		}
	});
}

/**
 * La mitad de la sesión que vive en el servidor: se visita cada endpoint de
 * logout en la misma pestaña, uno detrás de otro. Si uno falla se sigue con
 * los demás — son independientes (organización, cuenta personal, Office).
 */
async function visitSignOutUrls(tabId: number, report: HardResetReport): Promise<void> {
	for (const url of SIGN_OUT_URLS) {
		try {
			await navigateAndWait(tabId, url, LOGOUT_STEP_TIMEOUT_MS);
			report.signedOutFrom.push(url);
			logger.info(`Sesión cerrada en ${url}`);
		} catch (error) {
			report.errors.push(`Logout en ${url}: ${describe(error)}`);
		}
	}
}

/** Cierra las pestañas de Microsoft, menos la que estamos conduciendo. */
async function closeMicrosoftTabs(driver: number | null, report: HardResetReport): Promise<number> {
	const ids = (await microsoftTabs())
		.map((tab) => tab.id)
		.filter((id): id is number => id !== undefined && id !== driver);
	if (ids.length === 0) return 0;
	try {
		await ext().tabs.remove(ids);
		return ids.length;
	} catch (error) {
		report.errors.push(`No se pudieron cerrar algunas pestañas: ${describe(error)}`);
		return 0;
	}
}

/** Último paso: la web de Copilot, que sin sesión pide iniciar sesión. */
async function openSignIn(driver: number | null, report: HardResetReport): Promise<void> {
	try {
		if (driver !== null) await ext().tabs.update(driver, { url: M365_CHAT_URL, active: true });
		else await ext().tabs.create({ url: M365_CHAT_URL, active: true });
	} catch (error) {
		report.errors.push(`No se pudo abrir M365 Copilot: ${describe(error)}`);
	}
}

// ------------------------------------------------------------------- cookies

/**
 * Borra una por una todas las cookies de los dominios de Microsoft, en todos
 * los contenedores de cookies (los «contextual identities» de Firefox y el
 * modo incógnito son stores aparte: borrar sólo el store por defecto dejaba
 * la sesión viva en ellos).
 *
 * Se hace cookie a cookie y no con `browsingData` porque es la única forma de
 * saber cuántas se fueron de verdad — y `browsingData` las borra por dominio
 * registrable, sin decir nada de lo que tocó.
 */
async function removeSessionCookies(report: HardResetReport): Promise<void> {
	const cookies = ext().cookies;
	if (!cookies) {
		report.errors.push('Falta el permiso «cookies»: no se pueden borrar las cookies de sesión.');
		return;
	}

	const storeIds = await cookieStoreIds();
	for (const storeId of storeIds) {
		for (const domain of MICROSOFT_COOKIE_DOMAINS) {
			let found: chrome.cookies.Cookie[];
			try {
				// `domain` incluye los subdominios: una consulta por dominio
				// registrable cubre login.*, account.*, www.*…
				found = await cookies.getAll(storeId === null ? { domain } : { domain, storeId });
			} catch (error) {
				report.errors.push(`Cookies de ${domain}: ${describe(error)}`);
				continue;
			}
			for (const cookie of found) {
				if (await removeCookie(cookie, storeId)) report.cookiesRemoved++;
				else report.cookiesFailed++;
			}
		}
	}
	logger.info(`Cookies borradas: ${report.cookiesRemoved} (fallidas: ${report.cookiesFailed})`);
}

/** Los contenedores de cookies; `[null]` si el navegador no los expone. */
async function cookieStoreIds(): Promise<(string | null)[]> {
	try {
		const stores = await ext().cookies.getAllCookieStores();
		const ids = stores.map((store) => store.id).filter(Boolean);
		return ids.length > 0 ? ids : [null];
	} catch {
		return [null];
	}
}

async function removeCookie(cookie: chrome.cookies.Cookie, storeId: string | null): Promise<boolean> {
	// Las cookies particionadas (CHIPS) son otra cookie distinta con el mismo
	// nombre: sin pasar su `partitionKey`, `remove` no encuentra nada y la deja.
	const partitionKey = (cookie as { partitionKey?: unknown }).partitionKey;
	// `partitionKey` es más nuevo que los tipos de @types/chrome que usamos:
	// se añade por intersección en vez de forzar todo el objeto a `Details`.
	const details: chrome.cookies.Details & { partitionKey?: unknown } = {
		url: cookieUrl(cookie),
		name: cookie.name,
	};
	if (storeId !== null) details.storeId = storeId;
	if (partitionKey) details.partitionKey = partitionKey;

	try {
		const removed = await ext().cookies.remove(details);
		// `remove` resuelve a `null` cuando no ha borrado nada: eso es un fallo,
		// no un éxito silencioso (es como se escondía que las `__Host-` seguían ahí).
		return removed !== null;
	} catch {
		return false;
	}
}

// ------------------------------------------------- almacenamiento por origen

/**
 * Vacía localStorage, IndexedDB, Cache Storage, service workers… de cada
 * origen de Microsoft. Ahí es donde MSAL guarda su caché de tokens, así que
 * es el paso que impide que la web se renueve sola sin preguntar.
 *
 * `sessionStorage` no se puede borrar desde aquí (no es un tipo de
 * `browsingData`), pero muere con la pestaña: para eso se cierran antes.
 */
async function removeOriginData(report: HardResetReport): Promise<void> {
	const browsingData = ext().browsingData;
	if (!browsingData) {
		report.errors.push('Falta el permiso «browsingData»: no se pudo vaciar el almacenamiento de las webs.');
		return;
	}

	const origins = [...MICROSOFT_SESSION_ORIGINS];
	const all = Object.fromEntries(SESSION_DATA_TYPES.map((type) => [type, true]));

	// Camino rápido: un solo lote con todos los tipos.
	if (await tryRemove(origins, all)) {
		report.dataTypes = [...SESSION_DATA_TYPES];
		report.originsCleared = origins.length;
		return;
	}

	// Lo rechazó: casi siempre porque un tipo no existe en este navegador
	// (Firefox y `cacheStorage`, Chrome moderno y `webSQL`). Se va tipo a tipo
	// para quedarse con todos los que sí valen, en vez de no borrar nada.
	for (const type of SESSION_DATA_TYPES) {
		if (await tryRemove(origins, { [type]: true })) report.dataTypes.push(type);
		else report.skippedDataTypes.push(type);
	}
	report.originsCleared = report.dataTypes.length > 0 ? origins.length : 0;
	if (report.dataTypes.length === 0) {
		report.errors.push('El navegador no aceptó vaciar el almacenamiento de ningún origen.');
	}
}

/**
 * Un intento de borrado. Chrome filtra por `origins`; Firefox no lo
 * implementa y pide `hostnames`, así que se prueban los dos antes de dar un
 * tipo por imposible.
 */
async function tryRemove(origins: string[], dataTypes: Record<string, boolean>): Promise<boolean> {
	const hostnames = origins.map((origin) => new URL(origin).hostname);
	for (const filter of [{ origins }, { hostnames }] as chrome.browsingData.RemovalOptions[]) {
		try {
			await ext().browsingData.remove(filter, dataTypes as chrome.browsingData.DataTypeSet);
			return true;
		} catch (error) {
			logger.debug('browsingData.remove rechazado:', describe(error));
		}
	}
	return false;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Cerrar la sesión de Microsoft **de verdad**: qué datos hay que borrar, en
 * qué orden y a qué endpoints hay que llamar para que la próxima visita a
 * M365 Copilot vuelva a pedir credenciales.
 *
 * Por qué hace falta todo esto, y no basta con borrar el token guardado:
 *
 *  1. El token de Copilot que captura la extensión es la última capa de una
 *     pila. Debajo está la caché de MSAL de la web (localStorage + IndexedDB
 *     en `m365.cloud.microsoft`), y debajo de todo la **sesión de Entra ID /
 *     Microsoft Account**, que vive en cookies de `login.microsoftonline.com`
 *     y `login.live.com`. Borrar sólo el token hace que la web pida otro… y
 *     MSAL lo renueva en silencio con esas cookies, sin preguntar nada. Es
 *     exactamente por eso que «renovar» no volvía a pedir iniciar sesión.
 *
 *  2. La sesión también tiene una mitad **en el servidor**: aunque se borre
 *     todo en local, el siguiente `authorize` puede resolverse solo contra la
 *     sesión que Microsoft recuerda del navegador. Por eso hay que pasar
 *     además por los endpoints de logout ({@link SIGN_OUT_URLS}).
 *
 * Este módulo es puro a propósito (no toca ninguna API de `chrome` ni de
 * `vscode`): las listas son el contrato que consumen la extensión de
 * navegador (la única que puede borrar cookies) y la de VS Code.
 */

/**
 * Dominios registrables cuyas cookies sostienen la sesión. Se usan con
 * `chrome.cookies.getAll({ domain })`, que ya incluye los subdominios: una
 * entrada por dominio registrable cubre `login.`, `account.`, `www.`…
 *
 * `bing.com` está aquí porque BizChat (el backend del chat de Copilot) nació
 * en Bing y todavía deja ahí cookies de sesión; el precio es que un cierre de
 * sesión también olvida las preferencias de búsqueda de Bing.
 */
export const MICROSOFT_COOKIE_DOMAINS = [
	// --- identidad (lo que de verdad evita que vuelva a pedir la contraseña)
	'microsoftonline.com',
	'microsoftonline-p.com',
	'microsoftonline-p.net',
	'windows.net',
	'live.com',
	'msauth.net',
	'msftauth.net',
	'msidentity.com',
	// --- Microsoft 365 / Copilot
	'microsoft.com',
	'cloud.microsoft',
	'office.com',
	'office.net',
	'office365.com',
	'outlook.com',
	'sharepoint.com',
	'microsoft365.com',
	'bing.com',
] as const;

/**
 * Orígenes concretos donde las webs de Microsoft guardan localStorage,
 * IndexedDB, Cache Storage y service workers (incluida la caché de MSAL y el
 * store de captura de esta extensión).
 *
 * Aquí **no** sirven los dominios registrables: `browsingData` filtra por
 * origen exacto para todo lo que no sean cookies, así que hay que nombrar
 * cada web una por una.
 */
export const MICROSOFT_SESSION_ORIGINS = [
	// --- identidad
	'https://login.microsoftonline.com',
	'https://login.microsoft.com',
	'https://login.windows.net',
	'https://login.live.com',
	'https://account.live.com',
	'https://account.microsoft.com',
	'https://aadcdn.msauth.net',
	'https://aadcdn.msftauth.net',
	// --- M365 Copilot (donde se captura el token)
	'https://m365.cloud.microsoft',
	'https://cloud.microsoft',
	'https://copilot.cloud.microsoft',
	'https://word.cloud.microsoft',
	'https://excel.cloud.microsoft',
	'https://powerpoint.cloud.microsoft',
	'https://outlook.cloud.microsoft',
	// --- el resto de M365
	'https://www.office.com',
	'https://office.com',
	'https://portal.office.com',
	'https://outlook.office.com',
	'https://outlook.office365.com',
	'https://teams.microsoft.com',
	'https://substrate.office.com',
	'https://graph.microsoft.com',
	'https://copilot.microsoft.com',
	'https://www.bing.com',
] as const;

/**
 * `host_permissions` que necesita la extensión de navegador para poder tocar
 * esas cookies: la API `chrome.cookies` exige permiso sobre la URL de cada
 * cookie que se lee o se borra, y `browsingData` sobre cada origen.
 */
export const MICROSOFT_HOST_PERMISSIONS: readonly string[] = MICROSOFT_COOKIE_DOMAINS.map(
	(domain) => `*://*.${domain}/*`,
);

/**
 * Tipos de datos que se borran, por origen. Son los que `browsingData` deja
 * filtrar por origen/host; la caché HTTP global **no** está en la lista a
 * propósito: no se puede limitar a unos orígenes, así que incluirla vaciaría
 * la caché de todas las webs del navegador sin que haga falta para volver a
 * pedir la sesión — lo que la sostiene son cookies y almacenamiento, y eso sí
 * se borra entero (`cacheStorage` y los service workers incluidos).
 *
 * No todos los navegadores conocen todos: Firefox no implementa
 * `cacheStorage` ni `fileSystems` en `browsingData`, y `webSQL` ya no existe
 * en Chrome moderno. Quien llame tiene que reintentar tipo a tipo si el lote
 * completo es rechazado (ver `hardReset` en la extensión de navegador).
 */
export const SESSION_DATA_TYPES = [
	'cookies',
	'localStorage',
	'indexedDB',
	'cacheStorage',
	'serviceWorkers',
	'fileSystems',
	'webSQL',
] as const;

export type SessionDataType = (typeof SESSION_DATA_TYPES)[number];

/**
 * Endpoints de cierre de sesión, en el orden en que hay que visitarlos: antes
 * de borrar nada en local, porque necesitan las cookies para identificar la
 * sesión que tienen que matar.
 *
 *  - el primero cierra la sesión de **Entra ID** (cuentas de organización);
 *  - el segundo la de **Microsoft Account** (cuentas personales);
 *  - el tercero es el logout de Office, que suelta además las cookies de
 *    aplicación de M365.
 *
 * Sin `post_logout_redirect_uri`: Microsoft sólo acepta URIs registradas por
 * la aplicación, así que cada endpoint se queda en su propia página de «has
 * cerrado la sesión» y es quien llama el que navega al siguiente.
 */
export const SIGN_OUT_URLS = [
	'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
	'https://login.live.com/logout.srf',
	'https://www.office.com/estslogout',
] as const;

/**
 * Lo que se consiguió borrar. Lo produce la extensión de navegador (la única
 * que puede tocar cookies) y lo lee tal cual la de VS Code, que lo resume al
 * usuario: es un contrato entre las dos, así que vive aquí.
 */
export interface SignOutReport {
	/** Cookies borradas de verdad (releídas para confirmarlo). */
	cookiesRemoved: number;
	/** Cookies que el navegador se negó a borrar (sin permiso, protegidas…). */
	cookiesFailed: number;
	/** Orígenes de Microsoft cuyo almacenamiento se vació. */
	originsCleared: number;
	/** Tipos de dato que este navegador aceptó borrar. */
	dataTypes: string[];
	/** Tipos que no implementa (informativo: no son un fallo). */
	skippedDataTypes: string[];
	/** Pestañas de Microsoft que se cerraron. */
	tabsClosed: number;
	/** Endpoints de logout que se visitaron con éxito. */
	signedOutFrom: string[];
	/** Todo lo que falló, en texto, para poder contarlo sin adivinar. */
	errors: string[];
}

/**
 * Marcador con el que la extensión de VS Code pide el cierre de sesión al
 * abrir el navegador: `…/chat/?m365copilot-signout=<id>`.
 *
 * El `id` no es decorativo. El content script que ve el marcador no puede
 * saber quién abrió esa pestaña, así que el background sólo obedece si ese
 * mismo `id` es el que VS Code tiene pendiente en su servidor local. Sin esa
 * comprobación, cualquier web podría enlazar esa URL y tirar la sesión de
 * Microsoft del usuario.
 */
export const SIGN_OUT_PARAM = 'm365copilot-signout';

/** `…/chat/?m365copilot-signout=<requestId>` */
export function signOutUrl(chatUrl: string, requestId: string): string {
	const url = new URL(chatUrl);
	url.searchParams.set(SIGN_OUT_PARAM, requestId);
	return url.toString();
}

/** El `id` del marcador, o null si esta URL no pide ningún cierre de sesión. */
export function signOutRequestId(url: string): string | null {
	try {
		const value = new URL(url).searchParams.get(SIGN_OUT_PARAM);
		return value && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

/** ¿Este host es uno de los que sostienen la sesión de Microsoft? */
export function isMicrosoftSessionDomain(host: string): boolean {
	const hostname = host.replace(/^\.+/, '').toLowerCase();
	return MICROSOFT_COOKIE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * URL con la que borrar una cookie: `chrome.cookies.remove` no acepta un
 * dominio, pide la URL a la que «pertenecería» la cookie. Las cookies de
 * dominio llegan con un punto delante (`.login.microsoftonline.com`), que hay
 * que quitar, y el esquema tiene que ser `https` si la cookie es `secure` —
 * si no, el navegador no encuentra la cookie que se le pide borrar y la deja
 * viva (con el nombre `__Secure-`/`__Host-` delante es garantía de fallo).
 */
export function cookieUrl(cookie: { domain: string; path: string; secure: boolean }): string {
	const host = cookie.domain.replace(/^\./, '');
	const path = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/';
	return `${cookie.secure ? 'https' : 'http'}://${host}${path}`;
}

/** ¿Es una pestaña de Microsoft (la cierra o la reutiliza el cierre de sesión)? */
export function isMicrosoftTabUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		const { protocol, hostname } = new URL(url);
		return (protocol === 'https:' || protocol === 'http:') && isMicrosoftSessionDomain(hostname);
	} catch {
		return false;
	}
}

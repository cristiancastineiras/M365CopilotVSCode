/**
 * Contrato de red entre la extensión de navegador, los userscripts de
 * Tampermonkey y el servidor local de la extensión de VS Code.
 *
 * Es la ÚNICA fuente de verdad: si el puerto o la ruta se desincronizan, el
 * token deja de sincronizarse silenciosamente (exactamente el bug que había
 * cuando el navegador apuntaba a 39283/profile y el servidor escuchaba en
 * 51827/token). Manténlo aquí y consúmelo desde ambos lados.
 */
export const TOKEN_SERVER_HOST = 'localhost';
export const TOKEN_SERVER_PORT = 51827;
export const TOKEN_SERVER_URL = `http://${TOKEN_SERVER_HOST}:${TOKEN_SERVER_PORT}`;

/** Ruta donde el servidor de VS Code recibe el perfil/token (POST). */
export const TOKEN_ENDPOINT_PATH = '/token';
/** Ruta de health-check para saber si VS Code está escuchando (GET). */
export const HEALTH_ENDPOINT_PATH = '/health';
/**
 * Ruta por la que la extensión de navegador avisa de que ya ha cerrado la
 * sesión de Microsoft (POST). El health-check es además el canal de ida: ahí
 * VS Code publica la petición pendiente, y el navegador la recoge en su
 * siguiente latido (ver signOut.ts).
 */
export const SIGNOUT_ENDPOINT_PATH = '/signout';

/**
 * Web de M365 Copilot: donde se captura el token. La extensión de navegador
 * abre aquí una pestaña en segundo plano para renovarlo, y la de VS Code la
 * ofrece cuando el token falta o caduca.
 */
export const M365_CHAT_URL = 'https://m365.cloud.microsoft/chat/';

/** Clave de localStorage donde el interceptor del navegador acumula la captura. */
export const CAPTURE_STORE_KEY = 'm365copilot.capture.v1';

/**
 * Marcador de los mensajes `window.postMessage` entre el interceptor (mundo
 * MAIN) y el puente (mundo ISOLATED) de la extensión de navegador.
 */
export const BRIDGE_MESSAGE_MARKER = '__m365copilot';

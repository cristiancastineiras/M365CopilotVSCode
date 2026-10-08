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

/**
 * Dominios donde los content scripts (interceptor + puente) tienen que
 * inyectarse para capturar el token. Es la ÚNICA fuente de verdad: los dos
 * content scripts la consumen, así que no se pueden desincronizar.
 *
 * Tiene que cubrir TODA superficie donde la web abre el WebSocket del chat o
 * guarda el token de MSAL, no sólo `m365.cloud.microsoft`:
 * - `*.cloud.microsoft`     el chat actual (m365, copilot…).
 * - `*.microsoft365.com`    el portal nuevo (antes office.com); es por donde
 *                            entra mucha gente, sobre todo desde Edge.
 * - `*.office.com`          Outlook/Office en la web embeben BizChat.
 * - `teams.microsoft.com`   Copilot dentro de Teams.
 *
 * Antes la lista era más estrecha que los `host_permissions` del manifest, así
 * que en esas otras superficies el interceptor ni siquiera arrancaba: ni log ni
 * captura. Debe ir acompañada de `all_frames` — el chat suele vivir en un
 * iframe, y sin eso el interceptor sólo corre en el documento de arriba.
 */
export const COPILOT_CONTENT_MATCHES = [
  'https://*.cloud.microsoft/*',
  'https://*.microsoft365.com/*',
  'https://*.office.com/*',
  'https://teams.microsoft.com/*',
] as const;

/** Clave de localStorage donde el interceptor del navegador acumula la captura. */
export const CAPTURE_STORE_KEY = 'm365copilot.capture.v1';

/**
 * Marcador de los mensajes `window.postMessage` entre el interceptor (mundo
 * MAIN) y el puente (mundo ISOLATED) de la extensión de navegador.
 */
export const BRIDGE_MESSAGE_MARKER = '__m365copilot';

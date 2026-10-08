import type { ConfigEnv, UserManifest } from 'wxt';
import { MICROSOFT_HOST_PERMISSIONS } from '@m365copilot/core';

/**
 * Piezas compartidas por wxt.config.ts (Chrome) y wxt.config.firefox.ts:
 * antes vivían duplicadas en los dos archivos, así que un permiso o una
 * opción de build que se tocaba en uno y se olvidaba en el otro se
 * desincronizaba en silencio (el mismo tipo de bug que ya sufrió este
 * proyecto con el puerto del servidor local — ver constants.ts en
 * @m365copilot/core). Ahora hay un único sitio que editar.
 */
export const sharedManifest: UserManifest = {
  // Nombre y descripción traducidos por el i18n nativo del navegador
  // (public/_locales/<idioma>/messages.json); el inglés es el de reserva.
  default_locale: 'en',
  name: '__MSG_extName__',
  description: '__MSG_extDescription__',
  // Sin `version` aquí: WXT usa la de package.json (`pkg?.version`) por
  // defecto. Fijarla a mano es un tercer sitio que sincronizar a cada release
  // — igual que el bug de duplicación que ya arregló wxt.config.base.ts.
  // `alarms` es imprescindible: en MV3 el background es un service worker que
  // Chrome duerme a los ~30 s, así que el único latido fiable para renovar el
  // token es una alarma. Sin este permiso `chrome.alarms` es `undefined` y la
  // primera llamada tumbaba el background entero — con él, los handlers de
  // mensajes y la sincronización con VS Code.
  // `cookies` y `browsingData` son lo que hace posible el cierre de sesión de
  // verdad: la sesión de Microsoft no vive en el token que captura esta
  // extensión, sino en las cookies de login.microsoftonline.com y en la caché
  // de MSAL (localStorage/IndexedDB) de cada web de M365. Sin estos dos
  // permisos, «renovar» sólo podía pedir otro token — y MSAL lo daba en
  // silencio con la sesión de siempre, sin volver a preguntar nada.
  permissions: ['storage', 'tabs', 'activeTab', 'alarms', 'cookies', 'browsingData'],
  host_permissions: [
    // Necesario para que el background pueda hacer fetch al servidor local de
    // la extensión de VS Code (http://localhost:51827) sin bloqueo de CORS.
    'http://localhost/*',
    // La API `cookies` exige permiso sobre la URL de cada cookie que se lee o
    // se borra, y `browsingData` sobre cada origen: la lista sale de
    // signOut.ts en @m365copilot/core, que es la única fuente de verdad de
    // qué dominios sostienen la sesión.
    ...MICROSOFT_HOST_PERMISSIONS,
  ],
  icons: {
    16: '/favicon-16x16.png',
    32: '/favicon-32x32.png',
    96: '/favicon-96x96.png',
    120: '/favicon-120x120.png',
  },
  action: {
    default_title: '__MSG_actionTitle__',
    default_icon: {
      16: '/favicon-16x16.png',
      32: '/favicon-32x32.png',
      96: '/favicon-96x96.png',
      120: '/favicon-120x120.png',
    },
  },
};

/**
 * ID permanente del complemento en Firefox. Sin él, «Instalar complemento
 * desde archivo» rechaza el .zip/.xpi con «parece estar dañado»
 * (ERROR_CORRUPT_FILE): Firefox sólo deja instalar sin ID las cargas
 * temporales de about:debugging. Una vez firmado en AMO no se puede cambiar
 * — si cambia, Firefox lo trata como otro complemento distinto.
 */
export const FIREFOX_ADDON_ID = 'm365-copilot-vscode@cristiancastineiras.github.io';

/**
 * Manifest por navegador. Chrome no conoce `browser_specific_settings` (lo
 * ignora con un aviso en chrome://extensions), así que sólo va en Firefox.
 */
export function manifestFor({ browser }: ConfigEnv): UserManifest {
  if (browser !== 'firefox') return sharedManifest;
  return {
    ...sharedManifest,
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ADDON_ID,
        // 128 es la primera versión con `world: 'MAIN'` en los content
        // scripts del manifest (también en MV2): sin eso el interceptor corre
        // aislado y no ve el WebSocket del chat, así que no captura nada.
        strict_min_version: '128.0',
        // Consentimiento de datos nativo de Firefox (140+; las anteriores lo
        // ignoran con un aviso). AMO lo exige para firmar extensiones nuevas.
        // Para Mozilla «transmitir» es sacar datos del navegador, y mandar el
        // perfil al servidor local de VS Code lo es: el token
        // (authenticationInfo) y la plantilla de la invocación `chat`, que
        // incluye el último mensaje escrito en Copilot (personalCommunications).
        data_collection_permissions: {
          required: ['authenticationInfo', 'personalCommunications'],
        },
      },
    },
  } as UserManifest;
}

/**
 * Este `vite` (via wxt → vite@8) ya bundlea con Rolldown y transforma cada
 * archivo con Oxc en vez de esbuild — por eso se usan `rolldownOptions` (no
 * el alias `rollupOptions`, deprecado) y `oxc` (no `esbuild`, deprecado desde
 * que Oxc lo sustituyó como transform de Vite).
 *
 * `esnext` es a propósito: es el navegador el que carga estos bundles (no hay
 * que soportar Node antiguo ni browsers legacy), así que apuntar al target
 * más moderno evita down-leveling y helpers de más → menos JS que descargar y
 * ejecutar. `manualChunks: undefined` deja que cada entrypoint (background,
 * content, interceptor, popup) sea un archivo autocontenido: no hay
 * navegación entre páginas que se beneficie de un vendor chunk compartido, y
 * los content scripts no pueden cargar chunks adicionales de todos modos.
 */
export const sharedViteBuild = {
  build: {
    target: 'esnext',
    // Oxc (Rust) es el minificador nativo de este Vite: más rápido que la
    // vía esbuild y es el default para builds de cliente, lo dejamos explícito.
    minify: 'oxc',
    rolldownOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  oxc: {
    target: 'esnext',
  },
} as const;

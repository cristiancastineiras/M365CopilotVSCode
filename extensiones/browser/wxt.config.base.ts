import type { UserManifest } from 'wxt';

/**
 * Piezas compartidas por wxt.config.ts (Chrome) y wxt.config.firefox.ts:
 * antes vivían duplicadas en los dos archivos, así que un permiso o una
 * opción de build que se tocaba en uno y se olvidaba en el otro se
 * desincronizaba en silencio (el mismo tipo de bug que ya sufrió este
 * proyecto con el puerto del servidor local — ver constants.ts en
 * @m365copilot/core). Ahora hay un único sitio que editar.
 */
export const sharedManifest: UserManifest = {
  name: 'Microsoft 365 Copilot VS Code Extension',
  description: 'Browser extension to capture M365 Copilot authentication tokens and sync with VS Code',
  // Sin `version` aquí: WXT usa la de package.json (`pkg?.version`) por
  // defecto. Fijarla a mano es un tercer sitio que sincronizar a cada release
  // — igual que el bug de duplicación que ya arregló wxt.config.base.ts.
  // `alarms` es imprescindible: en MV3 el background es un service worker que
  // Chrome duerme a los ~30 s, así que el único latido fiable para renovar el
  // token es una alarma. Sin este permiso `chrome.alarms` es `undefined` y la
  // primera llamada tumbaba el background entero — con él, los handlers de
  // mensajes y la sincronización con VS Code.
  permissions: ['storage', 'tabs', 'activeTab', 'alarms'],
  // Necesario para que el background pueda hacer fetch al servidor local de
  // la extensión de VS Code (http://localhost:51827) sin bloqueo de CORS.
  host_permissions: ['http://localhost/*'],
  icons: {
    16: '/favicon-16x16.png',
    32: '/favicon-32x32.png',
    96: '/favicon-96x96.png',
    120: '/favicon-120x120.png',
  },
  action: {
    default_icon: {
      16: '/favicon-16x16.png',
      32: '/favicon-32x32.png',
      96: '/favicon-96x96.png',
      120: '/favicon-120x120.png',
    },
  },
};

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

import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  extensionApi: 'chrome',
  outDir: '../../releases/chrome',
  alias: {
    '@': fileURLToPath(new URL('.', import.meta.url)),
  },
  runner: {
    disabled: true,
  },
  manifest: {
    name: 'Microsoft 365 Copilot VS Code Extension',
    description: 'Browser extension to capture M365 Copilot authentication tokens and sync with VS Code',
    version: '0.0.1',
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
  },
  vite: () => ({
    build: {
      target: 'esnext',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
    esbuild: {
      target: 'esnext',
      treeShaking: true,
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
    },
  }),
  publicDir: 'logo',
});
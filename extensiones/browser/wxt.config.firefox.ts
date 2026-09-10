import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  extensionApi: 'chrome',
  outDir: '../../releases/firefox',
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
    permissions: ['storage', 'tabs', 'activeTab', 'alarms'],
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
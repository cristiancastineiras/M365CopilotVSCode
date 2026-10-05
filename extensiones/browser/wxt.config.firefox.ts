import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import { sharedManifest } from './wxt.config.base';

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
    ...sharedManifest,
    // Fijada a mano (y no la de package.json) porque los scripts `zip` de
    // package.json renombran el .zip esperando exactamente este número.
    version: '0.0.1',
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
  publicDir: 'public',
});
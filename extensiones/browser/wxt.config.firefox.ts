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
  // Sin `version`: WXT usa la de package.json, que Changesets sube en cada
  // release junto con las de los otros dos paquetes.
  manifest: sharedManifest,
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
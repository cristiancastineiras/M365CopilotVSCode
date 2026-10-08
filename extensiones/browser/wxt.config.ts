import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import { manifestFor } from './wxt.config.base';

export default defineConfig({
  extensionApi: 'chrome',
  outDir: '../../releases/chrome',
  alias: {
    '@': fileURLToPath(new URL('.', import.meta.url)),
  },
  runner: {
    disabled: true,
  },
  // Sin `version`: WXT usa la de package.json, que Changesets sube en cada
  // release junto con las de los otros dos paquetes.
  manifest: manifestFor,
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
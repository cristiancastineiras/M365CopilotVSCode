import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import { manifestFor } from './wxt.config.base';

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
  // El zip de fuentes es el que pide AMO al firmar (el código va minificado).
  // Sale desde la raíz del monorepo: con la raíz por defecto (este paquete)
  // faltaba @m365copilot/core (packages/core) y el lockfile, así que el
  // revisor no podía reconstruir el build.
  zip: {
    sourcesRoot: fileURLToPath(new URL('../..', import.meta.url)),
    excludeSources: ['extensiones/vscode/**', 'releases/**', '**/dist/**'],
  },
});
import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';
import { sharedManifest, sharedViteBuild } from './wxt.config.base';

export default defineConfig({
  extensionApi: 'chrome',
  outDir: '../../releases/chrome',
  alias: {
    '@': fileURLToPath(new URL('.', import.meta.url)),
  },
  runner: {
    disabled: true,
  },
  manifest: sharedManifest,
  vite: () => sharedViteBuild,
  publicDir: 'logo',
});

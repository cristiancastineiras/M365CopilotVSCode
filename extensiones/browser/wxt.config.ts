import { defineConfig } from "wxt";
import { fileURLToPath } from "node:url";
import { manifestFor, sharedViteBuild } from "./wxt.config.base";

export default defineConfig({
  extensionApi: "chrome",
  outDir: "../../releases/chrome",
  alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    "@m365copilot/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
  },
  runner: {
    disabled: true,
  },
  // Sin `version`: WXT usa la de package.json, que Changesets sube en cada
  // release junto con las de los otros dos paquetes.
  manifest: manifestFor,
  // Build (Rolldown + Oxc) compartido por los tres navegadores.
  vite: () => sharedViteBuild,
  publicDir: "public",
});

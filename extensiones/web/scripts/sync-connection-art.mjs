// Regenera assets/connection-art.svg con la ilustración «M365 → VS Code» del popup de la extensión de
// navegador y del userscript (connectionArtSvg, en packages/core): el arte tiene una sola fuente.
//
//   pnpm --filter @m365copilot/core build && node extensiones/web/scripts/sync-connection-art.mjs
//
// El título accesible queda como marcador (@@TITLE@@): lo rellena la plantilla en cada idioma.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connectionArtSvg } from "../../../packages/core/dist/connectionArt.js";

const svg = connectionArtSvg({ idPrefix: "hero-art", title: "@@TITLE@@" });
const out = fileURLToPath(new URL("../assets/connection-art.svg", import.meta.url));
writeFileSync(out, svg + "\n");
console.log(`connection-art.svg written (${(svg.length / 1024).toFixed(1)} KB)`);

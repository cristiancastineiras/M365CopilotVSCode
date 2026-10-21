// Regenera favicon-32x32.png y apple-touch-icon.png desde static/pixel/m365.svg (el logo de M365 en píxeles).
//
//   node extensiones/web/scripts/make-favicons.mjs     (necesita `pnpm install`: usa @resvg/resvg-js)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../vscode/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");
const logo = readFileSync(new URL("../static/pixel/m365.svg", import.meta.url), "utf8");
const dataUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;
const out = (name) => fileURLToPath(new URL(`../static/${name}`, import.meta.url));

// Pestaña del navegador: el logo a tamaño completo, transparente.
const small = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><image width="32" height="32" href="${dataUri}"/></svg>`;
writeFileSync(out("favicon-32x32.png"), new Resvg(small).render().asPng());

// iOS no admite transparencia: fondo blanco y margen.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="#fff"/><image x="20" y="20" width="140" height="140" href="${dataUri}"/></svg>`;
writeFileSync(out("apple-touch-icon.png"), new Resvg(apple).render().asPng());
console.log("favicon-32x32.png y apple-touch-icon.png escritos");

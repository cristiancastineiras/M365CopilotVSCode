// Genera static/pixel/vscode.svg: el logo de VS Code del proyecto (extensiones/vscode/logo/vscode.svg) pasado a
// tiles de 2×2 en una cuadrícula de 24×24, con el mismo tratamiento que el logo de M365 en píxeles
// (static/pixel/m365.svg): relieve de tile (pattern), degradado por zona y silueta con las esquinas
// convexas redondeadas.
//
//   node extensiones/web/scripts/make-pixel-vscode.mjs          (necesita `pnpm install`: usa @resvg/resvg-js)
//
// Si algún día cambia el logo, basta con volver a ejecutarlo. `--ascii` solo imprime la cuadrícula.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { outlinePath, runPath, TILE_PATTERN } from "./pixel-lib.mjs";

const require = createRequire(new URL("../../vscode/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");

const N = 24; // celdas por lado
const SRC = readFileSync(new URL("../../vscode/logo/vscode.svg", import.meta.url), "utf8");
const paths = [...SRC.matchAll(/<path d="([^"]+)" style="fill:(#[0-9a-f]{6})"/gi)].map((m) => ({ d: m[1], fill: m[2] }));
if (paths.length !== 3) throw new Error(`esperaba 3 formas en vscode.svg y hay ${paths.length}`);
// Orden del logo: brazo superior (oscuro), brazo inferior (medio), barra (claro).
const LABELS = ["a", "b", "c"];

// El logo ocupa x 2–30, y 2.25–29.75: una celda mide 28/22 unidades y queda centrado en la cuadrícula.
const cell = 28 / 22;
const x0 = 2 - cell;
const y0 = 2.25 - (N * cell - 27.5) / 2;
const view = `${x0} ${y0} ${N * cell} ${N * cell}`;
const SS = 8; // submuestras por celda y eje

function coverage(d) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${N * SS}" height="${N * SS}"><path d="${d}" fill="#000"/></svg>`;
  const px = new Resvg(svg).render().pixels;
  const out = Array.from({ length: N }, () => Array(N).fill(0));
  for (let y = 0; y < N * SS; y++)
    for (let x = 0; x < N * SS; x++) out[Math.floor(y / SS)][Math.floor(x / SS)] += px[(y * N * SS + x) * 4 + 3] / 255 / (SS * SS);
  return out;
}

const cov = paths.map((p) => coverage(p.d));
const grid = Array.from({ length: N }, (_, y) =>
  Array.from({ length: N }, (_, x) => {
    const total = Math.min(1, cov[0][y][x] + cov[1][y][x] + cov[2][y][x]);
    if (total < 0.5) return ".";
    // La barra gana los empates, luego el brazo superior.
    const order = [2, 0, 1];
    let best = order[0];
    for (const i of order) if (cov[i][y][x] > cov[best][y][x] + 1e-6) best = i;
    return LABELS[best];
  }),
);
console.log(grid.map((r) => r.join("")).join("\n"));
if (process.argv.includes("--ascii")) process.exit(0);

const outline = outlinePath(grid);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none" role="img" aria-labelledby="title">
  <title id="title">VS Code (pixel art)</title>
  <defs>
    ${TILE_PATTERN}
    <linearGradient id="vs-upper" x1="6" y1="6" x2="30" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#1b86c9"/>
      <stop offset="1" stop-color="#0065a9"/>
    </linearGradient>
    <linearGradient id="vs-lower" x1="6" y1="42" x2="30" y2="18" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2d9be0"/>
      <stop offset="1" stop-color="#007acc"/>
    </linearGradient>
    <linearGradient id="vs-bar" x1="36" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5cc0ff"/>
      <stop offset="0.5" stop-color="#1f9cf0"/>
      <stop offset="1" stop-color="#0a84d8"/>
    </linearGradient>
    <clipPath id="rounded-outline" clipPathUnits="userSpaceOnUse">
      <path clip-rule="evenodd" d="${outline}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#rounded-outline)">
    <path d="${runPath(grid, "a")}" fill="url(#vs-upper)"/>
    <path d="${runPath(grid, "a")}" fill="url(#tile-relief)"/>
    <path d="${runPath(grid, "b")}" fill="url(#vs-lower)"/>
    <path d="${runPath(grid, "b")}" fill="url(#tile-relief)"/>
    <path d="${runPath(grid, "c")}" fill="url(#vs-bar)"/>
    <path d="${runPath(grid, "c")}" fill="url(#tile-relief)"/>
  </g>
</svg>
`;
const out = fileURLToPath(new URL("../static/pixel/vscode.svg", import.meta.url));
mkdirSync(fileURLToPath(new URL("../static/pixel/", import.meta.url)), { recursive: true });
writeFileSync(out, svg);
console.log(`\nwritten ${out} (${(svg.length / 1024).toFixed(1)} KB)`);

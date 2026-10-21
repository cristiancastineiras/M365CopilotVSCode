// Genera static/pixel/star.svg: la estrella de la sección «dale una estrella en GitHub», dibujada a mano en una
// cuadrícula de 16×16 tiles con el mismo tratamiento que los logos en píxeles (relieve, degradado, esquinas
// convexas redondeadas).
//
//   node extensiones/web/scripts/make-pixel-star.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { outlinePath, runPath, TILE_PATTERN } from "./pixel-lib.mjs";

// a = cuerpo, h = brillo
const ART = [
  "................",
  ".......aa.......",
  ".......aa.......",
  "......aaaa......",
  "......aaaa......",
  ".aahaaaaaaaaaaa.",
  ".ahaaaaaaaaaaaa.",
  "..aaaaaaaaaaaa..",
  "...aaaaaaaaaa...",
  "...aaaaaaaaaa...",
  "..aaaaaaaaaaaa..",
  "..aaaaa..aaaaa..",
  ".aaaaa....aaaaa.",
  ".aaaa......aaaa.",
  ".aa..........aa.",
  "................",
];
const grid = ART.map((row) => row.split(""));
if (grid.some((r) => r.length !== 16) || grid.length !== 16) throw new Error("la cuadrícula debe ser de 16×16");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" role="img" aria-labelledby="title">
  <title id="title">Estrella (pixel art)</title>
  <defs>
    ${TILE_PATTERN}
    <linearGradient id="star-body" x1="4" y1="4" x2="28" y2="30" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFE27A"/>
      <stop offset="0.55" stop-color="#FFC800"/>
      <stop offset="1" stop-color="#FF9F1C"/>
    </linearGradient>
    <clipPath id="rounded-outline" clipPathUnits="userSpaceOnUse">
      <path clip-rule="evenodd" d="${outlinePath(grid)}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#rounded-outline)">
    <path d="${runPath(grid, "a")}" fill="url(#star-body)"/>
    <path d="${runPath(grid, "h")}" fill="#FFF6CF"/>
    <path d="${runPath(grid, "a")}${runPath(grid, "h")}" fill="url(#tile-relief)"/>
  </g>
</svg>
`;
writeFileSync(fileURLToPath(new URL("../static/pixel/star.svg", import.meta.url)), svg);
console.log(`star.svg (${(svg.length / 1024).toFixed(1)} KB)`);

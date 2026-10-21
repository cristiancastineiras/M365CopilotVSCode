// Genera static/pixel/edge.svg: el borde «que se deshace en píxeles» entre secciones de la web.
// Es una máscara (solo importa su transparencia): el CSS la pinta con el color de la sección (.px-edge).
// Determinista (generador congruencial), así que el resultado es siempre el mismo.
//
//   node extensiones/web/scripts/make-pixel-edge.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const COLS = 192;
const ROWS = 6;
let seed = 20261021;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);

let d = "";
for (let y = 0; y < ROWS; y++) {
  // Arriba casi nada, abajo todo: la fila de abajo se funde con la sección de debajo.
  const base = y === ROWS - 1 ? 2 : Math.pow((y + 0.35) / ROWS, 1.7);
  let x = 0;
  while (x < COLS) {
    const wave = 0.16 * Math.sin(x / 7 + y) + 0.1 * Math.sin(x / 23);
    const p = Math.min(1, Math.max(0, base + wave * (y === ROWS - 1 ? 0 : 1)));
    if (rand() >= p) { x++; continue; }
    let w = 1;
    while (x + w < COLS && rand() < p) w++;
    d += `M${x} ${y}h${w}v1h-${w}z`;
    x += w;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS}" height="${ROWS}" viewBox="0 0 ${COLS} ${ROWS}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>\n`;
writeFileSync(fileURLToPath(new URL("../static/pixel/edge.svg", import.meta.url)), svg);
console.log(`edge.svg ${COLS}x${ROWS} cells (${(svg.length / 1024).toFixed(1)} KB)`);

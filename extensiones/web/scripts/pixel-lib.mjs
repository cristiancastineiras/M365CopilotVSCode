// Piezas comunes de los generadores de sprites en píxeles (make-pixel-*.mjs): cuadrículas de celdas de 2×2
// unidades en un lienzo de N×2, con el mismo relieve de tile y la silueta con las esquinas convexas redondeadas
// del logo de M365 en píxeles (static/pixel/m365.svg).

/** Patrón de relieve: cada tile de 2×2 queda un poco más oscuro por dentro y más aún en su esquina superior izquierda. */
export const TILE_PATTERN = `<pattern id="tile-relief" width="2" height="2" patternUnits="userSpaceOnUse">
      <g transform="scale(.125)">
        <rect width="12" height="12" x="2" y="2" fill="#000" opacity=".08"/>
        <rect width="6" height="6" x="2" y="2" fill="#000" opacity=".08"/>
      </g>
    </pattern>`;

/** Tiras horizontales de las celdas con esa etiqueta, en una sola ruta (celdas de 2×2). */
export function runPath(grid, label) {
  let d = "";
  for (let y = 0; y < grid.length; y++) {
    let x = 0;
    while (x < grid[y].length) {
      if (grid[y][x] !== label) { x++; continue; }
      let w = 0;
      while (x + w < grid[y].length && grid[y][x + w] === label) w++;
      d += `M${x * 2} ${y * 2}h${w * 2}v2h-${w * 2}z`;
      x += w;
    }
  }
  return d;
}

/**
 * Contorno del conjunto de celdas rellenas (cualquier etiqueta distinta de ".") con las esquinas convexas
 * redondeadas con radio `r` (en celdas). Para usarlo como clipPath con clip-rule="evenodd".
 */
export function outlinePath(grid, r = 0.4) {
  const rows = grid.length, cols = grid[0].length;
  const filled = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && grid[y][x] !== ".";
  // Aristas con el relleno a la derecha del recorrido.
  const next = new Map();
  const add = (a, b) => {
    const k = a.join(",");
    if (next.has(k)) throw new Error(`vértice pellizcado en ${k}: dos celdas se tocan solo por la esquina`);
    next.set(k, b);
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) add([x, y], [x + 1, y]);
      if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
      if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
      if (!filled(x - 1, y)) add([x, y + 1], [x, y]);
    }

  const f = (n) => +(n * 2).toFixed(2); // celdas → unidades del lienzo
  let outline = "";
  const seen = new Set();
  for (const startKey of next.keys()) {
    if (seen.has(startKey)) continue;
    let loop = [];
    let k = startKey;
    while (!seen.has(k)) {
      seen.add(k);
      loop.push(k.split(",").map(Number));
      k = next.get(k).join(",");
    }
    // Fuera los vértices alineados con sus vecinos.
    loop = loop.filter((v, i) => {
      const p = loop[(i + loop.length - 1) % loop.length];
      const n = loop[(i + 1) % loop.length];
      return (v[0] - p[0]) * (n[1] - v[1]) - (v[1] - p[1]) * (n[0] - v[0]) !== 0;
    });
    const unit = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      return [dx / len, dy / len];
    };
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const cmds = [`M${f(mid(loop[0], loop[1])[0])} ${f(mid(loop[0], loop[1])[1])}`];
    for (let i = 1; i <= loop.length; i++) {
      const v = loop[i % loop.length];
      const p = loop[(i - 1) % loop.length];
      const n = loop[(i + 1) % loop.length];
      const cross = (v[0] - p[0]) * (n[1] - v[1]) - (v[1] - p[1]) * (n[0] - v[0]);
      if (cross > 0) {
        // Giro a la derecha con el relleno a la derecha: esquina convexa → se redondea.
        const uin = unit(p, v), uout = unit(v, n);
        cmds.push(`L${f(v[0] - uin[0] * r)} ${f(v[1] - uin[1] * r)}Q${f(v[0])} ${f(v[1])} ${f(v[0] + uout[0] * r)} ${f(v[1] + uout[1] * r)}`);
      } else cmds.push(`L${f(v[0])} ${f(v[1])}`);
    }
    outline += cmds.join("") + "Z";
  }
  return outline;
}

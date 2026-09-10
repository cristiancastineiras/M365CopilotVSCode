import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

// The Marketplace icon must be a PNG (vsce rejects SVG). Rasterize the source
// SVG to a square PNG so `contributes` / the gallery show the logo.
const SIZE = 256;
const svgPath = fileURLToPath(new URL('../logo/ms365-vscode.svg', import.meta.url));
const pngPath = fileURLToPath(new URL('../logo/ms365-vscode.png', import.meta.url));

const svg = readFileSync(svgPath, 'utf8');
// resvg is a strict XML parser: strip any BOM and inject the SVG namespace the
// source omits, otherwise it fails with "document does not have a root node".
const normalized = svg
	.replace(/^\uFEFF/, '')
	.replace(/<svg(?![^>]*\bxmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"');
const png = new Resvg(normalized, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
writeFileSync(pngPath, png);
console.log(`icon rendered: ${pngPath} (${SIZE}x${SIZE}, ${png.length} bytes)`);

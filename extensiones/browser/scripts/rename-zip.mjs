#!/usr/bin/env node
/**
 * `wxt zip` nombra el archivo con la versión de package.json embebida
 * (p. ej. `m365-copilot-vscode-extension-1.0.0-chrome.zip`). Este script lo
 * busca por sufijo y lo renombra a un nombre público estable, para no tener
 * que tocar ningún script a mano en cada release — que es justo el bug que
 * tenía antes esta ruta con la versión hardcodeada en package.json.
 *
 * Uso: node rename-zip.mjs <directorio> <sufijo-sin-guion> <nombre-final>
 *   node rename-zip.mjs ../../releases/chrome chrome m365-copilot-vscode-extension-chrome.zip
 */
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, suffix, stableName] = process.argv;
if (!dir || !suffix || !stableName) {
  console.error('Uso: node rename-zip.mjs <directorio> <sufijo> <nombre-final>');
  process.exit(1);
}

// The stable name also ends in `-<suffix>.zip`: skip it, or a leftover zip of
// an earlier build could be "renamed" onto itself while the fresh one stays
// unrenamed (readdir order is not alphabetical on every file system).
const match = readdirSync(dir)
  .filter((f) => f.endsWith(`-${suffix}.zip`) && f !== stableName)
  .sort()
  .at(-1);
if (!match) {
  console.error(`No se encontró ningún .zip que acabe en "-${suffix}.zip" en ${dir}`);
  process.exit(1);
}

renameSync(join(dir, match), join(dir, stableName));
console.log(`${match} → ${stableName}`);

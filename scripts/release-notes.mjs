#!/usr/bin/env node
/**
 * Junta, para una versión dada, la sección de cada CHANGELOG.md del monorepo
 * (uno por paquete) en un único cuerpo de notas de versión en Markdown. Lo
 * usa el workflow de release (`.github/workflows/release.yml`) para rellenar
 * la release de GitHub que se crea al hacer push de un tag `vX.Y.Z`.
 *
 * Uso: node scripts/release-notes.mjs <versión>   (con o sin "v" delante)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const version = (process.argv[2] || '').replace(/^v/, '').trim();
if (!version) {
  console.error('Uso: node scripts/release-notes.mjs <versión>');
  process.exit(1);
}

const COMPONENTS = [
  { file: 'extensiones/vscode/CHANGELOG.md', title: '🧩 Extensión de VS Code' },
  { file: 'extensiones/browser/CHANGELOG.md', title: '🌐 Extensión de navegador' },
  { file: 'packages/core/CHANGELOG.md', title: '⚙️ Núcleo compartido (@ms365copilot/core)' },
];

/** Extrae el contenido bajo `## <version>` hasta el siguiente `## ` (o el final del archivo). */
function extractSection(path, version) {
  let text;
  try {
    text = readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end).join('\n').trim();
  return section || null;
}

const parts = COMPONENTS.map(({ file, title }) => {
  const section = extractSection(file, version);
  return section ? `### ${title}\n\n${section}` : null;
}).filter(Boolean);

console.log(
  parts.length > 0
    ? parts.join('\n\n')
    : `_No se encontraron notas de cambios para la versión ${version}._`,
);

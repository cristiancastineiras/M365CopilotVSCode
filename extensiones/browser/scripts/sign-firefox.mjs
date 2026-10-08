#!/usr/bin/env node
/**
 * Firma el build de Firefox en AMO como complemento «unlisted»
 * (autodistribuido: no aparece en addons.mozilla.org, pero Mozilla lo firma)
 * y deja el resultado en `releases/firefox/m365-copilot-vscode-extension-firefox.xpi`.
 *
 * Firefox Release/Beta sólo instalan de forma permanente complementos
 * firmados por Mozilla: el .zip sin firmar sólo sirve como complemento
 * temporal (about:debugging) o en Developer Edition/Nightly/ESR con
 * `xpinstall.signatures.required = false`.
 *
 * Requiere haber ejecutado antes `pnpm zip:firefox` (build + zip de fuentes,
 * que AMO pide porque el código va minificado) y las credenciales de la API
 * de AMO en el entorno — web-ext las lee solo:
 *   WEB_EXT_API_KEY     (JWT issuer)  https://addons.mozilla.org/developers/addon/api/key/
 *   WEB_EXT_API_SECRET  (JWT secret)
 *
 * AMO firma cada versión una sola vez: hay que subir `version` antes de
 * volver a firmar.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseDir = resolve(pkgDir, '../../releases/firefox');
const { name, version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const sourceDir = join(releaseDir, 'firefox-mv2');
const sourcesZip = join(releaseDir, `${name}-${version}-sources.zip`);
const signedName = 'm365-copilot-vscode-extension-firefox.xpi';

if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error('Faltan WEB_EXT_API_KEY / WEB_EXT_API_SECRET (credenciales de la API de AMO).');
  process.exit(1);
}
for (const required of [join(sourceDir, 'manifest.json'), sourcesZip]) {
  if (!existsSync(required)) {
    console.error(`No existe ${required}: ejecuta antes \`pnpm zip:firefox\`.`);
    process.exit(1);
  }
}

// web-ext nombra el .xpi con el nombre de la extensión: se firma en una
// carpeta temporal y se copia con un nombre estable, como hace rename-zip.mjs.
const artifactsDir = mkdtempSync(join(tmpdir(), 'm365-amo-'));
const webExtArgs = [
  'dlx', 'web-ext@8', 'sign',
  '--channel', 'unlisted',
  '--source-dir', sourceDir,
  '--artifacts-dir', artifactsDir,
  '--upload-source-code', sourcesZip,
  '--no-config-discovery',
];
// Lanzado con `pnpm sign:firefox`, npm_execpath es el propio pnpm (JS): se
// ejecuta con este mismo node y sin shell, así las rutas con espacios no se
// parten en Windows (pnpm.cmd sólo arranca con `shell: true`).
const pnpmJs = process.env.npm_execpath;
const result = pnpmJs?.endsWith('js')
  ? spawnSync(process.execPath, [pnpmJs, ...webExtArgs], { stdio: 'inherit' })
  : spawnSync('pnpm', webExtArgs, { stdio: 'inherit', shell: process.platform === 'win32' });

let exitCode = 0;
const xpi = result.status === 0 ? readdirSync(artifactsDir).find((f) => f.endsWith('.xpi')) : undefined;
if (result.status !== 0) {
  exitCode = result.status ?? 1;
} else if (!xpi) {
  console.error('web-ext terminó sin dejar ningún .xpi firmado.');
  exitCode = 1;
} else {
  // Copia, no rename: en CI el tmpdir puede estar en otro sistema de archivos (EXDEV).
  copyFileSync(join(artifactsDir, xpi), join(releaseDir, signedName));
  console.log(`${xpi} → releases/firefox/${signedName}`);
}
rmSync(artifactsDir, { recursive: true, force: true });
process.exit(exitCode);

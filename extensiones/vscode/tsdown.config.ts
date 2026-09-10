import { defineConfig } from 'tsdown';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

// VS Code extensions load a CommonJS entry and require `vscode` from the host
// at runtime, so `vscode` must stay external. `ws` IS bundled into the output
// (tsdown externalizes package.json dependencies by default, so we opt it back
// in via `noExternal`) — this lets us ship a single self-contained file with
// `vsce package --no-dependencies`. ws's optional native accelerators are left
// external so the bundle degrades to ws's pure-JS fallback when absent.
export default defineConfig({
	entry: ['src/extension.ts'],
	format: ['cjs'],
	platform: 'node',
	target: 'node18',
	outDir: 'dist',
	outExtensions: () => ({ js: '.cjs' }),
	deps: {
		// `@ms365copilot/core` es un paquete del workspace (no publicado), así que
		// debe quedar embebido en el bundle final en vez de quedar como `require`.
		alwaysBundle: ['ws', '@ms365copilot/core'],
		neverBundle: ['vscode', 'bufferutil', 'utf-8-validate'],
	},
	dts: false,
	clean: true,
	sourcemap: true,
	shims: true,
	onSuccess: async () => {
		// Si se define CLEANUP_DIST=1, eliminamos el directorio dist después del build
		if (process.env.CLEANUP_DIST === '1') {
			const distPath = join(process.cwd(), 'dist');
			rmSync(distPath, { recursive: true, force: true });
			console.log('✓ Directorio dist eliminado después del build');
		}
	},
});

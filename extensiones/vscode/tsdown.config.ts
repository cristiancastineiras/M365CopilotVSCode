import { defineConfig } from 'tsdown';

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
	// VS Code ^1.104 corre sobre Electron con Node 20+; apuntar ahí (en vez de
	// node18) evita down-leveling innecesario y produce un .cjs más pequeño.
	target: 'node20',
	outDir: 'dist',
	outExtensions: () => ({ js: '.cjs' }),
	deps: {
		// `@m365copilot/core` es un paquete del workspace (no publicado), así que
		// debe quedar embebido en el bundle final en vez de quedar como `require`.
		alwaysBundle: ['ws', '@m365copilot/core'],
		neverBundle: ['vscode', 'bufferutil', 'utf-8-validate'],
	},
	dts: false,
	clean: true,
	treeshake: true,
	// Único artefacto final que se empaqueta en el .vsix: minificarlo reduce el
	// tamaño instalado sin coste (el sourcemap de al lado sigue permitiendo
	// depurar).
	minify: true,
	sourcemap: true,
	shims: true,
});

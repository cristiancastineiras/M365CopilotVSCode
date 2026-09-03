import { defineConfig } from 'tsdown';

// @m365copilot/core es la única librería del monorepo (consumida "en común"
// por las extensiones de VS Code y de navegador), así que sigue el patrón de
// librería: ESM puro, un entrypoint por módulo para que cada consumidor sólo
// cargue lo que usa, y nada de React/deps de runtime que externalizar (no
// tiene ninguna) — sólo tipos y funciones puras isomorfas.
export default defineConfig({
	entry: {
		index: 'src/index.ts',
		constants: 'src/constants.ts',
		jwt: 'src/jwt.ts',
		profile: 'src/profile.ts',
		token: 'src/token.ts',
	},
	format: ['esm'],
	target: 'es2022',
	// El paquete ya declara "type": "module", así que `.js` es inequívocamente
	// ESM aquí — evita el `.mjs` por defecto de tsdown y deja los exports del
	// package.json (que apuntan a `./dist/*.js`) coherentes con lo generado.
	outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
	dts: true,
	treeshake: true,
	sourcemap: true,
	clean: true,
	// tsconfig.json activa `isolatedDeclarations`, así que tsdown genera los
	// .d.ts con el camino rápido de oxc-transform en vez de un Program de tsc.
});

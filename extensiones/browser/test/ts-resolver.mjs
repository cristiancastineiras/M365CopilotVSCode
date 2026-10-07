/**
 * Node ESM resolve hook for `--experimental-strip-types`.
 *
 * The extension sources (and `@m365copilot/core`'s build output) are consumed
 * through a bundler, so they import each other without a file extension
 * (`./toolCatalog`). Node's ESM resolver requires the extension, which made
 * `pnpm test` fail before it ran a single assertion. This hook retries an
 * unresolved relative specifier with the usual extensions, so the tests can
 * import the real sources unchanged.
 */
const CANDIDATES = ['.ts', '.js', '.mjs', '/index.ts', '/index.js'];

export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		const extensionless = specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier);
		if (!extensionless || error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
		for (const candidate of CANDIDATES) {
			try {
				return await nextResolve(`${specifier}${candidate}`, context);
			} catch {
				/* try the next extension */
			}
		}
		throw error;
	}
}

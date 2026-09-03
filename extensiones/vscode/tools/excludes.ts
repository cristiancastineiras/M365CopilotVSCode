/**
 * Exclusion globs for the workspace-scanning tools.
 *
 * `workspace.findFiles` replaces its default excludes when you hand it a
 * pattern, so passing only our own list quietly ignores whatever the user
 * configured in `files.exclude` / `search.exclude` — the agent then goes
 * rummaging through folders the user deliberately hid. Merging both keeps the
 * user's settings authoritative while still guaranteeing our own baseline.
 *
 * Kept free of the `vscode` import so it can be exercised directly.
 */

/** Always skipped, even when the user has no excludes configured. */
export const BASELINE_EXCLUDES: readonly string[] = [
	'**/node_modules/**',
	'**/.git/**',
	'**/dist/**',
	'**/build/**',
	'**/out/**',
	'**/.next/**',
	'**/.nuxt/**',
	'**/.output/**',
	'**/.venv/**',
	'**/__pycache__/**',
	'**/.turbo/**',
	'**/coverage/**',
];

/**
 * Merge VS Code exclude settings (`{ glob: boolean }`) with the baseline into
 * one brace pattern. Entries explicitly set to `false` are honoured as
 * "do not exclude this" and dropped from the result.
 */
export function buildExcludeGlob(...settings: readonly (Record<string, unknown> | undefined)[]): string {
	const globs = new Set<string>(BASELINE_EXCLUDES);
	const reEnabled = new Set<string>();

	for (const setting of settings) {
		if (!setting) continue;
		for (const [glob, enabled] of Object.entries(setting)) {
			if (enabled === false) {
				reEnabled.add(glob);
				continue;
			}
			if (enabled) globs.add(glob);
		}
	}

	for (const glob of reEnabled) globs.delete(glob);

	const merged = [...globs];
	if (merged.length === 0) return '';
	if (merged.length === 1) return merged[0];
	return `{${merged.join(',')}}`;
}

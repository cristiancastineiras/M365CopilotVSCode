/**
 * The names this extension had in 1.3.0–2.0.0, when it shipped as
 * `ms365-copilot-vscode`: `ms365copilot.*` settings and `ms365-copilot-*`
 * model ids. Everything is `m365` again (as it was in 1.0), and this is the
 * one module that still spells the old name — to carry the user's settings
 * over (migration.ts) and to spot the old extension still installed next to
 * this one, where both would fight over the token port and `@m365`.
 *
 * Kept free of the `vscode` import so the tests can check the mapping.
 */

/** `<publisher>.<name>` of the 1.3.0–2.0.0 builds. */
export const LEGACY_EXTENSION_ID = 'ms365-copilot-vscode.ms365-copilot-vscode';

const SETTING_PREFIX = 'm365copilot.';
const LEGACY_SETTING_PREFIX = 'ms365copilot.';
const MODEL_ID_PREFIX = 'm365-copilot-';
const LEGACY_MODEL_ID_PREFIX = 'ms365-copilot-';

/** `m365copilot.editor.model` → `ms365copilot.editor.model`; undefined for keys of other extensions. */
export function legacySettingKey(key: string): string | undefined {
	return key.startsWith(SETTING_PREFIX) ? LEGACY_SETTING_PREFIX + key.slice(SETTING_PREFIX.length) : undefined;
}

/**
 * An old setting's value as this version expects it: the model settings
 * stored ids like `ms365-copilot-gpt56`, which are `m365-copilot-gpt56` now.
 * Anything else is kept as is.
 */
export function migrateLegacyValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return value.startsWith(LEGACY_MODEL_ID_PREFIX)
			? MODEL_ID_PREFIX + value.slice(LEGACY_MODEL_ID_PREFIX.length)
			: value;
	}
	if (Array.isArray(value)) return value.map(migrateLegacyValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateLegacyValue(item)]));
	}
	return value;
}

/**
 * Copy an old value into a scope only where the user set the old key and has
 * not set the new one: a value they chose in this version always wins.
 */
export function shouldMigrate(legacyValue: unknown, currentValue: unknown): boolean {
	return legacyValue !== undefined && currentValue === undefined;
}

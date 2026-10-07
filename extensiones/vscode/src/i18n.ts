/**
 * Internationalisation (English / Spanish) for everything the extension says
 * at runtime: notifications, status bar, tool results, errors, logs — and the
 * prompts sent to the model, so an English user gets English instructions
 * (and therefore English answers) instead of the Spanish ones this extension
 * started with.
 *
 * Deliberately does NOT import `vscode` (same pattern as toolCatalog.ts): the
 * vscode-free modules (client, tool protocol, sub-agent loop, git/commit
 * helpers) use it too, and test/e2e.mts exercises them without a VS Code
 * host. The extension resolves the locale at activation — the
 * `m365copilot.language` setting, falling back to VS Code's display
 * language — and calls {@link setLocale}.
 *
 * Manifest strings (command titles, setting descriptions, walkthrough…) live
 * in package.nls.json / package.nls.es.json instead: VS Code resolves those
 * itself from its display language, before any extension code runs.
 *
 * Catalogs are plain typed objects rather than `vscode.l10n` bundles so that a
 * missing or misspelled key is a compile error, and the Spanish catalog is
 * checked against the English one key by key (see locales/es.ts).
 */
import { en } from './locales/en';
import { es } from './locales/es';

export type Locale = 'en' | 'es';
export type MessageKey = keyof typeof en;
/** Value of the `m365copilot.language` setting. */
export type LanguageSetting = 'auto' | Locale;

export const LOCALES: readonly Locale[] = ['en', 'es'];

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, es };

let current: Locale = 'en';

/**
 * `auto` (or anything unrecognised) follows VS Code's display language: any
 * Spanish variant (`es`, `es-ES`, `es-419`…) maps to Spanish, everything else
 * to English.
 */
export function resolveLocale(setting: unknown, displayLanguage: string | undefined): Locale {
	if (setting === 'en' || setting === 'es') return setting;
	return (displayLanguage ?? '').toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function setLocale(locale: Locale): void {
	current = locale;
}

export function getLocale(): Locale {
	return current;
}

/**
 * Translate `key` into the current locale, replacing `{0}`, `{1}`… with
 * `args`. A placeholder without a matching argument is left as-is, which
 * makes a forgotten argument visible instead of silently printing "undefined".
 */
export function t(key: MessageKey, ...args: readonly (string | number)[]): string {
	return format(CATALOGS[current][key] ?? en[key] ?? key, args);
}

/** Same as {@link t}, for an explicit locale (tests, and the catalog parity check). */
export function tIn(locale: Locale, key: MessageKey, ...args: readonly (string | number)[]): string {
	return format(CATALOGS[locale][key] ?? en[key] ?? key, args);
}

/** `message.locale` BizChat expects for the current language. */
export function bizChatLocale(): string {
	return current === 'es' ? 'es-ES' : 'en-US';
}

/** Every key of the reference (English) catalog — used by the parity test. */
export function messageKeys(): MessageKey[] {
	return Object.keys(en) as MessageKey[];
}

/** Placeholder indices used by a message (`{0}`, `{2}` → [0, 2]), sorted. */
export function placeholdersOf(locale: Locale, key: MessageKey): number[] {
	const found = new Set<number>();
	for (const match of CATALOGS[locale][key].matchAll(/\{(\d+)\}/g)) found.add(Number(match[1]));
	return [...found].sort((a, b) => a - b);
}

function format(template: string, args: readonly (string | number)[]): string {
	if (args.length === 0) return template;
	return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
		const value = args[Number(index)];
		return value === undefined ? placeholder : String(value);
	});
}

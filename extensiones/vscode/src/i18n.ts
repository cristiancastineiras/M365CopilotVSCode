/**
 * Internationalisation (English / Spanish) for everything the extension says
 * at runtime: notifications, status bar, tool results, errors, logs — and the
 * prompts sent to the model, so an English user gets English instructions
 * (and therefore English answers) instead of the Spanish ones this extension
 * started with.
 *
 * The engine, and the messages of the BizChat layer (client errors, tool
 * protocol, tool hints…), live in `@m365copilot/core/bizchat`; this module
 * registers the extension's own catalogs on top of it. There is one current
 * locale for the whole process, so the layer follows {@link setLocale} too.
 *
 * Deliberately does NOT import `vscode` (same pattern as the BizChat layer):
 * the vscode-free modules (sub-agent loop, git/commit helpers) use it too, and
 * test/e2e.mts exercises them without a VS Code host. The extension resolves
 * the locale at activation — the `m365copilot.language` setting, falling back
 * to VS Code's display language — and calls {@link setLocale}.
 *
 * Manifest strings (command titles, setting descriptions, walkthrough…) live
 * in package.nls.json / package.nls.es.json instead: VS Code resolves those
 * itself from its display language, before any extension code runs.
 *
 * Catalogs are plain typed objects rather than `vscode.l10n` bundles so that a
 * missing or misspelled key is a compile error, and the Spanish catalog is
 * checked against the English one key by key (see locales/es.ts).
 */
import {
  coreMessageKeys,
  getLocale as getCoreLocale,
  placeholdersOf as corePlaceholdersOf,
  registerCatalogs,
  setLocale as setCoreLocale,
  translate,
  translateIn,
  type CoreMessageKey,
} from "@m365copilot/core/bizchat";
import { en } from "./locales/en";
import { es } from "./locales/es";

export { bizChatLocale, formatMoment } from "@m365copilot/core/bizchat";

export type Locale = "en" | "es";
/** The extension's own keys plus the BizChat layer's. */
export type MessageKey = keyof typeof en | CoreMessageKey;
/** Value of the `m365copilot.language` setting. */
export type LanguageSetting = "auto" | Locale;

export const LOCALES: readonly Locale[] = ["en", "es"];

registerCatalogs({ en, es });

/**
 * `auto` (or anything unrecognised) follows VS Code's display language: any
 * Spanish variant (`es`, `es-ES`, `es-419`…) maps to Spanish, everything else
 * to English.
 */
export function resolveLocale(setting: unknown, displayLanguage: string | undefined): Locale {
  if (setting === "en" || setting === "es") return setting;
  return (displayLanguage ?? "").toLowerCase().startsWith("es") ? "es" : "en";
}

export function setLocale(locale: Locale): void {
  setCoreLocale(locale);
}

export function getLocale(): Locale {
  return getCoreLocale() === "es" ? "es" : "en";
}

/**
 * Translate `key` into the current locale, replacing `{0}`, `{1}`… with
 * `args`. A placeholder without a matching argument is left as-is, which
 * makes a forgotten argument visible instead of silently printing "undefined".
 */
export function t(key: MessageKey, ...args: readonly (string | number)[]): string {
  return translate(key, args);
}

/** Same as {@link t}, for an explicit locale (tests, and the catalog parity check). */
export function tIn(
  locale: Locale,
  key: MessageKey,
  ...args: readonly (string | number)[]
): string {
  return translateIn(locale, key, args);
}

/** Every key of the reference (English) catalogs — used by the parity test. */
export function messageKeys(): MessageKey[] {
  return [...coreMessageKeys(), ...(Object.keys(en) as (keyof typeof en)[])];
}

/** Placeholder indices used by a message (`{0}`, `{2}` → [0, 2]), sorted. */
export function placeholdersOf(locale: Locale, key: MessageKey): number[] {
  return corePlaceholdersOf(locale, key);
}

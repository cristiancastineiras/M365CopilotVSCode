/**
 * Internationalisation (English / Spanish / Chinese) for everything the
 * terminal TUI says at runtime: the chat, errors, logs — and the prompts sent
 * to the model, so an English user gets English instructions (and therefore
 * English answers) instead of the Spanish ones this project started with.
 *
 * The engine, and the messages of the BizChat layer (client errors, tool
 * protocol, tool hints…), live in `@m365copilot/core/bizchat`; this module
 * registers the TUI's own catalogs on top of it. There is one current locale
 * for the whole process, so the layer follows {@link setLocale} too.
 *
 * The Chinese catalog is deliberately PARTIAL: it covers the terminal TUI
 * itself, the client errors and the most visible account/language strings, and
 * everything else falls back to English key by key. That keeps the
 * model-facing prompts (tuned against BizChat, see locales/en.ts) untouched
 * until they are translated on purpose. `en` is always the reference `t()`
 * and {@link placeholdersOf} fall back to.
 *
 * Catalogs are plain typed objects so that a missing or misspelled key is a
 * compile error, and the Spanish catalog is checked against the English one
 * key by key (see locales/es.ts).
 */
import {
  coreMessageKeys,
  placeholdersOf as corePlaceholdersOf,
  registerCatalogs,
  translate,
  translateIn,
  type CoreMessageKey,
  type Locale,
} from "@m365copilot/core/bizchat";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { zh } from "./locales/zh";

export { bizChatLocale, formatMoment, getLocale, setLocale } from "@m365copilot/core/bizchat";
export type { Locale } from "@m365copilot/core/bizchat";

/** The TUI's own keys plus the BizChat layer's. */
export type MessageKey = keyof typeof en | CoreMessageKey;
/** Value of the language setting. */
export type LanguageSetting = "auto" | Locale;

export const LOCALES: readonly Locale[] = ["en", "es", "zh"];

registerCatalogs({ en, es, zh });

/**
 * `auto` (or anything unrecognised) follows the display language: any Spanish
 * variant (`es`, `es-ES`, `es-419`…) maps to Spanish, any Chinese one
 * (`zh`, `zh-CN`, `zh-Hans`, `zh-TW`…) to Chinese, everything else to English.
 */
export function resolveLocale(setting: unknown, displayLanguage: string | undefined): Locale {
  if (setting === "en" || setting === "es" || setting === "zh") return setting;
  const display = (displayLanguage ?? "").toLowerCase();
  if (display.startsWith("es")) return "es";
  if (display.startsWith("zh")) return "zh";
  return "en";
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

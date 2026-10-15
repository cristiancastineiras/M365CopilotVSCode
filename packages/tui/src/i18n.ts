/**
 * Internationalisation (English / Spanish / Chinese) for everything the
 * extension says at runtime: notifications, status bar, tool results, errors,
 * logs — and the prompts sent to the model, so an English user gets English
 * instructions (and therefore English answers) instead of the Spanish ones
 * this extension started with.
 *
 * Deliberately does NOT import `vscode` (same pattern as toolCatalog.ts): the
 * vscode-free modules (client, tool protocol, sub-agent loop, git/commit
 * helpers) use it too, and test/e2e.mts exercises them without a VS Code
 * host. The extension resolves the locale at activation — the
 * `m365copilot.language` setting, falling back to VS Code's display
 * language — and calls {@link setLocale}.
 *
 * The Chinese catalog is deliberately PARTIAL: it covers the terminal TUI
 * (tui/), the client errors and the most visible account/language strings,
 * and everything else falls back to English key by key. That keeps the
 * model-facing prompts (tuned against BizChat, see locales/en.ts) untouched
 * until they are translated on purpose. `en` is always the reference `t()`
 * and {@link placeholdersOf} fall back to.
 *
 * Manifest strings (command titles, setting descriptions, walkthrough…) live
 * in package.nls.json / package.nls.es.json instead: VS Code resolves those
 * itself from its display language, before any extension code runs.
 *
 * Catalogs are plain typed objects rather than `vscode.l10n` bundles so that a
 * missing or misspelled key is a compile error, and the Spanish catalog is
 * checked against the English one key by key (see locales/es.ts).
 */
import { en } from "./locales/en";
import { es } from "./locales/es";
import { zh } from "./locales/zh";

export type Locale = "en" | "es" | "zh";
export type MessageKey = keyof typeof en;
/** Value of the `m365copilot.language` setting. */
export type LanguageSetting = "auto" | Locale;

export const LOCALES: readonly Locale[] = ["en", "es", "zh"];

/** `en`/`es` are complete; `zh` may be partial and falls back to English. */
type Catalog = Readonly<Partial<Record<MessageKey, string>>>;

const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, es, zh };

let current: Locale = "en";

/**
 * `auto` (or anything unrecognised) follows VS Code's display language: any
 * Spanish variant (`es`, `es-ES`, `es-419`…) maps to Spanish, any Chinese one
 * (`zh`, `zh-CN`, `zh-Hans`, `zh-TW`…) to Chinese, everything else to English.
 */
export function resolveLocale(setting: unknown, displayLanguage: string | undefined): Locale {
  if (setting === "en" || setting === "es" || setting === "zh") return setting;
  const display = (displayLanguage ?? "").toLowerCase();
  if (display.startsWith("es")) return "es";
  if (display.startsWith("zh")) return "zh";
  return "en";
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
export function tIn(
  locale: Locale,
  key: MessageKey,
  ...args: readonly (string | number)[]
): string {
  return format(CATALOGS[locale][key] ?? en[key] ?? key, args);
}

/** `message.locale` BizChat expects for the current language. */
export function bizChatLocale(): string {
  if (current === "es") return "es-ES";
  if (current === "zh") return "zh-CN";
  return "en-US";
}

/**
 * A moment as the user reads it, in their time zone and language: just the
 * time when it falls today ("15:40"), with the day otherwise ("Monday 20 Oct,
 * 02:00") — for "paused until…" and "resets at…".
 */
export function formatMoment(epochMs: number, now = Date.now()): string {
  const when = new Date(epochMs);
  const sameDay = when.toDateString() === new Date(now).toDateString();
  return when.toLocaleString(bizChatLocale(), {
    ...(sameDay ? {} : { weekday: "long", day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Every key of the reference (English) catalog — used by the parity test. */
export function messageKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}

/** Placeholder indices used by a message (`{0}`, `{2}` → [0, 2]), sorted. */
export function placeholdersOf(locale: Locale, key: MessageKey): number[] {
  const found = new Set<number>();
  // A key the locale does not translate falls back to English, exactly like `t()`.
  for (const match of (CATALOGS[locale][key] ?? en[key]).matchAll(/\{(\d+)\}/g))
    found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

function format(template: string, args: readonly (string | number)[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

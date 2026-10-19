/**
 * The i18n engine shared by the BizChat layer and the apps built on it.
 *
 * The layer's own messages (client errors, tool protocol, tool hints…) live in
 * locales/{en,es,zh}.ts and always work, whatever app uses them. An app adds
 * its own catalogs on top with {@link registerCatalogs}: a key is looked up in
 * the app's catalog first, then in the layer's, in the current locale and then
 * in English — so an app can override a layer message, and a partial catalog
 * (the TUI's Chinese) falls back key by key.
 *
 * There is ONE current locale for the whole process: the app calls
 * {@link setLocale} and both its own code and this layer's follow it. The
 * prompts sent to the model use it too, so an English user gets English
 * instructions (and therefore English answers).
 *
 * Deliberately free of any host API (`vscode`, DOM): tests and other clients
 * use it as-is.
 */
import { en } from "./locales/en";
import { es } from "./locales/es";
import { zh } from "./locales/zh";

export type Locale = "en" | "es" | "zh";
/** Keys of the layer's own catalog. An app's `MessageKey` is this plus its own keys. */
export type CoreMessageKey = keyof typeof en;
/** A catalog an app registers: `en` is the reference, the rest may be partial. */
export type AppCatalogs = Readonly<
  { en: Readonly<Record<string, string>> } & Partial<
    Record<Locale, Readonly<Partial<Record<string, string>>>>
  >
>;

type Catalog = Readonly<Partial<Record<string, string>>>;

const CORE: Readonly<Record<Locale, Catalog>> = { en, es, zh };
let app: Readonly<Partial<Record<Locale, Catalog>>> = {};
let current: Locale = "en";

/** Adds an app's catalogs on top of the layer's. Replaces any registered before. */
export function registerCatalogs(catalogs: AppCatalogs): void {
  app = catalogs;
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
export function translate(key: string, args: readonly (string | number)[] = []): string {
  return format(lookup(current, key) ?? key, args);
}

/** The layer's own messages, typed: what the modules of this layer call. */
export function t(key: CoreMessageKey, ...args: readonly (string | number)[]): string {
  return translate(key, args);
}

/** Same as {@link translate}, for an explicit locale (tests, and the catalog parity check). */
export function translateIn(
  locale: Locale,
  key: string,
  args: readonly (string | number)[] = [],
): string {
  return format(lookup(locale, key) ?? key, args);
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

/** Every key of the layer's reference (English) catalog. */
export function coreMessageKeys(): CoreMessageKey[] {
  return Object.keys(en) as CoreMessageKey[];
}

/** Placeholder indices used by a message (`{0}`, `{2}` → [0, 2]), sorted. */
export function placeholdersOf(locale: Locale, key: string): number[] {
  const found = new Set<number>();
  for (const match of (lookup(locale, key) ?? "").matchAll(/\{(\d+)\}/g)) {
    found.add(Number(match[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function lookup(locale: Locale, key: string): string | undefined {
  return app[locale]?.[key] ?? CORE[locale][key] ?? app.en?.[key] ?? CORE.en[key];
}

function format(template: string, args: readonly (string | number)[]): string {
  if (args.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

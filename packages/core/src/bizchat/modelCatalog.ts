/**
 * Which M365 Copilot models (BizChat `tone`s) the extension offers, and where
 * each one comes from:
 *
 *  - account:  the account's own model menu — what the web app's model picker
 *              offers it, from `GET /m365Copilot/getgptlist` (fetchModelMenu in
 *              client.ts, read by {@link parseModelMenu});
 *  - builtin:  the ones shipped with this version, offered only until the
 *              account's menu has been loaded once;
 *  - custom:   tones the user typed in `m365copilot.models.custom`.
 *
 * Kept free of the `vscode` import so the merge rules can be tested directly.
 */
import { TONE_PATTERN } from "../capture";
import type { CoreMessageKey } from "./i18n";

export type ModelSource = "builtin" | "account" | "custom";

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  /**
   * `tone` to send, or null for Auto (BizChat's own routing). A tone the paid
   * scenario serves as another model carries {@link PAID_SUFFIX}
   * (`Claude_Sonnet@paid` is Claude Sonnet 5.5): see {@link parseToneSelector}.
   */
  readonly tone: string | null;
  readonly source: ModelSource;
  /** Built-ins describe themselves through the i18n catalog… */
  readonly detailKey?: CoreMessageKey;
  /** …the rest through the account menu's or the setting's text (or nothing). */
  readonly detail?: Readonly<{ en?: string; es?: string }>;
}

/** One model of the account's menu or of the `custom` setting. */
export interface ModelEntry {
  /** A tone, or `Tone@paid` (see {@link normalizeSelector}). */
  readonly tone: string;
  readonly name?: string;
  readonly detail?: Readonly<{ en?: string; es?: string }>;
}

const FAMILY = "m365-copilot";
const PREFIX = "M365 Copilot · ";
/** The picker stays usable; an endless list is a bug in some source. */
const MAX_MODELS = 30;
const MAX_NAME_CHARS = 60;
const MAX_DETAIL_CHARS = 200;

/**
 * The models known when this version shipped: the three modes that let M365
 * pick the model (Auto = `magic`, Quick response = `Chat`, Think deeper =
 * `Reasoning`) and the named models. Auto is always offered; the rest only
 * until the account's own menu arrives. When that menu lists one of these
 * tones, the model keeps its id here — settings and the chat's picker refer
 * to it — and its translated description.
 */
const BUILTIN_SPECS: readonly Omit<CatalogModel, "family" | "source">[] = [
  {
    id: "m365-copilot-auto",
    name: "M365 Copilot (Auto)",
    tone: null,
    detailKey: "model.auto.detail",
  },
  {
    id: "m365-copilot-quick",
    name: `${PREFIX}Quick response`,
    tone: "Chat",
    detailKey: "model.quick.detail",
  },
  {
    id: "m365-copilot-think-deeper",
    name: `${PREFIX}Think deeper`,
    tone: "Reasoning",
    detailKey: "model.thinkDeeper.detail",
  },
  {
    id: "m365-copilot-gpt56-reasoning",
    name: `${PREFIX}GPT 5.6 Think deeper`,
    tone: "Gpt_5_6_Reasoning",
    detailKey: "model.gpt56Reasoning.detail",
  },
  {
    id: "m365-copilot-gpt",
    name: `${PREFIX}GPT 5.5 Quick response`,
    tone: "Gpt_5_5_Chat",
    detailKey: "model.gpt.detail",
  },
  {
    id: "m365-copilot-reasoning",
    name: `${PREFIX}GPT 5.5 Think deeper`,
    tone: "Gpt_5_5_Reasoning",
    detailKey: "model.reasoning.detail",
  },
  {
    id: "m365-copilot-claude",
    name: `${PREFIX}Claude Sonnet`,
    tone: "Claude_Sonnet",
    detailKey: "model.claude.detail",
  },
  {
    id: "m365-copilot-claude-think-deeper",
    name: `${PREFIX}Claude Sonnet Think deeper`,
    tone: "Claude_Sonnet_Reasoning",
    detailKey: "model.claudeThinkDeeper.detail",
  },
];

export const BUILTIN_MODELS: readonly CatalogModel[] = BUILTIN_SPECS.map((model) => ({
  ...model,
  family: FAMILY,
  source: "builtin" as const,
}));

/**
 * The models a tone reaches only on the paid scenario (`scenario=
 * OfficeWebPaidCopilot`, `licenseType=Premium`): the one an account with a
 * Microsoft 365 Copilot licence uses, where one with only Copilot Chat uses
 * `OfficeWebIncludedCopilot`. On the included scenario these tones answer with
 * the canned apology (Claude Opus, GPT-6) or are another, older model (Claude
 * Sonnet 5 is Sonnet 4.6 there). Measured by github.com/cramt/m365-copilot-proxy
 * (docs/m365-copilot-api.md §5): Claude Opus 5.5, Claude Sonnet 5, GPT-6.
 */
export const PAID_ONLY_TONES: ReadonlySet<string> = new Set([
  "Claude_Opus",
  "Claude_Sonnet_5",
  "Gpt_6_Reasoning",
]);

/**
 * `Tone@paid`: the same tone on the paid scenario, where it is another model —
 * `Claude_Sonnet` is Claude Sonnet 4.6 on the included scenario and Claude
 * Sonnet 5.5 (metered: 80 turns a day) on the paid one. Never sent to BizChat
 * as is: {@link parseToneSelector} splits it into the tone and the scenario.
 */
export const PAID_SUFFIX = "@paid";

export interface ToneSelector {
  /** The tone BizChat receives. */
  readonly tone: string;
  /** Whether the turn goes on the paid scenario. */
  readonly paid: boolean;
}

/** What a model's `tone` asks for: the tone to send and the scenario. */
export function parseToneSelector(selector: string): ToneSelector {
  const suffixed = selector.endsWith(PAID_SUFFIX);
  const tone = suffixed ? selector.slice(0, -PAID_SUFFIX.length) : selector;
  return { tone, paid: suffixed || PAID_ONLY_TONES.has(tone) };
}

/** Whether a model needs the paid scenario (a Microsoft 365 Copilot licence). */
export function isPaidSelector(selector: string | null): boolean {
  return selector !== null && parseToneSelector(selector).paid;
}

/**
 * A tone or `Tone@paid` from the account's menu or the settings, or null if it
 * is not one. A paid-only tone drops the suffix — it is paid anyway — so that
 * `Claude_Opus` and `Claude_Opus@paid` are the same model.
 */
export function normalizeSelector(raw: string): string | null {
  const text = raw.trim();
  const suffixed = text.endsWith(PAID_SUFFIX);
  const tone = suffixed ? text.slice(0, -PAID_SUFFIX.length) : text;
  if (!TONE_PATTERN.test(tone)) return null;
  return suffixed && !PAID_ONLY_TONES.has(tone) ? `${tone}${PAID_SUFFIX}` : tone;
}

/** The web app's names for its modes, which also end the named tones. */
const MODE_LABELS: Readonly<Record<string, string>> = {
  chat: "Quick response",
  quick: "Quick response",
  reasoning: "Think deeper",
  magic: "Auto",
};

/**
 * A readable name for a tone, with the web app's labels for the mode:
 * `Gpt_5_6_Reasoning` → "GPT 5.6 Think deeper", `Gpt_5_5_Chat` → "GPT 5.5
 * Quick response", `Gpt_6_1_Sol` → "GPT 6.1 Sol", `Claude_Opus_4_1` →
 * "Claude Opus 4.1", `Reasoning` → "Think deeper".
 */
export function prettyTone(tone: string): string {
  if (tone.endsWith(PAID_SUFFIX)) return `${prettyTone(tone.slice(0, -PAID_SUFFIX.length))} (paid)`;
  const tokens = tone.split(/[_\-\s]+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  const mode = last !== undefined ? MODE_LABELS[last.toLowerCase()] : undefined;
  if (mode) tokens.pop();
  const words: string[] = [];
  for (const token of tokens) {
    const previous = words[words.length - 1];
    if (/^\d+$/.test(token) && previous !== undefined && /\d$/.test(previous)) {
      words[words.length - 1] = `${previous}.${token}`;
    } else if (/^gpt$/i.test(token)) {
      words.push("GPT");
    } else if (/^\d/.test(token)) {
      words.push(token);
    } else {
      words.push(token.charAt(0).toUpperCase() + token.slice(1));
    }
  }
  if (mode) words.push(mode);
  return words.join(" ") || tone;
}

/** Stable picker id for a tone that is not built in. */
export function modelIdForTone(tone: string): string {
  return `m365-copilot-tone-${tone
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

function cleanDetail(value: unknown): ModelEntry["detail"] {
  if (typeof value === "string") {
    const text = cleanText(value, MAX_DETAIL_CHARS);
    return text ? { en: text, es: text } : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const en = cleanText(record.en, MAX_DETAIL_CHARS);
  const es = cleanText(record.es, MAX_DETAIL_CHARS);
  return en || es ? { en: en ?? es, es: es ?? en } : undefined;
}

function entryOf(raw: unknown): ModelEntry | null {
  if (typeof raw === "string") {
    const tone = normalizeSelector(raw);
    return tone ? { tone } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const tone = typeof record.tone === "string" ? normalizeSelector(record.tone) : null;
  if (!tone) return null;
  return {
    tone,
    name: cleanText(record.name, MAX_NAME_CHARS),
    detail: cleanDetail(record.detail),
  };
}

/** The `m365copilot.models.custom` setting: tones, or `{ tone, name }` objects. */
export function parseCustomModels(setting: unknown): ModelEntry[] {
  if (!Array.isArray(setting)) return [];
  return setting.map(entryOf).filter(Boolean) as ModelEntry[];
}

/**
 * The model menu in a `getgptlist` answer: `gptList[].clientPreferences.
 * modelSelectorMetadata.availableModelSelectionOptions`, where a family
 * ("Claude", "GPT") nests its models in `itemGroup`. Its `Magic` is Auto, which
 * is always offered anyway. Null when the answer has no menu at all (keep the
 * last one then).
 */
export function parseModelMenu(json: unknown): ModelEntry[] | null {
  const gpts = json && typeof json === "object" ? (json as { gptList?: unknown }).gptList : null;
  if (!Array.isArray(gpts)) return null;
  for (const gpt of gpts) {
    const options = (gpt as MenuGpt | null)?.clientPreferences?.modelSelectorMetadata
      ?.availableModelSelectionOptions;
    if (Array.isArray(options)) return menuEntries(options, "").slice(0, MAX_MODELS);
  }
  return null;
}

interface MenuGpt {
  readonly clientPreferences?: {
    readonly modelSelectorMetadata?: { readonly availableModelSelectionOptions?: unknown };
  };
}

function menuEntries(options: readonly unknown[], family: string): ModelEntry[] {
  return options.flatMap((raw): ModelEntry[] => {
    if (!raw || typeof raw !== "object") return [];
    const option = raw as Record<string, unknown>;
    const title = cleanText(option.menuItemTitle, MAX_NAME_CHARS);
    if (Array.isArray(option.itemGroup)) return menuEntries(option.itemGroup, title ?? family);
    const tone = typeof option.id === "string" ? normalizeSelector(option.id) : null;
    if (!tone || /^magic$/i.test(tone)) return [];
    // "Claude" › "Sonnet 5" reads "Claude Sonnet 5"; "GPT" › "GPT-6" stays "GPT-6".
    const name =
      title && family && !title.toLowerCase().startsWith(family.toLowerCase())
        ? `${family} ${title}`
        : title;
    return [{ tone, name, detail: cleanDetail(option.menuItemDescription) }];
  });
}

/**
 * One list from the menus of the two scenarios (see client.ts): `paid` is the
 * Microsoft 365 Copilot licence's, null for an account that has only one. A
 * model there that the included menu lacks — or names differently, because the
 * same tone is another model on the licence — becomes `Tone@paid`, so its
 * turns go on the paid scenario. In the paid menu's order, which is the web
 * app's.
 */
export function combineMenus(
  included: readonly ModelEntry[],
  paid: readonly ModelEntry[] | null,
): ModelEntry[] {
  if (!paid) return [...included];
  const includedNames = new Map(included.map((entry) => [entry.tone, entry.name]));
  const combined = paid.map((entry) =>
    includedNames.has(entry.tone) && includedNames.get(entry.tone) === entry.name
      ? entry
      : { ...entry, tone: normalizeSelector(`${entry.tone}${PAID_SUFFIX}`) ?? entry.tone },
  );
  const tones = new Set(combined.map((entry) => entry.tone));
  return [...combined, ...included.filter((entry) => !tones.has(entry.tone))];
}

export interface ModelSources {
  /** The account's model menu, or null until it has been loaded once. */
  readonly account: readonly ModelEntry[] | null;
  readonly custom: readonly ModelEntry[];
}

const BUILTIN_BY_TONE = new Map(BUILTIN_MODELS.slice(1).map((model) => [model.tone!, model]));

/**
 * The picker's list: Auto first, then the account's menu (the built-ins until
 * it has been loaded), then the custom ones — one model per tone. Names:
 * custom over the menu over built-in. Descriptions: custom over built-in
 * (translated) over the menu's. A built-in tone keeps its built-in id.
 */
export function mergeModels(sources: ModelSources): CatalogModel[] {
  const custom = new Map(sources.custom.map((entry) => [entry.tone, entry]));
  const merged = new Map<string, CatalogModel>();
  const add = (tone: string, source: ModelSource, entry?: ModelEntry) => {
    if (merged.has(tone)) return;
    const builtin = BUILTIN_BY_TONE.get(tone);
    const name = custom.get(tone)?.name ?? entry?.name;
    const detail = custom.get(tone)?.detail;
    merged.set(tone, {
      id: builtin?.id ?? modelIdForTone(tone),
      name: name ? `${PREFIX}${name}` : (builtin?.name ?? `${PREFIX}${prettyTone(tone)}`),
      family: FAMILY,
      tone,
      source,
      ...(detail
        ? { detail }
        : builtin?.detailKey
          ? { detailKey: builtin.detailKey }
          : entry?.detail
            ? { detail: entry.detail }
            : {}),
    });
  };
  if (sources.account) for (const entry of sources.account) add(entry.tone, "account", entry);
  else for (const tone of BUILTIN_BY_TONE.keys()) add(tone, "builtin");
  for (const entry of sources.custom) add(entry.tone, "custom", entry);
  return [BUILTIN_MODELS[0]!, ...merged.values()].slice(0, MAX_MODELS);
}

/** Models in `after` whose tone `known` does not contain and did not ship — what to announce. */
export function unannounced(
  after: readonly CatalogModel[],
  known: ReadonlySet<string>,
): CatalogModel[] {
  return after.filter(
    (model) => model.tone !== null && !BUILTIN_BY_TONE.has(model.tone) && !known.has(model.tone),
  );
}

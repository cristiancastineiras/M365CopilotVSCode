/**
 * Which M365 Copilot models (BizChat `tone`s) the extension offers, and where
 * each one comes from. Microsoft adds and retires models often, and there is
 * no documented API that lists them, so the list is the merge of four sources:
 *
 *  - builtin:  the ones shipped with this version (always available offline);
 *  - catalog:  models.json in the project's GitHub repo, downloaded by the
 *              extension — the maintainer adds a model (or hides a retired one)
 *              there and every user gets it without a new release;
 *  - observed: tones the M365 Copilot web app itself used, captured by the
 *              browser extension / userscript and sent along with the token —
 *              proof that the model exists for THIS tenant;
 *  - custom:   tones the user typed in `m365copilot.models.custom`.
 *
 * Kept free of the `vscode` import so the merge rules can be tested directly.
 */
import { TONE_PATTERN } from "../capture";
import type { CoreMessageKey } from "./i18n";

export type ModelSource = "builtin" | "catalog" | "observed" | "custom";

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
  /** …the rest through per-language text from models.json (or nothing). */
  readonly detail?: Readonly<{ en?: string; es?: string }>;
}

/** One entry of models.json or of the `custom` setting. */
export interface ModelEntry {
  /** A tone, or `Tone@paid` (see {@link normalizeSelector}). */
  readonly tone: string;
  readonly name?: string;
  readonly detail?: Readonly<{ en?: string; es?: string }>;
  /** Catalog only: the model was retired — hide it even if built in. */
  readonly hidden?: boolean;
}

const FAMILY = "m365-copilot";
const PREFIX = "M365 Copilot · ";
/** The picker stays usable; an endless list is a bug in some source. */
const MAX_MODELS = 30;
const MAX_NAME_CHARS = 60;
const MAX_DETAIL_CHARS = 200;

/**
 * What the M365 Copilot web app's model menu offers, with its own labels: the
 * three modes that let M365 pick the model (Auto = `magic`, Quick response =
 * `Chat`, Think deeper = `Reasoning`) and the named models. The tones come from
 * the web app's own menu and from tones seen answering live. Newer models
 * arrive in phases per tenant, so they come from the online catalog
 * (models.json) instead — GPT 6.0 Sol, GPT-6.1 Sol and GPT 5.6 Quick response
 * (`Gpt_5_6_Chat`, which serves again since 2026-09-24) are there — or show up
 * by themselves once the web app uses them (observed).
 * The ids of models kept from earlier versions do not change: settings and
 * the chat's picker refer to them.
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
 * Sonnet 5.5 (metered: 80 turns a day) on the paid one. Not a valid BizChat tone
 * on purpose: versions without paid models skip such an entry of models.json.
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
 * A tone or `Tone@paid` from models.json or the settings, or null if it is not
 * one. A paid-only tone drops the suffix — it is paid anyway — so that a tone
 * the web app was seen using (`Claude_Opus`) and the catalog's entry for it are
 * the same model.
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
    hidden: record.hidden === true,
  };
}

/**
 * models.json, validated: `{ "models": [{ "tone", "name"?, "detail"?, "hidden"? }] }`.
 * Null when it is not that shape at all (keep using the cached copy then).
 */
export function parseModelCatalog(json: unknown): ModelEntry[] | null {
  if (!json || typeof json !== "object" || !Array.isArray((json as { models?: unknown }).models))
    return null;
  return (
    (json as { models: unknown[] }).models.map(entryOf).filter(Boolean) as ModelEntry[]
  ).slice(0, MAX_MODELS);
}

/** The `m365copilot.models.custom` setting: tones, or `{ tone, name }` objects. */
export function parseCustomModels(setting: unknown): ModelEntry[] {
  if (!Array.isArray(setting)) return [];
  return (setting.map(entryOf).filter(Boolean) as ModelEntry[]).map((entry) => ({
    ...entry,
    hidden: false,
  }));
}

export interface ModelSources {
  readonly catalog: readonly ModelEntry[];
  readonly observed: readonly string[];
  readonly custom: readonly ModelEntry[];
}

/**
 * The picker's list. One model per tone (Auto first), in the order built-in →
 * catalog → observed → custom. Names and descriptions: custom over catalog
 * over built-in; an observed tone only contributes its existence. A catalog
 * entry with `hidden` removes that tone — unless the user listed it in custom.
 */
export function mergeModels(sources: ModelSources): CatalogModel[] {
  const hidden = new Set(
    sources.catalog.filter((entry) => entry.hidden).map((entry) => entry.tone),
  );
  const custom = new Map(sources.custom.map((entry) => [entry.tone, entry]));
  const catalog = new Map(
    sources.catalog.filter((entry) => !entry.hidden).map((entry) => [entry.tone, entry]),
  );
  const merged = new Map<string, CatalogModel>();

  const add = (tone: string, source: ModelSource, entry?: ModelEntry) => {
    if (merged.has(tone) || (hidden.has(tone) && !custom.has(tone))) return;
    const override = custom.get(tone) ?? catalog.get(tone) ?? entry;
    merged.set(tone, {
      id: modelIdForTone(tone),
      name: `${PREFIX}${override?.name ?? prettyTone(tone)}`,
      family: FAMILY,
      tone,
      source,
      detail: override?.detail,
    });
  };

  const result: CatalogModel[] = BUILTIN_MODELS.slice(0, 1);
  for (const model of BUILTIN_MODELS.slice(1)) {
    const tone = model.tone!;
    if (hidden.has(tone) && !custom.has(tone)) continue;
    const override = custom.get(tone) ?? catalog.get(tone);
    merged.set(tone, {
      ...model,
      name: override?.name ? `${PREFIX}${override.name}` : model.name,
      // A new description from the catalog replaces the shipped one.
      ...(override?.detail ? { detail: override.detail, detailKey: undefined } : {}),
    });
  }
  for (const entry of sources.catalog) if (!entry.hidden) add(entry.tone, "catalog", entry);
  for (const tone of sources.observed) if (TONE_PATTERN.test(tone)) add(tone, "observed");
  for (const entry of sources.custom) add(entry.tone, "custom", entry);

  result.push(...merged.values());
  return result.slice(0, MAX_MODELS);
}

/** Models in `after` whose tone `known` does not contain — what to announce. */
export function unannounced(
  after: readonly CatalogModel[],
  known: ReadonlySet<string>,
): CatalogModel[] {
  return after.filter(
    (model) => model.tone !== null && model.source !== "builtin" && !known.has(model.tone),
  );
}

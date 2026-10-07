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
 *  - custom:   tones the user typed in `ms365copilot.models.custom`.
 *
 * Kept free of the `vscode` import so the merge rules can be tested directly.
 */
import { TONE_PATTERN } from '@ms365copilot/core';
import type { MessageKey } from './i18n';

export type ModelSource = 'builtin' | 'catalog' | 'observed' | 'custom';

export interface CatalogModel {
	readonly id: string;
	readonly name: string;
	readonly family: string;
	/** `tone` to send, or null for Auto (BizChat's own routing). */
	readonly tone: string | null;
	readonly source: ModelSource;
	/** Built-ins describe themselves through the i18n catalog… */
	readonly detailKey?: MessageKey;
	/** …the rest through per-language text from models.json (or nothing). */
	readonly detail?: Readonly<{ en?: string; es?: string }>;
}

/** One entry of models.json or of the `custom` setting. */
export interface ModelEntry {
	readonly tone: string;
	readonly name?: string;
	readonly detail?: Readonly<{ en?: string; es?: string }>;
	/** Catalog only: the model was retired — hide it even if built in. */
	readonly hidden?: boolean;
}

const FAMILY = 'm365-copilot';
const PREFIX = 'M365 Copilot · ';
/** The picker stays usable; an endless list is a bug in some source. */
const MAX_MODELS = 30;
const MAX_NAME_CHARS = 60;
const MAX_DETAIL_CHARS = 200;

const BUILTIN_SPECS: readonly Omit<CatalogModel, 'family' | 'source'>[] = [
	{ id: 'ms365-copilot-auto', name: 'M365 Copilot (Auto)', tone: null, detailKey: 'model.auto.detail' },
	{ id: 'ms365-copilot-gpt', name: `${PREFIX}GPT`, tone: 'Gpt_5_5_Chat', detailKey: 'model.gpt.detail' },
	{ id: 'ms365-copilot-gpt56', name: `${PREFIX}GPT 5.6`, tone: 'Gpt_5_6_Chat', detailKey: 'model.gpt56.detail' },
	{
		id: 'ms365-copilot-gpt56-reasoning',
		name: `${PREFIX}GPT 5.6 Reasoning`,
		tone: 'Gpt_5_6_Reasoning',
		detailKey: 'model.gpt56Reasoning.detail',
	},
	{ id: 'ms365-copilot-claude', name: `${PREFIX}Claude Sonnet`, tone: 'Claude_Sonnet', detailKey: 'model.claude.detail' },
	{ id: 'ms365-copilot-reasoning', name: `${PREFIX}Reasoning`, tone: 'Gpt_5_5_Reasoning', detailKey: 'model.reasoning.detail' },
];

export const BUILTIN_MODELS: readonly CatalogModel[] = BUILTIN_SPECS.map((model) => ({
	...model,
	family: FAMILY,
	source: 'builtin' as const,
}));

/**
 * A readable name for a tone: `Gpt_5_6_Reasoning` → "GPT 5.6 Reasoning",
 * `Claude_Opus_4_1` → "Claude Opus 4.1", `Gpt_5_7_Chat` → "GPT 5.7" (the
 * "Chat" suffix is the default flavour, not worth showing).
 */
export function prettyTone(tone: string): string {
	const tokens = tone.split(/[_\-\s]+/).filter(Boolean);
	if (tokens.length > 1 && tokens[tokens.length - 1].toLowerCase() === 'chat') tokens.pop();
	const words: string[] = [];
	for (const token of tokens) {
		const previous = words[words.length - 1];
		if (/^\d+$/.test(token) && previous !== undefined && /\d$/.test(previous)) {
			words[words.length - 1] = `${previous}.${token}`;
		} else if (/^gpt$/i.test(token)) {
			words.push('GPT');
		} else if (/^\d/.test(token)) {
			words.push(token);
		} else {
			words.push(token.charAt(0).toUpperCase() + token.slice(1));
		}
	}
	return words.join(' ') || tone;
}

/** Stable picker id for a tone that is not built in. */
export function modelIdForTone(tone: string): string {
	return `ms365-copilot-tone-${tone.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function cleanText(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const text = value.replace(/\s+/g, ' ').trim();
	return text ? text.slice(0, max) : undefined;
}

function cleanDetail(value: unknown): ModelEntry['detail'] {
	if (typeof value === 'string') {
		const text = cleanText(value, MAX_DETAIL_CHARS);
		return text ? { en: text, es: text } : undefined;
	}
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const en = cleanText(record.en, MAX_DETAIL_CHARS);
	const es = cleanText(record.es, MAX_DETAIL_CHARS);
	return en || es ? { en: en ?? es, es: es ?? en } : undefined;
}

function entryOf(raw: unknown): ModelEntry | null {
	if (typeof raw === 'string') return TONE_PATTERN.test(raw.trim()) ? { tone: raw.trim() } : null;
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	const tone = typeof record.tone === 'string' ? record.tone.trim() : '';
	if (!TONE_PATTERN.test(tone)) return null;
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
	if (!json || typeof json !== 'object' || !Array.isArray((json as { models?: unknown }).models)) return null;
	return ((json as { models: unknown[] }).models.map(entryOf).filter(Boolean) as ModelEntry[]).slice(0, MAX_MODELS);
}

/** The `ms365copilot.models.custom` setting: tones, or `{ tone, name }` objects. */
export function parseCustomModels(setting: unknown): ModelEntry[] {
	if (!Array.isArray(setting)) return [];
	return (setting.map(entryOf).filter(Boolean) as ModelEntry[]).map((entry) => ({ ...entry, hidden: false }));
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
	const hidden = new Set(sources.catalog.filter((entry) => entry.hidden).map((entry) => entry.tone));
	const custom = new Map(sources.custom.map((entry) => [entry.tone, entry]));
	const catalog = new Map(sources.catalog.filter((entry) => !entry.hidden).map((entry) => [entry.tone, entry]));
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

	const auto = BUILTIN_MODELS[0];
	const result: CatalogModel[] = [auto];
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
	for (const entry of sources.catalog) if (!entry.hidden) add(entry.tone, 'catalog', entry);
	for (const tone of sources.observed) if (TONE_PATTERN.test(tone)) add(tone, 'observed');
	for (const entry of sources.custom) add(entry.tone, 'custom', entry);

	result.push(...merged.values());
	return result.slice(0, MAX_MODELS);
}

/** Models in `after` whose tone `known` does not contain — what to announce. */
export function unannounced(after: readonly CatalogModel[], known: ReadonlySet<string>): CatalogModel[] {
	return after.filter((model) => model.tone !== null && model.source !== 'builtin' && !known.has(model.tone));
}

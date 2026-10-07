import * as vscode from 'vscode';
import { getLocale, t } from './i18n';
import {
	BUILTIN_MODELS,
	mergeModels,
	parseCustomModels,
	parseModelCatalog,
	unannounced,
	type CatalogModel,
	type ModelEntry,
} from './modelCatalog';
import type { ProfileStore } from './secrets';

/**
 * M365 Copilot / BizChat selects a model through the `tone` field of the chat
 * invocation, not a model id. The "Auto" model sends no override and lets
 * BizChat route; the others force a tone. Which tones exist changes often, so
 * the list is not fixed: see modelCatalog.ts for the sources and
 * {@link ModelRegistry} for how they are kept up to date.
 */
export type CopilotModel = CatalogModel;

/** models.json in the project's repository — edit it there to add or retire a model for everyone. */
export const MODEL_CATALOG_URL =
	'https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/models.json';
const CATALOG_REFRESH_MS = 12 * 60 * 60_000;
const CATALOG_TIMEOUT_MS = 8_000;
/** Give activation room before going to the network. */
const FIRST_FETCH_DELAY_MS = 5_000;

const CATALOG_CACHE_KEY = 'm365copilot.models.catalog';
const OBSERVED_KEY = 'm365copilot.models.observed';
const ANNOUNCED_KEY = 'm365copilot.models.announced';
const MAX_OBSERVED = 20;

const MAX_INPUT_TOKENS = 128_000;
const MAX_OUTPUT_TOKENS = 16_000;

let registry: ModelRegistry | undefined;

/** Every model offered right now (built-ins only until the registry starts). */
export function allModels(): readonly CopilotModel[] {
	return registry?.models ?? BUILTIN_MODELS;
}

export function findModel(id: string): CopilotModel | undefined {
	return allModels().find((model) => model.id === id);
}

/**
 * Tone for answers written straight into the editor — inline edits, the
 * lightbulb fix, the Source Control commit message (`m365copilot.editor.model`).
 */
export function editorTone(): string | null {
	const id = vscode.workspace.getConfiguration('m365copilot.editor').get<string>('model', 'm365-copilot-auto');
	return findModel(id)?.tone ?? null;
}

interface CatalogCache {
	readonly entries: ModelEntry[];
	readonly fetchedAt: number;
}

/**
 * Keeps the model list up to date: downloads the catalog (on start and every
 * 12 h, cached for offline use), learns the tones the web app used from every
 * profile the browser side sends, reads the custom ones from settings, and
 * fires {@link onDidChange} when the merged list changes — the provider
 * re-announces it and the chat's model picker updates. New models are
 * announced once each.
 */
export class ModelRegistry implements vscode.Disposable {
	private current: CopilotModel[] = [...BUILTIN_MODELS];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly disposables: vscode.Disposable[] = [];
	private timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly memento: vscode.Memento,
		private readonly store: ProfileStore,
		private readonly log: (message: string) => void,
	) {
		this.disposables.push(
			store.onDidChange(() => void this.absorbProfile()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('m365copilot.models')) return;
				this.recompute();
				if (event.affectsConfiguration('m365copilot.models.updateFromCatalog') && catalogEnabled()) {
					void this.refreshCatalog();
				}
			}),
		);
		this.recompute(false);
		void this.absorbProfile();
		this.timer = setTimeout(() => {
			void this.refreshCatalog();
			this.timer = setInterval(() => void this.refreshCatalog(), CATALOG_REFRESH_MS);
		}, FIRST_FETCH_DELAY_MS);
	}

	get models(): readonly CopilotModel[] {
		return this.current;
	}

	/**
	 * Download models.json now. Returns false when it could not be fetched or
	 * parsed — the cached copy (or the built-ins) stay in use.
	 */
	async refreshCatalog(): Promise<boolean> {
		if (!catalogEnabled()) return false;
		try {
			const response = await fetch(MODEL_CATALOG_URL, {
				signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
				headers: { Accept: 'application/json' },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const entries = parseModelCatalog(await response.json());
			if (!entries) throw new Error('models.json has no "models" array');
			await this.memento.update(CATALOG_CACHE_KEY, { entries, fetchedAt: Date.now() } satisfies CatalogCache);
			this.log(t('log.modelsCatalog', entries.length));
			this.recompute();
			return true;
		} catch (error) {
			this.log(t('log.modelsCatalogFailed', error instanceof Error ? error.message : String(error)));
			return false;
		}
	}

	/** When the catalog was last downloaded, if ever. */
	get catalogFetchedAt(): number | undefined {
		return this.memento.get<CatalogCache>(CATALOG_CACHE_KEY)?.fetchedAt;
	}

	/** Remember the tones the web app used (they come inside the profile). */
	private async absorbProfile(): Promise<void> {
		const profile = await this.store.get();
		const incoming = profile?.observedTones ?? [];
		if (incoming.length === 0) return;
		const known = this.memento.get<string[]>(OBSERVED_KEY, []);
		const next = [...known.filter((tone) => !incoming.includes(tone)), ...incoming].slice(-MAX_OBSERVED);
		if (next.length === known.length && next.every((tone, index) => tone === known[index])) return;
		await this.memento.update(OBSERVED_KEY, next);
		this.recompute();
	}

	private recompute(announce = true): void {
		const config = vscode.workspace.getConfiguration('m365copilot.models');
		const next = mergeModels({
			catalog: catalogEnabled() ? (this.memento.get<CatalogCache>(CATALOG_CACHE_KEY)?.entries ?? []) : [],
			observed: config.get<boolean>('detectFromBrowser', true) ? this.memento.get<string[]>(OBSERVED_KEY, []) : [],
			custom: parseCustomModels(config.get<unknown>('custom', [])),
		});
		const before = this.current.map((model) => `${model.id}|${model.name}|${model.tone}`).join(',');
		const after = next.map((model) => `${model.id}|${model.name}|${model.tone}`).join(',');
		this.current = next;
		if (before !== after) this.changed.fire();
		if (announce) void this.announce(next);
	}

	/** One notification per model that appears for the first time (not on every start). */
	private async announce(models: readonly CopilotModel[]): Promise<void> {
		const known = new Set(this.memento.get<string[]>(ANNOUNCED_KEY, []));
		const fresh = unannounced(models, known);
		if (fresh.length === 0) return;
		for (const model of fresh) known.add(model.tone!);
		await this.memento.update(ANNOUNCED_KEY, [...known]);
		const names = fresh.map((model) => model.name.replace(/^M365 Copilot · /, '')).join(', ');
		const open = t('paste.openChat');
		const picked = await vscode.window.showInformationMessage(t('models.new', names), open);
		if (picked === open) await vscode.commands.executeCommand('workbench.action.chat.open');
	}

	dispose(): void {
		// clearTimeout also clears an interval in Node.
		if (this.timer) clearTimeout(this.timer);
		this.changed.dispose();
		for (const disposable of this.disposables) disposable.dispose();
		if (registry === this) registry = undefined;
	}
}

/** Create the registry and make it the source of {@link allModels} / {@link findModel}. */
export function installModelRegistry(
	memento: vscode.Memento,
	store: ProfileStore,
	log: (message: string) => void,
): ModelRegistry {
	registry = new ModelRegistry(memento, store, log);
	return registry;
}

function catalogEnabled(): boolean {
	return vscode.workspace.getConfiguration('m365copilot.models').get<boolean>('updateFromCatalog', true);
}

/** The picker's one-line description of a model. */
export function modelDetail(model: CopilotModel): string {
	if (model.detailKey) return t(model.detailKey);
	const text = model.detail?.[getLocale()] ?? model.detail?.en;
	if (text) return text;
	return t(
		model.source === 'observed'
			? 'models.source.observed'
			: model.source === 'custom'
				? 'models.source.custom'
				: 'models.source.catalog',
		model.tone ?? '',
	);
}

/**
 * Extra fields Copilot Chat reads from a model's information that are not (yet)
 * on the stable `LanguageModelChatInformation` type. They live in the same
 * proposed-API bucket, so we attach them via a cast — exactly what the
 * minimax / deepseek BYOK providers do.
 *
 * - `isUserSelectable` — WITHOUT this the model is registered (and shows in
 *   "Manage Models") but Copilot Chat never offers it in the in-chat model
 *   picker. This is the field that makes the picker list our models.
 * - `isBYOK` — tokens are billed to the user's M365 plan, not Copilot's
 *   premium-request quota, so Copilot must not count the round-trip against
 *   its own budget.
 */
type PickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly isBYOK?: true;
	readonly statusIcon?: vscode.ThemeIcon;
};

/** Whether the stored token can be used right now — drives the picker's warning state. */
export type TokenState = 'ok' | 'missing' | 'expired';

/** Build the model information VS Code renders in the picker. */
export function toChatInformation(model: CopilotModel, tokenState: TokenState): vscode.LanguageModelChatInformation {
	const detail = modelDetail(model);
	const info: PickerChatInformation = {
		id: model.id,
		name: model.name,
		family: model.family,
		version: '1.0.0',
		maxInputTokens: MAX_INPUT_TOKENS,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		detail:
			tokenState === 'ok' ? detail : t(tokenState === 'missing' ? 'model.needsToken' : 'model.tokenExpired'),
		tooltip: model.tone ? `${detail} (tone: ${model.tone})` : detail,
		// This is what surfaces the model in the in-chat picker (not just in
		// "Manage Models").
		isUserSelectable: true,
		isBYOK: true,
		statusIcon: tokenState === 'ok' ? undefined : new vscode.ThemeIcon('warning'),
		capabilities: {
			// We advertise tool calling so the models also appear in the default
			// Agent/Edit chat mode (which filters out models without it). BizChat
			// has no native tool execution: the calls are a text protocol we
			// describe in the prompt and decode from the reply (see
			// toolProtocol.ts), covering both our tools and the editor's own —
			// so the agent loop does work, one tool call per turn.
			toolCalling: true,
			imageInput: false,
		},
	};
	return info;
}

import * as vscode from 'vscode';
import { streamCopilotTurn, CopilotClientError } from './client';
import { cleanCompletion, reuseForExtendedPrefix } from './completionText';
import { log } from './logger';
import { findModel } from './models';
import { isTokenUsable } from './profile';
import type { ProfileStore } from './secrets';

const CONFIG_SECTION = 'm365copilot.inlineCompletions';

/** Context bounds. Ghost text needs to be fast far more than it needs to be
 * well-informed, and every extra character is latency on a backend that opens
 * a fresh WebSocket per request. */
const MAX_PREFIX_CHARS = 2500;
const MAX_SUFFIX_CHARS = 800;
/** Enough of the document after the cursor to spot duplicated tails. */
const OVERLAP_LOOKAHEAD = 200;

const CACHE_MAX_ENTRIES = 40;
/** How much of the prefix identifies a cache entry. */
const CACHE_KEY_CHARS = 400;

interface CacheEntry {
	readonly prefix: string;
	readonly completion: string;
}

interface Settings {
	readonly enabled: boolean;
	readonly manualOnly: boolean;
	readonly debounceMs: number;
	readonly maxLines: number;
	readonly timeoutMs: number;
	readonly modelId: string;
}

function readSettings(): Settings {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return {
		enabled: config.get<boolean>('enabled', true),
		manualOnly: config.get<string>('triggerMode', 'automatic') === 'manual',
		debounceMs: clamp(config.get<number>('debounceMs', 500), 0, 5000),
		maxLines: clamp(config.get<number>('maxLines', 6), 1, 30),
		timeoutMs: clamp(config.get<number>('timeoutMs', 6000), 1000, 30_000),
		modelId: config.get<string>('model', 'm365-copilot-auto'),
	};
}

function clamp(value: number, min: number, max: number): number {
	if (typeof value !== 'number' || Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Ghost-text completions backed by BizChat.
 *
 * BizChat is a chat assistant on a connection that costs a full WebSocket
 * handshake per request, so this will never be as instant as a purpose-built
 * fill-in-the-middle model. Three things carry the experience:
 *
 *  - a debounce, so a burst of typing produces one request, not twenty;
 *  - a cache that keeps serving the same suggestion while you type along with
 *    it, which is what stops the ghost text flickering on every keystroke;
 *  - aborting the stream as soon as enough lines have arrived, instead of
 *    waiting out the model's closing pleasantries.
 */
export class M365InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private readonly cache = new Map<string, CacheEntry>();
	private inFlight: AbortController | undefined;

	constructor(
		private readonly store: ProfileStore,
		private readonly status: CompletionStatus,
	) {}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | undefined> {
		const settings = readSettings();
		if (!settings.enabled) return undefined;
		const invokedByHand = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
		if (settings.manualOnly && !invokedByHand) return undefined;

		const prefix = textBefore(document, position);
		const suffix = textAfter(document, position);
		if (!prefix.trim()) return undefined;

		// A cache hit costs nothing and is the difference between ghost text
		// that sticks and ghost text that blinks in and out while you type.
		const cached = this.fromCache(document, prefix);
		if (cached) return [toItem(cached, position)];

		const profile = await this.store.get();
		if (!profile || !isTokenUsable(profile)) return undefined;

		if (!invokedByHand && settings.debounceMs > 0) {
			await delay(settings.debounceMs, token);
			if (token.isCancellationRequested) return undefined;
			// The pause may have been long enough for a neighbouring request to
			// answer; re-check before spending another round trip.
			const afterWait = this.fromCache(document, prefix);
			if (afterWait) return [toItem(afterWait, position)];
		}

		// Only the newest request matters — drop whatever is still in flight.
		this.inFlight?.abort();
		const controller = new AbortController();
		this.inFlight = controller;
		token.onCancellationRequested(() => controller.abort());

		const started = Date.now();
		this.status.setBusy(true);
		try {
			const raw = await this.requestCompletion(profile, document, prefix, suffix, settings, controller);
			if (raw === undefined || token.isCancellationRequested) return undefined;

			const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
			const completion = cleanCompletion(raw, {
				linePrefix,
				suffix: suffix.slice(0, OVERLAP_LOOKAHEAD),
				maxLines: settings.maxLines,
				languageId: document.languageId,
			});
			log(
				`autocompletado: ${Date.now() - started} ms, ${raw.length} chars crudos → ${completion.length} usables`,
			);
			if (!completion) return undefined;

			this.remember(document, prefix, completion);
			return [toItem(completion, position)];
		} catch (error) {
			if (error instanceof CopilotClientError && error.message === '__CANCELLED__') return undefined;
			log(`autocompletado falló: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		} finally {
			if (this.inFlight === controller) this.inFlight = undefined;
			this.status.setBusy(false);
		}
	}

	/** Returns the raw model answer, or undefined when nothing usable arrived. */
	private async requestCompletion(
		profile: NonNullable<Awaited<ReturnType<ProfileStore['get']>>>,
		document: vscode.TextDocument,
		prefix: string,
		suffix: string,
		settings: Settings,
		controller: AbortController,
	): Promise<string | undefined> {
		const prompt = buildCompletionPrompt(document, prefix, suffix, settings.maxLines);
		let accumulated = '';
		let stoppedEarly = false;

		const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
		try {
			await streamCopilotTurn({
				profile,
				prompt,
				tone: findModel(settings.modelId)?.tone ?? null,
				signal: controller.signal,
				callbacks: {
					onText: (delta) => {
						accumulated += delta;
						// Stop as soon as there is plainly enough: the tail of a chat
						// answer is prose we would throw away anyway, and waiting for
						// it is pure latency.
						if (hasEnough(accumulated, settings.maxLines)) {
							stoppedEarly = true;
							controller.abort();
						}
					},
				},
			});
		} catch (error) {
			const cancelled = error instanceof CopilotClientError && error.message === '__CANCELLED__';
			// Our own early abort (and a timeout that still produced text) are
			// successes; anything else is a real failure.
			if (!cancelled || (!stoppedEarly && !accumulated.trim())) throw error;
		} finally {
			clearTimeout(timer);
		}

		return accumulated.trim() ? accumulated : undefined;
	}

	private cacheKey(document: vscode.TextDocument, prefix: string): string {
		return `${document.uri.toString()}::${prefix.slice(-CACHE_KEY_CHARS)}`;
	}

	/** Exact hit, or a still-valid suggestion the user is typing along with. */
	private fromCache(document: vscode.TextDocument, prefix: string): string | undefined {
		const uri = document.uri.toString();
		for (const [key, entry] of [...this.cache].reverse()) {
			if (!key.startsWith(`${uri}::`)) continue;
			const reusable = reuseForExtendedPrefix(entry.prefix, entry.completion, prefix);
			if (reusable) return reusable;
		}
		return undefined;
	}

	private remember(document: vscode.TextDocument, prefix: string, completion: string): void {
		const key = this.cacheKey(document, prefix);
		this.cache.delete(key);
		this.cache.set(key, { prefix, completion });
		while (this.cache.size > CACHE_MAX_ENTRIES) {
			const oldest = this.cache.keys().next();
			if (oldest.done) break;
			this.cache.delete(oldest.value);
		}
	}

	clearCache(): void {
		this.cache.clear();
	}
}

/** Enough lines to fill the suggestion, or a closed fence — whichever first. */
function hasEnough(text: string, maxLines: number): boolean {
	if (text.length > 4000) return true;
	const body = text.replace(/^[\s\S]*?```[A-Za-z0-9_+-]*\r?\n/, '');
	if (/\r?\n[ \t]*```/.test(body)) return true;
	return body.split('\n').length > maxLines + 1;
}

function buildCompletionPrompt(
	document: vscode.TextDocument,
	prefix: string,
	suffix: string,
	maxLines: number,
): string {
	const relativePath = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
	return [
		'Actúas como un motor de autocompletado de código, no como un asistente conversacional.',
		`Continúa el código EXACTAMENTE en la posición marcada con ⟦CURSOR⟧, en ${document.languageId}.`,
		'Reglas estrictas:',
		'- Responde SÓLO con el texto que va en ⟦CURSOR⟧. Nada de explicaciones, saludos ni comentarios sobre lo que haces.',
		'- No repitas el código que ya está antes del cursor ni el que va después.',
		'- No uses vallas de código ni Markdown.',
		`- Como mucho ${maxLines} líneas. Si no hay nada útil que añadir, responde con una línea vacía.`,
		`Archivo: ${relativePath}`,
		'--- código ---',
		`${prefix}⟦CURSOR⟧${suffix}`,
		'--- fin ---',
	].join('\n');
}

function textBefore(document: vscode.TextDocument, position: vscode.Position): string {
	const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
	return text.length > MAX_PREFIX_CHARS ? text.slice(-MAX_PREFIX_CHARS) : text;
}

function textAfter(document: vscode.TextDocument, position: vscode.Position): string {
	const lastLine = document.lineCount - 1;
	const end = new vscode.Position(lastLine, document.lineAt(lastLine).text.length);
	const text = document.getText(new vscode.Range(position, end));
	return text.length > MAX_SUFFIX_CHARS ? text.slice(0, MAX_SUFFIX_CHARS) : text;
}

function toItem(text: string, position: vscode.Position): vscode.InlineCompletionItem {
	return new vscode.InlineCompletionItem(text, new vscode.Range(position, position));
}

function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			listener.dispose();
			resolve();
		}, ms);
		const listener = token.onCancellationRequested(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/** Status-bar affordance: without it a 1–3 s suggestion just looks broken. */
export class CompletionStatus implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private busy = false;

	constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
		this.item.command = 'm365copilot.toggleInlineCompletions';
		this.render();
		this.item.show();
	}

	setBusy(busy: boolean): void {
		if (this.busy === busy) return;
		this.busy = busy;
		this.render();
	}

	refresh(): void {
		this.render();
	}

	private render(): void {
		const enabled = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>('enabled', true);
		if (!enabled) {
			this.item.text = '$(circle-slash) M365';
			this.item.tooltip = 'Autocompletado de M365 Copilot desactivado. Clic para activarlo.';
			return;
		}
		this.item.text = this.busy ? '$(loading~spin) M365' : '$(sparkle) M365';
		this.item.tooltip = this.busy
			? 'M365 Copilot está pensando una sugerencia...'
			: 'Autocompletado de M365 Copilot activo. Clic para desactivarlo.';
	}

	dispose(): void {
		this.item.dispose();
	}
}

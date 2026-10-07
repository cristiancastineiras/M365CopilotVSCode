import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { streamCopilotTurnWithRetry, CopilotClientError, CopilotAuthError, type TurnMode, type WebSource } from './client';
import { log } from './logger';

import { MarkdownStreamFormatter } from './markdown';
import { flattenMessages, latestUserText } from './messages';
import { webSearchEnabled } from './webSearch';
import { sourcesMarkdown } from './webSearchPrompt';
import { allModels, findModel, toChatInformation, type TokenState } from './models';
import { isTokenUsable, minutesUntilExpiry } from './profile';
import { buildToolCatalog, ToolCallDecoder, type DuplicatePolicy } from './toolProtocol';
import type { ProfileStore } from './secrets';
import { t } from './i18n';

/** Rough token estimate; BizChat exposes no tokenizer. */
const CHARS_PER_TOKEN = 3.5;

/** Cómo se describen en el prompt las herramientas que ofrece VS Code. */
function readToolSettings(): {
	includeEditorTools: boolean;
	duplicates: DuplicatePolicy;
	maxTools: number;
} {
	const config = vscode.workspace.getConfiguration('m365copilot.tools');
	return {
		includeEditorTools: config.get<boolean>('includeEditorTools', true),
		duplicates: config.get<DuplicatePolicy>('duplicates', 'preferEditor'),
		maxTools: config.get<number>('maxAdvertised', 48),
	};
}

/** The project context for a chat message (see projectIndex.ts), or undefined. */
export type ProjectContextSource = (message: string) => Promise<string | undefined>;

export class M365CopilotProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
	private readonly storeListener: vscode.Disposable;

	constructor(
		private readonly store: ProfileStore,
		private readonly projectContext?: ProjectContextSource,
	) {
		this.storeListener = store.onDidChange(() => this.changeEmitter.fire());
	}

	/** Force Copilot Chat to re-query the model list. */
	refresh(): void {
		this.changeEmitter.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const profile = await this.store.get();
		const state: TokenState = !profile ? 'missing' : isTokenUsable(profile) ? 'ok' : 'expired';
		return allModels().map((m) => toChatInformation(m, state));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const profile = await this.store.get();
		if (!profile) {
			throw new Error(t('provider.noToken'));
		}
		if (!isTokenUsable(profile)) {
			const mins = minutesUntilExpiry(profile);
			this.changeEmitter.fire();
			throw new Error(t('provider.tokenExpired', mins !== null ? t('provider.expiredAgo', Math.abs(mins)) : ''));
		}

		const selected = findModel(model.id);
		// `options.tools` trae TODAS las herramientas activas del turno: las
		// nuestras, las nativas del editor/modo agente, las de MCP y las de otras
		// extensiones. Se describen todas en el prompt y VS Code ejecuta la que el
		// modelo pida — es lo que hace que el modo agente funcione con este
		// proveedor, y no sólo con las siete herramientas de la extensión.
		const catalog = buildToolCatalog(options.tools, readToolSettings());
		const toolsRequired = options.toolMode === vscode.LanguageModelChatToolMode.Required;
		// Without tools to call there is no text protocol to protect, so the
		// turn can go out the way the web app sends it: with web search.
		const webTurn = catalog.callable.size === 0 && webSearchEnabled() && Boolean(profile.invocationTemplate);
		let projectContext: string | undefined;
		try {
			projectContext = await this.projectContext?.(latestUserText(messages));
		} catch (error) {
			log(t('log.indexContextFailed', error instanceof Error ? error.message : String(error)));
		}
		const prompt = flattenMessages(messages, { catalog, toolsRequired, projectContext });
		log(
			t(
				'log.chatRequest',
				model.id,
				messages.length,
				prompt.length,
				catalog.entries.length,
				catalog.callable.size,
				catalog.m365Count,
				catalog.editorCount,
			) + (catalog.omitted.length > 0 ? t('log.chatRequestOmitted', catalog.omitted.join(', ')) : ''),
		);
		if (!prompt.trim()) {
			log(t('log.emptyPrompt'));
			return;
		}

		const controller = new AbortController();
		const markdown = new MarkdownStreamFormatter();
		const emitMarkdown = (text: string) => {
			const formatted = markdown.push(text);
			if (formatted) progress.report(new vscode.LanguageModelTextPart(formatted));
		};
		const toolDecoder = new ToolCallDecoder(
			catalog.callable,
			emitMarkdown,
			(toolCall) => {
				log(t('log.toolCallRequested', toolCall.name));
				progress.report(
					new vscode.LanguageModelToolCallPart(randomUUID(), toolCall.name, toolCall.input),
				);
			},
		);
		const cancelListener = token.onCancellationRequested(() => controller.abort());
		const sources: WebSource[] = [];
		let emitted = false;
		const run = (mode: TurnMode) =>
			streamCopilotTurnWithRetry({
				profile,
				prompt,
				tone: selected?.tone ?? null,
				mode,
				signal: controller.signal,
				log,
				callbacks: {
					onText: (delta) => {
						if (delta) emitted = true;
						toolDecoder.push(delta);
					},
					onSources: (found) => sources.push(...found),
				},
			});

		try {
			try {
				await run(webTurn ? 'web' : 'tools');
			} catch (error) {
				// The web app's invocation is captured, not designed for us: if
				// BizChat turns it down, answer the plain way instead of failing.
				const retryable =
					webTurn &&
					!emitted &&
					!token.isCancellationRequested &&
					error instanceof CopilotClientError &&
					!(error instanceof CopilotAuthError) &&
					error.message !== '__CANCELLED__';
				if (!retryable) throw error;
				log(t('log.webFallback', error.message));
				await run('tools');
			}
			toolDecoder.finish();
			const formatted = markdown.finish();
			if (formatted) progress.report(new vscode.LanguageModelTextPart(formatted));
			const cited = sourcesMarkdown(sources);
			if (cited) progress.report(new vscode.LanguageModelTextPart(cited));
		} catch (error) {
			if (error instanceof CopilotClientError && error.message === '__CANCELLED__') {
				return; // user cancelled — swallow quietly
			}
			if (token.isCancellationRequested) return;
			// The server rejected the token mid-flight (even though its `exp` had not
			// passed); refresh the picker so its warning state reflects that the token
			// needs re-capturing.
			if (error instanceof CopilotAuthError) this.changeEmitter.fire();
			// A model that did not ship with this version (catalog, detected or
			// custom) may simply not exist in this tenant: say so instead of
			// leaving a bare "rejected the request".
			if (
				error instanceof CopilotClientError &&
				!(error instanceof CopilotAuthError) &&
				selected &&
				selected.source !== 'builtin'
			) {
				throw new Error(`${error.message}${t('models.rejectedHint', selected.name)}`);
			}
			throw error instanceof Error ? error : new Error(String(error));
		} finally {
			cancelListener.dispose();
		}
	}

	provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Thenable<number> {
		const raw =
			typeof text === 'string'
				? text
				: text.content
						.map((p) =>
							p instanceof vscode.LanguageModelTextPart ? p.value : JSON.stringify(p),
						)
						.join('');
		return Promise.resolve(Math.ceil(raw.length / CHARS_PER_TOKEN));
	}

	dispose(): void {
		this.storeListener.dispose();
		this.changeEmitter.dispose();
	}
}

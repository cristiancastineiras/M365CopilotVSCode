import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import {
	streamCopilotTurnWithRetry,
	CopilotClientError,
	CopilotAuthError,
	CopilotModelUnavailableError,
	type TurnMode,
	type WebSource,
} from './client';
import { debug, log } from './logger';

import { currentEnvironment } from './editorContext';
import { MarkdownStreamFormatter } from './markdown';
import { flattenMessages, recentUserTexts } from './messages';
import { retrievalText } from './transcript';
import { webSearchEnabled } from './webSearch';
import { sourcesMarkdown } from './webSearchPrompt';
import { allModels, findModel, modelRegistry, toChatInformation, type TokenState } from './models';
import { isTokenUsable, minutesUntilExpiry } from './profile';
import { buildToolCatalog, ToolCallDecoder, type DuplicatePolicy } from './toolProtocol';
import type { ProfileStore } from './secrets';
import { t } from './i18n';

/** Rough token estimate; BizChat exposes no tokenizer. */
const CHARS_PER_TOKEN = 3.5;

/** Numbers each chat request in the deep trace (`chat#3`), so interleaved requests can be told apart. */
let chatSeq = 0;

/** Cómo se describen en el prompt las herramientas que ofrece VS Code. */
function readToolSettings(): {
	includeEditorTools: boolean;
	duplicates: DuplicatePolicy;
	maxTools: number;
	singleRoot: boolean;
} {
	const config = vscode.workspace.getConfiguration('m365copilot.tools');
	return {
		includeEditorTools: config.get<boolean>('includeEditorTools', true),
		duplicates: config.get<DuplicatePolicy>('duplicates', 'preferEditor'),
		maxTools: config.get<number>('maxAdvertised', 48),
		singleRoot: (vscode.workspace.workspaceFolders?.length ?? 0) <= 1,
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
		const registry = modelRegistry();
		const infos = allModels().map((m) => toChatInformation(m, state, registry?.unavailability(m.tone)));
		debug('chat', 'VS Code asked for the model list', () => ({ tokenState: state, models: infos.map((info) => info.id) }));
		return infos;
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const scope = `chat#${++chatSeq}`;
		const started = Date.now();
		debug(scope, `request received for ${model.id}`, () => ({
			model: { id: model.id, name: model.name, family: model.family },
			messages: describeMessages(messages),
			toolMode: options.toolMode === undefined ? null : vscode.LanguageModelChatToolMode[options.toolMode],
			tools: (options.tools ?? []).map((tool) => tool.name),
			modelOptions: options.modelOptions,
		}));
		const profile = await this.store.get();
		if (!profile) {
			debug(scope, 'refused: no token stored');
			throw new Error(t('provider.noToken'));
		}
		if (!isTokenUsable(profile)) {
			const mins = minutesUntilExpiry(profile);
			debug(scope, `refused: the stored token expired (${mins} min)`);
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
		debug(scope, `turn mode decided: ${webTurn ? 'web (with BizChat plugins)' : 'tools (lean invocation)'}`, () => ({
			callableTools: [...catalog.callable.keys()],
			omittedTools: catalog.omitted,
			toolsRequired,
			webSearchEnabled: webSearchEnabled(),
			hasInvocationTemplate: Boolean(profile.invocationTemplate),
			selectedModel: selected ? { id: selected.id, tone: selected.tone, source: selected.source } : null,
		}));
		let projectContext: string | undefined;
		try {
			projectContext = await this.projectContext?.(retrievalText(recentUserTexts(messages, 2)));
		} catch (error) {
			log(t('log.indexContextFailed', error instanceof Error ? error.message : String(error)));
		}
		debug(scope, `project context (${projectContext?.length ?? 0} chars)`, projectContext);
		const prompt = flattenMessages(messages, {
			catalog,
			toolsRequired,
			environment: currentEnvironment(),
			projectContext,
		});
		debug(scope, `prompt flattened (${prompt.length} chars) — exactly what goes to BizChat as the user message`, prompt);
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
			if (formatted) {
				debug(scope, `→ text part to VS Code (${formatted.length} chars)`);
				progress.report(new vscode.LanguageModelTextPart(formatted));
			}
		};
		const toolDecoder = new ToolCallDecoder(
			catalog.callable,
			emitMarkdown,
			(toolCall) => {
				log(t('log.toolCallRequested', toolCall.name));
				debug(scope, `→ tool call to VS Code: ${toolCall.name}`, toolCall.input);
				progress.report(
					new vscode.LanguageModelToolCallPart(randomUUID(), toolCall.name, toolCall.input),
				);
			},
		);
		const cancelListener = token.onCancellationRequested(() => controller.abort());
		const sources: WebSource[] = [];
		let emitted = false;
		const run = (mode: TurnMode) => {
			debug(scope, `starting the BizChat turn in "${mode}" mode`);
			return streamCopilotTurnWithRetry({
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
		};

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
				debug(scope, 'the web invocation was turned down; falling back to the lean "tools" invocation', error);
				await run('tools');
			}
			toolDecoder.finish();
			const formatted = markdown.finish();
			if (formatted) progress.report(new vscode.LanguageModelTextPart(formatted));
			const cited = sourcesMarkdown(sources);
			if (cited) progress.report(new vscode.LanguageModelTextPart(cited));
			debug(scope, `request finished in ${Date.now() - started} ms`, () => ({
				streamedAnyText: emitted,
				sources: sources.map((source) => source.url),
			}));
		} catch (error) {
			debug(scope, `request ended with an error after ${Date.now() - started} ms`, error);
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
			// leaving a bare "rejected the request". (A model the service refused
			// already says all that.)
			if (
				error instanceof CopilotClientError &&
				!(error instanceof CopilotAuthError) &&
				!(error instanceof CopilotModelUnavailableError) &&
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
		const tokens = Math.ceil(raw.length / CHARS_PER_TOKEN);
		debug('chat', `token count asked for ${raw.length} chars → ${tokens} (estimate: ${CHARS_PER_TOKEN} chars per token)`);
		return Promise.resolve(tokens);
	}

	dispose(): void {
		this.storeListener.dispose();
		this.changeEmitter.dispose();
	}
}

/** What a chat request carries, for the deep trace: roles and part sizes (the flattened prompt is logged whole separately). */
function describeMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): unknown[] {
	return messages.map((message, index) => ({
		index,
		role: vscode.LanguageModelChatMessageRole[message.role] ?? message.role,
		name: message.name,
		parts: message.content.map(describePart),
	}));
}

function describePart(part: unknown): string {
	if (part instanceof vscode.LanguageModelTextPart) return `text(${part.value.length} chars)`;
	if (part instanceof vscode.LanguageModelToolCallPart) return `toolCall(${part.name}, ${part.callId})`;
	if (part instanceof vscode.LanguageModelToolResultPart) return `toolResult(${part.callId}, ${part.content.length} parts)`;
	return part && typeof part === 'object' ? (part.constructor?.name ?? 'object') : typeof part;
}

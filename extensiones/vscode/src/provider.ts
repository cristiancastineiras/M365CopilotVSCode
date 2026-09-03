import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { streamCopilotTurn, CopilotClientError, CopilotAuthError } from './client';
import { log } from './logger';

import { MarkdownStreamFormatter } from './markdown';
import { flattenMessages } from './messages';
import { findModel, MODELS, toChatInformation } from './models';
import { isTokenUsable, minutesUntilExpiry } from './profile';
import { buildToolCatalog, ToolCallDecoder, type DuplicatePolicy } from './toolProtocol';
import type { ProfileStore } from './secrets';

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

export class M365CopilotProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
	private readonly storeListener: vscode.Disposable;

	constructor(private readonly store: ProfileStore) {
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
		const hasProfile = await this.store.has();
		return MODELS.map((m) => toChatInformation(m, hasProfile));
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
			throw new Error(
				'No hay token de M365 Copilot. Ejecuta «M365 Copilot: Pegar perfil o token».',
			);
		}
		if (!isTokenUsable(profile)) {
			const mins = minutesUntilExpiry(profile);
			this.changeEmitter.fire();
			throw new Error(
				`El token de M365 Copilot ha caducado${
					mins !== null ? ` (hace ${Math.abs(mins)} min)` : ''
				}. Vuelve a capturarlo con el userscript y pégalo de nuevo.`,
			);
		}

		const selected = findModel(model.id);
		// `options.tools` trae TODAS las herramientas activas del turno: las
		// nuestras, las nativas del editor/modo agente, las de MCP y las de otras
		// extensiones. Se describen todas en el prompt y VS Code ejecuta la que el
		// modelo pida — es lo que hace que el modo agente funcione con este
		// proveedor, y no sólo con las siete herramientas de la extensión.
		const catalog = buildToolCatalog(options.tools, readToolSettings());
		const toolsRequired = options.toolMode === vscode.LanguageModelChatToolMode.Required;
		const prompt = flattenMessages(messages, { catalog, toolsRequired });
		log(
			`petición del chat: modelo=${model.id}, ${messages.length} mensajes, prompt=${prompt.length} chars, ` +
				`herramientas=${catalog.entries.length}/${catalog.callable.size} ` +
				`(${catalog.m365Count} propias, ${catalog.editorCount} del editor)` +
				(catalog.omitted.length > 0 ? `, sin describir: ${catalog.omitted.join(', ')}` : ''),
		);
		if (!prompt.trim()) {
			log('prompt vacío tras aplanar; no se envía nada');
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
				log(`llamada de herramienta solicitada: ${toolCall.name}`);
				progress.report(
					new vscode.LanguageModelToolCallPart(randomUUID(), toolCall.name, toolCall.input),
				);
			},
		);
		const cancelListener = token.onCancellationRequested(() => controller.abort());

		try {
			await streamCopilotTurn({
				profile,
				prompt,
				tone: selected?.tone ?? null,
				signal: controller.signal,
				log,
				callbacks: {
					onText: (delta) => toolDecoder.push(delta),
				},
			});
			toolDecoder.finish();
			const formatted = markdown.finish();
			if (formatted) progress.report(new vscode.LanguageModelTextPart(formatted));
		} catch (error) {
			if (error instanceof CopilotClientError && error.message === '__CANCELLED__') {
				return; // user cancelled — swallow quietly
			}
			if (token.isCancellationRequested) return;
			// The server rejected the token mid-flight (even though its `exp` had not
			// passed); refresh the picker so its warning state reflects that the token
			// needs re-capturing.
			if (error instanceof CopilotAuthError) this.changeEmitter.fire();
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

import * as vscode from 'vscode';
import { buildToolProtocolInstructions, buildToolProtocolReminder, type ToolCatalog } from './toolProtocol';
import { renderTranscript, type TranscriptMessage, type TranscriptPart } from './transcript';
import { t } from './i18n';

/*
 * Tono/estilo de comunicación (`prompt.tone`), deliberadamente estricto: por
 * defecto, un modelo de chat tiende a rellenar con cháchara (celebrar la
 * pregunta, anunciar el plan con un párrafo entero, resumir al final lo que ya
 * se acaba de decir) porque ESO es lo que un asistente conversacional genérico
 * premia — aquí se pide justo lo contrario: un compañero de equipo serio y
 * funcional que va al grano. Junto con `prompt.markdown` y su recordatorio
 * final, vive en los catálogos de locales/ para que el modelo reciba las
 * instrucciones en el idioma del usuario.
 */

export interface FlattenOptions {
	/** Herramientas del turno (nuestras + nativas de VS Code + MCP). */
	readonly catalog?: ToolCatalog;
	/** `LanguageModelChatToolMode.Required`: hay que llamar a una herramienta sí o sí. */
	readonly toolsRequired?: boolean;
	/** Sistema, shell, raíz del workspace y fecha (environment.ts). */
	readonly environment?: string;
	/** Contexto del proyecto recuperado del índice local (projectIndex.ts), si lo hay. */
	readonly projectContext?: string;
}

/**
 * Los textos de los últimos mensajes del usuario (no los resultados de
 * herramientas), del más nuevo al más viejo: lo que se busca en el índice
 * del proyecto (ver `retrievalText` en transcript.ts).
 */
export function recentUserTexts(messages: readonly vscode.LanguageModelChatRequestMessage[], count = 2): string[] {
	const texts: string[] = [];
	for (let index = messages.length - 1; index >= 0 && texts.length < count; index -= 1) {
		const message = messages[index];
		if (message?.role !== vscode.LanguageModelChatMessageRole.User) continue;
		const text = message.content
			.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
			.map((part) => part.value)
			.join('\n')
			.trim();
		if (text) texts.push(text);
	}
	return texts;
}

/**
 * BizChat/Sydney takes a single `message.text` string per turn and keeps its
 * own conversation state server-side by `ConversationId`. VS Code, however,
 * re-sends the entire transcript on every turn. The simplest robust bridge is
 * to open a fresh conversation each turn and flatten the whole transcript into
 * one prompt with role labels — the model then has full context without us
 * having to reconcile the two state models. How the transcript is squeezed
 * into the budget (the request pinned, older tool results shortened) lives
 * in transcript.ts.
 */
export function flattenMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: FlattenOptions = {},
): string {
	const transcript = renderTranscript(toTranscript(messages));
	if (!transcript) return '';

	// A short reminder placed AFTER the transcript — the last thing the model
	// reads before it answers. Instruction-following fidelity is not uniform
	// across the different underlying models BizChat routes to (observed: the
	// Claude and reasoning tones drop rules stated only at the top of a long
	// prompt far more often than the GPT tone does); repeating the rule right
	// next to the question measurably improves compliance for all of them.
	const catalog = options.catalog;
	const reminder = [
		t('prompt.markdownReminder'),
		catalog ? buildToolProtocolReminder(catalog, options.toolsRequired) : '',
	]
		.filter(Boolean)
		.join('\n');

	return [
		t('prompt.tone'),
		t('prompt.markdown'),
		catalog ? buildToolProtocolInstructions(catalog) : '',
		options.environment ?? '',
		options.projectContext ?? '',
		transcript,
		reminder,
	]
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Los mensajes de VS Code en la forma neutra de transcript.ts. El id de
 * llamada es un UUID: sin el nombre delante, un transcript con varias
 * herramientas (las nativas del modo agente entran aquí igual que las
 * nuestras) deja al modelo adivinando de cuál viene cada resultado.
 */
function toTranscript(messages: readonly vscode.LanguageModelChatRequestMessage[]): TranscriptMessage[] {
	const callNames = new Map<string, string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelToolCallPart) callNames.set(part.callId, part.name);
		}
	}
	return messages.map((message) => ({
		role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user',
		parts: message.content.map((part): TranscriptPart => {
			if (part instanceof vscode.LanguageModelTextPart) return { kind: 'text', text: part.value };
			if (part instanceof vscode.LanguageModelToolResultPart) {
				return { kind: 'toolResult', name: callNames.get(part.callId) ?? part.callId, text: toolResultToText(part.content) };
			}
			if (part instanceof vscode.LanguageModelToolCallPart) {
				return { kind: 'toolCall', name: part.name, input: safeJson(part.input) };
			}
			return { kind: 'text', text: typeof part === 'string' ? part : unknownPartToText(part) };
		}),
	}));
}

/**
 * El resultado de una herramienta puede traer partes que no son texto plano:
 * las nativas de VS Code devuelven a menudo un árbol de `@vscode/prompt-tsx` y
 * algunas adjuntan datos binarios. Volcar el JSON crudo de esas partes gasta
 * contexto y confunde al modelo, así que se extrae el texto y lo demás se
 * resume en una línea.
 */
function toolResultToText(content: ReadonlyArray<unknown>): string {
	const out: string[] = [];
	for (const part of content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			out.push(part.value);
		} else {
			out.push(unknownPartToText(part));
		}
	}
	return out.filter(Boolean).join('\n');
}

function unknownPartToText(part: unknown): string {
	if (part instanceof vscode.LanguageModelPromptTsxPart) {
		return promptTsxToText(part.value) || safeJson(part.value);
	}
	if (part instanceof vscode.LanguageModelDataPart) return dataPartToText(part);
	if (part && typeof part === 'object' && 'value' in part) {
		const value = (part as { value: unknown }).value;
		return typeof value === 'string' ? value : safeJson(value);
	}
	return t('prompt.nonTextOmitted');
}

/** Texto legible de un dato adjunto; lo binario sólo se anuncia. */
function dataPartToText(part: vscode.LanguageModelDataPart): string {
	const mime = part.mimeType || 'application/octet-stream';
	if (/^text\/|json|xml|yaml|javascript|typescript/i.test(mime)) {
		try {
			return new TextDecoder().decode(part.data);
		} catch {
			/* no era UTF-8 válido: se anuncia como binario */
		}
	}
	return t('prompt.attachmentOmitted', mime, Math.ceil(part.data.byteLength / 1024));
}

/**
 * Aplana el JSON que produce `renderElementJSON` de `@vscode/prompt-tsx`
 * quedándose sólo con el texto. La forma exacta del árbol es un detalle interno
 * de esa librería, así que el recorrido es deliberadamente estructural: baja por
 * `node`/`children` y recoge cualquier `text`.
 */
function promptTsxToText(value: unknown, depth = 0): string {
	if (depth > 12 || value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		return value
			.map((item) => promptTsxToText(item, depth + 1))
			.filter(Boolean)
			.join('');
	}
	if (typeof value !== 'object') return '';

	const record = value as Record<string, unknown>;
	const collected: string[] = [];
	for (const key of ['text', 'node', 'children'] as const) {
		if (key in record) collected.push(promptTsxToText(record[key], depth + 1));
	}
	return collected.filter(Boolean).join('');
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}


import * as vscode from 'vscode';
import { buildToolProtocolInstructions, buildToolProtocolReminder, type ToolCatalog } from './toolProtocol';
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

const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_LATEST_MESSAGE_CHARS = 24_000;
const MAX_TOOL_RESULT_CHARS = 12_000;
const MAX_TOOL_CALL_INPUT_CHARS = 4_000;

export interface FlattenOptions {
	/** Herramientas del turno (nuestras + nativas de VS Code + MCP). */
	readonly catalog?: ToolCatalog;
	/** `LanguageModelChatToolMode.Required`: hay que llamar a una herramienta sí o sí. */
	readonly toolsRequired?: boolean;
	/** Contexto del proyecto recuperado del índice local (projectIndex.ts), si lo hay. */
	readonly projectContext?: string;
}

/**
 * El texto del último mensaje del usuario (no los resultados de
 * herramientas): lo que se busca en el índice del proyecto.
 */
export function latestUserText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== vscode.LanguageModelChatMessageRole.User) continue;
		const text = message.content
			.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
			.map((part) => part.value)
			.join('\n')
			.trim();
		if (text) return text;
	}
	return '';
}

/**
 * BizChat/Sydney takes a single `message.text` string per turn and keeps its
 * own conversation state server-side by `ConversationId`. VS Code, however,
 * re-sends the entire transcript on every turn. The simplest robust bridge is
 * to open a fresh conversation each turn and flatten the whole transcript into
 * one prompt with role labels — the model then has full context without us
 * having to reconcile the two state models.
 */
export function flattenMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: FlattenOptions = {},
): string {
	const blocks: string[] = [];
	// El id de llamada es un UUID: sin el nombre delante, un transcript con
	// varias herramientas (las nativas del modo agente entran aquí igual que las
	// nuestras) deja al modelo adivinando de cuál viene cada resultado.
	const callNames = collectToolCallNames(messages);

	for (const [index, message] of messages.entries()) {
		const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'Assistant' : 'User';
		const text = partsToText(message.content, callNames).trim();
		if (!text) continue;
		const maxChars = index === messages.length - 1 ? MAX_LATEST_MESSAGE_CHARS : MAX_MESSAGE_CHARS;
		blocks.push(`${role}:\n${trimForContext(text, maxChars)}`);
	}
	if (blocks.length === 0) return '';

	// The final User turn is what we want answered; the earlier blocks are
	// context. A trailing marker nudges plain single-turn rings to answer.
	const transcript =
		messages.length > 1
			? `${t('prompt.continue')}\n\n${compactContext(blocks)}\n\nAssistant:`
			: blocks[0];

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
		options.projectContext ?? '',
		transcript,
		reminder,
	]
		.filter(Boolean)
		.join('\n\n');
}

/** callId → nombre de la herramienta, recorriendo todo el transcript. */
function collectToolCallNames(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): Map<string, string> {
	const names = new Map<string, string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelToolCallPart) names.set(part.callId, part.name);
		}
	}
	return names;
}

function partsToText(content: ReadonlyArray<unknown>, callNames: ReadonlyMap<string, string>): string {
	const out: string[] = [];
	for (const part of content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			out.push(part.value);
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			const name = callNames.get(part.callId);
			out.push(
				`${t('prompt.toolResult', name ?? part.callId)}\n${trimForContext(
					toolResultToText(part.content),
					MAX_TOOL_RESULT_CHARS,
				)}`,
			);
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			out.push(
				t('prompt.toolCall', part.name, trimForContext(safeJson(part.input), MAX_TOOL_CALL_INPUT_CHARS)),
			);
		} else if (typeof part === 'string') {
			out.push(part);
		} else {
			out.push(unknownPartToText(part));
		}
	}
	return out.join('\n');
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

function compactContext(blocks: readonly string[]): string {
	const selected: string[] = [];
	let remaining = MAX_CONTEXT_CHARS;
	let omitted = false;

	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (remaining <= 0) {
			omitted = true;
			break;
		}
		if (block.length <= remaining) {
			selected.unshift(block);
			remaining -= block.length;
			continue;
		}

		selected.unshift(trimForContext(block, remaining));
		omitted = true;
		break;
	}

	if (omitted) selected.unshift(t('prompt.earlierOmitted'));
	return selected.join('\n\n');
}

function trimForContext(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	if (maxChars < 200) return value.slice(-maxChars);

	const headLength = Math.floor(maxChars * 0.65);
	const tailLength = maxChars - headLength - 72;
	const omitted = value.length - headLength - tailLength;
	return `${value.slice(0, headLength)}\n\n${t('prompt.charsOmitted', omitted)}\n\n${value.slice(-tailLength)}`;
}

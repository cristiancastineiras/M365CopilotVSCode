import * as vscode from 'vscode';
import { ensureNotCancelled, errorMessage } from './common';
import { t } from '../src/i18n';

/**
 * Sustituto de "web search" para BizChat.
 *
 * `client.ts` deja fuera a propósito los plugins nativos de la sesión real de
 * Copilot (incluido `BingWebSearch`): con ellos activos el modelo trata el
 * turno como una sesión web con tool-calling nativo y deja de obedecer el
 * protocolo de texto que esta extensión inyecta (ver el comentario grande
 * junto a `arguments[0]` en client.ts). El precio de eso es que el modelo no
 * tiene NINGUNA fuente de información externa/actual — de ahí el aviso
 * "Web search is off" que el propio backend añade a sus respuestas. No hay
 * ajuste en esta extensión que lo reactive sin reintroducir ese problema.
 *
 * Esta herramienta no es un buscador web general: consulta DeepWiki
 * (deepwiki.com), un servicio público que genera documentación y responde
 * preguntas sobre un repositorio de GitHub concreto (normalmente uno del que
 * depende el proyecto), en vivo en cada llamada — no es nada que el modelo
 * ya llevara aprendido. Es angosto a propósito: no reemplaza una búsqueda
 * web real, pero le da al modelo una forma legítima de consultar algo
 * externo y actual dentro del mismo protocolo `<m365_tool_call>`.
 */

const DEEPWIKI_ENDPOINT = 'https://mcp.deepwiki.com/mcp';
const DEEPWIKI_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_CHARS = 20_000;

export type DeepWikiAction = 'ask' | 'structure' | 'contents';

export interface DeepWikiSearchInput {
	readonly repo?: string;
	readonly question?: string;
	readonly action?: string;
}

const REPO_RE = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

function normalizeAction(value: unknown): DeepWikiAction {
	const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (action === 'structure' || action === 'contents') return action;
	return 'ask'; // el caso común: "¿qué hace X / cómo funciona X?"
}

export async function searchDeepWiki(
	input: DeepWikiSearchInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const repo = typeof input.repo === 'string' ? input.repo.trim() : '';
	if (!repo || !REPO_RE.test(repo)) {
		throw new Error(t('deepwiki.badRepo'));
	}
	const action = normalizeAction(input.action);

	let toolName: string;
	let args: Record<string, unknown>;
	if (action === 'ask') {
		const question = typeof input.question === 'string' ? input.question.trim() : '';
		if (!question) throw new Error(t('deepwiki.noQuestion'));
		toolName = 'ask_question';
		args = { repoName: repo, question };
	} else if (action === 'structure') {
		toolName = 'read_wiki_structure';
		args = { repoName: repo };
	} else {
		toolName = 'read_wiki_contents';
		args = { repoName: repo };
	}

	ensureNotCancelled(token);
	const text = await callDeepWiki(toolName, args, token);
	if (!text.trim()) return t('deepwiki.empty', repo, action);

	const trimmed = text.trim();
	const truncated =
		trimmed.length > MAX_OUTPUT_CHARS ? `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n${t('git.truncated')}` : trimmed;
	return `DeepWiki (${repo}, ${action}):\n${truncated}`;
}

let requestId = 0;

/** Llama a una herramienta del MCP público de DeepWiki por HTTP y devuelve su texto. */
async function callDeepWiki(
	name: string,
	args: Record<string, unknown>,
	token: vscode.CancellationToken,
): Promise<string> {
	const controller = new AbortController();
	const cancelListener = token.onCancellationRequested(() => controller.abort());
	const timeout = setTimeout(() => controller.abort(), DEEPWIKI_TIMEOUT_MS);
	const id = ++requestId;
	try {
		let response: Response;
		try {
			response = await fetch(DEEPWIKI_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json, text/event-stream',
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					id,
					method: 'tools/call',
					params: { name, arguments: args },
				}),
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(
					token.isCancellationRequested ? t('ws.cancelled') : t('deepwiki.timeout', DEEPWIKI_TIMEOUT_MS / 1000),
				);
			}
			throw new Error(t('deepwiki.unreachable', errorMessage(error)));
		}
		if (!response.ok) {
			throw new Error(t('deepwiki.http', `${response.status} ${response.statusText}`.trimEnd()));
		}

		const body = await response.text();
		const message = findJsonRpcResponse(body, id);
		if (!message) throw new Error(t('deepwiki.unrecognised'));
		if (message.error) {
			throw new Error(`DeepWiki: ${message.error.message ?? JSON.stringify(message.error)}`);
		}
		return extractResultText(message.result);
	} finally {
		clearTimeout(timeout);
		cancelListener.dispose();
	}
}

interface JsonRpcResponse {
	readonly id?: number;
	readonly result?: unknown;
	readonly error?: { readonly message?: string };
}

/**
 * El servidor responde como SSE (una línea `data: {...}` por evento) aunque
 * la petición sea una única llamada de request/response: hay notificaciones
 * de progreso intercaladas antes del resultado final. Se busca la primera
 * línea `data:` cuyo JSON traiga el `id` de esta petición y un `result` o
 * `error` — esa es la respuesta real, el resto son notificaciones.
 */
function findJsonRpcResponse(body: string, id: number): JsonRpcResponse | null {
	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const payload = trimmed.slice('data:'.length).trim();
		if (!payload) continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== 'object') continue;
		const message = parsed as JsonRpcResponse;
		if (message.id === id && ('result' in message || 'error' in message)) return message;
	}
	return null;
}

interface ToolCallResult {
	readonly content?: readonly { readonly type?: string; readonly text?: string }[];
	readonly structuredContent?: { readonly result?: string };
	readonly isError?: boolean;
}

function extractResultText(result: unknown): string {
	const record = (result && typeof result === 'object' ? result : {}) as ToolCallResult;
	const parts = Array.isArray(record.content)
		? record.content
				.filter((part) => part && part.type === 'text' && typeof part.text === 'string')
				.map((part) => part.text as string)
		: [];
	const text = parts.join('\n').trim() || (typeof record.structuredContent?.result === 'string' ? record.structuredContent.result.trim() : '');

	if (record.isError) {
		throw new Error(text || t('deepwiki.errorNoDetails'));
	}
	return text;
}

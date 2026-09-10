/**
 * Bucle de un sub-agente y su limitador de concurrencia — la mitad de
 * `subagents.ts` (ver sus comentarios) que a propósito NO importa `vscode`,
 * igual que `toolCatalog.ts`/`toolProtocol.ts`: así se puede probar contra el
 * servidor BizChat simulado de `test/e2e.mts` sin host de VS Code. La
 * ejecución real de herramientas (`vscode.lm.invokeTool`) se inyecta desde
 * fuera como `executeTool`.
 */
import { streamCopilotTurnWithRetry } from './client';
import type { CopilotProfile } from './profile';
import {
	buildToolCatalog,
	buildToolProtocolInstructions,
	buildToolProtocolReminder,
	ToolCallDecoder,
	type DecodedToolCall,
	type OfferedTool,
	type ToolCatalog,
} from './toolProtocol';

// --------------------------------------------------------- concurrency

/**
 * Cola FIFO con un máximo de ejecuciones simultáneas. Se usa dos veces: para
 * acotar cuántos sub-agentes corren a la vez, y como mutex (límite 1) para
 * serializar `ms365_apply_edits`/`ms365_run_command` entre sub-agentes
 * concurrentes — `tools/terminal.ts` cachea UN terminal por cwd y
 * `tools/writeFile.ts` mantiene estado mutable compartido, así que dos
 * llamadas mutantes a la vez podrían entrelazar salida de terminal o pisarse
 * la una a la otra; las de solo lectura no comparten nada y no pasan por aquí.
 */
export class ConcurrencyLimiter {
	private active = 0;
	private readonly queue: (() => void)[] = [];
	private readonly max: number;

	// Plain assignment, not a constructor parameter property: this module is
	// loaded by test/e2e.mts under Node's `--experimental-strip-types`, which
	// only erases types and does not support that TS-only shorthand.
	constructor(max: number) {
		this.max = max;
	}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= this.max) {
			await new Promise<void>((resolve) => this.queue.push(resolve));
		}
		this.active += 1;
		try {
			return await fn();
		} finally {
			this.active -= 1;
			this.queue.shift()?.();
		}
	}
}

// --------------------------------------------------------------- loop

export type SubagentToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

export interface SubagentStepInfo {
	readonly step: number;
	readonly kind: 'call' | 'done' | 'limit' | 'error';
	readonly detail: string;
}

export interface SubagentTaskParams {
	readonly label: string;
	readonly task: string;
	readonly profile: CopilotProfile;
	readonly tone: string | null;
	readonly maxSteps: number;
	readonly signal: AbortSignal;
	/** Herramientas ofrecidas al sub-agente (normalmente las 7 de workspace, nunca `ms365_spawn_agents`). */
	readonly offeredTools: readonly OfferedTool[];
	readonly executeTool: SubagentToolExecutor;
	readonly onStep?: (info: SubagentStepInfo) => void;
	readonly log?: (message: string) => void;
	/** Sólo para tests: apunta `streamCopilotTurn` a un servidor BizChat simulado. */
	readonly endpointBase?: string;
	/** Sólo para tests: sustituye {@link MAX_TASK_WALL_CLOCK_MS} por un techo más corto. */
	readonly maxWallClockMs?: number;
}

export interface SubagentTaskResult {
	readonly label: string;
	readonly ok: boolean;
	readonly summary: string;
	readonly steps: number;
}

const MAX_STEP_RESULT_CHARS = 4_000;
const MAX_CALL_PREVIEW_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_LAST_RESULT_PREVIEW_CHARS = 2_000;

/**
 * Techo de tiempo TOTAL de un sub-agente, independiente de `maxSteps`. Cada
 * paso ya tiene su propio límite duro de 5 min (`MAX_TURN_MS` en client.ts),
 * pero eso por sí solo permite que una sola tarea (con `maxSteps` hasta 12)
 * tarde hasta una hora en darse por vencida — desde el chat eso se ve
 * exactamente como "se queda colgado", porque el aviso de "Delegando..." no
 * cambia y la única señal de progreso vive en una notificación aparte. Se
 * comprueba ENTRE pasos (nunca corta uno ya en curso) para no perder trabajo
 * a medio hacer.
 */
const MAX_TASK_WALL_CLOCK_MS = 8 * 60_000;

/**
 * Bucle de un sub-agente: llama a BizChat, decodifica la respuesta y, si pide
 * una herramienta, la ejecuta con `executeTool` y reenvía el resultado en el
 * siguiente paso. Nunca lanza — cualquier fallo se devuelve como
 * `{ ok: false, summary }`, porque el llamador siempre quiere un informe de
 * texto, no una excepción que tumbe al resto de sub-agentes en curso.
 */
export async function runSubagentTask(params: SubagentTaskParams): Promise<SubagentTaskResult> {
	const { label, task, profile, tone, maxSteps, signal, offeredTools, executeTool, endpointBase } = params;
	const log = params.log ?? (() => {});
	const onStep = params.onStep ?? (() => {});

	const catalog = buildToolCatalog(offeredTools, {
		includeEditorTools: false,
		duplicates: 'both',
		maxTools: offeredTools.length,
	});
	const blocks: string[] = [];
	let lastResultText = '';
	const startedAt = Date.now();
	const wallClockBudgetMs = params.maxWallClockMs ?? MAX_TASK_WALL_CLOCK_MS;

	for (let step = 1; step <= maxSteps; step += 1) {
		if (signal.aborted) return { label, ok: false, summary: 'Cancelado.', steps: step - 1 };
		if (Date.now() - startedAt > wallClockBudgetMs) {
			const minutes = (wallClockBudgetMs / 60_000).toFixed(wallClockBudgetMs < 60_000 ? 2 : 0);
			const summary =
				`⏱️ Se alcanzó el tiempo máximo (${minutes} min) para esta sub-tarea sin una respuesta final. ` +
				`Último resultado:\n${clip(lastResultText, MAX_LAST_RESULT_PREVIEW_CHARS)}`;
			onStep({ step, kind: 'limit', detail: summary });
			return { label, ok: false, summary, steps: step - 1 };
		}

		let call: DecodedToolCall | null = null;
		let text = '';
		const decoder = new ToolCallDecoder(
			catalog.callable,
			(delta) => {
				text += delta;
			},
			(decoded) => {
				call = decoded;
			},
		);

		try {
			await streamCopilotTurnWithRetry({
				profile,
				prompt: buildSubagentPrompt(task, catalog, blocks),
				tone,
				signal,
				endpointBase,
				log,
				callbacks: { onText: (delta) => decoder.push(delta) },
			});
			decoder.finish();
		} catch (error) {
			if (signal.aborted) return { label, ok: false, summary: 'Cancelado.', steps: step - 1 };
			const message = error instanceof Error ? error.message : String(error);
			onStep({ step, kind: 'error', detail: message });
			return { label, ok: false, summary: `Error: ${message}`, steps: step - 1 };
		}

		if (!call) {
			const summary = text.trim() || '(el sub-agente no devolvió texto).';
			onStep({ step, kind: 'done', detail: summary });
			return { label, ok: true, summary, steps: step };
		}

		// `call` is mutated inside the decoder's closures; a type assertion
		// (rather than relying on narrowing across that boundary) is used here
		// on purpose — the `if (!call) return` above already proved it's set.
		const finishedCall = call as DecodedToolCall;
		onStep({ step, kind: 'call', detail: `${finishedCall.name}(${safeJsonPreview(finishedCall.input)})` });
		const resultText = await executeTool(finishedCall.name, finishedCall.input);
		lastResultText = resultText;
		blocks.push(renderCallBlock(step, finishedCall));
		blocks.push(renderResultBlock(finishedCall.name, resultText));
	}

	const summary =
		`⚠️ Se alcanzó el límite de ${maxSteps} paso(s) sin una respuesta final. ` +
		`Último resultado:\n${clip(lastResultText, MAX_LAST_RESULT_PREVIEW_CHARS)}`;
	onStep({ step: maxSteps, kind: 'limit', detail: summary });
	return { label, ok: false, summary, steps: maxSteps };
}

function buildSubagentPrompt(task: string, catalog: ToolCatalog, blocks: readonly string[]): string {
	const framing = [
		'Eres un SUB-AGENTE autónomo dentro de VS Code, delegado por el agente principal de M365 Copilot para UNA ' +
			'tarea concreta y acotada. No ves el resto de la conversación con el usuario — sólo la tarea de abajo — ' +
			'así que no des nada por hecho fuera de ella.',
		`Tarea encomendada:\n${task}`,
		'Usa las herramientas que necesites, un paso a la vez. Cuando termines, responde en Markdown con un RESUMEN ' +
			'CONCISO (unos pocos párrafos o una lista de puntos como mucho) de lo que hiciste y lo que encontraste o ' +
			'cambiaste — es lo ÚNICO que va a leer el agente principal, así que no dejes fuera nada importante ni ' +
			'emitas más marcadores de herramienta una vez tengas esa respuesta final. Si el resumen incluye código de ' +
			'2 o más líneas, ponlo entre vallas ``` con el lenguaje.',
	].join('\n\n');

	return [
		buildToolProtocolInstructions(catalog),
		framing,
		compactBlocks(blocks),
		buildToolProtocolReminder(catalog, false),
	]
		.filter(Boolean)
		.join('\n\n');
}

/** Igual que `compactContext` de messages.ts pero local: se queda con los pasos
 * más recientes y avisa cuando descarta los más antiguos por espacio. */
function compactBlocks(blocks: readonly string[]): string {
	if (blocks.length === 0) return '';
	const kept: string[] = [];
	let remaining = MAX_TRANSCRIPT_CHARS;
	let omitted = false;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index];
		if (remaining <= 0) {
			omitted = true;
			break;
		}
		kept.unshift(clip(block, remaining));
		remaining -= block.length;
	}
	if (omitted) kept.unshift('[pasos anteriores del sub-agente omitidos para conservar contexto]');
	return kept.join('\n\n');
}

function renderCallBlock(step: number, call: DecodedToolCall): string {
	return `Sub-agente (paso ${step}): llamó a ${call.name} con ${safeJsonPreview(call.input)}`;
}

function renderResultBlock(name: string, resultText: string): string {
	return `Resultado de ${name}:\n${clip(resultText, MAX_STEP_RESULT_CHARS)}`;
}

function safeJsonPreview(input: Record<string, unknown>): string {
	let json: string;
	try {
		json = JSON.stringify(input) ?? '{}';
	} catch {
		json = '{}';
	}
	return clip(json, MAX_CALL_PREVIEW_CHARS);
}

/** Exportado también para `subagents.ts` (formatea el informe combinado y el
 * log de progreso) — evita reimplementar el mismo recorte en dos sitios.
 * Cierra una valla ``` que el corte haya dejado abierta (ver
 * {@link closeDanglingFence}): un resumen de sub-agente con código truncado
 * a medias dejaba el resto del informe — y con él la respuesta del agente
 * principal, que lee este texto como parte de su propio prompt — dentro de
 * un bloque de código sin cerrar. */
export function clip(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const omitted = text.length - maxChars;
	return `${closeDanglingFence(text.slice(0, maxChars))}\n… (${omitted} caracteres omitidos)`;
}

/**
 * Si el corte cae dentro de una valla ``` abierta, añade una de cierre antes
 * de la nota de "caracteres omitidos" — si no, ese texto (y cualquier cosa
 * que el llamador concatene después, como el resto del informe) se renderiza
 * como si fuera parte del bloque de código.
 */
function closeDanglingFence(text: string): string {
	const fenceLines = text.match(/^[ \t]{0,3}(?:```|~~~)/gm)?.length ?? 0;
	return fenceLines % 2 === 1 ? `${text}\n\`\`\`` : text;
}

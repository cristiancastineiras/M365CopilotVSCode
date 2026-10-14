/**
 * Bucle de un sub-agente y su limitador de concurrencia — la mitad de
 * `subagents.ts` (ver sus comentarios) que a propósito NO importa `vscode`,
 * igual que `toolCatalog.ts`/`toolProtocol.ts`: así se puede probar contra el
 * servidor BizChat simulado de `test/e2e.mts` sin host de VS Code. La
 * ejecución real de herramientas (`vscode.lm.invokeTool`) se inyecta desde
 * fuera como `executeTool`.
 */
import { createCopilotConversation, streamCopilotTurnWithRetry, type TurnImage } from './client';
import { looksLikeRemoteSandbox, ProseHold, toolFreeProblem, type ToolFreeProblem } from './giveUp';
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
import { condenseToolResult, toolResultBudgets } from './transcript';
import { t } from './i18n';

// --------------------------------------------------------- concurrency

/**
 * Cola FIFO con un máximo de ejecuciones simultáneas. Se usa dos veces: para
 * acotar cuántos sub-agentes corren a la vez, y como mutex (límite 1) para
 * serializar `m365_apply_edits`/`m365_run_command` entre sub-agentes
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
	/** Nombre de la herramienta, sólo cuando `kind === 'call'`. */
	readonly toolName?: string;
}

/** Por qué terminó el bucle — el participante de chat lo usa para decidir qué mostrar. */
export type ToolLoopOutcome = 'done' | 'stepLimit' | 'timeLimit' | 'error' | 'cancelled';

export interface ToolLoopParams {
	/**
	 * Texto que va entre las instrucciones del protocolo y el historial de
	 * pasos: la tarea en sí y cómo debe terminar. Es lo único que distingue a
	 * un sub-agente del participante `@m365` (ver `participant.ts`).
	 */
	readonly framing: string;
	readonly profile: CopilotProfile;
	readonly tone: string | null;
	readonly maxSteps: number;
	readonly signal: AbortSignal;
	/** Herramientas ofrecidas al bucle (normalmente las de workspace, nunca `m365_spawn_agents`). */
	readonly offeredTools: readonly OfferedTool[];
	readonly executeTool: SubagentToolExecutor;
	readonly onStep?: (info: SubagentStepInfo) => void;
	/**
	 * Recibe en vivo la prosa que el modelo escribe en cada paso (lo que el
	 * decodificador deja pasar: nunca los marcadores de herramienta). Sin esto
	 * el texto sólo se conoce al final, en `summary`.
	 */
	readonly onProse?: (delta: string) => void;
	/** Llamado justo antes de pedir cada paso al modelo. */
	readonly onStepStart?: (step: number) => void;
	readonly log?: (message: string) => void;
	/** Sólo para tests: apunta `streamCopilotTurn` a un servidor BizChat simulado. */
	readonly endpointBase?: string;
	/** Sustituye {@link MAX_TASK_WALL_CLOCK_MS} (los tests usan un techo más corto). */
	readonly maxWallClockMs?: number;
	/** Workspace de una sola carpeta: el catálogo omite `workspaceFolder`. */
	readonly singleRoot?: boolean;
	/** Imágenes que el usuario adjuntó: se envían al iniciar la conversación. */
	readonly images?: readonly TurnImage[];
	/** Una imagen que no se pudo adjuntar (el bucle sigue sin ella). */
	readonly onImageSkipped?: (reason: string) => void;
}

export interface ToolLoopResult {
	readonly ok: boolean;
	readonly outcome: ToolLoopOutcome;
	readonly summary: string;
	readonly steps: number;
}

export interface SubagentTaskParams extends Omit<ToolLoopParams, 'framing' | 'onProse' | 'onStepStart'> {
	readonly label: string;
	readonly task: string;
	/** System, shell, workspace root and date (environment.ts). */
	readonly environment?: string;
}

export interface SubagentTaskResult {
	readonly label: string;
	readonly ok: boolean;
	readonly summary: string;
	readonly steps: number;
}

const MAX_STEP_RESULT_CHARS = 4_000;
/** How many of the latest results keep {@link MAX_STEP_RESULT_CHARS}; older ones keep the next one. */
const FULL_STEP_RESULTS = 2;
const MAX_OLD_STEP_RESULT_CHARS = 800;
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
export const MAX_TASK_WALL_CLOCK_MS = 8 * 60_000;

/**
 * Bucle de un sub-agente: llama a BizChat, decodifica la respuesta y, si pide
 * una herramienta, la ejecuta con `executeTool` y reenvía el resultado en el
 * siguiente paso. Nunca lanza — cualquier fallo se devuelve como
 * `{ ok: false, summary }`, porque el llamador siempre quiere un informe de
 * texto, no una excepción que tumbe al resto de sub-agentes en curso.
 */
export async function runSubagentTask(params: SubagentTaskParams): Promise<SubagentTaskResult> {
	const { label, task, environment, ...loop } = params;
	const result = await runToolLoop({ ...loop, framing: buildSubagentFraming(task, environment) });
	return { label, ok: result.ok, summary: result.summary, steps: result.steps };
}

/**
 * El bucle de herramientas en sí, compartido por los sub-agentes y por el
 * participante de chat `@m365`. Igual que {@link runSubagentTask}, nunca
 * lanza: el resultado dice cómo terminó (`outcome`).
 */
export async function runToolLoop(params: ToolLoopParams): Promise<ToolLoopResult> {
	const { framing, profile, tone, maxSteps, signal, offeredTools, executeTool, endpointBase } = params;
	const log = params.log ?? (() => {});
	const onStep = params.onStep ?? (() => {});

	const catalog = buildToolCatalog(offeredTools, {
		includeEditorTools: false,
		duplicates: 'both',
		maxTools: offeredTools.length,
		singleRoot: params.singleRoot,
	});
	const steps: LoopStep[] = [];
	// One conversation per loop, never shared between concurrent sub-agents.
	const conversation = createCopilotConversation();
	let lastResultText = '';
	const startedAt = Date.now();
	const toolsOffered = catalog.callable.size > 0;
	// One forced retry per loop when a step gives up or works in M365's own
	// sandbox instead of calling a tool (giveUp.ts); its note goes after the prompt.
	let forced: ToolFreeProblem | null = null;
	let forcedNote = '';
	const wallClockBudgetMs = params.maxWallClockMs ?? MAX_TASK_WALL_CLOCK_MS;

	for (let step = 1; step <= maxSteps; step += 1) {
		if (signal.aborted) return { ok: false, outcome: 'cancelled', summary: t('subagent.cancelled'), steps: step - 1 };
		if (Date.now() - startedAt > wallClockBudgetMs) {
			const minutes = (wallClockBudgetMs / 60_000).toFixed(wallClockBudgetMs < 60_000 ? 2 : 0);
			const summary = t('subagent.timeLimit', minutes, clip(lastResultText, MAX_LAST_RESULT_PREVIEW_CHARS));
			onStep({ step, kind: 'limit', detail: summary });
			return { ok: false, outcome: 'timeLimit', summary, steps: step - 1 };
		}

		let call: DecodedToolCall | null = null;
		let text = '';
		let remoteWork = false;
		// While a step's reply is short and has not called a tool, its prose is
		// held back: a give-up is then retried before anyone sees it.
		const held = new ProseHold((delta) => params.onProse?.(delta));
		if (!toolsOffered || forced) held.flush();
		// The step's turn ends as soon as its tool call is complete: what the
		// model writes after it is ignored anyway, and can run for minutes.
		const finishTurn = new AbortController();
		const decoder = new ToolCallDecoder(
			catalog.callable,
			(delta) => {
				text += delta;
				held.push(delta);
			},
			(decoded) => {
				call = decoded;
				held.flush();
				finishTurn.abort();
			},
		);

		params.onStepStart?.(step);
		try {
			await streamCopilotTurnWithRetry({
				profile,
				prompt: conversation.isStartOfSession
					? buildLoopPrompt(framing, catalog, steps) + forcedNote
					: [
							compactBlocks(renderSteps(steps.slice(-1))),
							buildToolProtocolReminder(catalog, false),
							forcedNote,
						].filter(Boolean).join('\n\n'),
				conversation,
				tone,
				signal,
				stopSignal: finishTurn.signal,
				endpointBase,
				log,
				images: conversation.isStartOfSession ? params.images : undefined,
				callbacks: {
					onText: (delta) => decoder.push(delta),
					onRemoteWork: () => (remoteWork = true),
					onImageSkipped: params.onImageSkipped,
				},
			});
			conversation.isStartOfSession = false;
			decoder.finish();
		} catch (error) {
			held.flush();
			if (signal.aborted) return { ok: false, outcome: 'cancelled', summary: t('subagent.cancelled'), steps: step - 1 };
			const message = error instanceof Error ? error.message : String(error);
			onStep({ step, kind: 'error', detail: message });
			return { ok: false, outcome: 'error', summary: t('subagent.errorPrefix', message), steps: step - 1 };
		}

		if (!call) {
			// Gave up, or worked in its own sandbox: the same step once more, with
			// a note that says what is true (the dropped reply was never shown).
			const problem: ToolFreeProblem | null =
				toolsOffered && !forced && held.holding ? toolFreeProblem(text, remoteWork) : null;
			if (problem) {
				forced = problem;
				forcedNote = `\n\n${t(problem === 'sandbox' ? 'protocol.force.sandbox' : 'protocol.force.giveUp')}`;
				log(t('log.forcedRetry', problem));
				held.discard();
				step -= 1;
				continue;
			}
			held.flush();
			let summary = text.trim() || t('subagent.noText');
			if (toolsOffered && (remoteWork || looksLikeRemoteSandbox(text))) {
				const warning = t('turn.remoteSandbox');
				params.onProse?.(warning);
				summary += warning;
			}
			onStep({ step, kind: 'done', detail: summary });
			return { ok: true, outcome: 'done', summary, steps: step };
		}
		forcedNote = '';

		// `call` is mutated inside the decoder's closures; a type assertion
		// (rather than relying on narrowing across that boundary) is used here
		// on purpose — the `if (!call) return` above already proved it's set.
		const finishedCall = call as DecodedToolCall;
		onStep({
			step,
			kind: 'call',
			detail: `${finishedCall.name}(${safeJsonPreview(finishedCall.input)})`,
			toolName: finishedCall.name,
		});
		const resultText = await executeTool(finishedCall.name, finishedCall.input);
		lastResultText = resultText;
		steps.push({ call: renderCallBlock(step, finishedCall), name: finishedCall.name, result: resultText });
	}

	const summary = t('subagent.stepLimit', maxSteps, clip(lastResultText, MAX_LAST_RESULT_PREVIEW_CHARS));
	onStep({ step: maxSteps, kind: 'limit', detail: summary });
	return { ok: false, outcome: 'stepLimit', summary, steps: maxSteps };
}

function buildSubagentFraming(task: string, environment?: string): string {
	return [t('subagent.prompt.framing'), environment ?? '', t('subagent.prompt.task', task), t('subagent.prompt.finish')]
		.filter(Boolean)
		.join('\n\n');
}

/** One step of the loop: the call (already rendered) and what the tool returned. */
interface LoopStep {
	readonly call: string;
	readonly name: string;
	readonly result: string;
}

function buildLoopPrompt(framing: string, catalog: ToolCatalog, steps: readonly LoopStep[]): string {
	return [
		buildToolProtocolInstructions(catalog),
		framing,
		compactBlocks(renderSteps(steps)),
		buildToolProtocolReminder(catalog, false),
	]
		.filter(Boolean)
		.join('\n\n');
}

/**
 * The steps as prompt blocks. Like the chat transcript (transcript.ts): the
 * latest results whole (up to {@link MAX_STEP_RESULT_CHARS}), older ones
 * shortened, and an older result repeated word for word later on reduced to
 * a pointer — so ten steps still fit instead of the first ones falling out.
 */
function renderSteps(steps: readonly LoopStep[]): string[] {
	const budgets = toolResultBudgets(
		steps.map((step) => ({ name: step.name, text: step.result })),
		{ full: FULL_STEP_RESULTS, maxChars: MAX_STEP_RESULT_CHARS, maxOldChars: MAX_OLD_STEP_RESULT_CHARS },
	);
	return steps.flatMap((step, index) => {
		const budget = budgets[index]!; // one budget per step
		const text =
			budget.older || budget.duplicate ? condenseToolResult(step.result, budget) : clip(step.result, budget.maxChars);
		return [step.call, t('subagent.prompt.resultBlock', step.name, text)];
	});
}

/** Se queda con los pasos más recientes y avisa cuando descarta los más
 * antiguos por espacio. */
function compactBlocks(blocks: readonly string[]): string {
	if (blocks.length === 0) return '';
	const kept: string[] = [];
	let remaining = MAX_TRANSCRIPT_CHARS;
	let omitted = false;
	for (let index = blocks.length - 1; index >= 0; index -= 1) {
		const block = blocks[index]!;
		if (remaining <= 0) {
			omitted = true;
			break;
		}
		kept.unshift(clip(block, remaining));
		remaining -= block.length;
	}
	if (omitted) kept.unshift(t('subagent.prompt.omitted'));
	return kept.join('\n\n');
}

function renderCallBlock(step: number, call: DecodedToolCall): string {
	return t('subagent.prompt.callBlock', step, call.name, safeJsonPreview(call.input));
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
	return `${closeDanglingFence(text.slice(0, maxChars))}\n${t('subagent.clipNote', omitted)}`;
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

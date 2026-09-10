/**
 * Wrapper de sub-agentes: registra la herramienta `ms365_spawn_agents`, que
 * deja que el modelo principal delegue una o varias tareas acotadas en
 * sub-agentes que corren su propio ciclo de herramientas — en paralelo si son
 * varias — y sólo devuelven un resumen, sin gastar el contexto de la
 * conversación principal en el detalle de la exploración.
 *
 * El bucle en sí (`runSubagentTask`, `ConcurrencyLimiter`) vive en
 * `subagentCore.ts`, que a propósito NO importa `vscode` (mismo patrón que
 * `toolCatalog.ts`), para poder probarlo contra el servidor BizChat simulado
 * de `test/e2e.mts` sin host de VS Code. Este módulo es la mitad
 * dependiente de VS Code: registra la herramienta, lee ajustes, resuelve el
 * perfil y construye el `executeTool` real sobre `vscode.lm.invokeTool` —
 * reenviando el `toolInvocationToken` recibido, así Keep/Undo y la
 * confirmación de terminal aparecen igual que si las hubiera pedido el
 * agente principal (ver la nota de `LanguageModelToolInvocationOptions` en
 * `@types/vscode`: "a tool that invokes another tool during its invocation
 * can pass along the toolInvocationToken it received").
 */
import * as vscode from 'vscode';
import { boundedInteger, errorMessage } from '../tools/common';
import { findModel } from './models';
import { isTokenUsable } from './profile';
import type { ProfileStore } from './secrets';
import { ConcurrencyLimiter, clip, runSubagentTask, type SubagentStepInfo, type SubagentTaskResult } from './subagentCore';
import { M365_TOOL_NAMES, M365_WORKSPACE_TOOL_NAMES, type OfferedTool } from './toolProtocol';

const MAX_TASKS = 6;
const MAX_REPORT_CHARS = 20_000;
const MAX_TASK_SUMMARY_CHARS = 5_000;

/**
 * Únicas herramientas que tocan estado compartido — se serializan entre
 * sub-agentes. `ms365_generate_commit_message` entra aquí también: escribe en
 * el input box del panel Source Control, que es un único recurso compartido
 * por repo — sin serializar, dos sub-agentes generando a la vez podrían
 * pisarse ese mensaje.
 */
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
	M365_TOOL_NAMES.applyWorkspaceEdits,
	M365_TOOL_NAMES.runCommand,
	M365_TOOL_NAMES.generateCommitMessage,
	M365_TOOL_NAMES.gitCommit,
]);

interface SpawnAgentsInput {
	readonly tasks?: unknown;
}

interface NormalizedTask {
	readonly task: string;
	readonly label: string;
}

interface SubagentSettings {
	readonly enabled: boolean;
	readonly maxConcurrent: number;
	readonly maxSteps: number;
	readonly tone: string | null;
}

export function registerM365SubagentTools(store: ProfileStore, log: (message: string) => void): vscode.Disposable[] {
	return [
		vscode.lm.registerTool<SpawnAgentsInput>(M365_TOOL_NAMES.spawnAgents, {
			prepareInvocation: (options) => {
				const count = Array.isArray(options.input.tasks) ? options.input.tasks.length : 0;
				return {
					// Pone la expectativa de tiempo por delante: cada sub-agente hace su
					// propio ciclo de turnos con BizChat, así que esto puede tardar bastante
					// más que una respuesta normal — sin el aviso, un turno de varios
					// minutos con la única señal de progreso en una notificación aparte se
					// lee como que el chat se ha quedado colgado.
					invocationMessage:
						`Delegando ${count || 'varias'} sub-tarea(s) a sub-agentes de M365 Copilot ` +
						'(puede tardar varios minutos; el progreso se ve en las notificaciones)...',
				};
			},
			invoke: (options, token) => spawnAgents(store, options, token, log),
		}),
	];
}

async function spawnAgents(
	store: ProfileStore,
	options: vscode.LanguageModelToolInvocationOptions<SpawnAgentsInput>,
	token: vscode.CancellationToken,
	log: (message: string) => void,
): Promise<vscode.LanguageModelToolResult> {
	const settings = readSubagentSettings();
	if (!settings.enabled) {
		return textResult(
			'La delegación en sub-agentes está desactivada (ajuste ms365copilot.subagents.enabled). ' +
				'Actívala si quieres poder usar esta herramienta, o resuelve la tarea directamente.',
		);
	}

	const normalized = normalizeTasks(options.input.tasks);
	if (typeof normalized === 'string') return textResult(`Error: ${normalized}`);

	const profile = await store.get();
	if (!profile) {
		return textResult(
			'No hay token de M365 Copilot guardado. Pide al usuario que ejecute «M365 Copilot: Pegar perfil o token» antes de delegar tareas.',
		);
	}
	if (!isTokenUsable(profile)) {
		return textResult('El token de M365 Copilot ha caducado. Pide al usuario que lo vuelva a capturar y pegar.');
	}

	const offeredTools = collectSubagentOfferedTools();
	const runLimiter = new ConcurrencyLimiter(settings.maxConcurrent);
	const mutateLimiter = new ConcurrencyLimiter(1);

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `M365 Copilot: ${normalized.length} sub-agente(s)`,
			cancellable: true,
		},
		async (progress, progressToken) => {
			const controller = new AbortController();
			const abort = () => controller.abort();
			const listeners = [token.onCancellationRequested(abort), progressToken.onCancellationRequested(abort)];
			try {
				const executeTool = makeExecutor(options.toolInvocationToken, mutateLimiter, token);
				const results = await Promise.all(
					normalized.map((entry) =>
						runLimiter.run(() =>
							runSubagentTask({
								label: entry.label,
								task: entry.task,
								profile,
								tone: settings.tone,
								maxSteps: settings.maxSteps,
								signal: controller.signal,
								offeredTools,
								executeTool,
								log,
								onStep: (info) => {
									progress.report({ message: `${entry.label}: ${stepMessage(info)}` });
									log(`[sub-agente ${entry.label}] paso ${info.step} (${info.kind}): ${clip(info.detail, 200)}`);
								},
							}),
						),
					),
				);
				return textResult(formatReport(results));
			} finally {
				for (const listener of listeners) listener.dispose();
			}
		},
	);
}

/** El único punto que llama a `vscode.lm.invokeTool`: reenvía el
 * `toolInvocationToken` recibido para que Keep/Undo y la confirmación de
 * terminal aparezcan igual que si las hubiera pedido el agente principal. */
function makeExecutor(
	toolInvocationToken: vscode.ChatParticipantToolToken | undefined,
	mutateLimiter: ConcurrencyLimiter,
	token: vscode.CancellationToken,
) {
	return async (name: string, input: Record<string, unknown>): Promise<string> => {
		// `invokeTool` returns a `Thenable`, not a real `Promise` — `ConcurrencyLimiter.run` needs the latter.
		const invoke = () => Promise.resolve(vscode.lm.invokeTool(name, { input, toolInvocationToken }, token));
		try {
			const result = MUTATING_TOOLS.has(name) ? await mutateLimiter.run(invoke) : await invoke();
			return toolResultToText(result);
		} catch (error) {
			return `Error de herramienta: ${errorMessage(error)}`;
		}
	};
}

function toolResultToText(result: vscode.LanguageModelToolResult): string {
	const parts: string[] = [];
	for (const part of result.content) {
		parts.push(part instanceof vscode.LanguageModelTextPart ? part.value : '[contenido no textual omitido]');
	}
	const text = parts.join('\n').trim();
	return text || '(sin contenido)';
}

function collectSubagentOfferedTools(): OfferedTool[] {
	const wanted: ReadonlySet<string> = new Set(M365_WORKSPACE_TOOL_NAMES);
	return vscode.lm.tools.filter((tool) => wanted.has(tool.name));
}

function normalizeTasks(raw: unknown): NormalizedTask[] | string {
	if (!Array.isArray(raw) || raw.length === 0) return 'tasks debe ser un array con al menos una tarea.';
	if (raw.length > MAX_TASKS) return `tasks no puede tener más de ${MAX_TASKS} tareas.`;

	const out: NormalizedTask[] = [];
	for (const [index, item] of raw.entries()) {
		if (!item || typeof item !== 'object') return `La tarea #${index + 1} debe ser un objeto.`;
		const record = item as Record<string, unknown>;
		const task = typeof record.task === 'string' ? record.task.trim() : '';
		if (!task) return `La tarea #${index + 1} necesita un campo "task" con la descripción de lo que debe hacer.`;
		const label =
			typeof record.label === 'string' && record.label.trim() ? record.label.trim() : `Tarea ${index + 1}`;
		out.push({ task, label });
	}
	return out;
}

function readSubagentSettings(): SubagentSettings {
	const config = vscode.workspace.getConfiguration('ms365copilot.subagents');
	const modelId = config.get<string>('model', 'ms365-copilot-auto');
	return {
		enabled: config.get<boolean>('enabled', true),
		maxConcurrent: boundedInteger(config.get<number>('maxConcurrent'), 3, 1, 6),
		maxSteps: boundedInteger(config.get<number>('maxSteps'), 6, 1, 12),
		tone: findModel(modelId)?.tone ?? null,
	};
}

function stepMessage(info: SubagentStepInfo): string {
	switch (info.kind) {
		case 'call':
			return `paso ${info.step} — ${info.detail}`;
		case 'done':
			return 'completado';
		case 'limit':
			// Cubre tanto el límite de pasos como el de tiempo total (ver
			// MAX_TASK_WALL_CLOCK_MS en subagentCore.ts) — el motivo exacto ya va en
			// info.detail, así que aquí basta con un rótulo genérico.
			return 'límite alcanzado';
		case 'error':
			return `error: ${info.detail}`;
	}
}

function formatReport(results: readonly SubagentTaskResult[]): string {
	const sections = results.map((result) => {
		const header = result.ok ? `### ${result.label}` : `### ⚠️ ${result.label} (incompleto)`;
		return `${header}\n${clip(result.summary, MAX_TASK_SUMMARY_CHARS)}`;
	});
	const incomplete = results.filter((result) => !result.ok);
	// Instrucción al agente PRINCIPAL, no al usuario: sin esto, lo más fácil es
	// que pegue las secciones tal cual (con sus cabeceras ### y separadores ---)
	// en vez de responder con una única respuesta coherente — que es exactamente
	// el "resultado confuso" que se ve desde el chat cuando hay 2+ tareas.
	const guidance = [
		`Resultado de ${results.length} sub-tarea(s) delegada(s). Sintetiza esto en UNA respuesta coherente para el ` +
			'usuario — no pegues las secciones ### tal cual ni menciones que venían de sub-agentes salvo que aporte algo.',
		...(incomplete.length > 0
			? [
					`${incomplete.length} de ellas quedó(ron) incompleta(s) (⚠️): dilo brevemente y decide si merece la ` +
						'pena reintentarla con menos alcance o informar al usuario del límite alcanzado.',
				]
			: []),
	].join(' ');
	return clip([guidance, sections.join('\n\n---\n\n')].join('\n\n'), MAX_REPORT_CHARS);
}

function textResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

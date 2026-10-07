/**
 * Wrapper de sub-agentes: registra la herramienta `m365_spawn_agents`, que
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
import { t } from './i18n';

const MAX_TASKS = 6;
const MAX_REPORT_CHARS = 20_000;
const MAX_TASK_SUMMARY_CHARS = 5_000;

/**
 * Únicas herramientas que tocan estado compartido — se serializan entre
 * sub-agentes. `m365_generate_commit_message` entra aquí también: escribe en
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
					invocationMessage: t('subagent.invocation', count || t('subagent.invocation.several')),
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
		return textResult(t('subagent.disabled'));
	}

	const normalized = normalizeTasks(options.input.tasks);
	if (typeof normalized === 'string') return textResult(t('subagent.errorPrefix', normalized));

	const profile = await store.get();
	if (!profile) {
		return textResult(t('subagent.noToken'));
	}
	if (!isTokenUsable(profile)) {
		return textResult(t('subagent.tokenExpired'));
	}

	const offeredTools = collectSubagentOfferedTools();
	const runLimiter = new ConcurrencyLimiter(settings.maxConcurrent);
	const mutateLimiter = new ConcurrencyLimiter(1);

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: t('subagent.progressTitle', normalized.length),
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
									log(t('log.subagentStep', entry.label, info.step, info.kind, clip(info.detail, 200)));
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
			return t('tool.error', errorMessage(error));
		}
	};
}

/** Flattens a tool result to the text the model reads (shared with participant.ts). */
export function toolResultToText(result: vscode.LanguageModelToolResult): string {
	const parts: string[] = [];
	for (const part of result.content) {
		parts.push(part instanceof vscode.LanguageModelTextPart ? part.value : t('subagent.nonText'));
	}
	const text = parts.join('\n').trim();
	return text || t('subagent.noContent');
}

function collectSubagentOfferedTools(): OfferedTool[] {
	const wanted: ReadonlySet<string> = new Set(M365_WORKSPACE_TOOL_NAMES);
	return vscode.lm.tools.filter((tool) => wanted.has(tool.name));
}

function normalizeTasks(raw: unknown): NormalizedTask[] | string {
	if (!Array.isArray(raw) || raw.length === 0) return t('subagent.tasks.notArray');
	if (raw.length > MAX_TASKS) return t('subagent.tasks.tooMany', MAX_TASKS);

	const out: NormalizedTask[] = [];
	for (const [index, item] of raw.entries()) {
		if (!item || typeof item !== 'object') return t('subagent.tasks.notObject', index + 1);
		const record = item as Record<string, unknown>;
		const task = typeof record.task === 'string' ? record.task.trim() : '';
		if (!task) return t('subagent.tasks.noTask', index + 1);
		const label =
			typeof record.label === 'string' && record.label.trim()
				? record.label.trim()
				: t('subagent.tasks.defaultLabel', index + 1);
		out.push({ task, label });
	}
	return out;
}

function readSubagentSettings(): SubagentSettings {
	const config = vscode.workspace.getConfiguration('m365copilot.subagents');
	const modelId = config.get<string>('model', 'm365-copilot-auto');
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
			return t('subagent.step.call', info.step, info.detail);
		case 'done':
			return t('subagent.step.done');
		case 'limit':
			// Cubre tanto el límite de pasos como el de tiempo total (ver
			// MAX_TASK_WALL_CLOCK_MS en subagentCore.ts) — el motivo exacto ya va en
			// info.detail, así que aquí basta con un rótulo genérico.
			return t('subagent.step.limit');
		case 'error':
			return t('subagent.step.error', info.detail);
	}
}

function formatReport(results: readonly SubagentTaskResult[]): string {
	const sections = results.map((result) => {
		const header = result.ok ? `### ${result.label}` : t('subagent.report.incomplete', result.label);
		return `${header}\n${clip(result.summary, MAX_TASK_SUMMARY_CHARS)}`;
	});
	const incomplete = results.filter((result) => !result.ok);
	// Instrucción al agente PRINCIPAL, no al usuario: sin esto, lo más fácil es
	// que pegue las secciones tal cual (con sus cabeceras ### y separadores ---)
	// en vez de responder con una única respuesta coherente — que es exactamente
	// el "resultado confuso" que se ve desde el chat cuando hay 2+ tareas.
	const guidance = [
		t('subagent.report.guidance', results.length),
		...(incomplete.length > 0 ? [t('subagent.report.guidanceIncomplete', incomplete.length)] : []),
	].join(' ');
	return clip([guidance, sections.join('\n\n---\n\n')].join('\n\n'), MAX_REPORT_CHARS);
}

function textResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

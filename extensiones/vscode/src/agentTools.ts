import * as vscode from 'vscode';
import { listWorkspaceFiles, searchWorkspaceText, type ListFilesInput, type SearchTextInput } from '../tools/listFiles';
import { readWorkspaceFile, type ReadFileInput } from '../tools/readFile';
import { WorkspaceEditManager, type ApplyWorkspaceEditsInput } from '../tools/writeFile';
import { getWorkspaceDiagnostics, type GetDiagnosticsInput } from '../tools/diagnostics';
import { getGitInfo, type GitInfoInput } from '../tools/git';
import {
	registerTerminalCleanup,
	runWorkspaceCommand,
	looksRisky,
	type RunCommandInput,
} from '../tools/terminal';
import { searchDeepWiki, type DeepWikiSearchInput } from '../tools/deepwiki';
import { errorMessage } from '../tools/common';
import { M365_TOOL_NAMES } from './toolProtocol';

export function registerM365WorkspaceTools(manager: WorkspaceEditManager): vscode.Disposable[] {
	return [
		registerTerminalCleanup(),
		vscode.lm.registerTool<ListFilesInput>(M365_TOOL_NAMES.listFiles, {
			prepareInvocation: (options) => ({
				invocationMessage: `Listando ${options.input.path || 'el workspace'}...`,
			}),
			invoke: (options, token) => toolResult(() => listWorkspaceFiles(options.input, token)),
		}),
		vscode.lm.registerTool<SearchTextInput>(M365_TOOL_NAMES.searchText, {
			prepareInvocation: (options) => ({
				invocationMessage: `Buscando «${options.input.query}»...`,
			}),
			invoke: (options, token) => toolResult(() => searchWorkspaceText(options.input, token)),
		}),
		vscode.lm.registerTool<ReadFileInput>(M365_TOOL_NAMES.readFile, {
			prepareInvocation: (options) => ({
				invocationMessage: `Leyendo ${options.input.path}...`,
			}),
			invoke: (options, token) => toolResult(() => readWorkspaceFile(options.input, token)),
		}),
		vscode.lm.registerTool<ApplyWorkspaceEditsInput>(M365_TOOL_NAMES.applyWorkspaceEdits, {
			prepareInvocation: (options) => ({
				invocationMessage: `Preparando ${Array.isArray(options.input.edits) ? options.input.edits.length : 0} edición(es)...`,
				confirmationMessages: {
					title: 'Aplicar cambios de M365 Copilot',
					message:
						'Los cambios se aplicarán en el editor, resaltados y SIN guardar en disco. ' +
						'Encima de cada cambio tendrás «Keep» para aceptarlo y «Undo» para revertirlo, además del diff.',
				},
			}),
			invoke: (options, token) => toolResult(() => manager.stageEdits(options.input, token)),
		}),
		vscode.lm.registerTool<GetDiagnosticsInput>(M365_TOOL_NAMES.getDiagnostics, {
			prepareInvocation: (options) => ({
				invocationMessage: `Leyendo diagnósticos${options.input.path ? ` de ${options.input.path}` : ' del workspace'}...`,
			}),
			invoke: (options, token) => toolResult(() => getWorkspaceDiagnostics(options.input, token)),
		}),
		vscode.lm.registerTool<GitInfoInput>(M365_TOOL_NAMES.gitInfo, {
			prepareInvocation: (options) => ({
				invocationMessage: `Consultando git ${options.input.action ?? ''}...`,
			}),
			invoke: (options, token) => toolResult(() => getGitInfo(options.input, token)),
		}),
		vscode.lm.registerTool<RunCommandInput>(M365_TOOL_NAMES.runCommand, {
			prepareInvocation: (options) => {
				const command = typeof options.input.command === 'string' ? options.input.command : '';
				const warning = looksRisky(command)
					? '\n\n⚠️ **Este comando coincide con un patrón potencialmente destructivo** (borrado masivo, push forzado, formateo del disco...). Revísalo con cuidado antes de continuar.'
					: '';
				return {
					invocationMessage: `Ejecutando: ${command}`,
					confirmationMessages: {
						title: 'Ejecutar comando de M365 Copilot',
						message: new vscode.MarkdownString(
							'M365 Copilot quiere ejecutar este comando en tu workspace:\n\n' +
								`\`\`\`\n${command}\n\`\`\`\n\n` +
								'Se ejecuta con tus propios permisos de usuario y su salida (stdout/stderr) se envía al modelo en la nube.' +
								warning,
						),
					},
				};
			},
			invoke: (options, token) => toolResult(() => runWorkspaceCommand(options.input, token)),
		}),
		vscode.lm.registerTool<DeepWikiSearchInput>(M365_TOOL_NAMES.deepwikiSearch, {
			prepareInvocation: (options) => ({
				invocationMessage: `Consultando DeepWiki (${options.input.repo ?? '?'})...`,
			}),
			invoke: (options, token) => toolResult(() => searchDeepWiki(options.input, token)),
		}),
	];
}

async function toolResult(run: () => Promise<string>): Promise<vscode.LanguageModelToolResult> {
	try {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(await run())]);
	} catch (error) {
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(`Error de herramienta: ${errorMessage(error)}`),
		]);
	}
}
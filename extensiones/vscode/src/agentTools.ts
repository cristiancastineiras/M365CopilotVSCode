import * as vscode from 'vscode';
import { listWorkspaceFiles, searchWorkspaceText, type ListFilesInput, type SearchTextInput } from '../tools/listFiles';
import { readWorkspaceFile, type ReadFileInput } from '../tools/readFile';
import { WorkspaceEditManager, type ApplyWorkspaceEditsInput } from '../tools/writeFile';
import { getWorkspaceDiagnostics, type GetDiagnosticsInput } from '../tools/diagnostics';
import { getGitInfo, type GitInfoInput } from '../tools/git';
import { generateCommitMessage, type GenerateCommitMessageInput } from '../tools/gitCommitMessage';
import { commitWorkspace, type GitCommitInput } from '../tools/gitCommit';
import {
	registerTerminalCleanup,
	runWorkspaceCommand,
	looksRisky,
	type RunCommandInput,
} from '../tools/terminal';
import { errorMessage } from '../tools/common';
import { M365_TOOL_NAMES } from './toolProtocol';
import { t } from './i18n';

export function registerM365WorkspaceTools(manager: WorkspaceEditManager): vscode.Disposable[] {
	return [
		registerTerminalCleanup(),
		vscode.lm.registerTool<ListFilesInput>(M365_TOOL_NAMES.listFiles, {
			prepareInvocation: (options) => ({
				invocationMessage: t('tool.listing', options.input.path || t('tool.listing.workspace')),
			}),
			invoke: (options, token) => toolResult(() => listWorkspaceFiles(options.input, token)),
		}),
		vscode.lm.registerTool<SearchTextInput>(M365_TOOL_NAMES.searchText, {
			prepareInvocation: (options) => ({
				invocationMessage: t('tool.searching', options.input.query),
			}),
			invoke: (options, token) => toolResult(() => searchWorkspaceText(options.input, token)),
		}),
		vscode.lm.registerTool<ReadFileInput>(M365_TOOL_NAMES.readFile, {
			prepareInvocation: (options) => ({
				invocationMessage: t('tool.reading', options.input.path),
			}),
			invoke: (options, token) => toolResult(() => readWorkspaceFile(options.input, token)),
		}),
		vscode.lm.registerTool<ApplyWorkspaceEditsInput>(M365_TOOL_NAMES.applyWorkspaceEdits, {
			prepareInvocation: (options) => ({
				invocationMessage: t('tool.preparingEdits', Array.isArray(options.input.edits) ? options.input.edits.length : 0),
				confirmationMessages: {
					title: t('tool.edits.confirmTitle'),
					message: t('tool.edits.confirmMessage'),
				},
			}),
			invoke: (options, token) => toolResult(() => manager.stageEdits(options.input, token)),
		}),
		vscode.lm.registerTool<GetDiagnosticsInput>(M365_TOOL_NAMES.getDiagnostics, {
			prepareInvocation: (options) => ({
				invocationMessage: options.input.path
					? t('tool.diagnostics.file', options.input.path)
					: t('tool.diagnostics.workspace'),
			}),
			invoke: (options, token) => toolResult(() => getWorkspaceDiagnostics(options.input, token)),
		}),
		vscode.lm.registerTool<GitInfoInput>(M365_TOOL_NAMES.gitInfo, {
			prepareInvocation: (options) => ({
				invocationMessage: t('tool.git', options.input.action ?? ''),
			}),
			invoke: (options, token) => toolResult(() => getGitInfo(options.input, token)),
		}),
		vscode.lm.registerTool<GenerateCommitMessageInput>(M365_TOOL_NAMES.generateCommitMessage, {
			prepareInvocation: () => ({
				invocationMessage: t('tool.generatingCommit'),
			}),
			invoke: (options, token) => toolResult(() => generateCommitMessage(options.input, token)),
		}),
		vscode.lm.registerTool<GitCommitInput>(M365_TOOL_NAMES.gitCommit, {
			prepareInvocation: (options) => {
				const message = typeof options.input.message === 'string' ? options.input.message : '';
				const subject = message.split('\n', 1)[0] || t('tool.commit.noMessage');
				const staging = options.input.stageAll
					? t('tool.commit.stageAll')
					: Array.isArray(options.input.paths) && options.input.paths.length > 0
						? t('tool.commit.stagePaths', options.input.paths.join(', '))
						: t('tool.commit.stageNone');
				return {
					invocationMessage: t('tool.commit.invocation', subject),
					confirmationMessages: {
						title: t('tool.commit.confirmTitle'),
						message: new vscode.MarkdownString(t('tool.commit.confirmMessage', message, staging)),
					},
				};
			},
			invoke: (options, token) => toolResult(() => commitWorkspace(options.input, token)),
		}),
		vscode.lm.registerTool<RunCommandInput>(M365_TOOL_NAMES.runCommand, {
			prepareInvocation: (options) => {
				const command = typeof options.input.command === 'string' ? options.input.command : '';
				const warning = looksRisky(command) ? t('tool.run.risky') : '';
				return {
					invocationMessage: t('tool.run.invocation', command),
					confirmationMessages: {
						title: t('tool.run.confirmTitle'),
						message: new vscode.MarkdownString(t('tool.run.confirmMessage', command, warning)),
					},
				};
			},
			invoke: (options, token) => toolResult(() => runWorkspaceCommand(options.input, token)),
		}),
	];
}

export async function toolResult(run: () => Promise<string>): Promise<vscode.LanguageModelToolResult> {
	try {
		return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(await run())]);
	} catch (error) {
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart(t('tool.error', errorMessage(error))),
		]);
	}
}
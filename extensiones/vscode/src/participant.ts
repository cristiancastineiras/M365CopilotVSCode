/**
 * The `@m365` chat participant: `@m365 /explain`, `/fix`, `/doc`, `/tests`
 * or a free-form request, always answered by Microsoft 365 Copilot — unlike
 * the model picker, which answers with whatever model is selected there.
 *
 * It is also where the editor integration lands: the context-menu entries,
 * the lightbulb actions and the walkthrough all open the chat with an
 * `@m365 /command` query, and the code they were invoked on arrives through
 * {@link EditorHandoff}.
 *
 * Each request runs the same tool loop as the sub-agents (`runToolLoop` in
 * subagentCore.ts) over this extension's workspace tools, streaming the
 * model's prose into the chat as it arrives. Tools are invoked with the
 * request's `toolInvocationToken`, so edits get the usual Keep/Undo review
 * and commands/commits their confirmation dialogs, inline in the chat.
 */
import * as vscode from 'vscode';
import { codeContextFromLocation, captureCodeContext, currentTextEditor, type CodeContext } from './editorContext';
import type { EditorHandoff } from './editorActions';
import { MarkdownStreamFormatter } from './markdown';
import { findModel } from './models';
import {
	asParticipantCommand,
	buildParticipantFraming,
	maxStepsForCommand,
	toolsForCommand,
	type HistoryTurn,
	type ParticipantCommand,
	type PromptTerminalRun,
} from './participantPrompts';
import { isTokenUsable } from './profile';
import type { ProfileStore } from './secrets';
import { MAX_TASK_WALL_CLOCK_MS, runToolLoop } from './subagentCore';
import { toolResultToText } from './subagents';
import type { WorkspaceEditManager } from '../tools/writeFile';
import type { TerminalHistory } from './terminalHistory';
import type { ContextOptions } from './projectIndex';
import { errorMessage, relativePathForUri } from '../tools/common';
import { t, type MessageKey } from './i18n';

export const PARTICIPANT_ID = 'm365copilot.m365';
const VENDOR = 'm365copilot';

interface ParticipantDeps {
	readonly store: ProfileStore;
	readonly handoff: EditorHandoff;
	readonly edits: WorkspaceEditManager;
	readonly terminals: TerminalHistory;
	readonly extensionUri: vscode.Uri;
	readonly log: (message: string) => void;
	/** The local project index's context for a request (projectIndex.ts). */
	readonly projectContext?: (message: string, options: ContextOptions) => Promise<string | undefined>;
}

interface ParticipantResultMetadata {
	readonly command?: ParticipantCommand;
}

export function registerChatParticipant(deps: ParticipantDeps): vscode.Disposable {
	const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, (request, context, stream, token) =>
		handleRequest(deps, request, context, stream, token),
	);
	participant.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'logo', 'm365-vscode.png');
	participant.followupProvider = { provideFollowups: (result) => followupsFor(result) };
	return participant;
}

async function handleRequest(
	deps: ParticipantDeps,
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
	const command = asParticipantCommand(request.command);
	const metadata: ParticipantResultMetadata = { command };

	const profile = await deps.store.get();
	if (!profile || !isTokenUsable(profile)) {
		deps.log(t('log.participantNoToken', command ?? '-'));
		stream.markdown(t(profile ? 'participant.tokenExpired' : 'participant.noToken'));
		stream.button({ command: 'm365copilot.pasteProfile', title: t('participant.button.paste') });
		return { metadata };
	}

	// /terminal is about the last command of the active terminal, not about code.
	let terminal: PromptTerminalRun | undefined;
	if (command === 'terminal') {
		terminal = deps.terminals.lastRun(vscode.window.activeTerminal);
		if (!terminal) {
			stream.markdown(t('participant.noTerminalRun'));
			return { metadata };
		}
	}
	const { code, attachedPaths } =
		command === 'terminal'
			? { code: undefined, attachedPaths: [] }
			: await resolveCode(deps.handoff, command, request.references);
	if (command && command !== 'terminal' && !code) {
		stream.markdown(t('participant.noContext'));
		return { metadata };
	}
	if (code) stream.reference(new vscode.Location(code.uri, code.range));

	// Answer with the M365 model picked in the chat, if one is; any other
	// vendor's model falls back to Auto — this participant always talks to M365.
	const tone = request.model.vendor === VENDOR ? (findModel(request.model.id)?.tone ?? null) : null;
	const contextLabel = terminal ? `$ ${terminal.commandLine}` : code ? code.relativePath : '-';
	deps.log(t('log.participantRequest', command ?? '-', tone ?? 'magic', contextLabel));

	// What to look up in the project index: the request, plus the code or the
	// command output it is about — whose own lines are left out, since they are
	// in the prompt already. What comes back is the code around it: callers,
	// definitions it uses, related files.
	const lookup = [
		request.prompt,
		code ? code.text.slice(0, 1_500) : '',
		terminal ? `${terminal.commandLine}\n${terminal.output.slice(-1_500)}` : '',
	].join('\n');
	let projectContext: string | undefined;
	try {
		projectContext = await deps.projectContext?.(lookup, {
			activeUri: code?.uri ?? currentTextEditor()?.document.uri,
			...(code ? { exclude: { uri: code.uri, startLine: code.startLine, endLine: code.endLine } } : {}),
		});
	} catch (error) {
		deps.log(t('log.indexContextFailed', errorMessage(error)));
	}

	const framing = buildParticipantFraming({
		command,
		request: request.prompt,
		code,
		terminal,
		history: historyOf(context),
		attachedPaths,
		projectContext,
	});
	const wanted = new Set(toolsForCommand(command));
	const offeredTools = vscode.lm.tools.filter((tool) => wanted.has(tool.name));

	const controller = new AbortController();
	const cancel = token.onCancellationRequested(() => controller.abort());
	let markdown = new MarkdownStreamFormatter();
	const flush = () => {
		const rest = markdown.finish();
		if (rest) stream.markdown(rest);
		markdown = new MarkdownStreamFormatter();
	};

	stream.progress(t('participant.progress.thinking'));
	try {
		const result = await runToolLoop({
			framing,
			profile,
			tone,
			maxSteps: maxStepsForCommand(command),
			signal: controller.signal,
			offeredTools,
			log: deps.log,
			onProse: (delta) => {
				const formatted = markdown.push(delta);
				if (formatted) stream.markdown(formatted);
			},
			// Each step is a separate model turn: close the previous one's
			// Markdown so an unfinished paragraph never bleeds into the next.
			onStepStart: (step) => {
				if (step > 1) flush();
			},
			onStep: (info) => {
				if (info.kind === 'call' && info.toolName) {
					stream.progress(t('participant.progress.tool', info.toolName));
				}
			},
			executeTool: async (name, input) => {
				try {
					const result = await vscode.lm.invokeTool(
						name,
						{ input, toolInvocationToken: request.toolInvocationToken },
						token,
					);
					return toolResultToText(result);
				} catch (error) {
					return t('tool.error', errorMessage(error));
				}
			},
		});
		flush();

		switch (result.outcome) {
			case 'error':
				return { metadata, errorDetails: { message: t('participant.error', result.summary) } };
			case 'stepLimit':
				stream.markdown(`\n\n${t('participant.stepLimit', result.steps)}`);
				break;
			case 'timeLimit':
				stream.markdown(`\n\n${t('participant.timeLimit', Math.round(MAX_TASK_WALL_CLOCK_MS / 60_000))}`);
				break;
			default:
				break;
		}
		if (deps.edits.pendingCount > 0) {
			stream.button({ command: 'm365copilot.reviewPendingEdits', title: t('participant.button.review') });
		}
		return { metadata };
	} finally {
		cancel.dispose();
	}
}

/**
 * Where the code comes from, in order: the editor action that opened the
 * chat (hand-off), a `#selection`/`#file` the user attached, and — for the
 * slash commands, or a free-form request with something selected — the
 * active editor. Other attachments are listed so the model can read them.
 */
async function resolveCode(
	handoff: EditorHandoff,
	command: ParticipantCommand | undefined,
	references: readonly vscode.ChatPromptReference[],
): Promise<{ code: CodeContext | undefined; attachedPaths: string[] }> {
	let code = handoff.take(command);
	const attached = new Set<string>();

	for (const reference of references) {
		const value = reference.value;
		if (!(value instanceof vscode.Location) && !(value instanceof vscode.Uri)) continue;
		// VS Code adds the current file/viewport on its own ("implicit" context).
		// Only an implicit *selection* is meaningful here; the file or viewport
		// is better served by the active-editor capture below, which narrows it
		// to the function at the cursor — and none of them is an attachment.
		const implicit = reference.id.startsWith('vscode.implicit');
		if (implicit && !/selection/i.test(reference.id)) continue;
		if (!code) {
			try {
				code = await codeContextFromLocation(value);
				continue;
			} catch {
				/* not a text document (folder, image…): just mention it */
			}
		}
		if (!implicit) attached.add(relativePathForUri(value instanceof vscode.Uri ? value : value.uri));
	}

	if (!code) {
		const editor = currentTextEditor();
		if (editor && (command || !editor.selection.isEmpty)) {
			code = await captureCodeContext(editor.document, { selection: editor.selection });
		}
	}
	if (code) attached.delete(code.relativePath);
	return { code, attachedPaths: [...attached] };
}

/** This participant's earlier turns in the conversation, as plain text. */
function historyOf(context: vscode.ChatContext): HistoryTurn[] {
	const turns: HistoryTurn[] = [];
	for (const turn of context.history) {
		if (turn instanceof vscode.ChatRequestTurn) {
			turns.push({ role: 'user', text: `${turn.command ? `/${turn.command} ` : ''}${turn.prompt}` });
		} else if (turn instanceof vscode.ChatResponseTurn) {
			const text = turn.response
				.map((part) => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ''))
				.join('');
			turns.push({ role: 'assistant', text });
		}
	}
	return turns;
}

function followupsFor(result: vscode.ChatResult): vscode.ChatFollowup[] {
	const command = (result.metadata as ParticipantResultMetadata | undefined)?.command;
	if (result.errorDetails || !command) return [];
	return FOLLOWUPS[command].map((followup) => ({ prompt: t(FOLLOWUP_LABELS[followup]), command: followup }));
}

/** What naturally comes next after each command. */
const FOLLOWUPS: Readonly<Record<ParticipantCommand, readonly ParticipantCommand[]>> = {
	explain: ['doc', 'tests'],
	fix: ['tests'],
	doc: ['tests'],
	tests: [],
	terminal: [],
};

const FOLLOWUP_LABELS: Readonly<Record<ParticipantCommand, MessageKey>> = {
	explain: 'participant.followup.explain',
	fix: 'participant.followup.fix',
	doc: 'participant.followup.doc',
	tests: 'participant.followup.tests',
	terminal: 'participant.followup.terminal',
};

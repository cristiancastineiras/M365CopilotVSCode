import * as vscode from 'vscode';
import { captureCodeContext, currentTextEditor, type CodeContext } from './editorContext';
import type { ParticipantCommand } from './participantPrompts';
import type { TerminalHistory } from './terminalHistory';
import { errorMessage } from '../tools/common';
import { t } from './i18n';

/** The `name` of the chat participant in package.json — what users type after `@`. */
export const PARTICIPANT_NAME = 'm365';

/** A hand-off older than this is stale: the user did something else in between. */
const HANDOFF_TTL_MS = 60_000;
const MAX_DIAGNOSTIC_TITLE_CHARS = 60;

/**
 * Passes the code an editor action was invoked on to the `@m365` participant.
 *
 * The action opens the chat with `@m365 /explain` (or `/fix`, …) as the query.
 * By the time the participant runs, focus is in the chat view and the
 * selection the user right-clicked may be gone or ambiguous, so the action
 * captures the context first and parks it here; the participant takes it if
 * it is fresh and for the same command, and otherwise falls back to reading
 * the editor itself.
 */
export class EditorHandoff {
	private pending: { command: ParticipantCommand; context: CodeContext; at: number } | undefined;

	set(command: ParticipantCommand, context: CodeContext): void {
		this.pending = { command, context, at: Date.now() };
	}

	take(command: ParticipantCommand | undefined): CodeContext | undefined {
		const pending = this.pending;
		this.pending = undefined;
		if (!pending || pending.command !== command || Date.now() - pending.at > HANDOFF_TTL_MS) return undefined;
		return pending.context;
	}
}

const ACTION_COMMANDS: readonly (readonly [string, ParticipantCommand])[] = [
	['m365copilot.explainCode', 'explain'],
	['m365copilot.fixCode', 'fix'],
	['m365copilot.documentCode', 'doc'],
	['m365copilot.generateTests', 'tests'],
];

export function registerEditorActions(handoff: EditorHandoff, terminals: TerminalHistory): vscode.Disposable[] {
	const selector: vscode.DocumentSelector = [
		{ scheme: 'file' },
		{ scheme: 'untitled' },
		{ scheme: 'vscode-remote' },
		{ scheme: 'vscode-vfs' },
	];
	return [
		...ACTION_COMMANDS.map(([id, command]) =>
			vscode.commands.registerCommand(id, (uri?: vscode.Uri, range?: vscode.Range) =>
				runEditorAction(handoff, command, uri, range),
			),
		),
		vscode.commands.registerCommand('m365copilot.askAboutCode', () => askAboutCode()),
		vscode.commands.registerCommand('m365copilot.explainTerminal', () => explainTerminal(terminals)),
		vscode.commands.registerCommand('m365copilot.openChat', () => openChat(`@${PARTICIPANT_NAME} `, true)),
		vscode.languages.registerCodeActionsProvider(selector, new M365CodeActionProvider(), {
			providedCodeActionKinds: M365CodeActionProvider.kinds,
		}),
	];
}

/**
 * Explain / fix / document / test the code at hand. `uri` + `range` come from
 * a code action (the diagnostic or selection it was offered for); from the
 * context menu or the palette they are absent and the active editor is used.
 */
async function runEditorAction(
	handoff: EditorHandoff,
	command: ParticipantCommand,
	uri?: vscode.Uri,
	range?: vscode.Range,
): Promise<void> {
	const editor = currentTextEditor();
	let context: CodeContext;
	if (uri instanceof vscode.Uri) {
		const document = await vscode.workspace.openTextDocument(uri);
		const given = range instanceof vscode.Range ? range : undefined;
		// A diagnostic's range (fix) is widened to the code around it; a
		// selection the user made (explain/doc) is taken exactly as selected.
		context = await captureCodeContext(
			document,
			command === 'fix' || !given ? { range: given } : { selection: new vscode.Selection(given.start, given.end) },
		);
	} else if (editor) {
		context = await captureCodeContext(editor.document, { selection: editor.selection });
	} else {
		void vscode.window.showWarningMessage(t('actions.noEditor'));
		return;
	}
	handoff.set(command, context);
	await openChat(`@${PARTICIPANT_NAME} /${command}`, false);
}

/** Free-form question about the selected code: asked first, then sent to `@m365`. */
async function askAboutCode(): Promise<void> {
	if (!currentTextEditor()) {
		void vscode.window.showWarningMessage(t('actions.noEditor'));
		return;
	}
	const question = await vscode.window.showInputBox({
		title: 'M365 Copilot',
		prompt: t('actions.ask.prompt'),
		placeHolder: t('actions.ask.placeholder'),
		ignoreFocusOut: true,
	});
	if (!question?.trim()) return;
	// No hand-off: a free-form request reads the current selection itself
	// (see participant.ts), which is still the one the user just asked about.
	await openChat(`@${PARTICIPANT_NAME} ${question.trim()}`, false);
}

/** Last terminal command → `@m365 /terminal`, which reads it from the history itself. */
async function explainTerminal(terminals: TerminalHistory): Promise<void> {
	const terminal = vscode.window.activeTerminal;
	if (!terminal) {
		void vscode.window.showWarningMessage(t('terminal.none'));
		return;
	}
	if (!terminals.lastRun(terminal)) {
		void vscode.window.showWarningMessage(t('participant.noTerminalRun'));
		return;
	}
	await openChat(`@${PARTICIPANT_NAME} /terminal`, false);
}

/**
 * Opens the chat view with `query`. `partial` leaves it in the input box for
 * the user to complete; otherwise it is sent straight away. Always in Ask
 * mode: chat participants do not run in Agent mode, where `@m365 /explain`
 * would reach the agent as plain text instead of this extension.
 */
async function openChat(query: string, partial: boolean): Promise<void> {
	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', {
			query,
			isPartialQuery: partial,
			mode: 'ask',
		});
	} catch (error) {
		void vscode.window.showErrorMessage(t('actions.chatUnavailable', errorMessage(error)));
	}
}

/**
 * Lightbulb integration: "Fix with M365 Copilot" on errors/warnings under the
 * cursor — an inline edit with the diagnostic as the instruction, so the fix
 * lands right there under Keep/Undo — and "Edit… / Explain / Document with
 * M365 Copilot" on a selection (the last two through `@m365`).
 */
class M365CodeActionProvider implements vscode.CodeActionProvider {
	static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
	): vscode.CodeAction[] {
		if (!vscode.workspace.getConfiguration('m365copilot.editor').get<boolean>('codeActions', true)) return [];
		const actions: vscode.CodeAction[] = [];

		const problems = context.diagnostics
			.filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
			.slice(0, 2);
		// Offered on a problem only: "fix all" is a quick fix like the others.
		const inFile =
			problems.length > 0
				? vscode.languages
						.getDiagnostics(document.uri)
						.filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning).length
				: 0;
		for (const diagnostic of problems) {
			const action = new vscode.CodeAction(
				t('actions.codeAction.fixDiagnostic', shorten(diagnostic.message)),
				vscode.CodeActionKind.QuickFix,
			);
			action.diagnostics = [diagnostic];
			action.command = {
				command: 'm365copilot.editCode',
				title: action.title,
				arguments: [document.uri, diagnostic.range, t('inlineEdit.fixInstruction', diagnostic.message)],
			};
			actions.push(action);
		}
		if (inFile >= 2) {
			const action = new vscode.CodeAction(t('actions.codeAction.fixAll', inFile), vscode.CodeActionKind.QuickFix);
			action.command = { command: 'm365copilot.fixAllProblems', title: action.title, arguments: [document.uri] };
			actions.push(action);
		}

		if (!range.isEmpty) {
			for (const [command, key] of [
				['m365copilot.editCode', 'actions.codeAction.edit'],
				['m365copilot.explainCode', 'actions.codeAction.explain'],
				['m365copilot.documentCode', 'actions.codeAction.document'],
			] as const) {
				const action = new vscode.CodeAction(t(key), vscode.CodeActionKind.RefactorRewrite);
				action.command = { command, title: action.title, arguments: [document.uri, range] };
				actions.push(action);
			}
		}
		return actions;
	}
}

function shorten(message: string): string {
	const firstLine = message.split('\n', 1)[0].trim();
	return firstLine.length > MAX_DIAGNOSTIC_TITLE_CHARS
		? `${firstLine.slice(0, MAX_DIAGNOSTIC_TITLE_CHARS - 1)}…`
		: firstLine;
}

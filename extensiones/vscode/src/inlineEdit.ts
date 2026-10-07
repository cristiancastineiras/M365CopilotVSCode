/**
 * "Edit with M365 Copilot…": rewrite a block of code in place from an
 * instruction, without opening the chat. The result lands under the usual
 * Keep/Undo review (per hunk), so it is as reversible as an agent edit.
 *
 * Also behind the lightbulb's "Fix with M365 Copilot", which runs the same
 * flow with the diagnostic as the instruction, behind "Apply fix" on a review
 * comment (review.ts), and behind "Fix all problems in this file", which runs
 * it once per block of code with errors or warnings.
 */
import * as vscode from 'vscode';
import { streamCopilotTurnWithRetry, CopilotClientError } from './client';
import { requireUsableProfile } from './commands';
import { captureCodeContext, currentTextEditor, type CodeContext } from './editorContext';
import { buildInlineEditPrompt, extractEditedCode } from './inlineEditPrompt';
import { editorTone } from './models';
import type { ProfileStore } from './secrets';
import type { WorkspaceEditManager } from '../tools/writeFile';
import { errorMessage, relativePathForUri } from '../tools/common';
import { t } from './i18n';

const HISTORY_KEY = 'm365copilot.inlineEdit.history';
const MAX_HISTORY = 10;
/** Errors/warnings "Fix all problems" takes, and blocks it rewrites, in one go. */
const MAX_FIX_ALL_PROBLEMS = 40;
const MAX_FIX_ALL_BLOCKS = 8;
const PRESET_INSTRUCTIONS = [
	'inlineEdit.preset.simplify',
	'inlineEdit.preset.errors',
	'inlineEdit.preset.types',
	'inlineEdit.preset.names',
	'inlineEdit.preset.comments',
	'inlineEdit.preset.performance',
	'inlineEdit.preset.async',
] as const;
/** Read-only context shown to the model around the block, each side. */
const CONTEXT_LINES = 30;
const MAX_CONTEXT_CHARS = 3_000;

interface InlineEditDeps {
	readonly store: ProfileStore;
	readonly edits: WorkspaceEditManager;
	readonly memento: vscode.Memento;
	readonly log: (message: string) => void;
}

export function registerInlineEdit(deps: InlineEditDeps): vscode.Disposable[] {
	const editing = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
		isWholeLine: true,
	});
	return [
		editing,
		vscode.commands.registerCommand(
			'm365copilot.editCode',
			(uri?: unknown, range?: unknown, instruction?: unknown) =>
				editCode(
					deps,
					editing,
					uri instanceof vscode.Uri ? uri : undefined,
					range instanceof vscode.Range ? range : undefined,
					typeof instruction === 'string' ? instruction : undefined,
				),
		),
		vscode.commands.registerCommand('m365copilot.fixAllProblems', (uri?: unknown) =>
			fixAllProblems(deps, editing, uri instanceof vscode.Uri ? uri : undefined),
		),
	];
}

/**
 * `uri` + `range` come from a code action (the diagnostic or the selection
 * it was offered on) or a review comment, and `instruction` from the quick
 * fix or the comment; from the context menu, the keybinding or the palette
 * all three are absent. Resolves whether a change was staged for review.
 */
async function editCode(
	deps: InlineEditDeps,
	editing: vscode.TextEditorDecorationType,
	uri: vscode.Uri | undefined,
	range: vscode.Range | undefined,
	instruction: string | undefined,
): Promise<boolean> {
	const editor = uri
		? await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false })
		: currentTextEditor();
	if (!editor) {
		void vscode.window.showWarningMessage(t('actions.noEditor'));
		return false;
	}
	const document = editor.document;

	// The quick fix passes the diagnostic's range together with an
	// instruction: that range widens to the code around it. A selection (from
	// the lightbulb, the menu or the editor) is edited exactly as selected, and
	// with nothing selected the function/class at the cursor is.
	const context = await captureCodeContext(
		document,
		range && instruction !== undefined
			? { range }
			: { selection: range ? new vscode.Selection(range.start, range.end) : editor.selection },
	);
	if (context.truncatedChars > 0) {
		void vscode.window.showWarningMessage(t('inlineEdit.tooLarge'));
		return false;
	}

	const request = instruction ?? (await askInstruction(deps.memento, context.startLine, context.endLine));
	if (!request) return false;
	const profile = await requireUsableProfile(deps.store);
	if (!profile) return false;

	const original = document.getText(context.range);
	const versionAtStart = document.version;
	editor.setDecorations(editing, [context.range]);
	try {
		const answer = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: t('inlineEdit.progress', context.relativePath, context.startLine, context.endLine),
				cancellable: true,
			},
			(_progress, token) => requestEdit(deps, profile, document, context, request, token),
		);
		if (answer === undefined) return false; // cancelled

		// The user may have typed in the block while the model was thinking:
		// replacing it now would silently throw that typing away.
		if (document.version !== versionAtStart && document.getText(context.range) !== original) {
			void vscode.window.showWarningMessage(t('inlineEdit.changed'));
			return false;
		}
		const replacement = extractEditedCode(answer, original);
		if (replacement === null) {
			void vscode.window.showWarningMessage(t('inlineEdit.empty'));
			return false;
		}
		if (replacement === original.replace(/\r\n?/g, '\n')) {
			void vscode.window.showInformationMessage(t('inlineEdit.noChange'));
			return false;
		}
		await deps.edits.stageDocumentEdit(document, context.range, matchEol(replacement, document));
		void rememberInstruction(deps.memento, request);
		void vscode.window.setStatusBarMessage(t('inlineEdit.done'), 5000);
		return true;
	} catch (error) {
		void vscode.window.showErrorMessage(t('inlineEdit.failed', errorMessage(error)));
		return false;
	} finally {
		editor.setDecorations(editing, []);
	}
}

/**
 * "Fix all problems in this file": one inline edit per block of code with
 * errors or warnings (the function/class each one is in, overlapping blocks
 * merged), applied from the bottom of the file up so that a rewritten block
 * never shifts the lines of the ones still to do. Each lands under Keep/Undo.
 */
async function fixAllProblems(
	deps: InlineEditDeps,
	editing: vscode.TextEditorDecorationType,
	uri: vscode.Uri | undefined,
): Promise<void> {
	const editor = uri
		? await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false })
		: currentTextEditor();
	if (!editor) {
		void vscode.window.showWarningMessage(t('actions.noEditor'));
		return;
	}
	const document = editor.document;
	const problems = vscode.languages
		.getDiagnostics(document.uri)
		.filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
		.slice(0, MAX_FIX_ALL_PROBLEMS);
	if (problems.length === 0) {
		void vscode.window.showInformationMessage(t('fixAll.none'));
		return;
	}
	const profile = await requireUsableProfile(deps.store);
	if (!profile) return;

	const allBlocks = await problemBlocks(document, problems);
	const blocks = allBlocks.filter((block) => block.truncatedChars === 0).slice(0, MAX_FIX_ALL_BLOCKS);
	if (blocks.length === 0) {
		void vscode.window.showWarningMessage(t('inlineEdit.tooLarge'));
		return;
	}
	const originals = blocks.map((block) => document.getText(block.range));
	let fixed = 0;
	let failed = 0;
	editor.setDecorations(editing, blocks.map((block) => block.range));
	try {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: t('fixAll.progress', problems.length, relativePathForUri(document.uri)),
				cancellable: true,
			},
			async (progress, token) => {
				for (const [index, block] of blocks.entries()) {
					if (token.isCancellationRequested) return;
					progress.report({ message: t('fixAll.step', index + 1, blocks.length, block.startLine, block.endLine) });
					const listed = problems
						.filter((problem) => problem.range.intersection(block.range))
						.map((problem) => `- ${problem.range.start.line + 1}:${problem.range.start.character + 1} ${problem.message}`);
					try {
						const answer = await requestEdit(
							deps,
							profile,
							document,
							block,
							t('fixAll.instruction', listed.join('\n')),
							token,
						);
						if (answer === undefined) return; // cancelled
						// Typed into meanwhile: leave that block alone.
						if (document.getText(block.range) !== originals[index]) continue;
						const replacement = extractEditedCode(answer, originals[index]);
						if (replacement === null || replacement === originals[index].replace(/\r\n?/g, '\n')) continue;
						await deps.edits.stageDocumentEdit(document, block.range, matchEol(replacement, document));
						fixed += 1;
					} catch (error) {
						failed += 1;
						deps.log(t('log.fixAllBlockFailed', block.startLine, block.endLine, errorMessage(error)));
					}
				}
			},
		);
	} finally {
		editor.setDecorations(editing, []);
	}
	if (fixed > 0) {
		const rest = allBlocks.length - blocks.length;
		void vscode.window.showInformationMessage(
			rest > 0 ? t('fixAll.doneSome', fixed, rest) : t('fixAll.done', fixed),
		);
	} else if (failed > 0) {
		void vscode.window.showErrorMessage(t('fixAll.failed', failed));
	} else {
		void vscode.window.showInformationMessage(t('fixAll.nothing'));
	}
}

/**
 * The code around each problem (as for a single quick fix), overlapping
 * blocks merged, last block first.
 */
async function problemBlocks(document: vscode.TextDocument, problems: readonly vscode.Diagnostic[]): Promise<CodeContext[]> {
	const ranges: vscode.Range[] = [];
	for (const problem of problems) ranges.push((await captureCodeContext(document, { range: problem.range })).range);
	ranges.sort((a, b) => a.start.line - b.start.line);
	const merged: vscode.Range[] = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range.start.line <= last.end.line) merged[merged.length - 1] = last.union(range);
		else merged.push(range);
	}
	const blocks: CodeContext[] = [];
	for (const range of merged) blocks.push(await captureCodeContext(document, { range }));
	return blocks.reverse();
}

/** Resolves the model's answer, or undefined when the user cancelled. */
async function requestEdit(
	deps: InlineEditDeps,
	profile: NonNullable<Awaited<ReturnType<ProfileStore['get']>>>,
	document: vscode.TextDocument,
	context: CodeContext,
	instruction: string,
	token: vscode.CancellationToken,
): Promise<string | undefined> {
	const controller = new AbortController();
	const cancel = token.onCancellationRequested(() => controller.abort());
	let answer = '';
	try {
		await streamCopilotTurnWithRetry({
			profile,
			prompt: buildInlineEditPrompt({
				instruction,
				relativePath: context.relativePath,
				languageId: context.languageId,
				startLine: context.startLine,
				endLine: context.endLine,
				code: document.getText(context.range),
				before: surrounding(document, context.range.start.line - CONTEXT_LINES, context.range.start.line - 1, true),
				after: surrounding(document, context.range.end.line + 1, context.range.end.line + CONTEXT_LINES, false),
				diagnostics: context.diagnostics,
			}),
			tone: editorTone(),
			signal: controller.signal,
			log: deps.log,
			callbacks: { onText: (delta) => (answer += delta) },
		});
		return answer;
	} catch (error) {
		if (token.isCancellationRequested || (error instanceof CopilotClientError && error.message === '__CANCELLED__')) {
			return undefined;
		}
		throw error;
	} finally {
		cancel.dispose();
	}
}

/** Lines `from`..`to` (clamped), capped from the side farthest from the block. */
function surrounding(document: vscode.TextDocument, from: number, to: number, keepTail: boolean): string {
	const start = Math.max(0, from);
	const end = Math.min(document.lineCount - 1, to);
	if (end < start) return '';
	const text = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
	if (text.length <= MAX_CONTEXT_CHARS) return text;
	return keepTail ? text.slice(-MAX_CONTEXT_CHARS) : text.slice(0, MAX_CONTEXT_CHARS);
}

/** The model answers with LF; a CRLF file gets CRLF back. */
function matchEol(text: string, document: vscode.TextDocument): string {
	return document.eol === vscode.EndOfLine.CRLF ? text.replace(/\n/g, '\r\n') : text;
}

/**
 * Asks for the instruction, offering the last ones used — the same few get
 * repeated a lot — and then a handful of common ones.
 */
function askInstruction(memento: vscode.Memento, startLine: number, endLine: number): Promise<string | undefined> {
	const history = memento.get<string[]>(HISTORY_KEY, []);
	const recent: vscode.QuickPickItem[] = history.map((label) => ({ label, description: t('inlineEdit.recent') }));
	const presets: vscode.QuickPickItem[] = PRESET_INSTRUCTIONS.map((key) => t(key))
		.filter((label) => !history.includes(label))
		.map((label) => ({ label, iconPath: new vscode.ThemeIcon('lightbulb') }));
	const suggested: vscode.QuickPickItem[] = [
		...recent,
		{ label: t('inlineEdit.suggestions'), kind: vscode.QuickPickItemKind.Separator },
		...presets,
	];
	const picker = vscode.window.createQuickPick();
	picker.title = t('inlineEdit.title', startLine, endLine);
	picker.placeholder = t('inlineEdit.placeholder');
	picker.ignoreFocusOut = true;
	picker.items = suggested;
	picker.onDidChangeValue((value) => {
		const typed = value.trim();
		picker.items = typed ? [{ label: typed }, ...suggested.filter((item) => item.label !== typed)] : suggested;
	});
	return new Promise((resolve) => {
		let settled = false;
		const finish = (value: string | undefined) => {
			if (settled) return;
			settled = true;
			resolve(value?.trim() || undefined);
			picker.hide();
		};
		picker.onDidAccept(() => finish(picker.selectedItems[0]?.label ?? picker.value));
		picker.onDidHide(() => {
			finish(undefined);
			picker.dispose();
		});
		picker.show();
	});
}

async function rememberInstruction(memento: vscode.Memento, instruction: string): Promise<void> {
	const history = memento.get<string[]>(HISTORY_KEY, []).filter((item) => item !== instruction);
	await memento.update(HISTORY_KEY, [instruction, ...history].slice(0, MAX_HISTORY));
}

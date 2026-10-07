/**
 * "Review with M365 Copilot": the findings come back as comment threads on
 * the reviewed lines — in the editor, and listed in VS Code's Comments panel —
 * each with "Apply fix" (an inline edit with the finding as the instruction,
 * under the usual Keep/Undo) and "Dismiss".
 *
 *  - Review code: the selection, or the whole file (the function at the cursor
 *    when the file is too large).
 *  - Review changes (Source Control title bar): every file changed against
 *    HEAD plus the untracked ones, asking only about — and keeping only the
 *    comments on — the changed lines.
 */
import * as vscode from 'vscode';
import { streamCopilotTurnWithRetry, CopilotClientError } from './client';
import { requireUsableProfile } from './commands';
import { captureCodeContext, currentTextEditor } from './editorContext';
import { editorTone } from './models';
import type { CopilotProfile } from './profile';
import {
	buildReviewPrompt,
	lastLineOf,
	parseReviewFindings,
	parseUnifiedDiff,
	touchesRanges,
	windowsAround,
	type CodeSegment,
	type FileChanges,
	type FindingSeverity,
	type LineRange,
	type ReviewFinding,
} from './reviewPrompt';
import { resolveRepository } from './scmCommit';
import type { ProfileStore } from './secrets';
import { ConcurrencyLimiter } from './subagentCore';
import { execGit } from '../tools/git';
import { errorMessage, relativePathForUri } from '../tools/common';
import { t, type MessageKey } from './i18n';

const CONTROLLER_ID = 'm365copilot.review';
const HAS_COMMENTS_CONTEXT = 'm365copilot.hasReviewComments';
/** What fits in one review turn; a bigger file is reviewed in parts. */
const MAX_REVIEW_CHARS = 40_000;
const MAX_REVIEW_FILES = 10;
const CONCURRENT_REVIEWS = 2;
/** Lines of context kept around each change when a changed file is too large to send whole. */
const CHANGE_CONTEXT_LINES = 30;

const SEVERITY_ICON: Record<FindingSeverity, string> = { error: 'error', warning: 'warning', info: 'info' };
const SEVERITY_LABEL: Record<FindingSeverity, MessageKey> = {
	error: 'review.severity.error',
	warning: 'review.severity.warning',
	info: 'review.severity.info',
};

interface ReviewDeps {
	readonly store: ProfileStore;
	readonly log: (message: string) => void;
}

export function registerReview(deps: ReviewDeps, comments: ReviewComments): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('m365copilot.reviewCode', (uri?: unknown) =>
			reviewCode(deps, comments, uri instanceof vscode.Uri ? uri : undefined),
		),
		vscode.commands.registerCommand('m365copilot.reviewChanges', (source?: unknown) =>
			reviewChanges(deps, comments, source),
		),
		vscode.commands.registerCommand('m365copilot.review.applyFix', (thread?: unknown) => comments.applyFix(thread)),
		vscode.commands.registerCommand('m365copilot.review.dismiss', (thread?: unknown) => comments.dismiss(thread)),
		vscode.commands.registerCommand('m365copilot.review.clear', () => comments.clear()),
	];
}

/** The comment threads of the reviews, per file. */
export class ReviewComments implements vscode.Disposable {
	private readonly controller = vscode.comments.createCommentController(CONTROLLER_ID, t('review.controller'));
	private readonly threads = new Map<string, vscode.CommentThread[]>();
	private readonly findings = new WeakMap<vscode.CommentThread, ReviewFinding>();
	private readonly author: vscode.CommentAuthorInformation;

	constructor(extensionUri: vscode.Uri) {
		this.author = { name: 'M365 Copilot', iconPath: vscode.Uri.joinPath(extensionUri, 'logo', 'm365-vscode.png') };
	}

	/** Replaces this file's comments inside `scope` (all of them without one) by `findings`. */
	show(document: vscode.TextDocument, findings: readonly ReviewFinding[], scope?: vscode.Range): vscode.CommentThread[] {
		const key = document.uri.toString();
		const kept = (this.threads.get(key) ?? []).filter((thread) => {
			if (scope && !thread.range?.intersection(scope)) return true;
			thread.dispose();
			return false;
		});
		const created = findings.map((finding) => this.createThread(document, finding));
		this.threads.set(key, [...kept, ...created]);
		this.updateContext();
		return created;
	}

	private createThread(document: vscode.TextDocument, finding: ReviewFinding): vscode.CommentThread {
		const last = Math.max(document.lineCount - 1, 0);
		const start = Math.min(Math.max(finding.startLine - 1, 0), last);
		const end = Math.min(Math.max(finding.endLine - 1, start), last);
		const range = new vscode.Range(start, 0, end, document.lineAt(end).text.length);
		const comment: vscode.Comment = {
			body: commentBody(finding),
			mode: vscode.CommentMode.Preview,
			author: this.author,
			label: t(SEVERITY_LABEL[finding.severity]),
		};
		const thread = this.controller.createCommentThread(document.uri, range, [comment]);
		thread.label = finding.title;
		thread.canReply = false;
		thread.contextValue = 'm365review';
		thread.collapsibleState =
			finding.severity === 'info'
				? vscode.CommentThreadCollapsibleState.Collapsed
				: vscode.CommentThreadCollapsibleState.Expanded;
		this.findings.set(thread, finding);
		return thread;
	}

	/** "Apply fix": an inline edit of the commented lines; the comment goes once the change is staged. */
	async applyFix(value: unknown): Promise<void> {
		const thread = this.threadOf(value);
		const finding = thread && this.findings.get(thread);
		if (!thread || !finding || !thread.range) return;
		const instruction = t('review.fixInstruction', finding.title, finding.message, finding.suggestion ?? '-');
		const applied = await vscode.commands.executeCommand<boolean>(
			'm365copilot.editCode',
			thread.uri,
			thread.range,
			instruction,
		);
		if (applied) this.remove(thread);
	}

	dismiss(value: unknown): void {
		const thread = this.threadOf(value);
		if (thread) this.remove(thread);
	}

	/** The open threads (of one file, or all), for the integration tests. */
	list(uri?: vscode.Uri): readonly vscode.CommentThread[] {
		return uri ? (this.threads.get(uri.toString()) ?? []) : [...this.threads.values()].flat();
	}

	clear(): void {
		for (const threads of this.threads.values()) for (const thread of threads) thread.dispose();
		this.threads.clear();
		this.updateContext();
	}

	private threadOf(value: unknown): vscode.CommentThread | undefined {
		return value && typeof value === 'object' && this.findings.has(value as vscode.CommentThread)
			? (value as vscode.CommentThread)
			: undefined;
	}

	private remove(thread: vscode.CommentThread): void {
		const key = thread.uri.toString();
		const rest = (this.threads.get(key) ?? []).filter((item) => item !== thread);
		if (rest.length > 0) this.threads.set(key, rest);
		else this.threads.delete(key);
		thread.dispose();
		this.updateContext();
	}

	private updateContext(): void {
		void vscode.commands.executeCommand('setContext', HAS_COMMENTS_CONTEXT, this.threads.size > 0);
	}

	dispose(): void {
		this.clear();
		this.controller.dispose();
	}
}

function commentBody(finding: ReviewFinding): vscode.MarkdownString {
	// Untrusted (no command links, no HTML): the text comes from the model.
	const body = new vscode.MarkdownString(undefined, true);
	body.appendMarkdown(`$(${SEVERITY_ICON[finding.severity]}) **${escapeMarkdown(finding.title)}**\n\n`);
	body.appendMarkdown(finding.message);
	if (finding.suggestion) {
		body.appendMarkdown(`\n\n$(lightbulb) **${t('review.suggestion')}** `);
		body.appendMarkdown(finding.suggestion);
	}
	return body;
}

/** The title is plain text (also the thread's label); `appendText` would turn its spaces into `&nbsp;`. */
function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

async function reviewCode(deps: ReviewDeps, comments: ReviewComments, uri: vscode.Uri | undefined): Promise<void> {
	const editor = uri
		? await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false })
		: currentTextEditor();
	if (!editor) {
		void vscode.window.showWarningMessage(t('actions.noEditor'));
		return;
	}
	const document = editor.document;
	let range: vscode.Range;
	if (!editor.selection.isEmpty) {
		range = wholeLines(document, editor.selection.start.line, lastSelectedLine(editor.selection));
	} else if (document.getText().length <= MAX_REVIEW_CHARS) {
		range = wholeLines(document, 0, document.lineCount - 1);
	} else {
		// Too large to send whole: the function/class at the cursor.
		const context = await captureCodeContext(document, { selection: editor.selection });
		if (context.truncatedChars > 0) {
			void vscode.window.showWarningMessage(t('review.tooLarge'));
			return;
		}
		range = context.range;
		void vscode.window.setStatusBarMessage(t('review.partial', context.startLine, context.endLine), 8000);
	}

	const profile = await requireUsableProfile(deps.store);
	if (!profile) return;
	const relativePath = relativePathForUri(document.uri);
	try {
		const findings = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: t('review.progress', relativePath), cancellable: true },
			(_progress, token) =>
				reviewDocument(deps, profile, document, [{ startLine: range.start.line + 1, text: document.getText(range) }], undefined, token),
		);
		if (findings === undefined) return; // cancelled
		const threads = comments.show(document, findings, range);
		void reportReview(findings.length, relativePath, threads[0]);
	} catch (error) {
		void vscode.window.showErrorMessage(t('review.failed', errorMessage(error)));
	}
}

async function reviewChanges(deps: ReviewDeps, comments: ReviewComments, source: unknown): Promise<void> {
	let repository: Awaited<ReturnType<typeof resolveRepository>>;
	try {
		repository = await resolveRepository(source);
	} catch (error) {
		void vscode.window.showErrorMessage(t('review.failed', errorMessage(error)));
		return;
	}
	if (!repository) return;
	const root = repository.rootUri;
	const profile = await requireUsableProfile(deps.store);
	if (!profile) return;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('review.changes.progress'), cancellable: true },
		async (progress, token) => {
			let files: ChangedFile[];
			try {
				files = await changedFiles(root.fsPath, token);
			} catch (error) {
				if (!token.isCancellationRequested) void vscode.window.showErrorMessage(t('review.failed', errorMessage(error)));
				return;
			}
			if (files.length === 0) {
				void vscode.window.showInformationMessage(t('review.changes.none'));
				return;
			}
			if (files.length > MAX_REVIEW_FILES) {
				void vscode.window.showWarningMessage(t('review.changes.tooMany', MAX_REVIEW_FILES, files.length));
			}
			const selected = files.slice(0, MAX_REVIEW_FILES);
			const limiter = new ConcurrencyLimiter(CONCURRENT_REVIEWS);
			let done = 0;
			let total = 0;
			let first: vscode.CommentThread | undefined;
			const failed: string[] = [];
			progress.report({ message: t('review.changes.count', 0, selected.length) });

			await Promise.all(
				selected.map((file) =>
					limiter.run(async () => {
						if (token.isCancellationRequested) return;
						try {
							const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, file.path));
							const ranges = file.untracked ? [{ start: 1, end: document.lineCount }] : file.ranges;
							const segments = segmentsAround(document, ranges);
							if (!segments) {
								deps.log(t('log.reviewSkipped', file.path));
								return;
							}
							const changes = { ...file, ranges };
							const findings = await reviewDocument(deps, profile, document, segments, changes, token);
							if (findings === undefined) return;
							const threads = comments.show(document, findings);
							total += findings.length;
							first ??= threads[0];
						} catch (error) {
							// A binary or unreadable file is not worth stopping the others for.
							failed.push(file.path);
							deps.log(t('log.reviewFileFailed', file.path, errorMessage(error)));
						} finally {
							done += 1;
							progress.report({
								increment: 100 / selected.length,
								message: t('review.changes.count', done, selected.length),
							});
						}
					}),
				),
			);
			if (token.isCancellationRequested) return;
			if (failed.length > 0) void vscode.window.showWarningMessage(t('review.changes.failedFiles', failed.join(', ')));
			void reportReview(total, t('review.changes.files', selected.length - failed.length), first);
		},
	);
}

/**
 * One review turn. Resolves the findings (on the changed lines only, when
 * reviewing changes), or undefined when cancelled; throws when the answer is
 * not a review.
 */
async function reviewDocument(
	deps: ReviewDeps,
	profile: CopilotProfile,
	document: vscode.TextDocument,
	segments: readonly CodeSegment[],
	changes: FileChanges | undefined,
	token: vscode.CancellationToken,
): Promise<ReviewFinding[] | undefined> {
	const relativePath = relativePathForUri(document.uri);
	const bounds: LineRange = { start: segments[0].startLine, end: lastLineOf(segments[segments.length - 1]) };
	const controller = new AbortController();
	const cancel = token.onCancellationRequested(() => controller.abort());
	let answer = '';
	try {
		await streamCopilotTurnWithRetry({
			profile,
			prompt: buildReviewPrompt({
				relativePath,
				languageId: document.languageId,
				segments,
				changed: changes?.ranges,
				diff: changes?.patch,
			}),
			tone: editorTone(),
			signal: controller.signal,
			log: deps.log,
			callbacks: { onText: (delta) => (answer += delta) },
		});
	} catch (error) {
		if (token.isCancellationRequested || (error instanceof CopilotClientError && error.message === '__CANCELLED__')) {
			return undefined;
		}
		throw error;
	} finally {
		cancel.dispose();
	}
	const findings = parseReviewFindings(answer, bounds);
	if (!findings) {
		deps.log(t('log.reviewUnreadable', relativePath, answer.slice(0, 2_000)));
		throw new Error(t('review.unreadable'));
	}
	deps.log(t('log.review', relativePath, findings.length));
	return changes ? findings.filter((finding) => touchesRanges(finding, changes.ranges)) : findings;
}

async function reportReview(count: number, what: string, first: vscode.CommentThread | undefined): Promise<void> {
	if (count === 0) {
		void vscode.window.showInformationMessage(t('review.clean', what));
		return;
	}
	const show = t('review.show');
	if ((await vscode.window.showInformationMessage(t('review.found', count, what), show)) !== show || !first) return;
	const range = first.range ?? new vscode.Range(0, 0, 0, 0);
	await vscode.window.showTextDocument(first.uri, { selection: new vscode.Range(range.start, range.start), preview: false });
}

interface ChangedFile extends FileChanges {
	/** New and not in git yet: every line is a change, and there is no diff. */
	readonly untracked?: boolean;
}

/** Files changed against HEAD (staged or not), plus the untracked ones. */
async function changedFiles(cwd: string, token: vscode.CancellationToken): Promise<ChangedFile[]> {
	const diff = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U0'];
	let patch: string;
	try {
		patch = await execGit([...diff, 'HEAD'], cwd, token);
	} catch (error) {
		if (token.isCancellationRequested) throw error;
		// No commit yet, so no HEAD: what is staged plus what is not.
		patch = `${await execGit([...diff, '--cached'], cwd, token)}\n${await execGit(diff, cwd, token)}`;
	}
	const files: ChangedFile[] = parseUnifiedDiff(patch);
	const untracked = await execGit(
		['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'],
		cwd,
		token,
	);
	for (const path of untracked.split('\0').filter(Boolean)) {
		files.push({ path, ranges: [], patch: '', untracked: true });
	}
	return files;
}

/**
 * What to send for a changed file: all of it when it fits, otherwise windows
 * around the changes — as many as fit. Undefined when not even one does.
 */
function segmentsAround(document: vscode.TextDocument, ranges: readonly LineRange[]): CodeSegment[] | undefined {
	const text = document.getText();
	if (text.length <= MAX_REVIEW_CHARS) return [{ startLine: 1, text }];
	const segments: CodeSegment[] = [];
	let size = 0;
	for (const window of windowsAround(ranges, document.lineCount, CHANGE_CONTEXT_LINES)) {
		const segment = { startLine: window.start, text: document.getText(wholeLines(document, window.start - 1, window.end - 1)) };
		size += segment.text.length;
		if (size > MAX_REVIEW_CHARS) break;
		segments.push(segment);
	}
	return segments.length > 0 ? segments : undefined;
}

function wholeLines(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
	const last = Math.max(document.lineCount - 1, 0);
	const start = Math.min(Math.max(startLine, 0), last);
	const end = Math.min(Math.max(endLine, start), last);
	return new vscode.Range(start, 0, end, document.lineAt(end).text.length);
}

/** A selection ending at column 0 of the next line does not include that line. */
function lastSelectedLine(selection: vscode.Selection): number {
	return selection.end.character === 0 && selection.end.line > selection.start.line
		? selection.end.line - 1
		: selection.end.line;
}

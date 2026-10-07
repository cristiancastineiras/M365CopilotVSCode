import * as vscode from 'vscode';
import {
	ensureNotCancelled,
	errorMessage,
	readWorkspaceText,
	relativePathForUri,
	resolveWorkspacePath,
	wholeDocumentRange,
} from './common';
import { replaceTextOnce, requireText } from './replaceText';
import { createContentOf, replaceNewTextOf } from './editFields';
import { acceptHunk, describeChange, describeHunks, diffLines, revertHunkEdit, type Hunk } from './lineDiff';
import { t } from '../src/i18n';

const PREVIEW_SCHEME = 'm365copilot-edit-preview';
const MAX_EDIT_COUNT = 20;
const MAX_EDIT_TEXT_CHARS = 500_000;
/** Beyond this many hunks in one file, per-hunk lenses are noise: only Keep all / Undo all remain. */
const MAX_HUNK_LENSES = 40;
/** Typing in a file under review re-diffs it, but not on every keystroke. */
const REFRESH_DEBOUNCE_MS = 150;

export interface ApplyWorkspaceEditsInput {
	readonly edits: unknown;
}

/** One file of an agent batch, as planned before applying it. */
interface PlannedFile {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	/** Content before this batch; undefined when the batch creates the file. */
	readonly before: string | undefined;
	/** Content after this batch; undefined when the batch deletes the file. */
	readonly after: string | undefined;
}

/** A file whose agent changes are waiting for Keep/Undo. */
interface PendingFile {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	/**
	 * What the review compares the live document against: the content before
	 * the agent's FIRST unreviewed edit — a second agent edit to the same file
	 * keeps it, instead of silently accepting the first one — updated as the
	 * user keeps individual hunks. Undefined when the agent created the file.
	 */
	baseline: string | undefined;
	/** The agent deleted the file: there is no document left to diff. */
	deleted: boolean;
}

/** Snapshot of a file as it was kept, for "undo last batch". */
interface KeptFile {
	readonly uri: vscode.Uri;
	readonly before: string | undefined;
	readonly after: string | undefined;
}

/** Holds the "before" side of the diff, so the right-hand pane can be the
 * real, editable document rather than a second read-only snapshot. */
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
	private readonly content = new Map<string, string>();
	private readonly changed = new vscode.EventEmitter<vscode.Uri>();
	/** Lets an open diff pick up a new baseline after a hunk is kept. */
	readonly onDidChange = this.changed.event;

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.content.get(uri.toString()) ?? '';
	}

	set(uri: vscode.Uri, text: string): void {
		if (this.content.get(uri.toString()) === text) return;
		this.content.set(uri.toString(), text);
		this.changed.fire(uri);
	}

	dispose(): void {
		this.content.clear();
		this.changed.dispose();
	}
}

/**
 * Applies agent edits the way VS Code's own editing flows do: the change
 * lands in the editor immediately, each changed block (hunk) is highlighted,
 * and the user accepts or reverts it with **Keep** / **Undo** — per hunk, or
 * for the whole file — from CodeLens on the change itself or the editor title.
 *
 * The review is always the LIVE diff between the baseline and the document
 * as it is now: typing inside an agent hunk updates it, reverting a change by
 * hand makes it disappear, and keeping a hunk folds it into the baseline. The
 * previous version stored the agent's output and highlighted one region from
 * the first to the last changed line, so two separate changes could only be
 * kept or undone together and the highlight covered untouched code between.
 *
 * Edits land as unsaved editor changes, so nothing is written to disk until
 * the user saves — Undo restores the previous content outright, and plain
 * Ctrl+Z works because every change is a normal editor edit.
 */
export class WorkspaceEditManager implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly previews = new PreviewContentProvider();
	private readonly pending = new Map<string, PendingFile>();
	/** Hunks per document version, so lenses and decorations do not re-diff on every call. */
	private readonly hunkCache = new Map<string, { version: number; hunks: Hunk[] }>();
	/** The last batch the user kept as a whole, so it can still be reverted afterwards. */
	private lastKept: KeptFile[] = [];
	private refreshTimer: NodeJS.Timeout | undefined;

	private readonly insertedLines = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
		isWholeLine: true,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});
	/** Lines removed right above this line. */
	private readonly removedAbove = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
		borderStyle: 'solid',
		borderWidth: '2px 0 0 0',
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});
	/** Lines removed after the last line of the file. */
	private readonly removedBelow = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
		borderStyle: 'solid',
		borderWidth: '0 0 2px 0',
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});

	private readonly codeLensChanged = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.codeLensChanged.event;

	private readonly pendingChanged = new vscode.EventEmitter<number>();
	/** Fires with the new count whenever the set of files awaiting Keep/Undo changes. */
	readonly onDidChangePending = this.pendingChanged.event;

	private readonly status: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];

	constructor() {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.status.command = 'm365copilot.reviewPendingEdits';
		this.disposables.push(
			vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this.previews),
			vscode.languages.registerCodeLensProvider({ pattern: '**' }, this),
			// Decorations live on editors, not documents: re-apply whenever the
			// set of visible editors changes (split, tab switch, reopen).
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
			// Drives the Keep/Undo/Diff buttons in the editor title bar.
			vscode.window.onDidChangeActiveTextEditor(() => this.updateActiveEditorContext()),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.pending.has(event.document.uri.toString())) this.scheduleRefresh();
			}),
		);
		this.renderStatus();
	}

	/** How many files are waiting for Keep/Undo. */
	get pendingCount(): number {
		return this.pending.size;
	}

	/** Re-render the lenses and the status item after a language change. */
	refreshLocale(): void {
		this.renderStatus();
		this.codeLensChanged.fire();
	}

	// ------------------------------------------------------------- tool entry

	async stageEdits(
		input: ApplyWorkspaceEditsInput,
		token: vscode.CancellationToken,
	): Promise<string> {
		const files = await this.planFiles(input, token);
		await this.applyToEditor(files);

		for (const file of files) this.track(file);
		await this.revealFirst(files[0]);
		this.changed();

		const summary = files
			.map((file) => `${file.relativePath} (${describeChange(file.before, file.after)})`)
			.join(', ');
		return t('edit.summary', summary);
	}

	/**
	 * An edit made from the editor itself (inline edit, quick fix): replace
	 * `range` with `newText` and put the result under the same review as an
	 * agent batch. Works for any text document, untitled ones included.
	 */
	async stageDocumentEdit(document: vscode.TextDocument, range: vscode.Range, newText: string): Promise<void> {
		const key = document.uri.toString();
		if (!this.pending.has(key)) {
			this.pending.set(key, {
				uri: document.uri,
				relativePath: relativePathForUri(document.uri),
				baseline: document.getText(),
				deleted: false,
			});
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, range, newText);
		if (!(await vscode.workspace.applyEdit(edit))) throw new Error(t('edit.applyFailed'));
		// Not reconcile(): it drops files without hunks, and this one is new —
		// the document-change listener re-diffs (and reconciles) right after.
		this.changed();
	}

	/** Start (or extend) the review of one file of a batch that was just applied. */
	private track(file: PlannedFile): void {
		const key = file.uri.toString();
		const existing = this.pending.get(key);
		if (!existing) {
			this.pending.set(key, {
				uri: file.uri,
				relativePath: file.relativePath,
				baseline: file.before,
				deleted: file.after === undefined,
			});
			return;
		}
		existing.deleted = file.after === undefined;
		// Created and deleted again before review: nothing is left to review.
		if (existing.baseline === undefined && existing.deleted) this.pending.delete(key);
		this.hunkCache.delete(key);
	}

	// ------------------------------------------------------------- planning

	private async planFiles(
		input: ApplyWorkspaceEditsInput,
		token: vscode.CancellationToken,
	): Promise<PlannedFile[]> {
		if (!Array.isArray(input.edits) || input.edits.length === 0) {
			throw new Error(t('edit.noEdits'));
		}
		if (input.edits.length > MAX_EDIT_COUNT) {
			throw new Error(t('edit.tooMany', MAX_EDIT_COUNT));
		}

		const byUri = new Map<string, { file: PlannedFile; after: string | undefined }>();
		const errors: string[] = [];
		let index = 0;
		for (const rawEdit of input.edits) {
			index += 1;
			ensureNotCancelled(token);
			try {
				await this.stageOneEdit(rawEdit, byUri);
			} catch (error) {
				// Collect instead of failing fast: a 16-file batch used to be thrown
				// away over a single bad field, and the model then had to regenerate
				// everything just to hit the NEXT problem on the retry.
				errors.push(t('edit.itemError', index, errorMessage(error)));
			}
		}

		if (errors.length > 0) {
			throw new Error(t('edit.invalidBatch', errors.length, input.edits.length, errors.join('\n')));
		}

		const files = [...byUri.values()]
			.filter((entry) => entry.file.before !== entry.after)
			.map((entry) => ({ ...entry.file, after: entry.after }));
		if (files.length === 0) throw new Error(t('edit.noChange'));
		return files;
	}

	private async stageOneEdit(
		rawEdit: unknown,
		byUri: Map<string, { file: PlannedFile; after: string | undefined }>,
	): Promise<void> {
		if (!isRecord(rawEdit)) throw new Error(t('edit.notObject'));
		const target = resolveWorkspacePath(rawEdit.path, rawEdit.workspaceFolder);
		const key = target.uri.toString();
		let entry = byUri.get(key);
		if (!entry) {
			const current = await readWorkspaceText(target.uri);
			entry = {
				file: {
					uri: target.uri,
					relativePath: target.relativePath,
					before: current,
					after: current,
				},
				after: current,
			};
			byUri.set(key, entry);
		}

		const operation = requireText(rawEdit.operation, 'operation', false);
		switch (operation) {
			case 'replace': {
				if (entry.after === undefined) {
					throw new Error(t('edit.replaceMissing', target.relativePath));
				}
				const oldText = requireText(rawEdit.oldText, 'oldText', false);
				const newText = requireText(replaceNewTextOf(rawEdit), 'newText');
				assertEditTextSize(oldText, 'oldText');
				assertEditTextSize(newText, 'newText');
				entry.after = replaceTextOnce(entry.after, oldText, newText, target.relativePath);
				break;
			}
			case 'create': {
				if (entry.after !== undefined) {
					throw new Error(t('edit.createExists', target.relativePath));
				}
				const content = requireText(createContentOf(rawEdit), 'content');
				assertEditTextSize(content, 'content');
				entry.after = content;
				break;
			}
			case 'delete':
				if (entry.after === undefined) {
					throw new Error(t('edit.deleteMissing', target.relativePath));
				}
				entry.after = undefined;
				break;
			default:
				throw new Error(t('edit.invalidOperation'));
		}
	}

	// ------------------------------------------------------------- applying

	private async applyToEditor(files: readonly PlannedFile[]): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		for (const file of files) {
			if (file.before === undefined) {
				if (file.after === undefined) continue;
				edit.createFile(file.uri, { overwrite: false, ignoreIfExists: true });
				if (file.after) edit.insert(file.uri, new vscode.Position(0, 0), file.after);
			} else if (file.after === undefined) {
				edit.deleteFile(file.uri);
			} else {
				edit.replace(file.uri, await this.fullRange(file.uri, file.before), file.after);
			}
		}
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error(t('edit.applyFailed'));
		}
	}

	/**
	 * The file's full range as it exists RIGHT NOW. Deriving the range from
	 * the text we expect would silently truncate the replacement whenever the
	 * document grew between reading it and writing it — the user typing while
	 * the model thinks is enough to cause that.
	 */
	private async fullRange(uri: vscode.Uri, fallbackText: string): Promise<vscode.Range> {
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			return document.validateRange(new vscode.Range(0, 0, document.lineCount, 0));
		} catch {
			return wholeDocumentRange(fallbackText);
		}
	}

	private async revealFirst(file: PlannedFile): Promise<void> {
		if (file.after === undefined) return; // nothing to show for a deletion
		try {
			const document = await vscode.workspace.openTextDocument(file.uri);
			const editor = await vscode.window.showTextDocument(document, { preview: false });
			const first = diffLines(file.before ?? '', file.after)[0];
			if (first) revealLine(editor, first.newStart);
		} catch {
			/* the file may have been deleted or is binary — the lenses still work */
		}
	}

	// --------------------------------------------------------- keep and undo

	/** Keep every change of one file (or of all of them, without `uri`). */
	async keep(uri?: vscode.Uri): Promise<void> {
		const files = this.take(uri);
		if (files.length === 0) return;
		this.lastKept = await Promise.all(files.map((file) => this.snapshot(file)));
		this.changed();
		void vscode.window.setStatusBarMessage(t('edit.kept', files.length), 5000);
	}

	/** Revert every change of one file (or of all of them, without `uri`). */
	async undo(uri?: vscode.Uri): Promise<void> {
		const files = this.take(uri);
		if (files.length === 0) return;
		try {
			await this.revert(await Promise.all(files.map((file) => this.snapshot(file))));
			void vscode.window.setStatusBarMessage(t('edit.reverted', files.length), 5000);
		} catch (error) {
			void vscode.window.showErrorMessage(t('edit.revertFailed', errorMessage(error)));
		}
		this.changed();
	}

	/**
	 * Keep one hunk: fold it into the baseline so it stops being a change.
	 * Per-hunk keeps do not feed "undo last batch", which reverts whole-file
	 * keeps only — Ctrl+Z still undoes the edit itself.
	 */
	async keepHunk(uri: vscode.Uri, hunk: Hunk): Promise<void> {
		const file = this.pending.get(uri.toString());
		if (!file || file.baseline === undefined) return;
		const document = await vscode.workspace.openTextDocument(uri);
		const live = this.liveHunk(file, document, hunk);
		if (!live) return;
		file.baseline = acceptHunk(file.baseline, document.getText(), live);
		this.hunkCache.delete(uri.toString());
		this.reconcile();
	}

	/** Undo one hunk: put the baseline's lines back in the document. */
	async undoHunk(uri: vscode.Uri, hunk: Hunk): Promise<void> {
		const file = this.pending.get(uri.toString());
		if (!file || file.baseline === undefined) return;
		const document = await vscode.workspace.openTextDocument(uri);
		const live = this.liveHunk(file, document, hunk);
		if (!live) return;
		const change = revertHunkEdit(document.getText(), file.baseline, live);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			uri,
			new vscode.Range(change.startLine, change.startCharacter, change.endLine, change.endCharacter),
			change.text,
		);
		if (!(await vscode.workspace.applyEdit(edit))) {
			void vscode.window.showErrorMessage(t('edit.revertFailed', t('edit.restoreFailed')));
			return;
		}
		this.reconcile();
	}

	/** Revert a batch the user already kept — the "me arrepentí" path. */
	async undoLastBatch(): Promise<void> {
		if (this.lastKept.length === 0) {
			void vscode.window.showInformationMessage(t('edit.noBatch'));
			return;
		}
		const files = this.lastKept;
		this.lastKept = [];
		try {
			await this.revert(files);
			void vscode.window.showInformationMessage(t('edit.batchUndone', files.length));
		} catch (error) {
			void vscode.window.showErrorMessage(t('edit.batchUndoFailed', errorMessage(error)));
		}
	}

	private async revert(files: readonly KeptFile[]): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		for (const file of files) {
			if (file.before === undefined) {
				edit.deleteFile(file.uri, { ignoreIfNotExists: true });
			} else if (file.after === undefined) {
				edit.createFile(file.uri, { overwrite: true });
				if (file.before) edit.insert(file.uri, new vscode.Position(0, 0), file.before);
			} else {
				edit.replace(file.uri, await this.fullRange(file.uri, file.after), file.before);
			}
		}
		if (!(await vscode.workspace.applyEdit(edit))) {
			throw new Error(t('edit.restoreFailed'));
		}
	}

	private async snapshot(file: PendingFile): Promise<KeptFile> {
		if (file.deleted) return { uri: file.uri, before: file.baseline, after: undefined };
		let after = '';
		try {
			after = (await vscode.workspace.openTextDocument(file.uri)).getText();
		} catch {
			/* gone from disk: reverting recreates it from the baseline */
		}
		return { uri: file.uri, before: file.baseline, after };
	}

	private take(uri?: vscode.Uri): PendingFile[] {
		const one = uri ? this.pending.get(uri.toString()) : undefined;
		const files = uri ? (one ? [one] : []) : [...this.pending.values()];
		for (const file of files) {
			this.pending.delete(file.uri.toString());
			this.hunkCache.delete(file.uri.toString());
		}
		return files;
	}

	/**
	 * The hunk a lens was created for, as it exists now. A lens can be clicked
	 * after the document changed under it; acting on its stale coordinates
	 * would keep or revert the wrong lines, so it is matched against the
	 * current diff (exactly, or by its start line) and ignored if gone.
	 */
	private liveHunk(file: PendingFile, document: vscode.TextDocument, hunk: Hunk): Hunk | undefined {
		const hunks = this.hunksFor(file, document);
		return (
			hunks.find(
				(candidate) =>
					candidate.oldStart === hunk.oldStart &&
					candidate.oldLength === hunk.oldLength &&
					candidate.newStart === hunk.newStart &&
					candidate.newLength === hunk.newLength,
			) ?? hunks.find((candidate) => candidate.newStart === hunk.newStart)
		);
	}

	// ------------------------------------------------------------ navigating

	/** Jump to the next (1) or previous (-1) agent change, across files. */
	async goToChange(direction: 1 | -1): Promise<void> {
		const targets: { uri: vscode.Uri; line: number }[] = [];
		for (const file of this.pending.values()) {
			if (file.deleted) continue;
			const document = await vscode.workspace.openTextDocument(file.uri);
			for (const hunk of this.hunksFor(file, document)) targets.push({ uri: file.uri, line: hunk.newStart });
		}
		if (targets.length === 0) {
			void vscode.window.showInformationMessage(t('edit.nonePending'));
			return;
		}

		const editor = vscode.window.activeTextEditor;
		const here = editor?.document.uri.toString();
		const cursor = editor?.selection.active.line ?? -1;
		const index = targets.findIndex((target) => target.uri.toString() === here);
		let next: { uri: vscode.Uri; line: number } | undefined;
		if (index !== -1) {
			const inFile = targets.filter((target) => target.uri.toString() === here);
			next =
				direction === 1
					? inFile.find((target) => target.line > cursor)
					: [...inFile].reverse().find((target) => target.line < cursor);
			if (!next) {
				// Past the last (or before the first) change of this file: next file, wrapping.
				const files = [...new Set(targets.map((target) => target.uri.toString()))];
				const at = files.indexOf(here!);
				const other = files[(at + direction + files.length) % files.length];
				const ofOther = targets.filter((target) => target.uri.toString() === other);
				next = direction === 1 ? ofOther[0] : ofOther[ofOther.length - 1];
			}
		} else {
			next = direction === 1 ? targets[0] : targets[targets.length - 1];
		}

		const document = await vscode.workspace.openTextDocument(next.uri);
		const target = await vscode.window.showTextDocument(document, { preview: false });
		revealLine(target, next.line);
	}

	// ------------------------------------------------------------- reviewing

	async showDiff(uri?: vscode.Uri): Promise<void> {
		const file = uri ? this.pending.get(uri.toString()) : [...this.pending.values()][0];
		if (!file) {
			void vscode.window.showInformationMessage(t('edit.nonePending'));
			return;
		}
		const beforeUri = this.previewUri(file, 'before');
		this.previews.set(beforeUri, file.baseline ?? '');
		// Right-hand side is the real document, so the diff is live and
		// editable — except for a deletion, where there is no document left to
		// point at and an empty virtual one shows the removal properly.
		let rightUri = file.uri;
		if (file.deleted) {
			rightUri = this.previewUri(file, 'deleted');
			this.previews.set(rightUri, '');
		}
		await vscode.commands.executeCommand(
			'vscode.diff',
			beforeUri,
			rightUri,
			t('edit.diffTitle', file.relativePath),
			{ preview: true },
		);
	}

	/** Entry point for the status bar and the palette command. */
	async reviewPendingEdits(): Promise<void> {
		const files = [...this.pending.values()];
		if (files.length === 0) {
			void vscode.window.showInformationMessage(t('edit.nonePending'));
			return;
		}
		if (files.length === 1) {
			await this.showDiff(files[0].uri);
			return;
		}
		const items = await Promise.all(
			files.map(async (file) => {
				const snapshot = await this.snapshot(file);
				return {
					label: file.relativePath,
					description: describeChange(snapshot.before, snapshot.after),
					uri: file.uri,
				};
			}),
		);
		const picked = await vscode.window.showQuickPick(items, {
			title: t('edit.review.title'),
			placeHolder: t('edit.review.placeholder'),
		});
		if (picked) await this.showDiff(picked.uri);
	}

	// ------------------------------------------------------------- live diff

	private hunksFor(file: PendingFile, document: vscode.TextDocument): Hunk[] {
		if (file.deleted) return [];
		const key = file.uri.toString();
		const cached = this.hunkCache.get(key);
		if (cached && cached.version === document.version) return cached.hunks;
		const hunks = diffLines(file.baseline ?? '', document.getText());
		this.hunkCache.set(key, { version: document.version, hunks });
		return hunks;
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			this.reconcile();
		}, REFRESH_DEBOUNCE_MS);
	}

	/**
	 * Re-diff the open documents under review and drop the files that no
	 * longer differ from their baseline (every hunk kept, or reverted by hand).
	 */
	private reconcile(): void {
		for (const document of vscode.workspace.textDocuments) {
			const key = document.uri.toString();
			const file = this.pending.get(key);
			if (!file || file.deleted || file.baseline === undefined) continue;
			if (this.hunksFor(file, document).length === 0) {
				this.pending.delete(key);
				this.hunkCache.delete(key);
			}
		}
		this.changed();
	}

	/** Everything that renders the review: decorations, lenses, status, context keys. */
	private changed(): void {
		this.refreshDecorations();
		this.renderStatus();
		this.codeLensChanged.fire();
	}

	// ------------------------------------------------------------- decoration

	private refreshDecorations(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const file = this.pending.get(editor.document.uri.toString());
			const hunks = file ? this.hunksFor(file, editor.document) : [];
			const lastLine = Math.max(editor.document.lineCount - 1, 0);
			const inserted: vscode.Range[] = [];
			const above: vscode.Range[] = [];
			const below: vscode.Range[] = [];
			for (const hunk of hunks) {
				if (hunk.newLength > 0) {
					inserted.push(new vscode.Range(hunk.newStart, 0, Math.min(hunk.newStart + hunk.newLength - 1, lastLine), 0));
				} else if (hunk.newStart <= lastLine) {
					above.push(new vscode.Range(hunk.newStart, 0, hunk.newStart, 0));
				} else {
					below.push(new vscode.Range(lastLine, 0, lastLine, 0));
				}
			}
			editor.setDecorations(this.insertedLines, inserted);
			editor.setDecorations(this.removedAbove, above);
			editor.setDecorations(this.removedBelow, below);
		}
	}

	// --------------------------------------------------------------- codelens

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const file = this.pending.get(document.uri.toString());
		if (!file) return [];
		const hunks = this.hunksFor(file, document);
		const lastLine = Math.max(document.lineCount - 1, 0);
		const at = (line: number) => new vscode.Range(Math.min(line, lastLine), 0, Math.min(line, lastLine), 0);
		const fileArgs = [file.uri];
		const created = file.baseline === undefined;

		// One hunk, a new file or too many hunks: whole-file actions only.
		if (created || hunks.length <= 1 || hunks.length > MAX_HUNK_LENSES) {
			const range = at(hunks[0]?.newStart ?? 0);
			return [
				new vscode.CodeLens(range, {
					title: t('edit.lens.keep', created ? t('diff.newFile') : describeHunks(hunks)),
					tooltip: t('edit.lens.keepTooltip'),
					command: 'm365copilot.keepEdits',
					arguments: fileArgs,
				}),
				new vscode.CodeLens(range, {
					title: t('edit.lens.undo'),
					tooltip: t('edit.lens.undoTooltip'),
					command: 'm365copilot.undoEdits',
					arguments: fileArgs,
				}),
				new vscode.CodeLens(range, {
					title: t('edit.lens.diff'),
					tooltip: t('edit.lens.diffTooltip'),
					command: 'm365copilot.showEditDiff',
					arguments: fileArgs,
				}),
			];
		}

		// Several hunks: whole-file actions at the top, Keep/Undo on each hunk.
		const top = at(0);
		const lenses = [
			new vscode.CodeLens(top, {
				title: t('edit.lens.keepAll', hunks.length),
				tooltip: t('edit.lens.keepTooltip'),
				command: 'm365copilot.keepEdits',
				arguments: fileArgs,
			}),
			new vscode.CodeLens(top, {
				title: t('edit.lens.undoAll'),
				tooltip: t('edit.lens.undoTooltip'),
				command: 'm365copilot.undoEdits',
				arguments: fileArgs,
			}),
			new vscode.CodeLens(top, {
				title: t('edit.lens.diff'),
				tooltip: t('edit.lens.diffTooltip'),
				command: 'm365copilot.showEditDiff',
				arguments: fileArgs,
			}),
		];
		for (const hunk of hunks) {
			const range = at(hunk.newStart);
			const args = [file.uri, hunk];
			lenses.push(
				new vscode.CodeLens(range, {
					title: t('edit.lens.keepHunk', describeHunks([hunk])),
					tooltip: t('edit.lens.keepHunkTooltip'),
					command: 'm365copilot.keepHunk',
					arguments: args,
				}),
				new vscode.CodeLens(range, {
					title: t('edit.lens.undoHunk'),
					tooltip: t('edit.lens.undoHunkTooltip'),
					command: 'm365copilot.undoHunk',
					arguments: args,
				}),
			);
		}
		return lenses;
	}

	// ----------------------------------------------------------------- status

	private renderStatus(): void {
		const count = this.pending.size;
		void vscode.commands.executeCommand('setContext', 'm365copilot.hasPendingEdits', count > 0);
		this.updateActiveEditorContext();
		this.pendingChanged.fire(count);
		if (count === 0) {
			this.status.hide();
			return;
		}
		this.status.text = t('edit.status.text', count);
		this.status.tooltip = t('edit.status.tooltip');
		this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this.status.show();
	}

	private updateActiveEditorContext(): void {
		const active = vscode.window.activeTextEditor?.document.uri.toString();
		const pendingHere = active !== undefined && this.pending.has(active);
		void vscode.commands.executeCommand('setContext', 'm365copilot.activeEditorHasPendingEdits', pendingHere);
	}

	private previewUri(file: PendingFile, side: 'before' | 'deleted'): vscode.Uri {
		return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${side}/${file.relativePath}` });
	}

	dispose(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.insertedLines.dispose();
		this.removedAbove.dispose();
		this.removedBelow.dispose();
		this.codeLensChanged.dispose();
		this.pendingChanged.dispose();
		this.status.dispose();
		this.previews.dispose();
		for (const disposable of this.disposables) disposable.dispose();
		this.pending.clear();
		this.hunkCache.clear();
		this.lastKept = [];
	}
}

function revealLine(editor: vscode.TextEditor, line: number): void {
	const anchor = new vscode.Position(Math.min(line, Math.max(editor.document.lineCount - 1, 0)), 0);
	editor.selection = new vscode.Selection(anchor, anchor);
	editor.revealRange(new vscode.Range(anchor, anchor), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertEditTextSize(value: string, name: string): void {
	if (value.length > MAX_EDIT_TEXT_CHARS) {
		throw new Error(t('edit.tooLarge', name, MAX_EDIT_TEXT_CHARS));
	}
}

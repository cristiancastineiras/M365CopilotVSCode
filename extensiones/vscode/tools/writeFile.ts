import * as vscode from 'vscode';
import {
	ensureNotCancelled,
	errorMessage,
	readWorkspaceText,
	resolveWorkspacePath,
	wholeDocumentRange,
} from './common';
import { replaceTextOnce, requireText } from './replaceText';
import { createContentOf, replaceNewTextOf } from './editFields';
import { changedRegion, describeChange } from './lineDiff';

const PREVIEW_SCHEME = 'm365copilot-edit-preview';
const MAX_EDIT_COUNT = 20;
const MAX_EDIT_TEXT_CHARS = 500_000;

export interface ApplyWorkspaceEditsInput {
	readonly edits: unknown;
}

interface PendingFile {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	/** Content before the agent touched it; undefined when it created the file. */
	readonly before: string | undefined;
	/** Content the agent wrote; undefined when it deleted the file. */
	readonly after: string | undefined;
}

/** Holds the "before" side of the diff, so the right-hand pane can be the
 * real, editable document rather than a second read-only snapshot. */
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
	private readonly content = new Map<string, string>();

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.content.get(uri.toString()) ?? '';
	}

	set(uri: vscode.Uri, text: string): void {
		this.content.set(uri.toString(), text);
	}

	dispose(): void {
		this.content.clear();
	}
}

/**
 * Applies agent edits the way VS Code's own editing flows do: the change
 * lands in the editor immediately, the touched lines are highlighted, and the
 * user accepts it with **Keep** or reverts it with **Undo** from a CodeLens
 * on the change itself.
 *
 * The previous flow staged everything behind a read-only preview diff and a
 * notification with buttons, which meant the model's tool call blocked until
 * somebody clicked, and the "edit" was never visible where people actually
 * read code. Applying first is also what makes plain Ctrl+Z work, since the
 * change is a normal editor undo step.
 *
 * Edits land as unsaved editor changes, so nothing is written to disk until
 * the user saves — Undo restores the previous content outright.
 */
export class WorkspaceEditManager implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly previews = new PreviewContentProvider();
	private readonly pending = new Map<string, PendingFile>();
	/** The last batch the user kept, so it can still be reverted afterwards. */
	private lastKept: PendingFile[] = [];

	private readonly changedLines = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
		isWholeLine: true,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Full,
	});

	private readonly codeLensChanged = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.codeLensChanged.event;

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
		);
		this.renderStatus();
	}

	// ------------------------------------------------------------- tool entry

	async stageEdits(
		input: ApplyWorkspaceEditsInput,
		token: vscode.CancellationToken,
	): Promise<string> {
		const files = await this.planFiles(input, token);
		await this.applyToEditor(files);

		for (const file of files) this.pending.set(file.uri.toString(), file);
		await this.revealFirst(files[0]);
		this.refreshDecorations();
		this.renderStatus();
		this.codeLensChanged.fire();

		const summary = files
			.map((file) => `${file.relativePath} (${describeChange(file.before, file.after)})`)
			.join(', ');
		return (
			`Cambios aplicados en el editor y pendientes de revisión del usuario: ${summary}. ` +
			'El usuario los verá resaltados con las acciones «Keep» y «Undo» encima del cambio. ' +
			'No están guardados en disco todavía y el usuario puede revertirlos, así que no des por hecho que son definitivos.'
		);
	}

	// ------------------------------------------------------------- planning

	private async planFiles(
		input: ApplyWorkspaceEditsInput,
		token: vscode.CancellationToken,
	): Promise<PendingFile[]> {
		if (!Array.isArray(input.edits) || input.edits.length === 0) {
			throw new Error('edits debe contener al menos una edición.');
		}
		if (input.edits.length > MAX_EDIT_COUNT) {
			throw new Error(`El lote no puede superar ${MAX_EDIT_COUNT} ediciones.`);
		}

		const byUri = new Map<string, { file: PendingFile; after: string | undefined }>();
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
				errors.push(`Edición #${index}: ${errorMessage(error)}`);
			}
		}

		if (errors.length > 0) {
			throw new Error(
				`${errors.length} de ${input.edits.length} edición(es) no son válidas; no se ha aplicado ninguna:\n${errors.join('\n')}`,
			);
		}

		const files = [...byUri.values()]
			.filter((entry) => entry.file.before !== entry.after)
			.map((entry) => ({ ...entry.file, after: entry.after }));
		if (files.length === 0) throw new Error('La propuesta no produce ningún cambio.');
		return files;
	}

	private async stageOneEdit(
		rawEdit: unknown,
		byUri: Map<string, { file: PendingFile; after: string | undefined }>,
	): Promise<void> {
		if (!isRecord(rawEdit)) throw new Error('Cada edición debe ser un objeto.');
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
					throw new Error(`No se puede reemplazar ${target.relativePath} porque no existe.`);
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
					throw new Error(`${target.relativePath} ya existe; usa replace para modificarlo.`);
				}
				const content = requireText(createContentOf(rawEdit), 'content');
				assertEditTextSize(content, 'content');
				entry.after = content;
				break;
			}
			case 'delete':
				if (entry.after === undefined) {
					throw new Error(`No se puede borrar ${target.relativePath} porque no existe.`);
				}
				entry.after = undefined;
				break;
			default:
				throw new Error('operation debe ser replace, create o delete.');
		}
	}

	// ------------------------------------------------------------- applying

	private async applyToEditor(files: readonly PendingFile[]): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		for (const file of files) {
			this.previews.set(this.previewUri(file, 'antes'), file.before ?? '');
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
			throw new Error('VS Code no pudo aplicar los cambios.');
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

	private async revealFirst(file: PendingFile): Promise<void> {
		if (file.after === undefined) return; // nothing to show for a deletion
		try {
			const document = await vscode.workspace.openTextDocument(file.uri);
			const editor = await vscode.window.showTextDocument(document, { preview: false });
			const region = changedRegion(file.before ?? '', file.after);
			if (region) {
				const anchor = new vscode.Position(Math.min(region.start, document.lineCount - 1), 0);
				editor.revealRange(new vscode.Range(anchor, anchor), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
		} catch {
			/* the file may have been deleted or is binary — the lenses still work */
		}
	}

	// --------------------------------------------------------- keep and undo

	async keep(uri?: vscode.Uri): Promise<void> {
		const files = this.take(uri);
		if (files.length === 0) return;
		this.lastKept = files;
		this.refreshDecorations();
		this.renderStatus();
		this.codeLensChanged.fire();
		void vscode.window.setStatusBarMessage(
			`M365 Copilot: ${files.length} archivo(s) aceptados. Sin guardar todavía — Ctrl+S para escribirlos.`,
			5000,
		);
	}

	async undo(uri?: vscode.Uri): Promise<void> {
		const files = this.take(uri);
		if (files.length === 0) return;
		try {
			await this.revert(files);
			void vscode.window.setStatusBarMessage(`M365 Copilot: ${files.length} archivo(s) revertidos.`, 5000);
		} catch (error) {
			void vscode.window.showErrorMessage(`M365 Copilot: no se pudo revertir: ${errorMessage(error)}`);
		}
		this.refreshDecorations();
		this.renderStatus();
		this.codeLensChanged.fire();
	}

	/** Revert a batch the user already kept — the "me arrepentí" path. */
	async undoLastBatch(): Promise<void> {
		if (this.lastKept.length === 0) {
			void vscode.window.showInformationMessage('M365 Copilot: no hay un lote de cambios para deshacer.');
			return;
		}
		const files = this.lastKept;
		this.lastKept = [];
		try {
			await this.revert(files);
			void vscode.window.showInformationMessage(
				`M365 Copilot: se deshizo el lote de ${files.length} archivo(s).`,
			);
		} catch (error) {
			void vscode.window.showErrorMessage(`M365 Copilot: no se pudo deshacer el lote: ${errorMessage(error)}`);
		}
	}

	private async revert(files: readonly PendingFile[]): Promise<void> {
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
			throw new Error('VS Code no pudo restaurar el contenido anterior.');
		}
	}

	private take(uri?: vscode.Uri): PendingFile[] {
		if (!uri) {
			const all = [...this.pending.values()];
			this.pending.clear();
			return all;
		}
		const key = uri.toString();
		const file = this.pending.get(key);
		if (!file) return [];
		this.pending.delete(key);
		return [file];
	}

	// ------------------------------------------------------------- reviewing

	async showDiff(uri?: vscode.Uri): Promise<void> {
		const file = uri ? this.pending.get(uri.toString()) : [...this.pending.values()][0];
		if (!file) {
			void vscode.window.showInformationMessage('M365 Copilot: no hay cambios de agente pendientes.');
			return;
		}
		const beforeUri = this.previewUri(file, 'antes');
		this.previews.set(beforeUri, file.before ?? '');
		// Right-hand side is the real document, so the diff is live and
		// editable — except for a deletion, where there is no document left to
		// point at and an empty virtual one shows the removal properly.
		let rightUri = file.uri;
		if (file.after === undefined) {
			rightUri = this.previewUri(file, 'borrado');
			this.previews.set(rightUri, '');
		}
		await vscode.commands.executeCommand(
			'vscode.diff',
			beforeUri,
			rightUri,
			`${file.relativePath}: antes ↔ propuesta de M365 Copilot`,
			{ preview: true },
		);
	}

	/** Entry point for the status bar and the palette command. */
	async reviewPendingEdits(): Promise<void> {
		const files = [...this.pending.values()];
		if (files.length === 0) {
			void vscode.window.showInformationMessage('M365 Copilot: no hay cambios de agente pendientes.');
			return;
		}
		if (files.length === 1) {
			await this.showDiff(files[0].uri);
			return;
		}
		const picked = await vscode.window.showQuickPick(
			files.map((file) => ({
				label: file.relativePath,
				description: describeChange(file.before, file.after),
				uri: file.uri,
			})),
			{ title: 'Cambios de M365 Copilot pendientes', placeHolder: 'Elige un archivo para ver el diff' },
		);
		if (picked) await this.showDiff(picked.uri);
	}

	// ------------------------------------------------------------- decoration

	private refreshDecorations(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			const file = this.pending.get(editor.document.uri.toString());
			if (!file || file.after === undefined) {
				editor.setDecorations(this.changedLines, []);
				continue;
			}
			const region = changedRegion(file.before ?? '', file.after);
			if (!region || region.end <= region.start) {
				editor.setDecorations(this.changedLines, []);
				continue;
			}
			const lastLine = Math.max(editor.document.lineCount - 1, 0);
			const start = Math.min(region.start, lastLine);
			const end = Math.min(region.end - 1, lastLine);
			editor.setDecorations(this.changedLines, [
				new vscode.Range(new vscode.Position(start, 0), new vscode.Position(end, 0)),
			]);
		}
	}

	// --------------------------------------------------------------- codelens

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const file = this.pending.get(document.uri.toString());
		if (!file) return [];
		const region = file.after === undefined ? null : changedRegion(file.before ?? '', file.after);
		const line = Math.min(region?.start ?? 0, Math.max(document.lineCount - 1, 0));
		const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
		const args = [file.uri];
		return [
			new vscode.CodeLens(range, {
				title: `$(check) Keep (${describeChange(file.before, file.after)})`,
				tooltip: 'Aceptar este cambio de M365 Copilot',
				command: 'm365copilot.keepEdits',
				arguments: args,
			}),
			new vscode.CodeLens(range, {
				title: '$(discard) Undo',
				tooltip: 'Revertir este cambio y restaurar el contenido anterior',
				command: 'm365copilot.undoEdits',
				arguments: args,
			}),
			new vscode.CodeLens(range, {
				title: '$(diff) Ver diff',
				tooltip: 'Comparar con el contenido anterior',
				command: 'm365copilot.showEditDiff',
				arguments: args,
			}),
		];
	}

	// ----------------------------------------------------------------- status

	private renderStatus(): void {
		const count = this.pending.size;
		if (count === 0) {
			this.status.hide();
			return;
		}
		this.status.text = `$(edit) M365: ${count} cambio(s) sin revisar`;
		this.status.tooltip = 'Cambios de M365 Copilot pendientes de Keep/Undo. Clic para revisarlos.';
		this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		this.status.show();
	}

	private previewUri(file: PendingFile, side: 'antes' | 'borrado'): vscode.Uri {
		return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${side}/${file.relativePath}` });
	}

	dispose(): void {
		this.changedLines.dispose();
		this.codeLensChanged.dispose();
		this.status.dispose();
		this.previews.dispose();
		for (const disposable of this.disposables) disposable.dispose();
		this.pending.clear();
		this.lastKept = [];
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertEditTextSize(value: string, name: string): void {
	if (value.length > MAX_EDIT_TEXT_CHARS) {
		throw new Error(`${name} supera el límite de ${MAX_EDIT_TEXT_CHARS} caracteres.`);
	}
}

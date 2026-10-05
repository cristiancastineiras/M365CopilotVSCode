import * as vscode from 'vscode';
import { relativePathForUri } from '../tools/common';
import { severityLabel } from '../tools/diagnosticsFormat';
import type { PromptCodeContext } from './participantPrompts';

/** Enough code to answer about a function or a class; more than this is truncated. */
const MAX_CONTEXT_CHARS = 16_000;
/** An enclosing symbol bigger than this is not "the code around the cursor" any more. */
const MAX_SYMBOL_LINES = 400;
/** Lines kept on each side of the cursor when there is no selection and no symbol. */
const WINDOW_LINES = 25;
const MAX_DIAGNOSTICS = 20;

/** Symbol kinds that make a good "the code you are in" unit. */
const ENCLOSING_KINDS: ReadonlySet<vscode.SymbolKind> = new Set([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Interface,
	vscode.SymbolKind.Enum,
	vscode.SymbolKind.Struct,
	vscode.SymbolKind.Module,
	vscode.SymbolKind.Namespace,
]);

export interface CodeContext extends PromptCodeContext {
	readonly uri: vscode.Uri;
	/** Whole lines covered by {@link PromptCodeContext.text}. */
	readonly range: vscode.Range;
}

/**
 * The code an editor action (or `@m365 /explain`…) should work on:
 *
 *  1. an explicit range (a code action passes the diagnostic's or the
 *     selection's range) — or the enclosing symbol around it, when it is a
 *     single line that would carry too little context on its own;
 *  2. otherwise the selection, widened to whole lines;
 *  3. otherwise the innermost function/class/… containing the cursor, as
 *     reported by the language's own symbol provider — so "explain" with no
 *     selection explains the function you are in, not one random line;
 *  4. otherwise a window of lines around the cursor.
 */
export async function captureCodeContext(
	document: vscode.TextDocument,
	options: { readonly selection?: vscode.Selection; readonly range?: vscode.Range } = {},
): Promise<CodeContext> {
	const range = await pickRange(document, options);
	return buildContext(document, range);
}

/** Context for a `#file`/`#selection` reference attached in the chat. */
export async function codeContextFromLocation(location: vscode.Location | vscode.Uri): Promise<CodeContext> {
	const uri = location instanceof vscode.Uri ? location : location.uri;
	const document = await vscode.workspace.openTextDocument(uri);
	const range =
		location instanceof vscode.Uri
			? new vscode.Range(0, 0, Math.max(document.lineCount - 1, 0), 0)
			: location.range;
	return buildContext(document, range);
}

/** The editor the user is working in, even while focus sits in the chat view. */
export function currentTextEditor(): vscode.TextEditor | undefined {
	return (
		vscode.window.activeTextEditor ??
		vscode.window.visibleTextEditors.find((editor) => editor.document.uri.scheme !== 'output')
	);
}

async function pickRange(
	document: vscode.TextDocument,
	options: { readonly selection?: vscode.Selection; readonly range?: vscode.Range },
): Promise<vscode.Range> {
	if (options.range) {
		if (options.range.end.line > options.range.start.line) return options.range;
		return (await enclosingSymbolRange(document, options.range.start)) ?? windowAround(document, options.range.start);
	}
	const selection = options.selection;
	if (selection && !selection.isEmpty) return selection;
	const cursor = selection?.active ?? new vscode.Position(0, 0);
	return (await enclosingSymbolRange(document, cursor)) ?? windowAround(document, cursor);
}

async function enclosingSymbolRange(
	document: vscode.TextDocument,
	position: vscode.Position,
): Promise<vscode.Range | undefined> {
	let symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
	try {
		symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
			'vscode.executeDocumentSymbolProvider',
			document.uri,
		);
	} catch {
		return undefined; // no symbol provider for this language
	}
	if (!symbols || symbols.length === 0) return undefined;

	let best: vscode.Range | undefined;
	const visit = (items: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[]) => {
		for (const symbol of items) {
			const range = 'location' in symbol ? symbol.location.range : symbol.range;
			if (!range.contains(position)) continue;
			const lines = range.end.line - range.start.line + 1;
			if (ENCLOSING_KINDS.has(symbol.kind) && lines <= MAX_SYMBOL_LINES) {
				// Innermost wins: children are visited after their parent.
				if (!best || best.contains(range)) best = range;
			}
			if ('children' in symbol && symbol.children.length > 0) visit(symbol.children);
		}
	};
	visit(symbols);
	return best;
}

function windowAround(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
	const start = Math.max(0, position.line - WINDOW_LINES);
	const end = Math.min(document.lineCount - 1, position.line + WINDOW_LINES);
	return new vscode.Range(start, 0, end, 0);
}

function buildContext(document: vscode.TextDocument, rawRange: vscode.Range): CodeContext {
	const lastLine = Math.max(document.lineCount - 1, 0);
	const startLine = Math.min(rawRange.start.line, lastLine);
	// A selection ending at column 0 of the next line does not include that line.
	const endLine = Math.max(
		startLine,
		Math.min(rawRange.end.character === 0 && rawRange.end.line > startLine ? rawRange.end.line - 1 : rawRange.end.line, lastLine),
	);
	const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);

	const fullText = document.getText(range);
	const text = fullText.length > MAX_CONTEXT_CHARS ? fullText.slice(0, MAX_CONTEXT_CHARS) : fullText;

	const diagnostics = vscode.languages
		.getDiagnostics(document.uri)
		.filter((diagnostic) => diagnostic.range.intersection(range) !== undefined)
		.slice(0, MAX_DIAGNOSTICS)
		.map((diagnostic) => {
			const where = `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
			const source = diagnostic.source ? ` (${diagnostic.source})` : '';
			return `${where} [${severityLabel(diagnostic.severity)}]${source} ${diagnostic.message}`;
		});

	return {
		uri: document.uri,
		range,
		relativePath: relativePathForUri(document.uri),
		languageId: document.languageId,
		startLine: startLine + 1,
		endLine: endLine + 1,
		text,
		truncatedChars: fullText.length - text.length,
		diagnostics,
	};
}

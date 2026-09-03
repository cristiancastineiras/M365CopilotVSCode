import * as vscode from 'vscode';
import {
	boundedInteger,
	ensureNotCancelled,
	errorMessage,
	readWorkspaceText,
	relativePathForUri,
	resolveWorkspacePath,
} from './common';
import { buildExcludeGlob } from './excludes';

const MAX_FILE_LIST_ENTRIES = 250;
const MAX_SEARCH_FILES = 600;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_LINE_CHARS = 260;

export interface ListFilesInput {
	readonly path?: string;
	readonly maxEntries?: number;
	readonly workspaceFolder?: string;
}

export interface SearchTextInput {
	readonly query: string;
	readonly path?: string;
	readonly maxResults?: number;
	readonly caseSensitive?: boolean;
	readonly workspaceFolder?: string;
}

/** Our baseline excludes merged with whatever the user configured, so the
 * agent never wanders into folders they deliberately hid from search. */
function excludeGlob(): string {
	return buildExcludeGlob(
		vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude'),
		vscode.workspace.getConfiguration('search').get<Record<string, unknown>>('exclude'),
	);
}

export async function listWorkspaceFiles(
	input: ListFilesInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const target = resolveWorkspacePath(input.path ?? '', input.workspaceFolder, { allowEmpty: true });
	const maxEntries = boundedInteger(input.maxEntries, 100, 1, MAX_FILE_LIST_ENTRIES);
	const pattern = target.relativePath ? `${target.relativePath}/**/*` : '**/*';
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(target.workspaceFolder, pattern),
		excludeGlob(),
		maxEntries + 1,
	);
	ensureNotCancelled(token);

	const limited = files.length > maxEntries;
	const visibleFiles = files
		.slice(0, maxEntries)
		.map(relativePathForUri)
		.sort((left, right) => left.localeCompare(right));

	if (visibleFiles.length === 0) {
		return `No hay archivos en ${target.relativePath || '.'} (o están todos excluidos).`;
	}

	return [
		`Archivos en ${target.relativePath || '.'}:`,
		'```text',
		...visibleFiles,
		'```',
		limited ? `Resultado limitado a ${maxEntries} archivos. Acota path antes de seguir.` : '',
	]
		.filter(Boolean)
		.join('\n');
}

export async function searchWorkspaceText(
	input: SearchTextInput,
	token: vscode.CancellationToken,
): Promise<string> {
	if (typeof input.query !== 'string' || !input.query.trim()) {
		throw new Error('query debe contener texto para buscar.');
	}
	const query = input.query.trim();
	if (query.length > 500) throw new Error('query no puede superar 500 caracteres.');

	const target = resolveWorkspacePath(input.path ?? '', input.workspaceFolder, { allowEmpty: true });
	const maxResults = boundedInteger(input.maxResults, 30, 1, MAX_SEARCH_RESULTS);
	const pattern = target.relativePath ? `${target.relativePath}/**/*` : '**/*';
	// One over the cap so we can tell "that's everything" from "there is more".
	const files = await vscode.workspace.findFiles(
		new vscode.RelativePattern(target.workspaceFolder, pattern),
		excludeGlob(),
		MAX_SEARCH_FILES + 1,
	);

	const moreFilesThanScanned = files.length > MAX_SEARCH_FILES;
	const scannable = files.slice(0, MAX_SEARCH_FILES);
	const caseSensitive = input.caseSensitive === true;
	const needle = caseSensitive ? query : query.toLocaleLowerCase();
	const matches: string[] = [];
	let scanned = 0;
	let skipped = 0;
	let hitResultCap = false;

	for (const file of scannable) {
		ensureNotCancelled(token);
		let text: string | undefined;
		try {
			text = await readWorkspaceText(file, 128 * 1024);
		} catch (error) {
			if (errorMessage(error).includes('cancelada')) throw error;
			skipped += 1; // binary, too large, unreadable — not "no match"
			continue;
		}
		if (text === undefined) {
			skipped += 1;
			continue;
		}
		scanned += 1;

		for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
			const haystack = caseSensitive ? line : line.toLocaleLowerCase();
			if (!haystack.includes(needle)) continue;
			const snippet = line.length > MAX_SEARCH_LINE_CHARS ? `${line.slice(0, MAX_SEARCH_LINE_CHARS)}...` : line;
			matches.push(`${relativePathForUri(file)}:${index + 1}: ${snippet}`);
			if (matches.length >= maxResults) {
				hitResultCap = true;
				break;
			}
		}
		if (hitResultCap) break;
	}

	// Being explicit about coverage matters: a bare "no matches" over a partial
	// scan reads as "this does not exist in the project", and the model will
	// act on that. Say what was actually looked at.
	const coverage: string[] = [];
	if (moreFilesThanScanned) {
		coverage.push(
			`AVISO: sólo se revisaron ${scanned} de más de ${MAX_SEARCH_FILES} archivos; la búsqueda NO es exhaustiva. Acota con path para cubrirlo todo.`,
		);
	}
	if (skipped > 0) coverage.push(`${skipped} archivo(s) omitidos por ser binarios o demasiado grandes.`);
	if (hitResultCap) coverage.push(`Se alcanzó el límite de ${maxResults} coincidencias; puede haber más.`);

	if (matches.length === 0) {
		return [
			`Sin coincidencias para «${query}» en ${target.relativePath || '.'} (${scanned} archivo(s) revisados${
				caseSensitive ? ', distinguiendo mayúsculas' : ''
			}).`,
			...coverage,
		].join('\n');
	}

	return [
		`Coincidencias para «${query}» (${matches.length} en ${scanned} archivo(s) revisados):`,
		'```text',
		...matches,
		'```',
		...coverage,
	].join('\n');
}

import * as path from 'node:path';
import * as vscode from 'vscode';

export const MAX_FILE_BYTES = 512 * 1024;

export interface ResolvedWorkspacePath {
	readonly uri: vscode.Uri;
	readonly relativePath: string;
	readonly workspaceFolder: vscode.WorkspaceFolder;
}

export function resolveWorkspacePath(
	value: unknown,
	workspaceFolderName: unknown,
	options: { readonly allowEmpty?: boolean } = {},
): ResolvedWorkspacePath {
	if (!vscode.workspace.isTrusted) {
		throw new Error('Las herramientas de M365 Copilot requieren un workspace de confianza.');
	}

	const workspaceFolder = resolveWorkspaceFolder(workspaceFolderName);
	const relativePath = normalizeRelativePath(value, options.allowEmpty ?? false);
	const uri = relativePath
		? vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split('/'))
		: workspaceFolder.uri;
	return { uri, relativePath, workspaceFolder };
}

export async function readWorkspaceText(
	uri: vscode.Uri,
	maxBytes = MAX_FILE_BYTES,
): Promise<string | undefined> {
	const openDocument = vscode.workspace.textDocuments.find(
		(document) => document.uri.toString() === uri.toString(),
	);
	if (openDocument) return openDocument.getText();

	let stat: vscode.FileStat;
	try {
		stat = await vscode.workspace.fs.stat(uri);
	} catch (error) {
		if (isFileNotFound(error)) return undefined;
		throw error;
	}
	if (!(stat.type & vscode.FileType.File)) {
		throw new Error(`La ruta no es un archivo: ${uri.path}`);
	}
	if (stat.size > maxBytes) {
		throw new Error(`El archivo supera el límite de ${Math.floor(maxBytes / 1024)} KB.`);
	}

	const bytes = await vscode.workspace.fs.readFile(uri);
	if (bytes.includes(0)) {
		throw new Error(binaryFileMessage(uri));
	}
	return new TextDecoder('utf-8').decode(bytes);
}

export function wholeDocumentRange(text: string): vscode.Range {
	const lines = text.split(/\r\n|\r|\n/);
	const lastLine = lines.length - 1;
	return new vscode.Range(0, 0, lastLine, lines[lastLine].length);
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export function relativePathForUri(uri: vscode.Uri): string {
	return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

export function inferLanguage(relativePath: string): string {
	const extension = path.posix.extname(relativePath).toLowerCase();
	return (
		{
			'.ts': 'ts',
			'.tsx': 'tsx',
			'.js': 'js',
			'.jsx': 'jsx',
			'.json': 'json',
			'.md': 'markdown',
			'.py': 'python',
			'.cs': 'csharp',
			'.css': 'css',
			'.html': 'html',
			'.yml': 'yaml',
			'.yaml': 'yaml',
		}[extension] ?? ''
	);
}

export function ensureNotCancelled(token: vscode.CancellationToken): void {
	if (token.isCancellationRequested) throw new Error('La operación fue cancelada.');
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function resolveWorkspaceFolder(workspaceFolderName: unknown): vscode.WorkspaceFolder {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) throw new Error('Abre una carpeta o workspace antes de usar herramientas.');

	const requested = typeof workspaceFolderName === 'string' ? workspaceFolderName.trim() : '';
	if (!requested && folders.length === 1) return folders[0];
	if (requested) {
		const folder = folders.find((candidate) => candidate.name === requested);
		if (folder) return folder;
		throw new Error(`No existe el workspaceFolder «${requested}».`);
	}

	throw new Error(
		`Hay varios workspaces abiertos (${folders.map((folder) => folder.name).join(', ')}). Especifica workspaceFolder.`,
	);
}

function normalizeRelativePath(value: unknown, allowEmpty: boolean): string {
	if (typeof value !== 'string') throw new Error('path debe ser una ruta relativa al workspace.');
	const raw = value.trim();
	if (!raw) {
		if (allowEmpty) return '';
		throw new Error('path no puede estar vacío.');
	}
	if (raw.includes('\0') || path.win32.isAbsolute(raw)) {
		throw new Error('path debe ser una ruta relativa dentro del workspace.');
	}

	const slashPath = raw.replace(/\\/g, '/');
	if (path.posix.isAbsolute(slashPath) || slashPath.split('/').some((part) => part === '..')) {
		throw new Error('path no puede salir del workspace.');
	}
	const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '');
	if (!normalized || normalized === '.') {
		if (allowEmpty) return '';
		throw new Error('path no puede apuntar a la raíz del workspace.');
	}
	if (normalized.split('/')[0] === '.git') {
		throw new Error('No se permite acceder a .git mediante herramientas.');
	}
	return normalized;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

/** Extensiones de formatos binarios habituales para los que merece la pena nombrar la causa
 * probable, en vez de un genérico "parece binario" que no orienta al modelo ni al usuario. */
const KNOWN_BINARY_KINDS: Readonly<Record<string, string>> = {
	'.pdf': 'un PDF',
	'.doc': 'un documento de Word antiguo (.doc)',
	'.docx': 'un documento de Word',
	'.xls': 'una hoja de Excel antigua (.xls)',
	'.xlsx': 'una hoja de Excel',
	'.ppt': 'una presentación de PowerPoint antigua (.ppt)',
	'.pptx': 'una presentación de PowerPoint',
	'.png': 'una imagen',
	'.jpg': 'una imagen',
	'.jpeg': 'una imagen',
	'.gif': 'una imagen',
	'.zip': 'un archivo comprimido',
};

/**
 * Mensaje de error para un archivo binario, pensado para que lo LEA EL MODELO (no el
 * usuario directamente): sin nombrar la causa probable y sin decirle explícitamente que
 * NO intente reconstruir el contenido a partir de bytes crudos, la tentación observada es
 * enviar igualmente esos bytes al modelo (o insistir en leer el archivo de otra forma) y
 * que éste intente «leerlo» de todos modos, produciendo una respuesta basada en ruido — grave
 * si el archivo es algo como un contrato y el usuario confía en la respuesta.
 */
function binaryFileMessage(uri: vscode.Uri): string {
	const extension = path.posix.extname(uri.path).toLowerCase();
	const kind = KNOWN_BINARY_KINDS[extension];
	const described = kind ? `${kind} (${extension})` : `un archivo binario (${extension || 'sin extensión'})`;
	return (
		`Este archivo parece ser ${described} y no se puede leer como texto: esta herramienta sólo lee texto plano, ` +
		'no extrae el contenido de formatos binarios/ofimáticos. NO intentes leerlo de otra forma ni inventes su ' +
		'contenido a partir de bytes crudos — dile al usuario que esta herramienta no puede abrir este tipo de ' +
		'archivo todavía, y pídele que pegue el texto relevante en el chat o lo exporte/guarde como .txt/.md si lo ' +
		'necesita.'
	);
}

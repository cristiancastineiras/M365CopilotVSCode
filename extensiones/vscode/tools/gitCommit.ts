import * as vscode from 'vscode';
import { ensureNotCancelled, type ResolvedWorkspacePath, resolveWorkspacePath } from './common';
import { validateConventionalCommitMessage } from './commitMessage';
import { execGit } from './git';

export interface GitCommitInput {
	readonly message?: string;
	/** Hace `git add -A` antes de commitear. Tiene prioridad sobre `paths`. */
	readonly stageAll?: boolean;
	/** Rutas relativas al workspace a `git add` antes de commitear. */
	readonly paths?: unknown;
	readonly workspaceFolder?: string;
}

const MAX_PATHS = 50;

/**
 * Crea un commit de verdad — la única herramienta de esta extensión que
 * modifica el historial del repositorio, así que `agentTools.ts` la registra
 * con `confirmationMessages`: el usuario ve el mensaje exacto y qué se va a
 * stagear antes de que se ejecute nada (mismo patrón que `ms365_run_command`).
 *
 * El mensaje se valida con {@link validateConventionalCommitMessage} en vez
 * de reescribirse: si no sigue Conventional Commits, la herramienta falla con
 * un error explicando el formato esperado, para que el modelo corrija la
 * llamada — igual que con cualquier otra entrada inválida en esta extensión.
 */
export async function commitWorkspace(input: GitCommitInput, token: vscode.CancellationToken): Promise<string> {
	const root = resolveWorkspacePath('', input.workspaceFolder, { allowEmpty: true });
	const message = validateConventionalCommitMessage(input.message);
	const paths = normalizePaths(input.paths, root);
	ensureNotCancelled(token);

	const stagedDescription: string[] = [];
	if (input.stageAll) {
		await execGit(['add', '-A'], root.uri.fsPath, token);
		stagedDescription.push('todos los cambios (`git add -A`)');
	} else if (paths.length > 0) {
		await execGit(['add', '--', ...paths], root.uri.fsPath, token);
		stagedDescription.push(...paths.map((p) => `\`${p}\``));
	}

	ensureNotCancelled(token);
	const staged = (await execGit(['diff', '--cached', '--name-status'], root.uri.fsPath, token)).trim();
	if (!staged) {
		throw new Error(
			'No hay nada en stage para commitear. Pasa stageAll o paths, o haz `git add` primero ' +
				'(por ejemplo con ms365_run_command).',
		);
	}

	await execGit(['commit', '-m', message], root.uri.fsPath, token);
	const summary = (await execGit(['show', '--stat', '--format=%H%n%s', '-1'], root.uri.fsPath, token)).trim();

	return [
		stagedDescription.length > 0
			? `Stage añadido antes de commitear: ${stagedDescription.join(', ')}.`
			: 'Se ha commiteado lo que ya estaba en stage (no se ha añadido nada nuevo).',
		'Commit creado:',
		'```text',
		summary,
		'```',
	].join('\n');
}

function normalizePaths(raw: unknown, root: ResolvedWorkspacePath): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) throw new Error('paths debe ser un array de rutas relativas al workspace.');
	if (raw.length > MAX_PATHS) throw new Error(`paths no puede tener más de ${MAX_PATHS} elementos.`);
	return raw.map((value) => resolveWorkspacePath(value, root.workspaceFolder.name).relativePath);
}

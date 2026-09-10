import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { ensureNotCancelled, resolveWorkspacePath } from './common';
import { buildGitArgs, normalizeGitAction, type GitAction } from './gitArgs';

const GIT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

export interface GitInfoInput {
	readonly action?: string;
	readonly path?: string;
	readonly staged?: boolean;
	readonly maxCount?: number;
	readonly workspaceFolder?: string;
}

/** Read-only: status, diff or log. Never commits, pushes or otherwise
 * mutates the repository — there is no write path here at all. */
export async function getGitInfo(input: GitInfoInput, token: vscode.CancellationToken): Promise<string> {
	const action: GitAction = normalizeGitAction(input.action);
	const root = resolveWorkspacePath('', input.workspaceFolder, { allowEmpty: true });
	const scoped =
		input.path && input.path.trim() ? resolveWorkspacePath(input.path, input.workspaceFolder) : undefined;
	ensureNotCancelled(token);

	const args = buildGitArgs(action, input, scoped?.relativePath);
	const output = await execGit(args, root.uri.fsPath, token);
	const label = scoped ? `${action} de ${scoped.relativePath}` : action;
	if (!output.trim()) return `git ${label}: sin salida.`;

	const trimmed = output.trimEnd();
	const truncated =
		trimmed.length > MAX_OUTPUT_CHARS ? `${trimmed.slice(0, MAX_OUTPUT_CHARS)}\n... (salida truncada)` : trimmed;
	return [`git ${label}:`, '```text', truncated, '```'].join('\n');
}

/** `execFile` with an argv array — never a shell string, so nothing in
 * `args` (including a workspace-relative path) can be interpreted as shell
 * syntax regardless of its content. Exported: `tools/gitCommit.ts` reuses it
 * for `git add`/`git commit` instead of spawning its own child process. */
export function execGit(args: string[], cwd: string, token: vscode.CancellationToken): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			'git',
			args,
			{ cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
			(error, stdout, stderr) => {
				cancelListener.dispose();
				if (error) {
					const err = error as NodeJS.ErrnoException;
					if (err.code === 'ENOENT') {
						reject(new Error('git no está instalado o no está en el PATH.'));
						return;
					}
					const message = stderr.trim() || err.message;
					if (/not a git repository/i.test(message)) {
						reject(new Error('Esta carpeta no es un repositorio git.'));
						return;
					}
					reject(new Error(`git falló: ${message}`));
					return;
				}
				resolve(stdout);
			},
		);
		const cancelListener = token.onCancellationRequested(() => child.kill());
	});
}

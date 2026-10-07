import * as vscode from 'vscode';
import { ensureNotCancelled, errorMessage, resolveWorkspacePath } from './common';
import { getGitInfo } from './git';
import { getGitRepository } from './gitExtension';
import { t } from '../src/i18n';

export interface GenerateCommitMessageInput {
	readonly workspaceFolder?: string;
}

/** El comando nativo puede tardar si tiene que ir a buscar un modelo de chat;
 * pasado esto se sigue adelante con sólo el diff, en vez de dejar el turno
 * colgado. */
const GENERATE_TIMEOUT_MS = 20_000;

/**
 * Envuelve el comando NATIVO de VS Code «Generate Commit Message» — el icono
 * ✨ del panel de Source Control, `git.generateCommitMessage` — en vez de
 * reimplementar la generación: lo dispara de verdad sobre el repositorio del
 * workspace (usa el modelo de chat que tengas activo en ese momento en VS
 * Code, que puede ser el propio M365 Copilot si lo tienes seleccionado) y lee
 * lo que deja escrito en el input box de Source Control.
 *
 * Ese comando no es fiable al 100 % — puede no escribir nada si no hay ningún
 * modelo de chat disponible ahora mismo, o si VS Code aún no lo tiene
 * registrado — así que el resultado incluye SIEMPRE también el diff en stage
 * (vía {@link getGitInfo}), para que el modelo que llamó a esta herramienta
 * pueda redactar o corregir el mensaje él mismo con Conventional Commits
 * antes de pasarlo a `m365_git_commit`.
 */
export async function generateCommitMessage(
	input: GenerateCommitMessageInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const root = resolveWorkspacePath('', input.workspaceFolder, { allowEmpty: true });
	ensureNotCancelled(token);
	const repository = await getGitRepository(root.uri);

	const hasStaged = repository.state.indexChanges.length > 0;
	const hasUnstaged = repository.state.workingTreeChanges.length > 0;
	if (!hasStaged && !hasUnstaged) {
		return t('genCommit.noChanges');
	}

	const before = repository.inputBox.value;
	let generated = '';
	let generationError: string | null = null;
	try {
		await withTimeout(
			Promise.resolve(vscode.commands.executeCommand('git.generateCommitMessage', repository)),
			GENERATE_TIMEOUT_MS,
		);
		ensureNotCancelled(token);
		generated = repository.inputBox.value.trim();
	} catch (error) {
		generationError = errorMessage(error);
	}

	const diff = await getGitInfo(
		{ action: 'diff', staged: hasStaged, workspaceFolder: input.workspaceFolder },
		token,
	);

	const noMessageReason = generationError ? t('genCommit.errorReason', generationError) : t('genCommit.noModelReason');
	const messageSection =
		generated && generated !== before.trim()
			? t('genCommit.generated', generated)
			: t('genCommit.notGenerated', noMessageReason);

	return [
		!hasStaged ? t('genCommit.nothingStaged', 'm365_git_commit') : null,
		messageSection,
		t('genCommit.checkConventional', 'm365_git_commit'),
		diff,
	]
		.filter((line): line is string => line !== null)
		.join('\n\n');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(t('genCommit.timeout', Math.round(ms / 1000)))),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

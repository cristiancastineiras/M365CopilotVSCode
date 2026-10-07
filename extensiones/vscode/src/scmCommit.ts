/**
 * "Generate commit message with M365 Copilot" — a button in the Source
 * Control title bar (and an entry in the quick menu) that writes the message
 * straight into the repository's commit box.
 *
 * Unlike the `m365_generate_commit_message` agent tool, which triggers VS
 * Code's native ✨ generator (answered by whatever model Copilot Chat uses),
 * this asks Microsoft 365 Copilot directly, in one turn, from the staged diff
 * — or the working tree's when nothing is staged. It never commits: the
 * message lands in the box for the user to review.
 */
import * as vscode from 'vscode';
import { streamCopilotTurnWithRetry } from './client';
import { requireUsableProfile } from './commands';
import { editorTone } from './models';
import type { ProfileStore } from './secrets';
import { buildCommitMessagePrompt, cleanGeneratedCommitMessage } from '../tools/commitMessage';
import { execGit } from '../tools/git';
import { getGitRepository, listGitRepositories, type GitRepository } from '../tools/gitExtension';
import { errorMessage } from '../tools/common';
import { t } from './i18n';

export function registerScmCommands(store: ProfileStore, log: (message: string) => void): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('m365copilot.generateCommitMessage', (source?: unknown) =>
			generateCommitMessage(store, log, source),
		),
	];
}

async function generateCommitMessage(store: ProfileStore, log: (message: string) => void, source: unknown) {
	const profile = await requireUsableProfile(store);
	if (!profile) return;

	let repository: GitRepository | undefined;
	try {
		repository = await resolveRepository(source);
	} catch (error) {
		void vscode.window.showErrorMessage(t('scm.failed', errorMessage(error)));
		return;
	}
	if (!repository) return;
	const target = repository;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.SourceControl, title: t('scm.progress'), cancellable: true },
		async (_progress, token) => {
			const controller = new AbortController();
			const cancel = token.onCancellationRequested(() => controller.abort());
			try {
				const cwd = target.rootUri.fsPath;
				let staged = true;
				let diff = await execGit(['diff', '--cached', '--no-color'], cwd, token);
				let files = await execGit(['diff', '--cached', '--name-status'], cwd, token);
				if (!diff.trim()) {
					staged = false;
					diff = await execGit(['diff', '--no-color'], cwd, token);
					files = await execGit(['status', '--porcelain=v1'], cwd, token);
				}
				if (!diff.trim() && !files.trim()) {
					void vscode.window.showInformationMessage(t('scm.noChanges'));
					return;
				}

				let answer = '';
				await streamCopilotTurnWithRetry({
					profile,
					prompt: buildCommitMessagePrompt({ files: lines(files), diff, staged }),
					tone: editorTone(),
					signal: controller.signal,
					log,
					callbacks: { onText: (delta) => (answer += delta) },
				});
				const message = cleanGeneratedCommitMessage(answer);
				log(t('log.commitMessage', message.length, diff.length));
				if (!message) {
					void vscode.window.showWarningMessage(t('scm.empty'));
					return;
				}
				target.inputBox.value = message;
				void vscode.window.setStatusBarMessage(t('scm.done'), 6000);
			} catch (error) {
				if (token.isCancellationRequested) return;
				void vscode.window.showErrorMessage(t('scm.failed', errorMessage(error)));
			} finally {
				cancel.dispose();
			}
		},
	);
}

/**
 * The repository to describe: the one whose Source Control title bar was
 * clicked (VS Code passes its `SourceControl`, which carries `rootUri`), the
 * only one open, or the one the user picks.
 */
export async function resolveRepository(source: unknown): Promise<GitRepository | undefined> {
	const rootUri = (source as { rootUri?: unknown } | undefined)?.rootUri;
	if (rootUri instanceof vscode.Uri) return getGitRepository(rootUri);

	const repositories = await listGitRepositories();
	if (repositories.length === 0) {
		void vscode.window.showWarningMessage(t('scm.noRepository'));
		return undefined;
	}
	if (repositories.length === 1) return repositories[0];

	const picked = await vscode.window.showQuickPick(
		repositories.map((repository) => ({
			label: vscode.workspace.asRelativePath(repository.rootUri, true) || repository.rootUri.fsPath,
			description: repository.rootUri.fsPath,
			repository,
		})),
		{ placeHolder: t('scm.pickRepository') },
	);
	return picked?.repository;
}

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);
}

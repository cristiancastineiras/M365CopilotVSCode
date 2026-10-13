/**
 * What the Source Control "Generate commit message with M365 Copilot" button
 * (scmCommit.ts) asks the model to describe.
 *
 * Kept free of the `vscode` import — git runs through an injected
 * {@link GitRunner} — so test/e2e.mts can drive it against a real repository.
 */
import { parseStatus, readUntrackedPreview, STATUS_ARGS, type GitRunner } from './autoCommitGit';
import { describeEntry } from './autoCommitPrompt';
import { diffStats, formatStat, renderUntrackedDiff } from '../tools/commitContext';
import type { CommitPromptInput } from '../tools/commitMessage';

/** New files whose content goes into the prompt; the rest are listed by name. */
const MAX_UNTRACKED_PREVIEWS = 30;

/**
 * The staged changes, or — when nothing is staged — everything in the
 * working tree, new files with their content (not only their names: they are
 * often the very point of the commit). Each file line carries its line
 * counts. Undefined when there is nothing to describe.
 */
export async function readChangesToDescribe(
	git: GitRunner,
	root: string,
): Promise<Pick<CommitPromptInput, 'files' | 'diff' | 'staged'> | undefined> {
	const quiet = ['-c', 'core.quotePath=false'];
	const stagedDiff = await git([...quiet, 'diff', '--cached', '--no-color', '--no-ext-diff', '-M']);
	if (stagedDiff.trim()) {
		const stats = diffStats(stagedDiff);
		const files = lines(await git([...quiet, 'diff', '--cached', '--name-status', '-M'])).map((line) => {
			const stat = formatStat(stats.get(line.split('\t').at(-1) ?? ''));
			return stat ? `${line}\t${stat}` : line;
		});
		return { files, diff: stagedDiff, staged: true };
	}

	const entries = parseStatus(await git(STATUS_ARGS));
	if (entries.length === 0) return undefined;
	const tracked = await git([...quiet, 'diff', '--no-color', '--no-ext-diff', '-M']);
	const untracked: string[] = [];
	for (const entry of entries.filter((item) => item.index === '?').slice(0, MAX_UNTRACKED_PREVIEWS)) {
		const preview = await readUntrackedPreview(root, entry.path);
		if (preview) untracked.push(renderUntrackedDiff(preview));
	}
	const diff = [tracked.trimEnd(), ...untracked].filter(Boolean).join('\n');
	const stats = diffStats(diff);
	return { files: entries.map((entry) => describeEntry(entry, stats.get(entry.path))), diff, staged: false };
}

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);
}

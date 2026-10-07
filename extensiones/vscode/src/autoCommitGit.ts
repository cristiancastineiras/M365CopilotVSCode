/**
 * Git side of the auto-commit (autoCommit.ts): the repository's state, what
 * changed (with a fingerprint to know whether anything moved since the last
 * look), committing a group of files and undoing an auto-commit.
 *
 * Kept free of the `vscode` import — git runs through an injected
 * {@link GitRunner} — so test/e2e.mts can drive it against a real repository.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Runs `git <args>` in the repository and resolves its stdout; rejects on a non-zero exit. */
export type GitRunner = (args: string[], options?: { readonly timeoutMs?: number }) => Promise<string>;

/** One line of `git status --porcelain=v1`. */
export interface StatusEntry {
	/** Index column (X): ' ', M, A, D, R, C, U or '?' for untracked. */
	readonly index: string;
	/** Working-tree column (Y). */
	readonly worktree: string;
	/** Repository-relative, `/`-separated. */
	readonly path: string;
	/** Where a staged rename or copy came from. */
	readonly origPath?: string;
}

export interface UntrackedFile {
	readonly path: string;
	readonly size: number;
	/** The start of the file; undefined for a binary file. */
	readonly content?: string;
	readonly truncated: boolean;
}

export interface ChangeSnapshot {
	readonly entries: readonly StatusEntry[];
	/** `git diff HEAD`: staged and unstaged changes of the tracked files. */
	readonly diff: string;
	readonly untracked: readonly UntrackedFile[];
	/** Equal fingerprints ⇔ same HEAD and same changes, to the byte. */
	readonly fingerprint: string;
}

export type OperationInProgress = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

export interface RepoState {
	/** Undefined on a detached HEAD. */
	readonly branch?: string;
	/** Undefined while the repository has no commits. */
	readonly head?: string;
	/** Committer date of HEAD, in ms. */
	readonly headTime?: number;
	readonly headSubject?: string;
	readonly inProgress?: OperationInProgress;
}

/** What one auto-commit round created, to undo it. */
export interface CommitRound {
	/** HEAD before the round. */
	readonly before: string;
	/** HEAD after it. */
	readonly after: string;
	readonly subjects: readonly string[];
	/** Every path the round committed (renames: both sides). */
	readonly paths: readonly string[];
}

/** Thrown by {@link undoCommits} when HEAD is no longer the round's last commit. */
export class HeadMovedError extends Error {}

/** Hooks (lint-staged and friends) run on `git commit`; a status never takes this long. */
const COMMIT_TIMEOUT_MS = 120_000;
/** How much of a new file the model gets to see. */
const UNTRACKED_PREVIEW_BYTES = 6_000;

const STATUS_ARGS = ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'];
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
const OPERATION_FILES: readonly (readonly [string, OperationInProgress])[] = [
	['MERGE_HEAD', 'merge'],
	['rebase-merge', 'rebase'],
	['rebase-apply', 'rebase'],
	['CHERRY_PICK_HEAD', 'cherry-pick'],
	['REVERT_HEAD', 'revert'],
	['BISECT_LOG', 'bisect'],
];

/**
 * Parses `git status --porcelain=v1 -z`: `XY path\0`, and for a rename or
 * copy `XY new\0old\0`. Leaves out nested repositories (`?? dir/`), which
 * cannot be added as files, and files added then deleted (`AD`), which have
 * nothing left to commit.
 */
export function parseStatus(output: string): StatusEntry[] {
	const fields = output.split('\0');
	const entries: StatusEntry[] = [];
	for (let i = 0; i < fields.length; i += 1) {
		const field = fields[i];
		if (field.length < 4) continue;
		const index = field[0];
		const worktree = field[1];
		const file = field.slice(3);
		const origPath = 'RC'.includes(index) || 'RC'.includes(worktree) ? fields[++i] : undefined;
		if (file.endsWith('/')) continue;
		if (index === 'A' && worktree === 'D') continue;
		entries.push(origPath ? { index, worktree, path: file, origPath } : { index, worktree, path: file });
	}
	return entries;
}

export function hasConflicts(entries: readonly StatusEntry[]): boolean {
	return entries.some((entry) => UNMERGED.has(entry.index + entry.worktree));
}

export async function readRepoState(git: GitRunner): Promise<RepoState> {
	const gitDir = (await git(['rev-parse', '--absolute-git-dir'])).trim();
	let inProgress: OperationInProgress | undefined;
	for (const [file, operation] of OPERATION_FILES) {
		if (await exists(path.join(gitDir, file))) {
			inProgress = operation;
			break;
		}
	}
	const branch = (await git(['symbolic-ref', '-q', '--short', 'HEAD']).catch(() => '')).trim() || undefined;
	// Fails in a repository without commits.
	const log = await git(['log', '-1', '--format=%H%x00%ct%x00%s']).catch(() => '');
	const [head, time, subject] = log.trim().split('\0');
	return {
		branch,
		head: head || undefined,
		headTime: time ? Number(time) * 1000 : undefined,
		headSubject: subject,
		inProgress,
	};
}

/** Whether the repository is a submodule of another one (those are left alone). */
export async function isSubmodule(git: GitRunner): Promise<boolean> {
	return (await git(['rev-parse', '--show-superproject-working-tree']).catch(() => '')).trim() !== '';
}

/** Everything not committed yet — staged, unstaged and untracked — against `head`. */
export async function readChanges(git: GitRunner, root: string, head: string): Promise<ChangeSnapshot> {
	const status = await git(STATUS_ARGS);
	const entries = parseStatus(status);
	const hash = createHash('sha1').update(head).update('\0').update(status);
	if (entries.length === 0) return { entries, diff: '', untracked: [], fingerprint: hash.digest('hex') };

	const diff = await git(['-c', 'core.quotePath=false', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '-M']);
	hash.update('\0').update(diff);
	const untracked: UntrackedFile[] = [];
	for (const entry of entries) {
		if (entry.index !== '?') continue;
		const file = await readUntracked(root, entry.path);
		if (!file) continue;
		untracked.push(file.preview);
		hash.update(`\0${entry.path}\0${file.preview.size}\0${file.mtimeMs}`);
	}
	return { entries, diff, untracked, fingerprint: hash.digest('hex') };
}

async function readUntracked(
	root: string,
	relativePath: string,
): Promise<{ preview: UntrackedFile; mtimeMs: number } | undefined> {
	const absolute = path.join(root, relativePath);
	let handle: fs.FileHandle | undefined;
	try {
		const stat = await fs.stat(absolute);
		if (!stat.isFile()) return undefined;
		handle = await fs.open(absolute, 'r');
		const buffer = Buffer.alloc(Math.min(stat.size, UNTRACKED_PREVIEW_BYTES));
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const bytes = buffer.subarray(0, bytesRead);
		const binary = bytes.includes(0);
		return {
			preview: {
				path: relativePath,
				size: stat.size,
				content: binary ? undefined : bytes.toString('utf8'),
				truncated: stat.size > bytesRead,
			},
			mtimeMs: stat.mtimeMs,
		};
	} catch {
		return undefined;
	} finally {
		await handle?.close();
	}
}

/**
 * The pathspecs to commit `files` (as listed by `git status`):
 *  - `add`: what `git add -A` has to stage first — everything in the index
 *    or the working tree. A deletion that is already staged, and the old side
 *    of a staged rename, only exist in HEAD, and `git add` fails on them;
 *  - `commit`: what `git commit -- <paths>` takes, both sides of a rename
 *    included, so the commit holds those files and nothing else — what the
 *    user had staged for other files stays staged.
 */
export function pathsToCommit(
	entries: readonly StatusEntry[],
	files: readonly string[],
): { readonly add: string[]; readonly commit: string[] } {
	const selected = new Set(files);
	const add = new Set<string>();
	const commit = new Set<string>();
	for (const entry of entries) {
		const renamed = entry.index === 'R' ? entry.origPath : undefined;
		if (!selected.has(entry.path) && !(renamed && selected.has(renamed))) continue;
		commit.add(entry.path);
		if (!(entry.index === 'D' && entry.worktree === ' ')) add.add(entry.path);
		if (renamed) commit.add(renamed);
	}
	return { add: [...add], commit: [...commit] };
}

/**
 * Commits exactly `files`, whole (working-tree version), with `message`, and
 * resolves the new HEAD. Pre-commit hooks run as usual. If the commit fails,
 * what this staged and the user had not is unstaged again.
 */
export async function commitFiles(
	git: GitRunner,
	entries: readonly StatusEntry[],
	files: readonly string[],
	message: string,
): Promise<{ readonly sha: string; readonly paths: readonly string[] }> {
	const { add, commit } = pathsToCommit(entries, files);
	if (commit.length === 0) throw new Error('nothing to commit');
	if (add.length > 0) await git(['--literal-pathspecs', 'add', '-A', '--', ...add]);
	try {
		await git(['--literal-pathspecs', 'commit', '--quiet', '-m', message, '--', ...commit], {
			timeoutMs: COMMIT_TIMEOUT_MS,
		});
	} catch (error) {
		const stagedByUs = entries
			.filter((entry) => add.includes(entry.path) && (entry.index === ' ' || entry.index === '?'))
			.map((entry) => entry.path);
		if (stagedByUs.length > 0) await git(['--literal-pathspecs', 'reset', '-q', '--', ...stagedByUs]).catch(() => '');
		throw error;
	}
	return { sha: (await git(['rev-parse', 'HEAD'])).trim(), paths: commit };
}

/**
 * Takes the round's commits back out of the history, leaving their changes
 * in the working tree, unstaged — as they were before (new files untracked
 * again). Refuses when someone committed on top since.
 */
export async function undoCommits(git: GitRunner, round: CommitRound): Promise<void> {
	const head = (await git(['rev-parse', 'HEAD'])).trim();
	if (head !== round.after) throw new HeadMovedError(head);
	await git(['reset', '--soft', round.before]);
	if (round.paths.length > 0) await git(['--literal-pathspecs', 'reset', '-q', '--', ...round.paths]);
}

/** Milliseconds still to wait before another commit is allowed (0 = go). */
export function cooldownRemaining(now: number, lastCommitAt: number | undefined, minIntervalMs: number): number {
	if (lastCommitAt === undefined || minIntervalMs <= 0) return 0;
	return Math.max(0, lastCommitAt + minIntervalMs - now);
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

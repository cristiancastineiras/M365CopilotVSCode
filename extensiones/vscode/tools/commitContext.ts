/**
 * What the model gets to see before writing a commit message, shared by the
 * Source Control button (scmCommit.ts → commitMessage.ts) and the auto-commit
 * (autoCommitPrompt.ts):
 *  - a diff that fits the prompt without hiding any file: the budget is
 *    shared out between files instead of cutting the tail off, and lock or
 *    generated files are reduced to their line counts;
 *  - how many lines each file gained and lost, to tell the main change from
 *    the small touches around it;
 *  - the repository's own conventions: its latest subjects and the scopes it
 *    already uses;
 *  - the ticket the branch name refers to, if any.
 *
 * Kept free of the `vscode` import so test/e2e.mts can check it.
 */
import type { UntrackedFile } from '../src/autoCommitGit';
import { t } from '../src/i18n';

/** Subjects shown to the model as examples of the repository's style. */
const MAX_EXAMPLE_SUBJECTS = 8;
const MAX_SCOPES = 10;

// ------------------------------------------------------------------- diff

export interface DiffStat {
	readonly added: number;
	readonly removed: number;
}

export interface DiffSection extends DiffStat {
	/** Repository-relative path (the new side of a rename, the old one of a deletion). */
	readonly path: string;
	readonly text: string;
}

/** Their diff says nothing about the change: what matters is in the files that produced them. */
const LOCK_FILES = new Set([
	'pnpm-lock.yaml',
	'package-lock.json',
	'npm-shrinkwrap.json',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'Cargo.lock',
	'poetry.lock',
	'Pipfile.lock',
	'uv.lock',
	'composer.lock',
	'Gemfile.lock',
	'go.sum',
	'packages.lock.json',
	'flake.lock',
	'pubspec.lock',
	'mix.lock',
	'Podfile.lock',
]);
const GENERATED = [
	/\.min\.(?:js|mjs|cjs|css)$/i,
	/\.map$/i,
	/\.snap$/i,
	/(?:^|\/)__snapshots__\//,
	/(?:^|\/)(?:dist|build|out|coverage|\.next|\.nuxt|\.output)\//,
];

export function isNoisePath(file: string): boolean {
	const name = file.slice(file.lastIndexOf('/') + 1);
	return LOCK_FILES.has(name) || GENERATED.some((pattern) => pattern.test(file));
}

/** Splits a unified diff into one section per file (`diff --git …`). */
export function splitDiff(diff: string): { readonly preamble: string; readonly sections: DiffSection[] } {
	const text = diff.replace(/\r\n?/g, '\n');
	const starts = [...text.matchAll(/^diff --git /gm)].map((match) => match.index ?? 0);
	if (starts.length === 0) return { preamble: text, sections: [] };
	return {
		preamble: text.slice(0, starts[0]),
		sections: starts.map((start, i) => describeSection(text.slice(start, starts[i + 1] ?? text.length).replace(/\n+$/, ''))),
	};
}

function describeSection(text: string): DiffSection {
	const lines = text.split('\n');
	let file = '';
	let content = -1;
	for (let i = 1; i < lines.length && content === -1; i += 1) {
		const line = lines[i];
		if (line.startsWith('@@')) content = i;
		else if (line.startsWith('+++ ')) {
			file = stripSide(line.slice(4)) || file;
			content = i + 1;
		} else if (line.startsWith('--- ')) file = stripSide(line.slice(4)) || file;
		else if (line.startsWith('rename to ')) file = line.slice('rename to '.length);
	}
	if (!file) {
		const header = lines[0];
		const at = header.lastIndexOf(' b/');
		file = at === -1 ? header.slice('diff --git '.length) : header.slice(at + 3);
	}
	let added = 0;
	let removed = 0;
	for (const line of lines.slice(content === -1 ? 1 : content)) {
		if (line.startsWith('+')) added += 1;
		else if (line.startsWith('-')) removed += 1;
	}
	return { path: file, text, added, removed };
}

/** `b/src/a.ts` → `src/a.ts`; `/dev/null` → ''. */
function stripSide(value: string): string {
	const file = value.replace(/\t.*$/, '').replace(/^"|"$/g, '');
	if (file === '/dev/null') return '';
	return file.replace(/^[ab]\//, '');
}

/** Lines gained and lost per file, keyed by {@link DiffSection.path}. */
export function diffStats(diff: string): Map<string, DiffStat> {
	return new Map(splitDiff(diff).sections.map((section) => [section.path, section]));
}

export function formatStat(stat: DiffStat | undefined): string {
	return stat ? `+${stat.added} -${stat.removed}` : '';
}

/**
 * The diff cut down to about `maxChars`. Lock and generated files always
 * shrink to their header and line counts. If the rest still does not fit,
 * the budget is shared out like water: small files stay whole, big ones keep
 * their header and as many lines as their share allows — so every file is
 * still in the prompt, not only the first ones.
 */
export function budgetDiff(diff: string, maxChars: number): string {
	const { preamble, sections } = splitDiff(diff);
	if (sections.length === 0) {
		return diff.length > maxChars ? `${diff.slice(0, maxChars)}\n${t('scm.prompt.truncated', diff.length - maxChars)}` : diff;
	}
	const head = preamble.trim();
	const parts = sections.map((section) =>
		isNoisePath(section.path)
			? `${section.text.split('\n', 1)[0]}\n${t('commit.diff.omitted', section.added, section.removed)}`
			: section.text,
	);
	const total = parts.reduce((size, part) => size + part.length + 1, head.length);
	if (total <= maxChars) return [head, ...parts].filter(Boolean).join('\n');

	const allowance = parts.map(() => 0);
	const bySize = parts.map((_, i) => i).sort((a, b) => parts[a].length - parts[b].length);
	let remaining = Math.max(0, maxChars - head.length);
	bySize.forEach((index, k) => {
		allowance[index] = Math.min(parts[index].length, Math.floor(remaining / (bySize.length - k)));
		remaining -= allowance[index];
	});
	return [head, ...parts.map((part, i) => fitSection(part, allowance[i]))].filter(Boolean).join('\n');
}

/** The section's first lines up to `allowance` characters; its `diff --git` line always stays. */
function fitSection(part: string, allowance: number): string {
	if (part.length <= allowance) return part;
	const lines = part.split('\n');
	let size = lines[0].length;
	let kept = 1;
	while (kept < lines.length && size + 1 + lines[kept].length <= allowance) {
		size += 1 + lines[kept].length;
		kept += 1;
	}
	return [...lines.slice(0, kept), t('commit.diff.fileTruncated', lines.length - kept)].join('\n');
}

/** A new, untracked file as the diff git would show once it is added. */
export function renderUntrackedDiff(file: UntrackedFile): string {
	const header = `diff --git a/${file.path} b/${file.path}\nnew file\n--- /dev/null\n+++ b/${file.path}`;
	if (file.content === undefined) return `${header}\n${t('autoCommit.prompt.binary', file.size)}`;
	const lines = file.content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
	const body = lines.map((line) => `+${line}`).join('\n');
	return `${header}\n${body}${file.truncated ? `\n${t('autoCommit.prompt.fileTruncated', file.size)}` : ''}`;
}

// -------------------------------------------------------------- repository

/**
 * The repository's conventions out of its latest subjects (newest first,
 * merges left out): a few of them as examples, and the scopes it uses with
 * how often — so the new commit says `(vscode)` like the other forty, not
 * `(extension)`. Empty when there is no history yet.
 */
export function historyContext(subjects: readonly string[]): string[] {
	const recent = subjects.filter(Boolean).slice(0, MAX_EXAMPLE_SUBJECTS);
	if (recent.length === 0) return [];
	const scopes = new Map<string, number>();
	for (const subject of subjects) {
		const scope = /^[a-z]+\(([^)\s]+)\)!?: /iu.exec(subject)?.[1];
		if (scope) scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
	}
	const top = [...scopes]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, MAX_SCOPES)
		.map(([scope, count]) => `${scope} (${count})`);
	return [
		t('commit.context.recent'),
		...recent.map((subject) => `- ${subject}`),
		...(top.length > 0 ? [t('commit.context.scopes', top.join(', '))] : []),
	];
}

/**
 * The ticket a branch name points to: a tracker key (`feature/ABC-123-login`
 * → `ABC-123`) or a GitHub issue number at the start of its last segment
 * (`fix/42-crash` → `#42`). Lower-case keys are left alone on purpose:
 * `fix/utf-8-names` is not ticket UTF-8.
 */
export function ticketFromBranch(branch: string | undefined): string | undefined {
	if (!branch) return undefined;
	const key = /(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d+)(?![A-Za-z0-9])/.exec(branch)?.[1];
	if (key) return key;
	const issue = /^(\d+)[-_]/.exec(branch.slice(branch.lastIndexOf('/') + 1))?.[1];
	return issue ? `#${issue}` : undefined;
}

// ------------------------------------------------------------------- text

/** Word-wraps `text` at `width` columns: `first` before the first line, `rest` before the others. */
export function wrap(text: string, width: number, first: string, rest: string): string {
	const lines: string[] = [];
	let line = first;
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const prefix = lines.length === 0 ? first : rest;
		if (line.length > prefix.length && line.length + 1 + word.length > width) {
			lines.push(line);
			line = rest + word;
		} else {
			line += line.length > prefix.length ? ` ${word}` : word;
		}
	}
	lines.push(line);
	return lines.join('\n');
}

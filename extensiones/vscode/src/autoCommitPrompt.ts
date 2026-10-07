/**
 * Prompt and answer parsing for the auto-commit (autoCommit.ts): one BizChat
 * turn that sees the uncommitted changes and answers with a JSON decision —
 * wait, or commit them as one or a few commits, each with its files and a
 * documented Conventional Commits message.
 *
 * Kept free of the `vscode` import, like reviewPrompt.ts, so the tests can
 * check the prompt and every answer shape the model likes to produce.
 */
import type { StatusEntry, UntrackedFile } from './autoCommitGit';
import { CONVENTIONAL_COMMIT_TYPES, cleanGeneratedCommitMessage, validateConventionalCommitMessage } from '../tools/commitMessage';
import { t } from './i18n';

/** Unrelated finished changes may become separate commits — but never a flood of them. */
export const MAX_COMMITS_PER_ROUND = 3;
/** Above this many changed files the developer commits by hand: generated output, a mass rename… */
export const MAX_CHANGED_FILES = 150;

const MAX_PROMPT_DIFF_CHARS = 24_000;
const MAX_PROMPT_FILES = 80;
const MAX_RECENT_SUBJECTS = 6;
const MAX_REASON_CHARS = 200;
const BODY_WIDTH = 72;

export interface AutoCommitPromptInput {
	readonly entries: readonly StatusEntry[];
	readonly diff: string;
	readonly untracked: readonly UntrackedFile[];
	readonly branch: string;
	readonly lastCommit?: { readonly minutesAgo: number; readonly subject: string };
	/** How long these changes have been piling up. */
	readonly pendingMinutes?: number;
	/** What the model said the last time it chose to wait. */
	readonly lastWaitReason?: string;
	/** Subjects of the latest commits, newest first: the repository's style. */
	readonly recentSubjects: readonly string[];
}

export interface AutoCommitGroup {
	/** Paths as `git status` lists them. */
	readonly files: readonly string[];
	/** Already validated as Conventional Commits. */
	readonly message: string;
}

export type AutoCommitDecision =
	| { readonly kind: 'commit'; readonly commits: readonly AutoCommitGroup[] }
	| { readonly kind: 'wait'; readonly reason: string }
	| { readonly kind: 'invalid'; readonly reason: string };

export function buildAutoCommitPrompt(input: AutoCommitPromptInput): string {
	const state = [t('autoCommit.prompt.branch', input.branch)];
	if (input.lastCommit) state.push(t('autoCommit.prompt.lastCommit', input.lastCommit.minutesAgo, input.lastCommit.subject));
	if (input.pendingMinutes !== undefined) state.push(t('autoCommit.prompt.pendingFor', input.pendingMinutes));
	if (input.lastWaitReason) state.push(t('autoCommit.prompt.lastWait', input.lastWaitReason));

	const recent = input.recentSubjects.slice(0, MAX_RECENT_SUBJECTS);
	const files = input.entries.slice(0, MAX_PROMPT_FILES).map(describeEntry);
	if (input.entries.length > files.length) files.push(`- … (+${input.entries.length - files.length})`);

	const fullDiff = [input.diff.trimEnd(), ...input.untracked.map(renderUntracked)].filter(Boolean).join('\n');
	const diff =
		fullDiff.length > MAX_PROMPT_DIFF_CHARS
			? `${fullDiff.slice(0, MAX_PROMPT_DIFF_CHARS)}\n${t('scm.prompt.truncated', fullDiff.length - MAX_PROMPT_DIFF_CHARS)}`
			: fullDiff;

	const context = [
		t('autoCommit.prompt.state'),
		...state.map((line) => `- ${line}`),
		'',
		...(recent.length > 0 ? [t('autoCommit.prompt.recent'), ...recent.map((subject) => `- ${subject}`), ''] : []),
		t('scm.prompt.files', input.entries.length),
		...files,
		'',
		t('scm.prompt.diff'),
		diff,
		t('scm.prompt.diffEnd'),
	].join('\n');
	return t('autoCommit.prompt', MAX_COMMITS_PER_ROUND, CONVENTIONAL_COMMIT_TYPES.join(', '), context);
}

/** `- src/a.ts (modified)`, with the path exactly as the answer must quote it. */
export function describeEntry(entry: StatusEntry): string {
	let kind: string;
	if (entry.index === '?') kind = t('autoCommit.prompt.kind.new');
	else if (entry.index === 'R' || entry.worktree === 'R') kind = t('autoCommit.prompt.kind.renamed', entry.origPath ?? '?');
	else if (entry.index === 'D' || entry.worktree === 'D') kind = t('autoCommit.prompt.kind.deleted');
	else if (entry.index === 'A') kind = t('autoCommit.prompt.kind.added');
	else kind = t('autoCommit.prompt.kind.modified');
	return `- ${entry.path} (${kind})`;
}

/** A new file as the diff git would show once it is added. */
function renderUntracked(file: UntrackedFile): string {
	const header = `diff --git a/${file.path} b/${file.path}\nnew file\n--- /dev/null\n+++ b/${file.path}`;
	if (file.content === undefined) return `${header}\n${t('autoCommit.prompt.binary', file.size)}`;
	const lines = file.content.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
	const body = lines.map((line) => `+${line}`).join('\n');
	return `${header}\n${body}${file.truncated ? `\n${t('autoCommit.prompt.fileTruncated', file.size)}` : ''}`;
}

/**
 * Reads the model's answer. Paths are matched against what changed (exactly,
 * then ignoring `./`, backslashes, a copied "(modified)" note and case);
 * unknown ones are dropped, and a file only goes into the first commit that
 * names it. A commit whose message is not valid Conventional Commits is
 * dropped too: nothing gets committed with a message nobody can read later.
 */
export function parseAutoCommitDecision(answer: string, entries: readonly StatusEntry[]): AutoCommitDecision {
	const record = readJsonObject(answer);
	if (!record) return { kind: 'invalid', reason: t('autoCommit.invalid.noJson') };

	const decision = String(record.decision ?? record.action ?? '').trim().toLowerCase();
	if (decision === 'wait') return { kind: 'wait', reason: oneLine(record.reason) };
	if (decision !== 'commit') return { kind: 'invalid', reason: t('autoCommit.invalid.decision', decision || '—') };

	const resolve = pathResolver(entries);
	const items = Array.isArray(record.commits) ? record.commits : [record];
	const used = new Set<string>();
	const commits: AutoCommitGroup[] = [];
	let problem = t('autoCommit.invalid.noFiles');
	for (const item of items) {
		if (commits.length >= MAX_COMMITS_PER_ROUND) break;
		if (!item || typeof item !== 'object') continue;
		const group = item as Record<string, unknown>;
		const files: string[] = [];
		for (const value of asList(group.files ?? group.paths)) {
			const file = resolve(value);
			if (file && !used.has(file) && !files.includes(file)) files.push(file);
		}
		if (files.length === 0) continue;
		let message: string;
		try {
			message = validateConventionalCommitMessage(composeMessage(group));
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
			continue;
		}
		for (const file of files) used.add(file);
		commits.push({ files, message });
	}
	return commits.length > 0 ? { kind: 'commit', commits } : { kind: 'invalid', reason: problem };
}

/**
 * The commit message out of `{subject, body}` (body as a list of points or a
 * text) or a ready-made `message`. Points become `- ` bullets wrapped at 72
 * columns, which is how `git log` reads best.
 */
function composeMessage(group: Record<string, unknown>): string {
	if (typeof group.message === 'string' && group.message.trim()) return cleanGeneratedCommitMessage(group.message);
	const subject = String(group.subject ?? group.title ?? group.summary ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\.+$/, '');
	const points = Array.isArray(group.body)
		? group.body.map((point) => String(point).trim().replace(/^[-*•]\s*/, '')).filter(Boolean)
		: [];
	const body =
		points.length > 0
			? points.map((point) => wrap(point, BODY_WIDTH, '- ', '  ')).join('\n')
			: typeof group.body === 'string'
				? group.body.trim()
				: '';
	return body ? `${subject}\n\n${body}` : subject;
}

function wrap(text: string, width: number, first: string, rest: string): string {
	const lines: string[] = [];
	let line = first;
	for (const word of text.split(/\s+/)) {
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

/** Maps what the model wrote to a path `git status` listed, or undefined. */
function pathResolver(entries: readonly StatusEntry[]): (value: unknown) => string | undefined {
	const exact = new Map<string, string>();
	const folded = new Map<string, string>();
	for (const entry of entries) {
		for (const file of [entry.path, entry.origPath]) {
			if (!file) continue;
			exact.set(file, entry.path);
			folded.set(file.toLowerCase(), entry.path);
		}
	}
	return (value) => {
		if (typeof value !== 'string') return undefined;
		const cleaned = value
			.trim()
			.replace(/^["'`]|["'`]$/g, '')
			.replace(/\\/g, '/')
			.replace(/^\.\//, '')
			.replace(/^- /, '');
		const bare = cleaned.replace(/\s+\([^)]*\)$/, '');
		return exact.get(cleaned) ?? exact.get(bare) ?? folded.get(bare.toLowerCase());
	};
}

function asList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	return typeof value === 'string' ? [value] : [];
}

function oneLine(value: unknown): string {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text;
}

function readJsonObject(answer: string): Record<string, unknown> | undefined {
	const text = answer.replace(/\r\n?/g, '\n');
	const candidates: string[] = [];
	for (const match of text.matchAll(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n[ \t]*\1|$)/g)) candidates.push(match[2]);
	const open = text.indexOf('{');
	const close = text.lastIndexOf('}');
	if (open !== -1 && close > open) candidates.push(text.slice(open, close + 1));
	for (const candidate of candidates) {
		const parsed = parseLenient(candidate.trim());
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	}
	return undefined;
}

/**
 * JSON.parse, then again without trailing commas (`{...,}`) and with the raw
 * line breaks a model leaves inside a string escaped — two common slips.
 */
function parseLenient(text: string): unknown {
	if (!text) return undefined;
	const withoutCommas = text.replace(/,\s*([\]}])/g, '$1');
	for (const candidate of [text, withoutCommas, escapeRawBreaks(withoutCommas)]) {
		try {
			return JSON.parse(candidate);
		} catch {
			/* try the next repair */
		}
	}
	return undefined;
}

function escapeRawBreaks(text: string): string {
	let result = '';
	let inString = false;
	let escaped = false;
	for (const char of text) {
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			else if (char === '\n' || char === '\r' || char === '\t') {
				result += char === '\n' ? '\\n' : char === '\t' ? '\\t' : '';
				continue;
			}
		} else if (char === '"') {
			inString = true;
		}
		result += char;
	}
	return result;
}

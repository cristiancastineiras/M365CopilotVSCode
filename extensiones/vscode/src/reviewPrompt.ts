/**
 * Prompt and answer parsing for "Review with M365 Copilot" (review.ts): one
 * BizChat turn per file that answers with a JSON list of findings, which
 * become comment threads on the reviewed lines.
 *
 * Also what git says changed, from a `git diff -U0` patch, so "Review
 * changes" only asks about — and only keeps comments on — the changed lines.
 *
 * Kept free of the `vscode` import, like inlineEditPrompt.ts, so the tests can
 * check the prompt and every answer shape the model likes to produce.
 */
import { fenceFor } from './participantPrompts';
import { t } from './i18n';

export type FindingSeverity = 'error' | 'warning' | 'info';

/** 1-based, inclusive. */
export interface LineRange {
	readonly start: number;
	readonly end: number;
}

export interface ReviewFinding {
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
	readonly severity: FindingSeverity;
	readonly title: string;
	readonly message: string;
	readonly suggestion?: string;
}

/** Consecutive lines of the file, starting at `startLine` (1-based). */
export interface CodeSegment {
	readonly startLine: number;
	readonly text: string;
}

export interface ReviewPromptInput {
	readonly relativePath: string;
	readonly languageId: string;
	/** What is shown to the model, numbered; several when only windows around the changes fit. */
	readonly segments: readonly CodeSegment[];
	/** When reviewing changes: the changed lines, and the diff with what was removed. */
	readonly changed?: readonly LineRange[];
	readonly diff?: string;
}

export const MAX_FINDINGS = 25;
const MAX_TITLE_CHARS = 100;
const MAX_DIFF_CHARS = 8_000;

/** `  12 | code`, so the model can cite exact line numbers; `width` aligns several segments. */
export function numberLines(segment: CodeSegment, width = String(lastLineOf(segment)).length): string {
	return segment.text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line, index) => `${String(segment.startLine + index).padStart(width)} | ${line}`)
		.join('\n');
}

/** 1-based number of the segment's last line. */
export function lastLineOf(segment: CodeSegment): number {
	return segment.startLine + segment.text.replace(/\r\n?/g, '\n').split('\n').length - 1;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
	const width = String(Math.max(...input.segments.map(lastLineOf))).length;
	const numbered = input.segments.map((segment) => numberLines(segment, width)).join('\n⋮\n');
	const fence = fenceFor(numbered);
	const sections = [
		t('review.prompt.role'),
		t('review.prompt.rules'),
		t('review.prompt.file', input.relativePath, input.languageId),
	];
	if (input.changed && input.changed.length > 0) {
		sections.push(t('review.prompt.changes', formatRanges(input.changed)));
	}
	const diff = input.diff?.trim();
	if (diff) {
		const clipped = diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…` : diff;
		const diffFence = fenceFor(clipped);
		sections.push(`${t('review.prompt.diff')}\n${diffFence}diff\n${clipped}\n${diffFence}`);
	}
	sections.push(`${t('review.prompt.code')}\n${fence}${input.languageId}\n${numbered}\n${fence}`);
	sections.push(t('review.prompt.reminder'));
	return sections.join('\n\n');
}

/** `10-14, 30`. */
export function formatRanges(ranges: readonly LineRange[]): string {
	return ranges.map((range) => (range.end > range.start ? `${range.start}-${range.end}` : `${range.start}`)).join(', ');
}

/**
 * The findings in a review answer: the JSON array of its first fenced block
 * (or the bare array, or `{ "findings": [...] }`), each entry normalized and
 * kept only if it points inside `bounds`. Null when no JSON could be read at
 * all — which is not the same as "nothing to report" (`[]`).
 */
export function parseReviewFindings(answer: string, bounds: LineRange): ReviewFinding[] | null {
	const items = readJsonList(answer);
	if (!items) return null;
	const seen = new Set<string>();
	const findings: ReviewFinding[] = [];
	for (const item of items) {
		const finding = normalizeFinding(item, bounds);
		if (!finding) continue;
		const key = `${finding.startLine}:${finding.title.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		findings.push(finding);
	}
	return findings
		.sort((a, b) => a.startLine - b.startLine || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
		.slice(0, MAX_FINDINGS);
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

function readJsonList(answer: string): unknown[] | null {
	const text = answer.replace(/\r\n?/g, '\n');
	const candidates: string[] = [];
	for (const match of text.matchAll(/(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:\n[ \t]*\1|$)/g)) candidates.push(match[2]);
	const open = text.indexOf('[');
	const close = text.lastIndexOf(']');
	if (open !== -1 && close > open) candidates.push(text.slice(open, close + 1));
	const brace = text.indexOf('{');
	const braceEnd = text.lastIndexOf('}');
	if (brace !== -1 && braceEnd > brace) candidates.push(text.slice(brace, braceEnd + 1));

	for (const candidate of candidates) {
		const parsed = parseLenient(candidate.trim());
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === 'object') {
			const record = parsed as Record<string, unknown>;
			const list = record.findings ?? record.issues ?? record.comments ?? record.problems;
			if (Array.isArray(list)) return list;
		}
	}
	return null;
}

/** JSON.parse, then once more without trailing commas (`[{...},]`), a common slip. */
function parseLenient(text: string): unknown {
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		try {
			return JSON.parse(text.replace(/,\s*([\]}])/g, '$1'));
		} catch {
			return undefined;
		}
	}
}

function normalizeFinding(item: unknown, bounds: LineRange): ReviewFinding | undefined {
	if (!item || typeof item !== 'object') return undefined;
	const record = item as Record<string, unknown>;
	const lines = lineSpan(record.line ?? record.startLine ?? record.start ?? record.lineNumber);
	if (!lines) return undefined;
	const end = lineSpan(record.endLine ?? record.end ?? record.lastLine)?.start ?? lines.end;
	const startLine = Math.max(lines.start, bounds.start);
	const endLine = Math.min(Math.max(end, lines.start), bounds.end);
	if (startLine > bounds.end || endLine < bounds.start) return undefined;

	const message = text(record.message ?? record.description ?? record.detail ?? record.explanation);
	const title = clip(text(record.title ?? record.summary ?? record.issue) || firstSentence(message), MAX_TITLE_CHARS);
	if (!title && !message) return undefined;
	const suggestion = text(record.suggestion ?? record.fix ?? record.recommendation);
	return {
		startLine,
		endLine: Math.max(startLine, endLine),
		severity: severityOf(record.severity ?? record.level ?? record.type),
		title: title || clip(message, MAX_TITLE_CHARS),
		message: message || title,
		...(suggestion ? { suggestion } : {}),
	};
}

/** `12`, `"12"`, `"L12"`, `"12-14"`. */
function lineSpan(value: unknown): LineRange | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
		const line = Math.trunc(value);
		return { start: line, end: line };
	}
	if (typeof value !== 'string') return undefined;
	const match = /(\d+)(?:\s*[-–:]\s*L?(\d+))?/.exec(value);
	if (!match) return undefined;
	const start = Number(match[1]);
	const end = match[2] ? Number(match[2]) : start;
	return start >= 1 ? { start, end: Math.max(start, end) } : undefined;
}

function severityOf(value: unknown): FindingSeverity {
	const label = typeof value === 'string' ? value.toLowerCase() : '';
	if (/error|critical|blocker|high|bug|security|grave|crític/.test(label)) return 'error';
	if (/warn|medium|major|aviso|advertencia|media/.test(label)) return 'warning';
	return 'info';
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function firstSentence(message: string): string {
	return /^[^\n.!?]*[.!?]?/.exec(message)?.[0].trim() ?? '';
}

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** A file in a `git diff`, with the lines that changed in its new version. */
export interface FileChanges {
	/** Repository-relative, `/`-separated. */
	readonly path: string;
	readonly ranges: readonly LineRange[];
	/** This file's part of the patch: what was added and what was removed. */
	readonly patch: string;
}

/**
 * Splits a `git diff -U0` patch per file. Deleted and binary files (no new
 * version, or no hunks) are left out; a file listed twice (staged and
 * unstaged diffs concatenated) is merged.
 */
export function parseUnifiedDiff(patch: string): FileChanges[] {
	const files = new Map<string, { ranges: LineRange[]; patch: string[] }>();
	let current: { path: string | undefined; lines: string[]; ranges: LineRange[] } | undefined;
	const flush = () => {
		if (!current?.path || current.ranges.length === 0) return;
		const entry = files.get(current.path) ?? { ranges: [], patch: [] };
		entry.ranges.push(...current.ranges);
		entry.patch.push(current.lines.join('\n'));
		files.set(current.path, entry);
	};
	for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
		if (line.startsWith('diff --git ')) {
			flush();
			current = { path: undefined, lines: [line], ranges: [] };
			continue;
		}
		if (!current) continue;
		current.lines.push(line);
		if (line.startsWith('+++ ')) {
			const target = unquoteGitPath(line.slice(4).replace(/\t$/, ''));
			current.path = target === '/dev/null' ? undefined : target.replace(/^b\//, '');
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (hunk) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			// A pure deletion (count 0) happened right after line `start`.
			current.ranges.push(count > 0 ? { start, end: start + count - 1 } : { start: Math.max(1, start), end: Math.max(1, start) });
		}
	}
	flush();
	return [...files].map(([path, entry]) => ({ path, ranges: mergeRanges(entry.ranges), patch: entry.patch.join('\n') }));
}

/** Git quotes paths with unusual characters: `"b/caf\303\251.ts"`. */
function unquoteGitPath(raw: string): string {
	if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
	const inner = raw.slice(1, -1);
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	const simple: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', r: '\r', v: '\v' };
	for (let index = 0; index < inner.length; index += 1) {
		const char = inner[index];
		if (char !== '\\') {
			bytes.push(...encoder.encode(char));
			continue;
		}
		const octal = /^[0-7]{3}/.exec(inner.slice(index + 1));
		if (octal) {
			bytes.push(parseInt(octal[0], 8));
			index += 3;
		} else {
			bytes.push(...encoder.encode(simple[inner[index + 1]] ?? inner[index + 1] ?? ''));
			index += 1;
		}
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Sorted, with overlapping and adjacent ranges merged. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const merged: LineRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.start <= last.end + 1) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
		else merged.push({ ...range });
	}
	return merged;
}

/** Each range widened by `context` lines (within 1..lineCount), merged. */
export function windowsAround(ranges: readonly LineRange[], lineCount: number, context: number): LineRange[] {
	return mergeRanges(
		ranges.map((range) => ({ start: Math.max(1, range.start - context), end: Math.min(lineCount, range.end + context) })),
	).filter((range) => range.start <= range.end);
}

/** Whether a finding is on (or within `slack` lines of) the changed lines. */
export function touchesRanges(finding: ReviewFinding, ranges: readonly LineRange[], slack = 2): boolean {
	return ranges.some((range) => finding.startLine <= range.end + slack && finding.endLine >= range.start - slack);
}

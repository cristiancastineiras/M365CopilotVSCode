/**
 * Line diff for the Keep/Undo review: which lines an agent edit changed,
 * split into separate hunks, plus the two operations the review offers per
 * hunk — accept it into the baseline, or revert it in the document.
 *
 * The previous version trimmed the common prefix and suffix and reported what
 * was left as ONE region, so an edit touching the top and the bottom of a
 * file painted everything in between green and could only be kept or undone
 * as a whole. This is a real Myers diff over lines (with that same
 * prefix/suffix trim as the fast path), falling back to the single region
 * only when the edit is too large for the diff to be worth its cost.
 *
 * Line numbers follow `splitLines`, which matches VS Code's own line model: a
 * text ending in a newline has a final empty line, exactly like
 * `TextDocument.lineCount` counts it.
 *
 * Kept free of the `vscode` import so it can be exercised directly.
 */
import { t } from '../src/i18n';

export function splitLines(text: string): string[] {
	return text.split(/\r\n|\r|\n/);
}

/** The line ending a text uses (its first one), LF when it has none. */
export function eolOf(text: string): string {
	const match = /\r\n|\r|\n/.exec(text);
	return match ? match[0] : '\n';
}

/** One changed block: `oldLength` baseline lines replaced by `newLength` current lines. */
export interface Hunk {
	/** 0-based first line in the baseline (old) text. */
	readonly oldStart: number;
	readonly oldLength: number;
	/** 0-based first line in the current (new) text. */
	readonly newStart: number;
	/** 0 when the hunk only removed lines. */
	readonly newLength: number;
}

/**
 * Past this many edit operations the diff stops and reports the changed span
 * as a single hunk. Memory grows with D² (one V slice per step), so this caps
 * it at a few MB; an edit that large is a rewrite, not a set of hunks anyway.
 */
const MAX_EDIT_DISTANCE = 1_500;

export function diffLines(before: string, after: string): Hunk[] {
	if (before === after) return [];
	const oldLines = splitLines(before);
	const newLines = splitLines(after);

	let prefix = 0;
	const maxPrefix = Math.min(oldLines.length, newLines.length);
	while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1;
	let suffix = 0;
	const maxSuffix = maxPrefix - prefix;
	while (
		suffix < maxSuffix &&
		oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
	const newMiddle = newLines.slice(prefix, newLines.length - suffix);
	if (oldMiddle.length === 0 && newMiddle.length === 0) return [];

	const whole: Hunk = { oldStart: prefix, oldLength: oldMiddle.length, newStart: prefix, newLength: newMiddle.length };
	if (oldMiddle.length === 0 || newMiddle.length === 0) return [whole];

	// Compare integers, not strings, inside the O(ND) loop.
	const ids = new Map<string, number>();
	const idOf = (line: string) => {
		let id = ids.get(line);
		if (id === undefined) {
			id = ids.size;
			ids.set(line, id);
		}
		return id;
	};
	const hunks = myers(oldMiddle.map(idOf), newMiddle.map(idOf));
	if (!hunks) return [whole];
	return hunks.map((hunk) => ({ ...hunk, oldStart: hunk.oldStart + prefix, newStart: hunk.newStart + prefix }));
}

/**
 * Myers' O(ND) diff. Returns null when the edit distance exceeds
 * {@link MAX_EDIT_DISTANCE}. Each step stores only the slice of V it can read
 * back while backtracking (k in [-d-1, d+1]), not the whole array.
 */
function myers(a: readonly number[], b: readonly number[]): Hunk[] | null {
	const n = a.length;
	const m = b.length;
	const max = n + m;
	const offset = max + 1;
	const v = new Int32Array(2 * max + 3);
	const trace: Int32Array[] = [];

	for (let d = 0; d <= max; d += 1) {
		if (d > MAX_EDIT_DISTANCE) return null;
		trace.push(v.slice(offset - d - 1, offset + d + 2));
		for (let k = -d; k <= d; k += 2) {
			let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x += 1;
				y += 1;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) return backtrack(trace, n, m);
		}
	}
	return null; // unreachable: d === n + m always reaches the end
}

/** Walk the stored V slices back from (n, m) and group the non-diagonal moves into hunks. */
function backtrack(trace: readonly Int32Array[], n: number, m: number): Hunk[] {
	// Moves, collected end → start: 'd' = deletion (old line), 'i' = insertion (new line).
	const moves: { kind: 'd' | 'i'; x: number; y: number }[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d > 0; d -= 1) {
		const slice = trace[d];
		const at = (k: number) => slice[k + d + 1];
		const k = x - y;
		const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
		const prevX = at(prevK);
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x -= 1;
			y -= 1;
		}
		if (x === prevX) moves.push({ kind: 'i', x: prevX, y: prevY });
		else moves.push({ kind: 'd', x: prevX, y: prevY });
		x = prevX;
		y = prevY;
	}
	moves.reverse();

	const hunks: Hunk[] = [];
	let current: { oldStart: number; oldLength: number; newStart: number; newLength: number } | undefined;
	for (const move of moves) {
		const touches =
			current !== undefined &&
			move.x === current.oldStart + current.oldLength &&
			move.y === current.newStart + current.newLength;
		if (!touches) {
			if (current) hunks.push(current);
			current = { oldStart: move.x, oldLength: 0, newStart: move.y, newLength: 0 };
		}
		if (move.kind === 'd') current!.oldLength += 1;
		else current!.newLength += 1;
	}
	if (current) hunks.push(current);
	return hunks;
}

/** Lines added and removed across a set of hunks (git's "+a −b"). */
export function hunkStats(hunks: readonly Hunk[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const hunk of hunks) {
		added += hunk.newLength;
		removed += hunk.oldLength;
	}
	return { added, removed };
}

/** A one-line summary of the size of a change, for the review affordances. */
export function describeChange(before: string | undefined, after: string | undefined): string {
	if (before === undefined) return t('diff.newFile');
	if (after === undefined) return t('diff.deletedFile');
	return describeHunks(diffLines(before, after));
}

export function describeHunks(hunks: readonly Hunk[]): string {
	if (hunks.length === 0) return t('diff.modified');
	const { added, removed } = hunkStats(hunks);
	return t('diff.stats', added, removed);
}

/**
 * The baseline with one hunk accepted: its current lines replace the
 * baseline lines it covered. Keeps the baseline's own line ending, so an
 * EOL-only difference never shows up as a new hunk.
 */
export function acceptHunk(baseline: string, current: string, hunk: Hunk): string {
	const oldLines = splitLines(baseline);
	const newLines = splitLines(current);
	oldLines.splice(hunk.oldStart, hunk.oldLength, ...newLines.slice(hunk.newStart, hunk.newStart + hunk.newLength));
	return oldLines.join(eolOf(baseline));
}

/** A text edit in line/character coordinates (mirrors `vscode.TextEdit`). */
export interface LineEdit {
	readonly startLine: number;
	readonly startCharacter: number;
	readonly endLine: number;
	readonly endCharacter: number;
	readonly text: string;
}

/**
 * The document edit that reverts one hunk: its current lines go back to the
 * baseline's. Pure insertions and pure deletions need care so that exactly
 * one line break is removed or added with the lines — including at the very
 * end of the file, where there is no following line to anchor on.
 */
export function revertHunkEdit(current: string, baseline: string, hunk: Hunk): LineEdit {
	const newLines = splitLines(current);
	const oldLines = splitLines(baseline).slice(hunk.oldStart, hunk.oldStart + hunk.oldLength);
	const eol = eolOf(current.includes('\n') || current.includes('\r') ? current : baseline);
	const lastLine = newLines.length - 1;

	if (hunk.newLength === 0) {
		// The agent removed lines: put them back before line `newStart`…
		if (hunk.newStart <= lastLine) {
			return edit(hunk.newStart, 0, hunk.newStart, 0, oldLines.join(eol) + eol);
		}
		// …or after the last line, when they were removed from the end.
		return edit(lastLine, newLines[lastLine].length, lastLine, newLines[lastLine].length, eol + oldLines.join(eol));
	}

	const endLine = hunk.newStart + hunk.newLength - 1;
	if (hunk.oldLength > 0) {
		return edit(hunk.newStart, 0, endLine, newLines[endLine].length, oldLines.join(eol));
	}

	// The agent only inserted lines: remove them together with one line break.
	if (endLine < lastLine) return edit(hunk.newStart, 0, endLine + 1, 0, '');
	if (hunk.newStart > 0) {
		const before = hunk.newStart - 1;
		return edit(before, newLines[before].length, endLine, newLines[endLine].length, '');
	}
	return edit(0, 0, endLine, newLines[endLine].length, '');
}

function edit(startLine: number, startCharacter: number, endLine: number, endCharacter: number, text: string): LineEdit {
	return { startLine, startCharacter, endLine, endCharacter, text };
}

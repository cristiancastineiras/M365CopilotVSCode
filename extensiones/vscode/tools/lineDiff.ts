/**
 * Which lines actually changed, so the review UI can highlight the edit
 * instead of painting the whole file green.
 *
 * This trims the common prefix and suffix and reports what is left as one
 * region. It is deliberately not a real diff: an edit that touches two
 * far-apart places reports the span between them rather than two hunks. For
 * what this drives — a background highlight and where to anchor the
 * Keep/Undo lenses — a slightly generous region is honest and cheap, whereas
 * a full LCS over a large file is neither.
 *
 * Kept free of the `vscode` import so it can be exercised directly.
 */

export interface ChangedRegion {
	/** 0-based first changed line in the new text, inclusive. */
	readonly start: number;
	/** 0-based line after the last changed one, exclusive. Equals `start`
	 * when the edit only removed lines. */
	readonly end: number;
}

export function splitLines(text: string): string[] {
	return text.split(/\r\n|\r|\n/);
}

/**
 * The changed region expressed in `after`'s line numbers, or null when the
 * two texts are identical.
 */
export function changedRegion(before: string, after: string): ChangedRegion | null {
	if (before === after) return null;

	const oldLines = splitLines(before);
	const newLines = splitLines(after);

	let prefix = 0;
	const maxPrefix = Math.min(oldLines.length, newLines.length);
	while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1;

	let suffix = 0;
	const maxSuffix = Math.min(oldLines.length, newLines.length) - prefix;
	while (
		suffix < maxSuffix &&
		oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
	) {
		suffix += 1;
	}

	const start = prefix;
	const end = Math.max(newLines.length - suffix, prefix);
	return { start, end };
}

/** A one-line summary of the size of a change, for the review affordances. */
export function describeChange(before: string | undefined, after: string | undefined): string {
	if (before === undefined) return 'archivo nuevo';
	if (after === undefined) return 'archivo borrado';
	const oldCount = splitLines(before).length;
	const newCount = splitLines(after).length;
	const delta = newCount - oldCount;
	if (delta > 0) return `+${delta} línea(s)`;
	if (delta < 0) return `${delta} línea(s)`;
	return 'modificado';
}

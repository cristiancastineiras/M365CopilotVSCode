import { t } from '../src/i18n';

export function requireText(value: unknown, fieldName: string, allowEmpty = true): string {
	if (typeof value !== 'string') throw new Error(t('edit.text.notString', fieldName));
	if (!allowEmpty && !value) throw new Error(t('edit.text.empty', fieldName));
	return value;
}

type MatchResult = { readonly kind: 'unique'; readonly index: number } | { readonly kind: 'none' } | { readonly kind: 'multiple' };

function findMatch(haystack: string, needle: string): MatchResult {
	const first = haystack.indexOf(needle);
	if (first === -1) return { kind: 'none' };
	if (haystack.indexOf(needle, first + needle.length) !== -1) return { kind: 'multiple' };
	return { kind: 'unique', index: first };
}

/**
 * Splice `newText` in place of the one occurrence of `oldText` in `content`.
 *
 * The model always works with LF line endings — that's what `m365_read_file`
 * shows it (it re-joins lines with `\n` regardless of the file's real line
 * endings) and what a JSON `"\n"` represents — but the file on disk may use
 * CRLF (common on Windows checkouts). A byte-exact match then never succeeds
 * even for an otherwise-correct edit, and fails identically on every retry
 * since re-reading the file shows the model the exact same (LF) text again.
 * So: try the exact match first, and only if that fails on a file that
 * actually contains CRLF, retry against an LF-normalized copy — if that
 * matches uniquely, splice it in there and re-normalize the whole result
 * back to CRLF (the file's own style) instead of failing.
 */
export function replaceTextOnce(
	content: string,
	oldText: string,
	newText: string,
	relativePath: string,
): string {
	const direct = findMatch(content, oldText);
	if (direct.kind === 'unique') {
		return `${content.slice(0, direct.index)}${newText}${content.slice(direct.index + oldText.length)}`;
	}
	if (direct.kind === 'multiple') {
		throw new Error(t('edit.oldText.multiple', relativePath));
	}

	if (content.includes('\r\n')) {
		const normalizedContent = content.replace(/\r\n/g, '\n');
		const normalizedOld = oldText.replace(/\r\n/g, '\n');
		const viaLf = findMatch(normalizedContent, normalizedOld);
		if (viaLf.kind === 'unique') {
			const normalizedNew = newText.replace(/\r\n/g, '\n');
			const merged =
				normalizedContent.slice(0, viaLf.index) +
				normalizedNew +
				normalizedContent.slice(viaLf.index + normalizedOld.length);
			return merged.replace(/\n/g, '\r\n');
		}
		if (viaLf.kind === 'multiple') {
			throw new Error(t('edit.oldText.multiple', relativePath));
		}
	}

	throw new Error(t('edit.oldText.noMatch', relativePath));
}
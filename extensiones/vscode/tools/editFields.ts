/**
 * Field-name tolerance for `m365_apply_edits`.
 *
 * Models routinely mix up which text field belongs to which operation — a
 * `create` carrying `newText` instead of `content` was observed discarding a
 * whole 16-file batch over one key name. The intent in those cases is
 * unambiguous, so resolve the obvious synonyms instead of rejecting the edit.
 * Order matters: the canonical field always wins when both are present.
 */
export function pickText(record: Record<string, unknown>, ...keys: readonly string[]): unknown {
	for (const key of keys) {
		if (typeof record[key] === 'string') return record[key];
	}
	return undefined;
}

/** Text a `create` should write: `content`, or the usual mix-ups. */
export function createContentOf(record: Record<string, unknown>): unknown {
	return pickText(record, 'content', 'newText', 'text');
}

/** Replacement text for a `replace`: `newText`, or the usual mix-up. */
export function replaceNewTextOf(record: Record<string, unknown>): unknown {
	return pickText(record, 'newText', 'content');
}

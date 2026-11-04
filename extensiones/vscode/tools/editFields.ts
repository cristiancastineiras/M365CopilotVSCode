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
    if (typeof record[key] === "string") return record[key];
  }
  return undefined;
}

/**
 * Files an edit can use to run code or that may hold secrets: the ones VS Code
 * itself asks about before a chat edit (`chat.tools.edits.autoApprove`).
 */
const SENSITIVE_PATH =
  /(?:^|[\\/])(?:\.vscode|\.github|\.devcontainer|\.husky)[\\/]|(?:^|[\\/])(?:\.env(?:\..*)?|\.npmrc|\.gitattributes|\.gitmodules|package\.json|Cargo\.toml|build\.rs|web\.config|server\.xml)$|\.(?:pem|key)$/i;

/** The sensitive paths in a batch of edits. */
export function sensitivePaths(edits: readonly unknown[]): string[] {
  const paths = edits.map((edit) => (edit as { path?: unknown } | null)?.path);
  const named = paths.filter((path): path is string => typeof path === "string");
  return [...new Set(named.filter((path) => SENSITIVE_PATH.test(path)))];
}

/** Text a `create` should write: `content`, or the usual mix-ups. */
export function createContentOf(record: Record<string, unknown>): unknown {
  return pickText(record, "content", "newText", "text");
}

/** Replacement text for a `replace`: `newText`, or the usual mix-up. */
export function replaceNewTextOf(record: Record<string, unknown>): unknown {
  return pickText(record, "newText", "content");
}

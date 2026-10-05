import * as vscode from 'vscode';
import { t } from '../src/i18n';
import { ensureNotCancelled, relativePathForUri, resolveWorkspacePath } from './common';
import { matchesSeverity, normalizeSeverityFilter, severityLabel } from './diagnosticsFormat';

const MAX_DIAGNOSTIC_ENTRIES = 200;
const MAX_MESSAGE_CHARS = 300;

export interface GetDiagnosticsInput {
	readonly path?: string;
	readonly severity?: string;
	readonly workspaceFolder?: string;
}

/** Read-only: surfaces whatever VS Code's language servers already computed.
 * Never compiles or runs anything itself. */
export async function getWorkspaceDiagnostics(
	input: GetDiagnosticsInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const filter = normalizeSeverityFilter(input.severity);
	const target = resolveWorkspacePath(input.path ?? '', input.workspaceFolder, { allowEmpty: true });
	ensureNotCancelled(token);

	const entries: readonly (readonly [vscode.Uri, readonly vscode.Diagnostic[]])[] = target.relativePath
		? [[target.uri, vscode.languages.getDiagnostics(target.uri)]]
		: vscode.languages.getDiagnostics();

	const lines: string[] = [];
	for (const [uri, diagnostics] of entries) {
		const relativePath = relativePathForUri(uri);
		for (const diagnostic of diagnostics) {
			if (!matchesSeverity(diagnostic.severity, filter)) continue;
			const line = diagnostic.range.start.line + 1;
			const col = diagnostic.range.start.character + 1;
			const source = diagnostic.source ? ` (${diagnostic.source})` : '';
			const message =
				diagnostic.message.length > MAX_MESSAGE_CHARS
					? `${diagnostic.message.slice(0, MAX_MESSAGE_CHARS)}...`
					: diagnostic.message;
			lines.push(`${relativePath}:${line}:${col}: [${severityLabel(diagnostic.severity)}]${source} ${message}`);
		}
	}

	if (lines.length === 0) {
		return target.relativePath ? t('diag.noneFile', target.relativePath) : t('diag.noneWorkspace');
	}

	const limited = lines.length > MAX_DIAGNOSTIC_ENTRIES;
	const visible = lines.slice(0, MAX_DIAGNOSTIC_ENTRIES);
	return [
		target.relativePath
			? t('diag.headerFile', target.relativePath, lines.length)
			: t('diag.headerWorkspace', lines.length),
		'```text',
		...visible,
		'```',
		limited ? t('diag.limited', MAX_DIAGNOSTIC_ENTRIES) : '',
	]
		.filter(Boolean)
		.join('\n');
}

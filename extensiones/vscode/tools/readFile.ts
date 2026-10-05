import * as vscode from 'vscode';
import { t } from '../src/i18n';
import {
	boundedInteger,
	ensureNotCancelled,
	inferLanguage,
	readWorkspaceText,
	resolveWorkspacePath,
} from './common';

const MAX_READ_LINES = 300;
const MAX_RESULT_CHARS = 14_000;
const MAX_LINE_CHARS = 320;

export interface ReadFileInput {
	readonly path: string;
	readonly startLine?: number;
	readonly endLine?: number;
	readonly workspaceFolder?: string;
}

export async function readWorkspaceFile(
	input: ReadFileInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const target = resolveWorkspacePath(input.path, input.workspaceFolder);
	const text = await readWorkspaceText(target.uri);
	ensureNotCancelled(token);
	if (text === undefined) throw new Error(t('read.notFound', target.relativePath));

	const lines = text.split(/\r\n|\r|\n/);
	const startLine = boundedInteger(input.startLine, 1, 1, Math.max(lines.length, 1));
	const requestedEnd = boundedInteger(
		input.endLine,
		Math.min(lines.length, startLine + MAX_READ_LINES - 1),
		startLine,
		Math.max(lines.length, startLine),
	);
	const endLine = Math.min(requestedEnd, startLine + MAX_READ_LINES - 1);
	const width = String(endLine).length;
	const numberedLines: string[] = [];
	let usedChars = 0;
	let lastLine = startLine - 1;

	for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
		const sourceLine = lines[lineNumber - 1] ?? '';
		const clippedLine =
			sourceLine.length > MAX_LINE_CHARS ? `${sourceLine.slice(0, MAX_LINE_CHARS)}...` : sourceLine;
		const renderedLine = `${String(lineNumber).padStart(width)} | ${clippedLine}`;
		if (usedChars + renderedLine.length + 1 > MAX_RESULT_CHARS) break;
		numberedLines.push(renderedLine);
		usedChars += renderedLine.length + 1;
		lastLine = lineNumber;
	}

	const wasLimited = lastLine < endLine || endLine < requestedEnd;
	return [
		t('read.header', target.relativePath, startLine, Math.max(lastLine, startLine), lines.length),
		`\`\`\`${inferLanguage(target.relativePath)}`,
		...numberedLines,
		'```',
		wasLimited ? t('read.limited') : '',
	]
		.filter(Boolean)
		.join('\n');
}
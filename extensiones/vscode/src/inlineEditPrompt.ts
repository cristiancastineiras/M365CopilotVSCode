/**
 * Prompt and answer parsing for the inline edit ("Edit with M365 Copilot…",
 * and the lightbulb's "Fix with M365 Copilot"): one BizChat turn that rewrites
 * a block of code in place, without going through the chat.
 *
 * Kept free of the `vscode` import, like participantPrompts.ts, so the tests
 * can check both the prompt and how answers in every shape the model likes to
 * produce become the replacement text.
 */
import { fenceFor } from './participantPrompts';
import { t } from './i18n';

export interface InlineEditInput {
	readonly instruction: string;
	readonly relativePath: string;
	readonly languageId: string;
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
	/** The whole lines being rewritten. */
	readonly code: string;
	/** Read-only context around the code, so the model knows where it lives. */
	readonly before: string;
	readonly after: string;
	/** Diagnostics VS Code reports in the code, already formatted. */
	readonly diagnostics?: readonly string[];
}

export function buildInlineEditPrompt(input: InlineEditInput): string {
	const block = (text: string) => {
		const fence = fenceFor(text);
		return `${fence}${input.languageId}\n${text}\n${fence}`;
	};
	const sections = [
		t('inlineEdit.prompt.role'),
		t('inlineEdit.prompt.rules'),
		t('inlineEdit.prompt.file', input.relativePath, input.languageId),
		`${t('inlineEdit.prompt.instruction')}\n${input.instruction.trim()}`,
	];
	if (input.diagnostics && input.diagnostics.length > 0) {
		sections.push(`${t('inlineEdit.prompt.diagnostics')}\n${input.diagnostics.map((line) => `- ${line}`).join('\n')}`);
	}
	if (input.before.trim()) sections.push(`${t('inlineEdit.prompt.before')}\n${block(input.before)}`);
	sections.push(`${t('inlineEdit.prompt.code', input.startLine, input.endLine)}\n${block(input.code)}`);
	if (input.after.trim()) sections.push(`${t('inlineEdit.prompt.after')}\n${block(input.after)}`);
	sections.push(t('inlineEdit.prompt.reminder'));
	return sections.join('\n\n');
}

/** First fenced block, tolerating a missing closing fence (the answer can be cut). */
const FENCED_BLOCK_RE = /(?:^|\n)[ \t]*(`{3,}|~{3,})[^\n`]*\n([\s\S]*?)(?:\n[ \t]*\1[ \t]*(?=\n|$)|$)/;

/** A leading line of prose ("Here is the updated code:") before unfenced code. */
const PREAMBLE_RE = /^[^\n{}();=<>[\]]{3,}:[ \t]*\n/;

/**
 * The replacement for `original` out of a chat answer: the contents of its
 * first fenced block (or the bare answer, minus a "Here you go:" line, when
 * the model skipped the fence), re-indented when the model dropped the
 * block's base indentation. Null when nothing usable came back.
 */
export function extractEditedCode(answer: string, original: string): string | null {
	const normalized = answer.replace(/\r\n?/g, '\n');
	const fenced = FENCED_BLOCK_RE.exec(normalized);
	let code = fenced ? fenced[2] : normalized.trim().replace(PREAMBLE_RE, '');
	code = code.replace(/\n+$/, '');
	if (!code.trim()) return null;
	return reindent(code, original.replace(/\r\n?/g, '\n'));
}

/**
 * Models often return a method or a nested block flush-left even though it
 * sits indented in the file. If the original's least-indented line was
 * indented and the answer's is not, shift every non-empty line by the
 * original's base indentation — otherwise the edit would land misaligned.
 */
export function reindent(code: string, original: string): string {
	const base = baseIndent(original);
	if (!base || baseIndent(code)) return code;
	return code
		.split('\n')
		.map((line) => (line.trim() ? base + line : line))
		.join('\n');
}

function baseIndent(text: string): string {
	let shortest: string | undefined;
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
		if (shortest === undefined || indent.length < shortest.length) shortest = indent;
		if (shortest === '') return '';
	}
	return shortest ?? '';
}

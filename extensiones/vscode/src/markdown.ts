/**
 * Streaming Markdown formatter with a safety net for unfenced code.
 *
 * BizChat/Sydney is asked (see messages.ts) to always fence code, and most
 * rings comply — VS Code renders that streaming Markdown natively, so the
 * fast path is a pure passthrough. But different underlying models behind
 * BizChat (GPT, Claude, the reasoning tone) obey that instruction with very
 * different fidelity: a ring that answers in *unfenced* multi-line code is a
 * real, observed failure mode — and unfenced multi-line code looks badly
 * broken in Markdown, because a renderer collapses single newlines inside a
 * plain paragraph into spaces, running every code line together.
 *
 * Earlier versions of this formatter tried to fix that by re-detecting code
 * *inside* the live character stream and splicing fences in in real time;
 * that heuristic mangled real answers (the classic "prints code wrong" bug)
 * because it had to guess with an incomplete, constantly-changing buffer.
 *
 * This version is safer by construction: it only ever makes a fence/no-fence
 * decision once a whole PARAGRAPH (or a whole fenced block) has arrived —
 * never mid-line, never mid-fence. Paragraphs already fenced by the model are
 * detected and passed through completely untouched (never re-wrapped or
 * double-fenced); only a paragraph with no fence at all, that reads as code
 * by a conservative multi-signal heuristic, gets one added. Streaming still
 * flushes progressively (per paragraph, not per token), so answers keep
 * appearing live — just a paragraph at a time instead of a byte at a time.
 */

/** A line that opens or closes a fenced code block (``` or ~~~, 3+ chars, optional info string). */
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;

/** Signals that a single line reads as code rather than prose. Any one match counts the line as "code-like". */
const CODE_LINE_SIGNALS: readonly RegExp[] = [
	/^[ \t]+\S/, // indented — the model's prose paragraphs are flush-left
	/[{}()[\];,]\s*$/, // ends in a brace / paren / bracket / semicolon / comma
	/^(function|const|let|var|class|import|export|return|if|else|for|while|switch|case|def|public|private|protected|static|package|namespace|using|type|interface|struct|enum)\b/,
	/^(#include|<\?php|SELECT|INSERT|UPDATE|DELETE)\b/i,
	/=>|::|->/, // arrow functions, scope resolution, pointer/member access
];

/** Markdown constructs that legitimately have short, punctuation-heavy lines — never treat these as code. */
const LIST_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
const BLOCKQUOTE_LINE_RE = /^[ \t]*>/;
const HEADING_LINE_RE = /^[ \t]{0,3}#{1,6}[ \t]/;
const TABLE_LINE_RE = /^[ \t]*\|/;

/** Fraction of non-blank lines that must look code-like before we add fences. Conservative on purpose. */
const CODE_LINE_THRESHOLD = 0.6;

export class MarkdownStreamFormatter {
	private buffer = '';

	push(delta: string): string {
		if (!delta) return '';
		this.buffer += delta.replace(/\r\n?/g, '\n');
		return this.drain(false);
	}

	finish(): string {
		const out = this.drain(true);
		this.buffer = '';
		return out;
	}

	private drain(isFinal: boolean): string {
		let out = '';
		for (;;) {
			const end = findUnitEnd(this.buffer, isFinal);
			if (end === -1) break;
			out += renderUnit(this.buffer.slice(0, end));
			this.buffer = this.buffer.slice(end);
			if (end === 0) break; // safety: never spin on a zero-length unit
		}
		return out;
	}
}

/**
 * Length of the first complete "unit" at the start of `buffer` — either a
 * single already-fenced code block (open fence through its matching close
 * fence, inclusive) or a plain paragraph (through its trailing blank line).
 * Returns -1 when the buffer doesn't yet contain a complete unit and more
 * input should be awaited (unless `isFinal`, which forces whatever remains
 * to be treated as complete).
 */
function findUnitEnd(buffer: string, isFinal: boolean): number {
	if (buffer.length === 0) return -1;

	// A run of blank lines at the very start is its own trivial unit — flush
	// it immediately so it never blocks detecting what follows.
	if (buffer[0] === '\n') {
		let i = 0;
		while (buffer[i] === '\n') i += 1;
		return i;
	}

	const firstLineEnd = buffer.indexOf('\n', 0);
	const firstLine = firstLineEnd === -1 ? buffer : buffer.slice(0, firstLineEnd);

	if (FENCE_LINE_RE.test(firstLine)) {
		return findFenceEnd(buffer, firstLine, firstLineEnd, isFinal);
	}

	// Plain paragraph: ends at the first CONFIRMED blank line, or (if a fence
	// opens mid-paragraph, which real answers do not do, but be defensive)
	// right before that fence line so we never merge prose and a fence into
	// one mis-detected unit.
	//
	// Reaching the end of the buffer right after a line's own newline is NOT
	// by itself a paragraph boundary — the next push() may continue the very
	// same paragraph with another code line and no blank line in between (this
	// is the common case: BizChat streams one line of code per delta). Only a
	// newline we can actually see following it (blank line) — or `isFinal`,
	// meaning no more input is coming — may end the paragraph here.
	let searchFrom = 0;
	for (;;) {
		const lineEnd = buffer.indexOf('\n', searchFrom);
		if (lineEnd === -1) {
			return isFinal ? buffer.length : -1;
		}
		const nextLineStart = lineEnd + 1;
		if (nextLineStart === buffer.length) {
			return isFinal ? buffer.length : -1; // can't yet tell what follows
		}
		if (buffer[nextLineStart] === '\n') {
			return nextLineStart; // confirmed blank line: paragraph ends here
		}
		const nextLineEnd = buffer.indexOf('\n', nextLineStart);
		if (nextLineEnd !== -1) {
			const nextLine = buffer.slice(nextLineStart, nextLineEnd);
			if (FENCE_LINE_RE.test(nextLine)) {
				return nextLineStart; // stop right before a fence line that follows
			}
		}
		searchFrom = nextLineStart;
	}
}

function findFenceEnd(buffer: string, openLine: string, firstLineEnd: number, isFinal: boolean): number {
	const match = FENCE_LINE_RE.exec(openLine);
	const marker = match?.[1]?.[0] ?? '`';
	const openLen = match?.[1]?.length ?? 3;
	const closeRe = new RegExp(`^[ \t]{0,3}${marker === '`' ? '`' : '~'}{${openLen},}[ \t]*$`);

	let searchFrom = firstLineEnd === -1 ? buffer.length : firstLineEnd + 1;
	for (;;) {
		if (searchFrom > buffer.length) break;
		const lineEnd = buffer.indexOf('\n', searchFrom);
		const line = buffer.slice(searchFrom, lineEnd === -1 ? buffer.length : lineEnd);
		if (lineEnd === -1) break; // final line not yet terminated; wait for more (or isFinal below)
		if (closeRe.test(line)) return lineEnd + 1;
		searchFrom = lineEnd + 1;
	}
	return isFinal ? buffer.length : -1;
}

/** Render one complete unit: fenced blocks pass through verbatim; unfenced code-like paragraphs get fenced. */
function renderUnit(unit: string): string {
	const trimmedStart = unit.replace(/^\n+/, '');
	if (trimmedStart === '' || FENCE_LINE_RE.test(unit.slice(0, unit.indexOf('\n') === -1 ? unit.length : unit.indexOf('\n')))) {
		return unit; // blank-line run, or already fenced — never touched
	}
	return looksLikeUnfencedCode(unit) ? wrapInFence(unit) : unit;
}

function looksLikeUnfencedCode(paragraph: string): boolean {
	const lines = paragraph.split('\n');
	const nonBlank = lines.filter((l) => l.trim().length > 0);
	if (nonBlank.length < 2) return false; // a single line renders fine inline; leave it alone

	if (nonBlank.some((l) => HEADING_LINE_RE.test(l))) return false;
	if (nonBlank.some((l) => BLOCKQUOTE_LINE_RE.test(l))) return false;
	if (nonBlank.filter((l) => LIST_LINE_RE.test(l)).length / nonBlank.length > 0.5) return false;
	if (nonBlank.filter((l) => TABLE_LINE_RE.test(l)).length / nonBlank.length > 0.3) return false;

	const codeLines = nonBlank.filter((l) => CODE_LINE_SIGNALS.some((re) => re.test(l))).length;
	return codeLines / nonBlank.length >= CODE_LINE_THRESHOLD;
}

/** Wrap a paragraph in a fenced block, preserving its own leading/trailing newline structure. */
function wrapInFence(paragraph: string): string {
	const leading = paragraph.match(/^\n*/)?.[0] ?? '';
	const trailing = paragraph.match(/\n*$/)?.[0] ?? '';
	const body = paragraph.slice(leading.length, paragraph.length - trailing.length);
	// `trailing` always ends the unit's own line break(s); keep exactly one
	// newline after the closing fence and preserve any further blank lines.
	const extraBlankLines = trailing.length > 1 ? trailing.slice(1) : '';
	return `${leading}\`\`\`\n${body}\n\`\`\`\n${extraBlankLines}`;
}

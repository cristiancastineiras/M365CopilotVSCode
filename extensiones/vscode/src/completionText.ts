/**
 * Turning a chat answer into ghost text.
 *
 * BizChat is a conversational assistant, not a fill-in-the-middle completion
 * model: even with a tight prompt it likes to wrap code in fences, open with
 * "Claro, aquí tienes:", echo the line you were already typing, and close the
 * block you already had closed below the cursor. None of that can go into the
 * editor verbatim, so everything here is about recovering the bare
 * continuation from whatever shape the answer arrived in.
 *
 * Kept free of the `vscode` import so it can be exercised directly.
 */

export interface CleanupOptions {
	/** Text on the cursor's line, before the cursor. */
	readonly linePrefix: string;
	/** Text from the cursor to the end of the document (bounded by the caller). */
	readonly suffix: string;
	/** Hard ceiling on how many lines of ghost text to show. */
	readonly maxLines: number;
	/** VS Code language id, when known — prose formats skip preamble stripping. */
	readonly languageId?: string;
}

/** Formats where a line of real content can legitimately read as a sentence,
 * so the "drop the chatty preamble" heuristic would do more harm than good. */
const PROSE_LANGUAGES = new Set(['markdown', 'plaintext', 'text', 'latex', 'restructuredtext', 'asciidoc']);

/** Statement keywords that legitimately produce a short `word:` line. */
const LABEL_KEYWORDS = /^(case|default|else|try|finally|do|public|private|protected|begin)\b/i;

/** A fenced block, tolerating the unterminated case — we abort the stream
 * early on purpose, so the closing fence often never arrives. */
const FENCED_RE =
	/(?:^|\n)[ \t]*(?:`{3,}|~{3,})[A-Za-z0-9_+-]*[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*|$)/;

/** Characters that make a line look like code rather than a sentence. */
const CODE_CHARS = /[{}();=<>[\]]|=>|::/;

export function cleanCompletion(raw: string, options: CleanupOptions): string {
	if (!raw) return '';

	let text = unwrapFence(raw);
	if (!PROSE_LANGUAGES.has(options.languageId ?? '')) text = dropProsePreamble(text);
	text = dropEchoedLinePrefix(text, options.linePrefix);
	text = limitLines(text, options.maxLines);
	text = trimSuffixOverlap(text, options.suffix);

	// Trailing whitespace would render as stray ghost spaces; leading
	// whitespace is meaningful (indentation) so it stays.
	return text.replace(/\s+$/, '');
}

/** Prefer the contents of the first fenced block; fall back to the raw text. */
function unwrapFence(text: string): string {
	const match = FENCED_RE.exec(text);
	if (match && match[1] !== undefined) return match[1];
	// An answer that is *only* an opening fence and code, with the fence on the
	// very first line and no newline captured above.
	const opening = /^[ \t]*(?:`{3,}|~{3,})[A-Za-z0-9_+-]*[ \t]*\r?\n/.exec(text);
	if (opening) return text.slice(opening[0].length).replace(/\r?\n[ \t]*(?:`{3,}|~{3,})[ \t]*$/, '');
	return text;
}

/**
 * Drop a leading conversational line ("Claro, aquí tienes:"). Deliberately
 * narrow, because over-eager stripping silently eats real code: the line must
 * end in a colon, carry no code punctuation, run to at least three words (so
 * `case 1:` and a bare `default:` survive) and not open with a statement
 * keyword. Prose languages skip this path entirely — see PROSE_LANGUAGES.
 */
function dropProsePreamble(text: string): string {
	const lines = text.split('\n');
	let start = 0;
	while (start < lines.length && start < 2) {
		const line = lines[start].trim();
		if (!line) {
			start += 1;
			continue;
		}
		const isProse =
			line.endsWith(':') &&
			!CODE_CHARS.test(line) &&
			!LABEL_KEYWORDS.test(line) &&
			line.split(/\s+/).length >= 3;
		if (!isProse) break;
		start += 1;
	}
	return start === 0 ? text : lines.slice(start).join('\n');
}

/**
 * Models often restate the line you are on before continuing it. The ghost
 * text starts AT the cursor, so that echo has to go or the line ends up
 * duplicated.
 */
function dropEchoedLinePrefix(text: string, linePrefix: string): string {
	if (!linePrefix.trim()) return text;
	if (text.startsWith(linePrefix)) return text.slice(linePrefix.length);
	const trimmed = linePrefix.trimStart();
	if (trimmed && text.startsWith(trimmed)) return text.slice(trimmed.length);
	return text;
}

function limitLines(text: string, maxLines: number): string {
	if (maxLines <= 0) return '';
	const lines = text.split('\n');
	return lines.length <= maxLines ? text : lines.slice(0, maxLines).join('\n');
}

/**
 * Trim a tail that merely restates what already follows the cursor — the
 * classic "closes a brace the file already closes" duplication. Longest
 * overlap wins so `\n}` beats `}`.
 */
function trimSuffixOverlap(text: string, suffix: string): string {
	if (!text || !suffix) return text;
	const limit = Math.min(text.length, suffix.length, 200);
	for (let k = limit; k >= 1; k -= 1) {
		const candidate = suffix.slice(0, k);
		if (!candidate.trim()) continue; // never trim on whitespace alone
		if (text.endsWith(candidate)) return text.slice(0, text.length - k);
	}
	return text;
}

/**
 * Serve a cached completion while the user types along with it: if the new
 * prefix is the cached one plus characters the suggestion itself predicted,
 * the rest of that suggestion is still valid. This is what makes ghost text
 * feel like it "sticks" instead of flickering off on every keystroke.
 */
export function reuseForExtendedPrefix(
	cachedPrefix: string,
	cachedCompletion: string,
	currentPrefix: string,
): string | null {
	if (!currentPrefix.startsWith(cachedPrefix)) return null;
	const typed = currentPrefix.slice(cachedPrefix.length);
	if (!typed) return cachedCompletion;
	if (!cachedCompletion.startsWith(typed)) return null;
	const rest = cachedCompletion.slice(typed.length);
	return rest || null;
}

/**
 * A real terminal's output is not a clean stdout capture: it carries ANSI
 * colour and cursor escapes, OSC sequences the shell uses to talk to VS Code's
 * shell integration, carriage returns from progress bars, and usually an echo
 * of the command itself. All of that has to go before the text is worth
 * sending to a model.
 *
 * Kept free of the `vscode` import so it can be exercised directly.
 */
import { t } from '../src/i18n';

// Matching control characters is the entire job of an ANSI stripper, so the
// no-control-regex rule is deliberately off for these three patterns.

/** OSC sequences (window titles, and VS Code's own shell-integration marks),
 * terminated by BEL or ST. Stripped first: their payload can contain
 * characters the other patterns would otherwise chew on. */
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
/** CSI escapes — colours, cursor movement, erase-line. */
// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** Two-character escapes that survive the two above. */
// eslint-disable-next-line no-control-regex
const ANSI_SINGLE = /\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
	return text.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(ANSI_SINGLE, '');
}

/**
 * Collapse the carriage-return redraws progress bars use, keeping only the
 * final state of each line instead of every frame of the animation.
 */
export function collapseCarriageReturns(text: string): string {
	return text
		.split('\n')
		.map((line) => {
			const frames = line.split('\r');
			return frames[frames.length - 1];
		})
		.join('\n');
}

/**
 * Turn raw terminal output into something worth handing to a model: no
 * escapes, no progress-bar frames, no echoed command line, no trailing blank
 * space. `command` is dropped only when it is genuinely the first line, so
 * output that legitimately repeats it is left alone.
 */
export function cleanTerminalOutput(raw: string, command: string): string {
	// Order matters: CRLF has to become LF *before* collapsing carriage
	// returns, or every Windows line looks like a progress redraw whose final
	// frame is empty — which silently wipes the entire output.
	const text = collapseCarriageReturns(stripAnsi(raw).replace(/\r\n/g, '\n'));

	const lines = text.split('\n');
	// Shells echo the command back before running it; that is noise here since
	// the caller already reports the command separately.
	if (lines.length > 0 && lines[0].trim() === command.trim()) lines.shift();

	return lines
		.join('\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/^\n+/, '')
		.replace(/\s+$/, '');
}

/** Keep a bounded but still useful slice: the head explains what ran, the
 * tail carries the error you actually need. */
export function truncateOutput(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const head = Math.floor(maxChars * 0.4);
	const tail = Math.max(maxChars - head - 40, 0);
	const omitted = text.length - head - tail;
	return `${text.slice(0, head)}\n${t('run.charsOmitted', omitted)}\n${text.slice(-tail)}`;
}

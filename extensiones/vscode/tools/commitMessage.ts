/**
 * Validación (sin `vscode`, igual que `gitArgs.ts`) del mensaje que
 * `ms365_git_commit` va a usar. No reescribe nada: quien redacta el mensaje
 * de verdad es el modelo que llama a la herramienta —con el diff que le da
 * `ms365_generate_commit_message` como contexto—, así que un mensaje mal
 * formado es un error a corregir (misma filosofía que el resto de
 * herramientas: "si falla, lee el error y corrige la llamada"), no algo que
 * esta función deba arreglar en silencio.
 */
import { t } from '../src/i18n';

/** Tipos de Conventional Commits (https://www.conventionalcommits.org/). */
export const CONVENTIONAL_COMMIT_TYPES = [
	'feat',
	'fix',
	'docs',
	'style',
	'refactor',
	'perf',
	'test',
	'build',
	'ci',
	'chore',
	'revert',
] as const;

const MAX_MESSAGE_CHARS = 8_000;
const MAX_SUBJECT_CHARS = 100;

const SUBJECT_RE = new RegExp(
	`^(${CONVENTIONAL_COMMIT_TYPES.join('|')})(\\([\\w./-]+\\))?(!)?: .{1,${MAX_SUBJECT_CHARS}}$`,
);

/**
 * Comprueba que `raw` sea un mensaje de commit no vacío cuya primera línea
 * siga Conventional Commits, y devuelve el mensaje recortado (fin de línea
 * normalizado a `\n`, sin espacio sobrante en los bordes). Lanza con un
 * mensaje de error accionable en caso contrario.
 */
export function validateConventionalCommitMessage(raw: unknown): string {
	if (typeof raw !== 'string' || !raw.trim()) {
		throw new Error(t('commitMsg.empty'));
	}
	const message = raw.replace(/\r\n/g, '\n').trim();
	if (message.length > MAX_MESSAGE_CHARS) {
		throw new Error(t('commitMsg.tooLong', MAX_MESSAGE_CHARS));
	}

	const subject = message.split('\n', 1)[0];
	if (!SUBJECT_RE.test(subject)) {
		throw new Error(
			t('commitMsg.notConventional', CONVENTIONAL_COMMIT_TYPES.join(', '), subject.slice(0, MAX_SUBJECT_CHARS)),
		);
	}
	if (subject.endsWith('.')) {
		throw new Error(t('commitMsg.trailingPeriod'));
	}

	return message;
}

// ------------------------------------------------- generated with M365 (SCM)

/** Diff budget for the prompt: plenty for a commit, bounded for a 1-turn request. */
const MAX_PROMPT_DIFF_CHARS = 24_000;
const MAX_PROMPT_FILES = 80;

export interface CommitPromptInput {
	/** `git diff --name-status` lines. */
	readonly files: readonly string[];
	/** The diff the message has to describe. */
	readonly diff: string;
	/** False when nothing is staged and the diff is the working tree's. */
	readonly staged: boolean;
}

/**
 * Prompt for the Source Control "Generate commit message with M365 Copilot"
 * button (`ms365copilot.generateCommitMessage`). The language of the message
 * follows the extension's language; the format is always Conventional
 * Commits, the same rule {@link validateConventionalCommitMessage} enforces
 * for the agent's own commits.
 */
export function buildCommitMessagePrompt(input: CommitPromptInput): string {
	const files = input.files.slice(0, MAX_PROMPT_FILES);
	const diff =
		input.diff.length > MAX_PROMPT_DIFF_CHARS
			? `${input.diff.slice(0, MAX_PROMPT_DIFF_CHARS)}\n${t('scm.prompt.truncated', input.diff.length - MAX_PROMPT_DIFF_CHARS)}`
			: input.diff;
	const context = [
		input.staged ? '' : t('scm.prompt.unstaged'),
		`${t('scm.prompt.files', input.files.length)}\n${files.join('\n')}`,
		t('scm.prompt.diff'),
		diff,
		t('scm.prompt.diffEnd'),
	]
		.filter(Boolean)
		.join('\n');
	return t('scm.prompt', CONVENTIONAL_COMMIT_TYPES.join(', '), context);
}

/**
 * The bare commit message out of a chat answer: no code fence around it, no
 * "Commit message:" preamble, no wrapping quotes, LF line endings and no
 * runs of blank lines. Returns '' when nothing usable is left.
 */
export function cleanGeneratedCommitMessage(raw: string): string {
	let text = raw.replace(/\r\n/g, '\n').trim();
	const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(text);
	if (fenced) text = fenced[2].trim();
	// A short label line ending in a colon before the real subject.
	const lines = text.split('\n');
	if (lines.length > 1 && /^[^:]{1,40}:\s*$/.test(lines[0]) && !SUBJECT_RE.test(lines[0])) {
		text = lines.slice(1).join('\n').trim();
	}
	if (/^(["'`])[\s\S]*\1$/.test(text)) text = text.slice(1, -1).trim();
	return text.replace(/\n{3,}/g, '\n\n');
}

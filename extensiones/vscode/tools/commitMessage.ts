/**
 * Validación (sin `vscode`, igual que `gitArgs.ts`) del mensaje que
 * `m365_git_commit` va a usar. No reescribe nada: quien redacta el mensaje
 * de verdad es el modelo que llama a la herramienta —con el diff que le da
 * `m365_generate_commit_message` como contexto—, así que un mensaje mal
 * formado es un error a corregir (misma filosofía que el resto de
 * herramientas: "si falla, lee el error y corrige la llamada"), no algo que
 * esta función deba arreglar en silencio.
 */
import { t } from '../src/i18n';
import { budgetDiff, historyContext, wrap } from './commitContext';

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

// El ámbito admite letras de cualquier idioma: `fix(configuración): …` es tan
// válido como `fix(config): …` (antes `\w`, sólo ASCII, lo rechazaba).
const SUBJECT_RE = new RegExp(
	`^(${CONVENTIONAL_COMMIT_TYPES.join('|')})(\\([\\p{L}\\p{N}_./-]+\\))?(!)?: .{1,${MAX_SUBJECT_CHARS}}$`,
	'u',
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

	const subject = message.split('\n', 1)[0] ?? '';
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

const BODY_WIDTH = 72;

export interface CommitPromptInput {
	/** One line per changed file, with its line counts (`M\tsrc/a.ts +3 -1`). */
	readonly files: readonly string[];
	/** The diff the message has to describe (new files included). */
	readonly diff: string;
	/** False when nothing is staged and the diff is the working tree's. */
	readonly staged: boolean;
	readonly branch?: string;
	/** Subjects of the latest commits, newest first: the repository's style. */
	readonly recentSubjects?: readonly string[];
	/** The previous answer and why it was rejected, to ask for a corrected one. */
	readonly rejected?: { readonly message: string; readonly problem: string };
}

/**
 * Prompt for the Source Control "Generate commit message with M365 Copilot"
 * button (`m365copilot.generateCommitMessage`). The language of the message
 * follows the extension's language — or the repository's, when all its
 * recent commits use another one; the format is always Conventional
 * Commits, the same rule {@link validateConventionalCommitMessage} enforces
 * for the agent's own commits.
 */
export function buildCommitMessagePrompt(input: CommitPromptInput): string {
	const files = input.files.slice(0, MAX_PROMPT_FILES);
	if (input.files.length > files.length) files.push(`… (+${input.files.length - files.length})`);
	const history = historyContext(input.recentSubjects ?? []);
	const context = [
		input.branch ? t('commit.context.branch', input.branch) : '',
		history.length > 0 ? history.join('\n') : '',
		input.staged ? '' : t('scm.prompt.unstaged'),
		`${t('scm.prompt.files', input.files.length)}\n${files.join('\n')}`,
		t('scm.prompt.diff'),
		budgetDiff(input.diff, MAX_PROMPT_DIFF_CHARS),
		t('scm.prompt.diffEnd'),
	]
		.filter(Boolean)
		.join('\n');
	const prompt = t('scm.prompt', CONVENTIONAL_COMMIT_TYPES.join(', '), context);
	return input.rejected ? `${prompt}\n\n${t('scm.prompt.repair', input.rejected.message, input.rejected.problem)}` : prompt;
}

/** Why `message` cannot be used as it is, or undefined when it can. */
export function commitMessageProblem(message: string): string | undefined {
	try {
		validateConventionalCommitMessage(message);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/**
 * The bare commit message out of a chat answer: no code fence around it, no
 * "Commit message:" preamble, no wrapping quotes, LF line endings and no
 * runs of blank lines. Returns '' when nothing usable is left.
 */
export function cleanGeneratedCommitMessage(raw: string): string {
	let text = raw.replace(/\r\n/g, '\n').trim();
	const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(text);
	if (fenced) text = (fenced[2] ?? '').trim();
	// A short label line ending in a colon before the real subject.
	const lines = text.split('\n');
	const label = lines[0] ?? '';
	if (lines.length > 1 && /^[^:]{1,40}:\s*$/.test(label) && !SUBJECT_RE.test(label)) {
		text = lines.slice(1).join('\n').trim();
	}
	if (/^(["'`])[\s\S]*\1$/.test(text)) text = text.slice(1, -1).trim();
	return text.replace(/\n{3,}/g, '\n\n');
}

// ----------------------------------------------------- tidying the message

/** Types models write that mean one of {@link CONVENTIONAL_COMMIT_TYPES}. */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
	feature: 'feat',
	features: 'feat',
	bugfix: 'fix',
	hotfix: 'fix',
	bug: 'fix',
	doc: 'docs',
	documentation: 'docs',
	tests: 'test',
	testing: 'test',
	refactoring: 'refactor',
	performance: 'perf',
	chores: 'chore',
};

/** `BREAKING CHANGE: …`, `Refs: …`, `Co-authored-by: …`: git trailers. */
const TRAILER_RE = /^(?:BREAKING[ -]CHANGE|[A-Za-z][A-Za-z0-9-]*): \S/;
/** An assistant signing the commit. The developer commits; no tool takes credit in their history. */
const AI_COAUTHOR_RE = /^co-authored-by:.*\b(?:copilot|bot|ai|assistant|gpt|claude)\b/i;
const AI_SIGNATURE_RE = /^\W*(?:generated|created|written) (?:by|with)\b.*\b(?:copilot|ai|gpt|chatgpt|claude)\b/i;

/**
 * Fixes the slips that don't need the model to be asked again, so a good
 * message is not rejected over form:
 *  - subject: `Feat(UI) : Add menu.` → `feat(UI): Add menu`; known aliases
 *    (`feature`, `bugfix`, `docs`…) become their Conventional Commits type,
 *    spaces in the scope become `-`, the trailing period goes;
 *  - body: separated from the subject by one blank line, `*`/`•` bullets as
 *    `- `, lines longer than 72 columns reflowed (code blocks and trailers
 *    are left alone), AI co-author/signature lines dropped;
 *  - `ticket` (from the branch name) added as a `Refs:` trailer unless the
 *    message already mentions it.
 * What it cannot fix — a subject that is not Conventional Commits at all —
 * is left for {@link validateConventionalCommitMessage} to reject.
 */
export function normalizeCommitMessage(raw: string, options: { readonly ticket?: string } = {}): string {
	const text = raw.replace(/\r\n?/g, '\n').trim();
	if (!text) return '';
	const [first = '', ...rest] = text.split('\n');
	const subject = normalizeSubject(first);
	let paragraphs = rest
		.join('\n')
		.trim()
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	if (paragraphs.length > 0) {
		const last = paragraphs.length - 1;
		paragraphs = paragraphs
			.map((paragraph, i) =>
				paragraph
					.split('\n')
					.filter((line) => !AI_COAUTHOR_RE.test(line) && !(i === last && AI_SIGNATURE_RE.test(line)))
					.join('\n'),
			)
			.filter(Boolean);
	}
	const fenced = paragraphs.some((paragraph) => /^\s*(?:`{3,}|~{3,})/m.test(paragraph));
	if (!fenced) paragraphs = paragraphs.map(tidyParagraph);

	const ticket = options.ticket;
	if (ticket && !text.toLowerCase().includes(ticket.toLowerCase())) {
		const last = paragraphs.at(-1);
		if (last && last.split('\n').every((line) => TRAILER_RE.test(line))) {
			paragraphs[paragraphs.length - 1] = `${last}\nRefs: ${ticket}`;
		} else {
			paragraphs.push(`Refs: ${ticket}`);
		}
	}
	return [subject, ...paragraphs].join('\n\n');
}

function normalizeSubject(line: string): string {
	let subject = line
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^#+\s+/, '')
		.replace(/^\*\*(.+)\*\*$/, '$1');
	const match = /^([A-Za-z]+) ?(?:\( ?([^)]*?) ?\))? ?(!)? ?: ?(.*)$/.exec(subject);
	if (match) {
		const [, word = '', scope, bang, summary] = match;
		const type = TYPE_ALIASES[word.toLowerCase()] ?? word.toLowerCase();
		if ((CONVENTIONAL_COMMIT_TYPES as readonly string[]).includes(type) && summary) {
			const cleanScope = scope ? scope.replace(/ /g, '-') : '';
			subject = `${type}${cleanScope ? `(${cleanScope})` : ''}${bang ?? ''}: ${summary}`;
		}
	}
	return subject.replace(/[\s.]+$/, '');
}

/** Bullets as `- `; reflowed at 72 columns only if some line is longer. */
function tidyParagraph(paragraph: string): string {
	const lines = paragraph.split('\n').map((line) => line.trimEnd().replace(/^(\s*)[*•]\s+/, '$1- '));
	if (lines.every((line) => line.length <= BODY_WIDTH) || lines.every((line) => TRAILER_RE.test(line))) {
		return lines.join('\n');
	}
	const items: { indent: string; bullet: boolean; text: string }[] = [];
	for (const line of lines) {
		const bullet = /^(\s*)- (.*)$/.exec(line);
		if (bullet) items.push({ indent: bullet[1] ?? '', bullet: true, text: bullet[2] ?? '' });
		else if (items.length === 0 || TRAILER_RE.test(line)) items.push({ indent: '', bullet: false, text: line.trim() });
		else items[items.length - 1]!.text += ` ${line.trim()}`;
	}
	return items
		.map((item) =>
			item.bullet
				? wrap(item.text, BODY_WIDTH, `${item.indent}- `, `${item.indent}  `)
				: TRAILER_RE.test(item.text)
					? item.text
					: wrap(item.text, BODY_WIDTH, '', ''),
		)
		.join('\n');
}

/**
 * Prompt building for the `@m365` chat participant (see participant.ts).
 *
 * Kept free of the `vscode` import, like toolCatalog.ts, so test/e2e.mts can
 * check exactly what the model receives for each slash command.
 */
import { t, type MessageKey } from './i18n';
import { M365_TOOL_NAMES, M365_WORKSPACE_TOOL_NAMES } from './toolCatalog';

export const PARTICIPANT_COMMANDS = ['explain', 'fix', 'doc', 'tests'] as const;
export type ParticipantCommand = (typeof PARTICIPANT_COMMANDS)[number];

export function asParticipantCommand(value: string | undefined): ParticipantCommand | undefined {
	return (PARTICIPANT_COMMANDS as readonly string[]).includes(value ?? '') ? (value as ParticipantCommand) : undefined;
}

/** The code a request is about, already captured from the editor. */
export interface PromptCodeContext {
	readonly relativePath: string;
	readonly languageId: string;
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
	readonly text: string;
	/** Characters cut from the end of {@link text} to keep the prompt bounded. */
	readonly truncatedChars: number;
	/** Diagnostics VS Code reports inside that range, already formatted. */
	readonly diagnostics: readonly string[];
}

export interface HistoryTurn {
	readonly role: 'user' | 'assistant';
	readonly text: string;
}

export interface ParticipantPromptInput {
	readonly command: ParticipantCommand | undefined;
	/** What the user typed after `@m365 /command`. */
	readonly request: string;
	readonly code?: PromptCodeContext;
	readonly history?: readonly HistoryTurn[];
	/** Workspace-relative paths of other files attached with `#`. */
	readonly attachedPaths?: readonly string[];
}

const TASK_KEYS: Readonly<Record<ParticipantCommand | 'ask', MessageKey>> = {
	explain: 'participant.task.explain',
	fix: 'participant.task.fix',
	doc: 'participant.task.doc',
	tests: 'participant.task.tests',
	ask: 'participant.task.ask',
};

/**
 * Tools the loop is allowed to use per command. `/explain` only reads: an
 * explanation that starts editing files would be a nasty surprise. The rest
 * get the full workspace set (edits still go through Keep/Undo, commands and
 * commits through their confirmation dialogs).
 */
export function toolsForCommand(command: ParticipantCommand | undefined): readonly string[] {
	if (command === 'explain') {
		return [
			M365_TOOL_NAMES.listFiles,
			M365_TOOL_NAMES.searchText,
			M365_TOOL_NAMES.readFile,
			M365_TOOL_NAMES.getDiagnostics,
			M365_TOOL_NAMES.gitInfo,
		];
	}
	return M365_WORKSPACE_TOOL_NAMES;
}

/** Tool-call budget per request: an explanation rarely needs more than a couple of reads. */
export function maxStepsForCommand(command: ParticipantCommand | undefined): number {
	return command === 'explain' ? 4 : 10;
}

const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TURN_CHARS = 1_500;

/** The framing handed to `runToolLoop`: role, tone, task, context and request. */
export function buildParticipantFraming(input: ParticipantPromptInput): string {
	const sections = [
		t('participant.prompt.framing'),
		t('prompt.tone'),
		t('prompt.markdown'),
		t(TASK_KEYS[input.command ?? 'ask']),
	];

	const history = renderHistory(input.history ?? []);
	if (history) sections.push(`${t('participant.prompt.history')}\n${history}`);

	if (input.code) sections.push(renderCode(input.code));
	if (input.attachedPaths && input.attachedPaths.length > 0) {
		sections.push(t('participant.prompt.attached', input.attachedPaths.join(', ')));
	}

	const request = input.request.trim();
	sections.push(`${t('participant.prompt.request')}\n${request || t('participant.prompt.noRequest')}`);
	return sections.join('\n\n');
}

function renderCode(code: PromptCodeContext): string {
	const fence = fenceFor(code.text);
	const lines = [
		t('participant.prompt.context', code.relativePath, code.startLine, code.endLine, code.languageId),
		`${fence}${code.languageId}`,
		code.text,
		fence,
	];
	if (code.truncatedChars > 0) lines.push(t('participant.prompt.contextTruncated', code.truncatedChars));
	if (code.diagnostics.length > 0) {
		lines.push(t('participant.prompt.diagnostics'), ...code.diagnostics.map((line) => `- ${line}`));
	}
	return lines.join('\n');
}

/** A fence longer than any backtick run inside the code, so the code can never close it early. */
export function fenceFor(text: string): string {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	return '`'.repeat(Math.max(3, longest + 1));
}

function renderHistory(turns: readonly HistoryTurn[]): string {
	return turns
		.filter((turn) => turn.text.trim())
		.slice(-MAX_HISTORY_TURNS)
		.map((turn) => {
			const text = turn.text.trim();
			const clipped = text.length > MAX_HISTORY_TURN_CHARS ? `${text.slice(0, MAX_HISTORY_TURN_CHARS)}…` : text;
			return `${turn.role === 'user' ? 'User' : 'Assistant'}: ${clipped}`;
		})
		.join('\n\n');
}

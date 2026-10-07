/**
 * Prompt and result of `m365_web_search` (webSearch.ts): a separate BizChat
 * turn with the web app's own plugins — web search — whose answer, with its
 * sources, goes back to the agent as the tool result.
 *
 * Kept free of the `vscode` import so the tests can check both.
 */
import type { WebSource } from './client';
import { t } from './i18n';

const MAX_ANSWER_CHARS = 8_000;
const MAX_SOURCES = 12;

export function buildWebSearchPrompt(query: string): string {
	return [t('web.prompt.role'), t('web.prompt.rules'), `${t('web.prompt.query')}\n${query.trim()}`].join('\n\n');
}

/**
 * The tool result: the answer with BizChat's citation markers (`[^1^]`)
 * turned into `[1]`, and the cited pages listed below it.
 */
export function formatWebResult(query: string, answer: string, sources: readonly WebSource[]): string {
	let text = answer
		.replace(/\[\^(\d+)\^\]/g, '[$1]')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!text) return t('web.empty', query);
	if (text.length > MAX_ANSWER_CHARS) text = `${text.slice(0, MAX_ANSWER_CHARS)}…`;
	const unique = uniqueSources(sources);
	const parts = [t('web.result.header', query), text];
	if (unique.length > 0) {
		parts.push(`${t('web.result.sources')}\n${unique.map((source, index) => `${index + 1}. ${source.title} — ${source.url}`).join('\n')}`);
	}
	return parts.join('\n\n');
}

/** Sources as a Markdown list, for a chat answer that came from a web turn. */
export function sourcesMarkdown(sources: readonly WebSource[]): string {
	const unique = uniqueSources(sources);
	if (unique.length === 0) return '';
	return `\n\n${t('web.result.sources')}\n${unique.map((source, index) => `${index + 1}. [${source.title.replace(/[[\]]/g, '')}](${source.url})`).join('\n')}`;
}

/** Each page once (the first time it is cited), at most {@link MAX_SOURCES}. */
function uniqueSources(sources: readonly WebSource[]): WebSource[] {
	const seen = new Set<string>();
	const unique: WebSource[] = [];
	for (const source of sources) {
		if (seen.has(source.url)) continue;
		seen.add(source.url);
		unique.push(source);
		if (unique.length >= MAX_SOURCES) break;
	}
	return unique;
}

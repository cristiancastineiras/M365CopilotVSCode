/**
 * `m365_web_search`: internet access for the agent and `@m365`.
 *
 * The extension's chat turns use a lean BizChat invocation without the web
 * app's plugins — that is what makes the text tool protocol reliable (see
 * client.ts), and also why M365 Copilot "has no internet" from VS Code. This
 * tool gives it back where it is needed: it runs a separate turn in `web`
 * mode — the invocation the M365 Copilot web app itself sends, as captured by
 * the browser extension or the userscript, web search included — and returns
 * its answer with the sources to the turn that asked.
 */
import * as vscode from 'vscode';
import { streamCopilotTurnWithRetry, CopilotClientError, type WebSource } from './client';
import { isTokenUsable } from './profile';
import type { ProfileStore } from './secrets';
import { buildWebSearchPrompt, formatWebResult } from './webSearchPrompt';
import { toolResult } from './agentTools';
import { M365_TOOL_NAMES } from './toolProtocol';
import { CancelledError } from '../tools/common';
import { t } from './i18n';

export interface WebSearchInput {
	readonly query?: unknown;
}

/** `m365copilot.web.enabled`. */
export function webSearchEnabled(): boolean {
	return vscode.workspace.getConfiguration('m365copilot.web').get<boolean>('enabled', true);
}

export function registerWebSearchTool(store: ProfileStore, log: (message: string) => void): vscode.Disposable {
	return vscode.lm.registerTool<WebSearchInput>(M365_TOOL_NAMES.webSearch, {
		prepareInvocation: (options) => ({
			invocationMessage: t('tool.webSearching', typeof options.input.query === 'string' ? options.input.query : ''),
		}),
		invoke: (options, token) => toolResult(() => searchWeb(store, options.input, token, log)),
	});
}

async function searchWeb(
	store: ProfileStore,
	input: WebSearchInput,
	token: vscode.CancellationToken,
	log: (message: string) => void,
): Promise<string> {
	const query = typeof input.query === 'string' ? input.query.trim() : '';
	if (!query) throw new Error(t('web.noQuery'));
	if (!webSearchEnabled()) return t('web.disabled');
	const profile = await store.get();
	if (!profile || !isTokenUsable(profile)) throw new Error(t(profile ? 'participant.tokenExpired' : 'participant.noToken'));
	if (!profile.invocationTemplate) return t('web.noTemplate');

	const controller = new AbortController();
	const cancel = token.onCancellationRequested(() => controller.abort());
	let answer = '';
	const sources: WebSource[] = [];
	try {
		log(t('log.webSearch', query));
		await streamCopilotTurnWithRetry({
			profile,
			prompt: buildWebSearchPrompt(query),
			tone: null,
			mode: 'web',
			signal: controller.signal,
			log,
			callbacks: {
				onText: (delta) => (answer += delta),
				onSources: (found) => sources.push(...found),
			},
		});
	} catch (error) {
		if (token.isCancellationRequested || (error instanceof CopilotClientError && error.message === '__CANCELLED__')) {
			throw new CancelledError();
		}
		throw error;
	} finally {
		cancel.dispose();
	}
	log(t('log.webSearchDone', answer.length, sources.length));
	return formatWebResult(query, answer, sources);
}

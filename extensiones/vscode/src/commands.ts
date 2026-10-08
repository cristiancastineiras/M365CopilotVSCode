/**
 * Commands behind the status bar hub: the quick menu itself, token
 * management (paste / status / clear), the inline-completion toggle and the
 * language picker.
 */
import * as vscode from 'vscode';
import { M365_CHAT_URL } from '@m365copilot/core';
import {
	foreignAudience,
	isTokenUsable,
	looksLikeProfile,
	minutesUntilExpiry,
	parsePastedProfile,
	ProfileParseError,
	type CopilotProfile,
} from './profile';
import type { ProfileStore } from './secrets';
import type { WorkspaceEditManager } from '../tools/writeFile';
import type { CopilotModel, ModelRegistry } from './models';
import { CopilotClientError, CopilotModelUnavailableError, streamCopilotTurn } from './client';
import { log } from './logger';
import type { IndexStatus } from './projectIndex';
import { getLocale, resolveLocale, t, type LanguageSetting, type Locale } from './i18n';

/** The walkthrough contributed in package.json (`<publisher>.<name>#<id>`). */
export const WALKTHROUGH_ID = 'm365-copilot-vscode.m365-copilot-vscode#m365copilot.gettingStarted';

interface MenuItem extends vscode.QuickPickItem {
	readonly run?: () => unknown;
}

export async function showMenu(
	store: ProfileStore,
	edits: WorkspaceEditManager,
	index?: IndexStatus,
	autoCommitOn = false,
): Promise<void> {
	const profile = await store.get();
	const completionsOn = vscode.workspace
		.getConfiguration('m365copilot.inlineCompletions')
		.get<boolean>('enabled', true);

	const command = (id: string) => () => vscode.commands.executeCommand(id);
	const items: MenuItem[] = [
		{ label: t('menu.section.session'), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(key) ${t('menu.paste')}`,
			detail: t('menu.paste.detail'),
			run: command('m365copilot.pasteProfile'),
		},
		{ label: `$(info) ${t('menu.status')}`, description: tokenSummary(profile), run: command('m365copilot.showStatus') },
		{ label: `$(link-external) ${t('menu.openM365')}`, run: () => openM365() },
		{
			label: `$(sign-out) ${t('menu.signOut')}`,
			detail: t('menu.signOut.detail'),
			run: command('m365copilot.signOut'),
		},
		{ label: t('menu.section.editor'), kind: vscode.QuickPickItemKind.Separator },
		{ label: `$(comment-discussion) ${t('menu.openChat')}`, run: command('m365copilot.openChat') },
		{
			label: `${completionsOn ? '$(circle-slash)' : '$(sparkle)'} ${t(completionsOn ? 'menu.completionsOff' : 'menu.completionsOn')}`,
			run: command('m365copilot.toggleInlineCompletions'),
		},
		...(edits.pendingCount > 0
			? [
					{
						label: `$(edit) ${t('menu.reviewEdits', edits.pendingCount)}`,
						run: command('m365copilot.reviewPendingEdits'),
					},
				]
			: []),
		{ label: `$(git-commit) ${t('menu.commitMessage')}`, run: command('m365copilot.generateCommitMessage') },
		{
			label: `$(history) ${t(autoCommitOn ? 'menu.autoCommit.on' : 'menu.autoCommit.off')}`,
			detail: autoCommitOn ? undefined : t('menu.autoCommit.detail'),
			// On: its own menu (check now, undo, turn off) — the status bar item opens the same one.
			run: command(autoCommitOn ? 'm365copilot.autoCommitMenu' : 'm365copilot.toggleAutoCommit'),
		},
		{ label: `$(sync) ${t('menu.models')}`, run: command('m365copilot.refreshModels') },
		{ label: t('menu.section.project'), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(search) ${t('menu.searchProject')}`,
			description: index ? indexSummary(index) : undefined,
			run: command('m365copilot.searchProject'),
		},
		{ label: `$(type-hierarchy) ${t('menu.projectMap')}`, run: command('m365copilot.showProjectMap') },
		{ label: `$(database) ${t('menu.rebuildIndex')}`, run: command('m365copilot.rebuildIndex') },
		{ label: t('menu.section.extension'), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(globe) ${t('menu.language', languageLabel(currentLanguageSetting()))}`,
			run: command('m365copilot.selectLanguage'),
		},
		{ label: `$(gear) ${t('menu.settings')}`, run: () => openSettings() },
		{ label: `$(book) ${t('menu.walkthrough')}`, run: () => openWalkthrough() },
		{ label: `$(output) ${t('menu.log')}`, run: command('m365copilot.showLog') },
		...(profile ? [{ label: `$(trash) ${t('menu.clear')}`, run: command('m365copilot.clearProfile') }] : []),
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: t('menu.title'),
		placeHolder: t('menu.placeholder'),
		matchOnDescription: true,
	});
	await picked?.run?.();
}

/**
 * The stored profile if its token can be used right now. Otherwise says why
 * (missing / expired) with a "Paste token" button, and resolves undefined —
 * the common guard of every editor command that talks to M365 directly.
 */
export async function requireUsableProfile(store: ProfileStore): Promise<CopilotProfile | undefined> {
	const profile = await store.get();
	if (profile && isTokenUsable(profile)) return profile;
	const paste = t('watcher.pasteToken');
	const picked = await vscode.window.showWarningMessage(
		t(profile ? 'participant.tokenExpired' : 'participant.noToken'),
		paste,
	);
	if (picked === paste) await vscode.commands.executeCommand('m365copilot.pasteProfile');
	return undefined;
}

export async function pasteProfile(store: ProfileStore): Promise<void> {
	const profile = await promptForProfile(store);
	if (profile) await announceProfile(profile);
}

/**
 * Asks for the profile/token and stores it. Resolves the stored profile, or
 * undefined when the user cancelled or it could not be parsed (already said).
 * Without the "ready" notification, which only resolves once dismissed: the
 * Accounts sign-in (account.ts) must not wait for that.
 */
export async function promptForProfile(store: ProfileStore): Promise<CopilotProfile | undefined> {
	// The usual flow is "Copy token" in the browser, then this command: when
	// the clipboard already holds a token, pre-fill it so Enter is enough.
	let clipboard = '';
	try {
		clipboard = await vscode.env.clipboard.readText();
	} catch {
		/* no clipboard access (remote/web): paste by hand */
	}
	const fromClipboard = looksLikeProfile(clipboard);
	const pasted = await vscode.window.showInputBox({
		title: t('paste.title'),
		prompt: t(fromClipboard ? 'paste.fromClipboard' : 'paste.prompt'),
		placeHolder: t('paste.placeholder'),
		value: fromClipboard ? clipboard.trim() : undefined,
		password: true,
		ignoreFocusOut: true,
	});
	if (pasted === undefined) return undefined;

	try {
		const profile = parsePastedProfile(pasted);
		// A token for another service would show as connected and then fail
		// every message with 401: say so now, while the user is still in DevTools.
		const audience = foreignAudience(profile.accessToken);
		if (audience) {
			const useAnyway = t('paste.foreignAudience.useAnyway');
			const picked = await vscode.window.showWarningMessage(
				t('paste.foreignAudience', audience),
				{ modal: true, detail: t('paste.foreignAudience.detail') },
				useAnyway,
			);
			if (picked !== useAnyway) return undefined;
		}
		return await store.set(profile);
	} catch (error) {
		const msg = error instanceof ProfileParseError ? error.message : String(error);
		void vscode.window.showErrorMessage(t('paste.failed', msg));
		return undefined;
	}
}

/** "Ready (user@…), valid for N minutes" with a button to open the chat. */
export async function announceProfile(profile: CopilotProfile): Promise<void> {
	const who = profile.claims?.upn ? ` (${profile.claims.upn})` : '';
	const mins = minutesUntilExpiry(profile);
	const expiry = mins !== null ? t('paste.validFor', mins) : '';
	const openChat = t('paste.openChat');
	const picked = await vscode.window.showInformationMessage(t('paste.ready', who, expiry), openChat);
	if (picked === openChat) await vscode.commands.executeCommand('m365copilot.openChat');
}

export async function clearProfile(store: ProfileStore): Promise<void> {
	const confirm = t('clear.confirmButton');
	const ok = await vscode.window.showWarningMessage(t('clear.confirm'), { modal: true }, confirm);
	if (ok !== confirm) return;
	await store.clear();
	void vscode.window.showInformationMessage(t('clear.done'));
}

export async function showStatus(store: ProfileStore): Promise<void> {
	const profile = await store.get();
	const paste = t('watcher.pasteToken');
	if (!profile) {
		const picked = await vscode.window.showInformationMessage(t('status.noToken'), paste);
		if (picked === paste) await vscode.commands.executeCommand('m365copilot.pasteProfile');
		return;
	}
	const usable = isTokenUsable(profile);
	const lines = [
		t('status.user', profile.claims?.upn ?? t('status.unknownUser')),
		t('status.state', tokenSummary(profile)),
		t('status.captured', new Date(profile.capturedAt).toLocaleString(getLocale())),
	];
	const open = t('status.openM365');
	const actions = usable ? [open] : [paste, open];
	const picked = await vscode.window.showInformationMessage(lines.join('  ·  '), ...actions);
	if (picked === paste) await vscode.commands.executeCommand('m365copilot.pasteProfile');
	if (picked === open) await openM365();
}

/**
 * "Update models": download the catalog now and list every model with where
 * it comes from and whether the service refused it lately. Picking one opens
 * the chat with it (when VS Code supports choosing the model from the
 * command; otherwise just the chat); the first entry checks them all.
 */
export async function refreshModels(registry: ModelRegistry, store: ProfileStore): Promise<void> {
	const updated = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('models.updating') },
		() => registry.refreshCatalog(),
	);
	if (!updated && vscode.workspace.getConfiguration('m365copilot.models').get<boolean>('updateFromCatalog', true)) {
		void vscode.window.showWarningMessage(t('models.updateFailed'));
	}
	const sourceLabel = {
		builtin: t('models.label.builtin'),
		catalog: t('models.label.catalog'),
		observed: t('models.label.observed'),
		custom: t('models.label.custom'),
	};
	const check = { label: `$(beaker) ${t('models.check.action')}`, detail: t('models.check.actionDetail'), id: '' };
	const picked = await vscode.window.showQuickPick(
		[
			check,
			{ label: '', kind: vscode.QuickPickItemKind.Separator, id: '' },
			...registry.models.map((model) => {
				const unavailable = registry.unavailability(model.tone);
				return {
					label: `${unavailable ? '$(warning) ' : ''}${model.name}`,
					description: model.tone ?? 'auto',
					detail: unavailable ? `${sourceLabel[model.source]} · ${t('model.unavailable')}` : sourceLabel[model.source],
					id: model.id,
				};
			}),
		],
		{ title: t('models.title', registry.models.length), placeHolder: t('models.placeholder'), matchOnDescription: true },
	);
	if (!picked) return;
	if (picked === check) {
		await checkModels(registry, store);
		return;
	}
	await openChatWith(picked.id);
}

async function openChatWith(modelId: string): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.chat.open', {
		modelSelector: { vendor: 'm365copilot', id: modelId },
	});
}

/** What the check asks each model: short, so a reasoning model does not think for long. */
const CHECK_PROMPT = 'Reply with just the word OK.';

interface CheckResult {
	readonly model: CopilotModel;
	readonly ok: boolean;
	readonly reason?: string;
}

/**
 * "Check models": one short turn per model (not Auto) to see which ones this
 * account can really use — new models reach a tenant in phases, and the
 * Anthropic/OpenAI ones need the admin. Each check is a conversation of its
 * own, one after another; the registry records every outcome (the client
 * reports them), so the picker flags the ones that failed.
 */
export async function checkModels(registry: ModelRegistry, store: ProfileStore): Promise<void> {
	const profile = await store.get();
	if (!profile || !isTokenUsable(profile)) {
		void vscode.window.showWarningMessage(t('models.check.noToken'));
		return;
	}
	const models = registry.models.filter((model) => model.tone !== null);
	const results = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('models.check.title'), cancellable: true },
		async (progress, token) => {
			const done: CheckResult[] = [];
			for (const [index, model] of models.entries()) {
				if (token.isCancellationRequested) break;
				progress.report({
					message: t('models.check.progress', shortName(model), index + 1, models.length),
					increment: 100 / models.length,
				});
				const controller = new AbortController();
				const cancel = token.onCancellationRequested(() => controller.abort());
				try {
					let answered = false;
					await streamCopilotTurn({
						profile,
						prompt: CHECK_PROMPT,
						tone: model.tone,
						signal: controller.signal,
						log,
						callbacks: { onText: (text) => (answered ||= Boolean(text.trim())) },
					});
					done.push(answered ? { model, ok: true } : { model, ok: false, reason: t('models.check.empty') });
				} catch (error) {
					if (token.isCancellationRequested || (error instanceof CopilotClientError && error.message === '__CANCELLED__')) break;
					const reason =
						error instanceof CopilotModelUnavailableError
							? error.serverReply
							: error instanceof Error
								? error.message
								: String(error);
					done.push({ model, ok: false, reason });
				} finally {
					cancel.dispose();
				}
			}
			return done;
		},
	);
	if (results.length === 0) return;
	const working = results.filter((result) => result.ok).length;
	const picked = await vscode.window.showQuickPick(
		results.map((result) => ({
			label: `${result.ok ? '$(pass-filled)' : '$(error)'} ${shortName(result.model)}`,
			description: result.model.tone ?? '',
			detail: result.ok ? t('models.check.works') : result.reason,
			id: result.model.id,
		})),
		{ title: t('models.check.summary', working, results.length), placeHolder: t('models.placeholder') },
	);
	if (picked) await openChatWith(picked.id);
}

function shortName(model: CopilotModel): string {
	return model.name.replace(/^M365 Copilot · /, '');
}

export async function toggleInlineCompletions(): Promise<void> {
	const config = vscode.workspace.getConfiguration('m365copilot.inlineCompletions');
	const enabled = config.get<boolean>('enabled', true);
	// Global target: the toggle is about how you want the editor to behave, not
	// a property of whichever folder happens to be open.
	await config.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
	void vscode.window.showInformationMessage(t(enabled ? 'completions.toggledOff' : 'completions.toggledOn'));
}

export async function selectLanguage(): Promise<void> {
	const current = currentLanguageSetting();
	const options: { label: string; value: LanguageSetting }[] = [
		{ label: languageLabel('auto'), value: 'auto' },
		{ label: 'English', value: 'en' },
		{ label: 'Español', value: 'es' },
	];
	const picked = await vscode.window.showQuickPick(
		options.map((option) => ({ ...option, description: option.value === current ? '✓' : undefined })),
		{ title: t('language.pick.title'), placeHolder: t('language.pick.placeholder') },
	);
	if (!picked || picked.value === current) return;
	// The configuration listener in extension.ts applies the change.
	await vscode.workspace
		.getConfiguration('m365copilot')
		.update('language', picked.value, vscode.ConfigurationTarget.Global);
}

export function currentLanguageSetting(): LanguageSetting {
	const value = vscode.workspace.getConfiguration('m365copilot').get<string>('language', 'auto');
	return value === 'en' || value === 'es' ? value : 'auto';
}

function languageLabel(setting: LanguageSetting): string {
	return setting === 'auto'
		? t('language.auto', languageName(resolveLocale('auto', vscode.env.language)))
		: languageName(setting);
}

export function languageName(locale: Locale): string {
	return t(locale === 'es' ? 'language.es' : 'language.en');
}

function indexSummary(status: IndexStatus): string {
	switch (status.state) {
		case 'indexing':
			return t('index.status.indexing', status.files);
		case 'disabled':
			return t('index.status.disabled');
		case 'untrusted':
			return t('index.status.untrusted');
		default:
			return t('index.status.ready', status.files);
	}
}

function tokenSummary(profile: Awaited<ReturnType<ProfileStore['get']>>): string {
	if (!profile) return t('statusbar.tooltip.tokenMissing');
	const mins = minutesUntilExpiry(profile);
	if (!isTokenUsable(profile)) {
		return mins !== null ? `${t('status.tokenExpired')} (${t('status.expiredAgo', Math.abs(mins))})` : t('status.tokenExpired');
	}
	return mins !== null ? `${t('status.tokenValid')} (${t('status.minutesLeft', mins)})` : t('status.tokenValid');
}

export async function openM365(): Promise<void> {
	await vscode.env.openExternal(vscode.Uri.parse(M365_CHAT_URL));
}

async function openSettings(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:m365-copilot-vscode.m365-copilot-vscode');
}

export async function openWalkthrough(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
}

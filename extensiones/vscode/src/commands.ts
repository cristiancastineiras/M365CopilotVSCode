/**
 * Commands behind the status bar hub: the quick menu itself, token
 * management (paste / status / clear), the inline-completion toggle and the
 * language picker.
 */
import * as vscode from 'vscode';
import { M365_CHAT_URL } from '@ms365copilot/core';
import { isTokenUsable, minutesUntilExpiry, ProfileParseError } from './profile';
import type { ProfileStore } from './secrets';
import type { WorkspaceEditManager } from '../tools/writeFile';
import { getLocale, resolveLocale, t, type LanguageSetting, type Locale } from './i18n';

/** The walkthrough contributed in package.json (`<publisher>.<name>#<id>`). */
export const WALKTHROUGH_ID = 'ms365-copilot-vscode.ms365-copilot-vscode#ms365copilot.gettingStarted';

interface MenuItem extends vscode.QuickPickItem {
	readonly run?: () => unknown;
}

export async function showMenu(store: ProfileStore, edits: WorkspaceEditManager): Promise<void> {
	const profile = await store.get();
	const completionsOn = vscode.workspace
		.getConfiguration('ms365copilot.inlineCompletions')
		.get<boolean>('enabled', true);

	const command = (id: string) => () => vscode.commands.executeCommand(id);
	const items: MenuItem[] = [
		{ label: t('menu.section.session'), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(key) ${t('menu.paste')}`,
			detail: t('menu.paste.detail'),
			run: command('ms365copilot.pasteProfile'),
		},
		{ label: `$(info) ${t('menu.status')}`, description: tokenSummary(profile), run: command('ms365copilot.showStatus') },
		{ label: `$(link-external) ${t('menu.openM365')}`, run: () => openM365() },
		{ label: t('menu.section.editor'), kind: vscode.QuickPickItemKind.Separator },
		{ label: `$(comment-discussion) ${t('menu.openChat')}`, run: command('ms365copilot.openChat') },
		{
			label: `${completionsOn ? '$(circle-slash)' : '$(sparkle)'} ${t(completionsOn ? 'menu.completionsOff' : 'menu.completionsOn')}`,
			run: command('ms365copilot.toggleInlineCompletions'),
		},
		...(edits.pendingCount > 0
			? [
					{
						label: `$(edit) ${t('menu.reviewEdits', edits.pendingCount)}`,
						run: command('ms365copilot.reviewPendingEdits'),
					},
				]
			: []),
		{ label: `$(git-commit) ${t('menu.commitMessage')}`, run: command('ms365copilot.generateCommitMessage') },
		{ label: t('menu.section.extension'), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `$(globe) ${t('menu.language', languageLabel(currentLanguageSetting()))}`,
			run: command('ms365copilot.selectLanguage'),
		},
		{ label: `$(gear) ${t('menu.settings')}`, run: () => openSettings() },
		{ label: `$(book) ${t('menu.walkthrough')}`, run: () => openWalkthrough() },
		{ label: `$(output) ${t('menu.log')}`, run: command('ms365copilot.showLog') },
		...(profile ? [{ label: `$(trash) ${t('menu.clear')}`, run: command('ms365copilot.clearProfile') }] : []),
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: t('menu.title'),
		placeHolder: t('menu.placeholder'),
		matchOnDescription: true,
	});
	await picked?.run?.();
}

export async function pasteProfile(store: ProfileStore): Promise<void> {
	const pasted = await vscode.window.showInputBox({
		title: t('paste.title'),
		prompt: t('paste.prompt'),
		placeHolder: t('paste.placeholder'),
		password: true,
		ignoreFocusOut: true,
	});
	if (pasted === undefined) return;

	try {
		const profile = await store.setFromPaste(pasted);
		const who = profile.claims?.upn ? ` (${profile.claims.upn})` : '';
		const mins = minutesUntilExpiry(profile);
		const expiry = mins !== null ? t('paste.validFor', mins) : '';
		const openChat = t('paste.openChat');
		const picked = await vscode.window.showInformationMessage(t('paste.ready', who, expiry), openChat);
		if (picked === openChat) await vscode.commands.executeCommand('ms365copilot.openChat');
	} catch (error) {
		const msg = error instanceof ProfileParseError ? error.message : String(error);
		void vscode.window.showErrorMessage(t('paste.failed', msg));
	}
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
		if (picked === paste) await vscode.commands.executeCommand('ms365copilot.pasteProfile');
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
	if (picked === paste) await vscode.commands.executeCommand('ms365copilot.pasteProfile');
	if (picked === open) await openM365();
}

export async function toggleInlineCompletions(): Promise<void> {
	const config = vscode.workspace.getConfiguration('ms365copilot.inlineCompletions');
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
		.getConfiguration('ms365copilot')
		.update('language', picked.value, vscode.ConfigurationTarget.Global);
}

export function currentLanguageSetting(): LanguageSetting {
	const value = vscode.workspace.getConfiguration('ms365copilot').get<string>('language', 'auto');
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
	await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ms365-copilot-vscode.ms365-copilot-vscode');
}

export async function openWalkthrough(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
}

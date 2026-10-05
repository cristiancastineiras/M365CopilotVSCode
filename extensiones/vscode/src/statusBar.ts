import * as vscode from 'vscode';
import { isTokenUsable, minutesUntilExpiry, type CopilotProfile } from './profile';
import type { CompletionBusySink } from './completions';
import type { ProfileStore } from './secrets';
import { t } from './i18n';

const COMPLETIONS_SECTION = 'ms365copilot.inlineCompletions';
/** Below this many minutes left, the item shows a countdown instead of the plain icon. */
const COUNTDOWN_MINUTES = 10;

/**
 * The one M365 Copilot item in the status bar: token state, inline-completion
 * state and "a suggestion is on its way", in that order of priority. Clicking
 * it opens the quick menu (`ms365copilot.showMenu`) — the single entry point
 * to everything the extension can do, instead of a command palette search.
 *
 * Replaces the old completion-only item, which toggled completions on click:
 * that hid the most common problem (an expired token) behind an icon that
 * looked perfectly healthy.
 */
export class M365StatusBar implements CompletionBusySink, vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];
	private profile: CopilotProfile | null = null;
	private busy = false;
	private pendingEdits = 0;

	constructor(private readonly store: ProfileStore) {
		this.item = vscode.window.createStatusBarItem('ms365copilot.status', vscode.StatusBarAlignment.Right, 90);
		this.item.name = 'M365 Copilot';
		this.item.command = 'ms365copilot.showMenu';
		this.disposables.push(
			store.onDidChange(() => void this.reload()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(COMPLETIONS_SECTION)) this.render();
			}),
		);
		this.render();
		this.item.show();
		void this.reload();
	}

	setBusy(busy: boolean): void {
		if (this.busy === busy) return;
		this.busy = busy;
		this.render();
	}

	setPendingEdits(count: number): void {
		if (this.pendingEdits === count) return;
		this.pendingEdits = count;
		this.render();
	}

	/** Re-render with the current clock and locale (the token watcher calls this every tick). */
	refresh(): void {
		this.render();
	}

	private async reload(): Promise<void> {
		this.profile = await this.store.get();
		this.render();
	}

	private render(): void {
		const completionsOn = vscode.workspace.getConfiguration(COMPLETIONS_SECTION).get<boolean>('enabled', true);
		const profile = this.profile;
		const usable = profile ? isTokenUsable(profile) : false;
		const minutes = profile ? minutesUntilExpiry(profile) : null;

		let icon = completionsOn ? '$(sparkle)' : '$(circle-slash)';
		let suffix = '';
		let background: vscode.ThemeColor | undefined;
		if (!profile) {
			icon = '$(key)';
		} else if (!usable) {
			icon = '$(warning)';
			background = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else if (minutes !== null && minutes <= COUNTDOWN_MINUTES) {
			icon = '$(clock)';
			suffix = ` ${minutes}m`;
		}
		if (this.busy) icon = '$(loading~spin)';

		this.item.text = `${icon} M365${suffix}`;
		this.item.backgroundColor = background;
		this.item.tooltip = this.tooltip(profile, usable, minutes, completionsOn);
	}

	private tooltip(
		profile: CopilotProfile | null,
		usable: boolean,
		minutes: number | null,
		completionsOn: boolean,
	): vscode.MarkdownString {
		const lines = [`**${t('statusbar.tooltip.title')}**`, ''];
		if (profile?.claims?.upn) lines.push(`$(account) ${t('statusbar.tooltip.account', profile.claims.upn)}`);
		if (!profile) {
			lines.push(`$(key) ${t('statusbar.tooltip.tokenMissing')}`);
		} else if (!usable) {
			lines.push(`$(warning) ${t('statusbar.tooltip.tokenExpired', Math.abs(minutes ?? 0))}`);
		} else {
			lines.push(
				`$(pass) ${minutes === null ? t('statusbar.tooltip.tokenValidNoExpiry') : t('statusbar.tooltip.tokenValid', minutes)}`,
			);
		}
		lines.push(
			completionsOn
				? `$(sparkle) ${t('statusbar.tooltip.completionsOn')}`
				: `$(circle-slash) ${t('statusbar.tooltip.completionsOff')}`,
		);
		if (this.busy) lines.push(`$(loading~spin) ${t('statusbar.tooltip.busy')}`);
		if (this.pendingEdits > 0) lines.push(`$(edit) ${t('statusbar.tooltip.pendingEdits', this.pendingEdits)}`);
		lines.push('', t('statusbar.tooltip.click'));

		// Markdown collapses single newlines; two trailing spaces force a hard
		// break so each entry gets its own row. `true` enables $(icon) syntax.
		return new vscode.MarkdownString(lines.join('  \n'), true);
	}

	dispose(): void {
		this.item.dispose();
		for (const disposable of this.disposables) disposable.dispose();
	}
}

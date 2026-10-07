import * as vscode from 'vscode';
import { M365_CHAT_URL } from '@m365copilot/core';
import { isTokenUsable, minutesUntilExpiry } from './profile';
import type { ProfileStore } from './secrets';
import { t } from './i18n';

const TICK_MS = 30_000;
/**
 * The browser extension renews the token ~12 min before it expires, so a
 * token that gets this close to expiry means automatic renewal is not
 * running (browser closed, no M365 tab, extension not installed…).
 */
const WARN_MINUTES = 5;

/**
 * Watches the stored token's lifetime. Before this, an expired token was only
 * discovered when a chat request failed; now the editor reacts as it happens:
 *
 *  - `onTick` re-renders the status bar countdown every 30 s;
 *  - `onStateChange` fires when the token flips between usable and expired, so
 *    the model picker's warning icon updates without waiting for a failure;
 *  - one notification when the token is about to expire without having been
 *    renewed, and one when it expires — each at most once per token, with the
 *    actions that fix it right there.
 */
export class TokenWatcher implements vscode.Disposable {
	private readonly timer: NodeJS.Timeout;
	private readonly storeListener: vscode.Disposable;
	private lastUsable: boolean | undefined;
	/** `exp` of the token we already warned about, so each warning shows once per token. */
	private warnedSoonFor: number | undefined;
	private warnedExpiredFor: number | undefined;

	constructor(
		private readonly store: ProfileStore,
		private readonly onTick: () => void,
		private readonly onStateChange: () => void,
	) {
		this.timer = setInterval(() => void this.check(), TICK_MS);
		this.storeListener = store.onDidChange(() => void this.check());
		void this.check();
	}

	private async check(): Promise<void> {
		const profile = await this.store.get();
		const usable = profile ? isTokenUsable(profile) : false;
		const wasUsable = this.lastUsable;
		if (wasUsable !== undefined && usable !== wasUsable) this.onStateChange();
		this.lastUsable = usable;
		this.onTick();

		const exp = profile?.claims?.exp;
		if (!profile || exp === undefined || !notificationsEnabled()) return;

		if (!usable) {
			// Only an expiry seen happening in this session: a token that was
			// already stale at startup is the normal state after a break (they
			// last ~1 h) and the status bar already flags it — a notification on
			// every launch would just be noise. Skipped too if the user was
			// already warned that this very token was about to expire.
			if (wasUsable !== true || this.warnedExpiredFor === exp || this.warnedSoonFor === exp) return;
			this.warnedExpiredFor = exp;
			void this.notify(t('watcher.expired'), 'warning');
			return;
		}

		const minutes = minutesUntilExpiry(profile);
		if (minutes !== null && minutes <= WARN_MINUTES && this.warnedSoonFor !== exp) {
			this.warnedSoonFor = exp;
			void this.notify(t('watcher.expiringSoon', minutes), 'info');
		}
	}

	private async notify(message: string, level: 'info' | 'warning'): Promise<void> {
		const paste = t('watcher.pasteToken');
		const open = t('watcher.openM365');
		const picked =
			level === 'warning'
				? await vscode.window.showWarningMessage(message, paste, open)
				: await vscode.window.showInformationMessage(message, paste, open);
		if (picked === paste) await vscode.commands.executeCommand('m365copilot.pasteProfile');
		if (picked === open) await vscode.env.openExternal(vscode.Uri.parse(M365_CHAT_URL));
	}

	dispose(): void {
		clearInterval(this.timer);
		this.storeListener.dispose();
	}
}

function notificationsEnabled(): boolean {
	return vscode.workspace.getConfiguration('m365copilot.notifications').get<boolean>('tokenExpiry', true);
}

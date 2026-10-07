/**
 * M365 Copilot in VS Code's Accounts menu (the person icon at the bottom of
 * the activity bar), as an authentication provider over the token store:
 *
 *  - with a usable token, the account (the token's UPN) is listed there, and
 *    its "Sign Out" clears the token;
 *  - without one, the menu gets a badge and a "Sign in with M365 Copilot"
 *    entry, which opens M365 Copilot in the browser — the browser extension or
 *    the userscript sends the token by itself — or asks for it to be pasted.
 *
 * The session's access token is the BizChat token itself: another extension
 * asking for it goes through VS Code's own consent dialog first.
 */
import * as vscode from 'vscode';
import { accountOf, isTokenUsable, type CopilotProfile } from './profile';
import type { ProfileStore } from './secrets';
import { announceProfile, openM365, promptForProfile } from './commands';
import { t } from './i18n';

export const AUTH_PROVIDER_ID = 'm365copilot';
/** How long "Sign in" waits for the browser to send the token. */
const BROWSER_SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export class M365AuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	private readonly changes = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this.changes.event;
	private current: vscode.AuthenticationSession | undefined;
	/** Whether the Accounts menu already shows the sign-in request. */
	private signInRequested = false;
	private readonly subscriptions: vscode.Disposable[];

	constructor(private readonly store: ProfileStore) {
		this.subscriptions = [
			this.changes,
			vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, 'M365 Copilot', this, {
				supportsMultipleAccounts: false,
			}),
			store.onDidChange(() => void this.refresh()),
		];
		void this.refresh();
	}

	/** Re-reads the token and tells VS Code what changed. Also called when it expires. */
	async refresh(): Promise<void> {
		const next = sessionOf(await this.store.get());
		// Read after the await: the store listener and the token watcher can
		// both refresh at once, and only the first may report the change.
		const previous = this.current;
		this.current = next;
		if (previous && next && previous.id === next.id) {
			if (previous.accessToken !== next.accessToken) this.changes.fire({ added: [], removed: [], changed: [next] });
		} else if (previous || next) {
			this.changes.fire({ added: next ? [next] : [], removed: previous ? [previous] : [], changed: [] });
		}
		if (next) this.signInRequested = false;
		else this.requestSignIn();
	}

	async getSessions(): Promise<vscode.AuthenticationSession[]> {
		const session = sessionOf(await this.store.get());
		return session ? [session] : [];
	}

	async createSession(): Promise<vscode.AuthenticationSession> {
		const profile = await signIn(this.store);
		const session = sessionOf(profile);
		if (!session) throw new Error(t('account.signInCancelled'));
		return session;
	}

	async removeSession(): Promise<void> {
		// VS Code has already asked "Sign out?" by the time this runs.
		await this.store.clear();
	}

	/**
	 * A quiet request (no dialog): the Accounts menu shows a badge and a
	 * "Sign in with M365 Copilot to use M365 Copilot" entry until there is a session.
	 */
	private requestSignIn(): void {
		if (this.signInRequested) return;
		this.signInRequested = true;
		vscode.authentication.getSession(AUTH_PROVIDER_ID, [], { createIfNone: false }).then(undefined, () => {
			this.signInRequested = false;
		});
	}

	dispose(): void {
		for (const subscription of this.subscriptions) subscription.dispose();
	}
}

function sessionOf(profile: CopilotProfile | null | undefined): vscode.AuthenticationSession | undefined {
	const account = accountOf(profile);
	if (!profile || !account) return undefined;
	return {
		id: account.sessionId,
		accessToken: profile.accessToken,
		account: { id: account.accountId, label: account.label },
		scopes: [],
	};
}

/** "Sign in with M365 Copilot": from the browser, or by pasting. */
async function signIn(store: ProfileStore): Promise<CopilotProfile | undefined> {
	const already = await store.get();
	if (already && isTokenUsable(already)) return already;

	const picked = await vscode.window.showQuickPick(
		[
			{ label: `$(globe) ${t('account.signIn.browser')}`, detail: t('account.signIn.browserDetail'), via: 'browser' as const },
			{ label: `$(key) ${t('account.signIn.paste')}`, detail: t('account.signIn.pasteDetail'), via: 'paste' as const },
		],
		{ title: t('account.signIn.title'), placeHolder: t('account.signIn.placeholder'), ignoreFocusOut: true },
	);
	if (!picked) return undefined;

	if (picked.via === 'paste') {
		const profile = await promptForProfile(store);
		if (profile && !isTokenUsable(profile)) void vscode.window.showWarningMessage(t('participant.tokenExpired'));
		else if (profile) void announceProfile(profile);
		return profile;
	}

	await openM365();
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('account.signIn.waiting'), cancellable: true },
		(_progress, token) => waitForUsableProfile(store, token, BROWSER_SIGN_IN_TIMEOUT_MS),
	);
}

/** Resolves once the store holds a usable token (from the local server), or undefined on cancel/timeout. */
function waitForUsableProfile(
	store: ProfileStore,
	token: vscode.CancellationToken,
	timeoutMs: number,
): Promise<CopilotProfile | undefined> {
	return new Promise((resolve) => {
		const finish = (profile: CopilotProfile | undefined) => {
			clearTimeout(timer);
			listener.dispose();
			cancel.dispose();
			resolve(profile);
		};
		const timer = setTimeout(() => {
			void vscode.window.showWarningMessage(t('account.signIn.timeout'));
			finish(undefined);
		}, timeoutMs);
		const cancel = token.onCancellationRequested(() => finish(undefined));
		const listener = store.onDidChange(async () => {
			const profile = await store.get();
			if (profile && isTokenUsable(profile)) finish(profile);
		});
	});
}

/**
 * "Sign out and sign in again": the renewal that really renews.
 *
 * Why this exists. Everything else in this extension renews the *token*, and
 * that is the one thing that was never the problem: the token is handed out by
 * a Microsoft session that lives in the browser (cookies of
 * `login.microsoftonline.com`, MSAL's cache in `m365.cloud.microsoft`) and
 * server-side at Microsoft. Ask for another token and that session issues one
 * silently, forever, without ever showing a sign-in page — which is exactly
 * why "renew" never asked for credentials anywhere.
 *
 * So the real renewal is a sign-out, and VS Code cannot do it alone: cookies
 * belong to the browser. What happens here:
 *
 *  1. the stored token is deleted (this side is done in one line);
 *  2. a sign-out request is left on the local server, with an id;
 *  3. the browser is opened at M365 Copilot with that id in the URL. The
 *     browser extension's content script sees it, checks the id against the
 *     pending request — a URL can be linked by any site, the id is what makes
 *     it trustworthy — and wipes cookies, MSAL's cache and site storage of
 *     every Microsoft domain, after walking Microsoft's own logout endpoints;
 *  4. it reports back here, and the user is left on the sign-in page.
 *
 * Without the browser extension (userscript users, or a browser where it is
 * not installed) step 3 never happens: the wait times out and the fallback
 * offers Microsoft's logout endpoints by hand, which still ends the session
 * server-side — enough to be asked to sign in again.
 */
import * as vscode from 'vscode';
import { M365_CHAT_URL, SIGN_OUT_URLS, signOutUrl, type SignOutReport } from '@m365copilot/core';
import type { ProfileStore } from './secrets';
import type { TokenAutoRefreshServer } from './tokenServer';
import { isTokenUsable, type CopilotProfile } from './profile';
import { announceProfile } from './commands';
import { log } from './logger';
import { t } from './i18n';

/**
 * How long the browser gets to confirm. Generous on purpose: the slow part is
 * the three logout pages, and a browser that was closed has to start first.
 */
const SIGN_OUT_TIMEOUT_MS = 3 * 60_000;

/** How long the new token gets to arrive after the user signs in again. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export async function signOutAndSignIn(store: ProfileStore, server: TokenAutoRefreshServer): Promise<void> {
	const confirm = t('signOut.confirm.button');
	const picked = await vscode.window.showWarningMessage(
		t('signOut.confirm'),
		{ modal: true, detail: t('signOut.confirm.detail') },
		confirm,
	);
	if (picked !== confirm) return;

	// First, and unconditionally: whatever happens in the browser, this editor
	// must not keep using a token whose session the user just asked to end.
	await store.clear();

	const pending = server.requestSignOut();
	const opened = await vscode.env.openExternal(vscode.Uri.parse(signOutUrl(M365_CHAT_URL, pending.id)));
	if (!opened) log(t('log.signOut.browserNotOpened'));

	const outcome = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('signOut.progress'), cancellable: true },
		(_progress, token) => waitForSignOut(server, pending.id, token),
	);

	if (!outcome) {
		server.cancelSignOut(pending.id);
		await offerManualSignOut();
		return;
	}

	logReport(outcome);
	if (!(await announceSignOut(outcome))) return;
	await waitForNewToken(store);
}

/** Resolves with the browser's report, or undefined on cancel/timeout. */
function waitForSignOut(
	server: TokenAutoRefreshServer,
	id: string,
	token: vscode.CancellationToken,
): Promise<SignOutReport | undefined> {
	return new Promise((resolve) => {
		const finish = (report: SignOutReport | undefined) => {
			clearTimeout(timer);
			listener.dispose();
			cancel.dispose();
			resolve(report);
		};
		const timer = setTimeout(() => finish(undefined), SIGN_OUT_TIMEOUT_MS);
		const cancel = token.onCancellationRequested(() => finish(undefined));
		const listener = server.onDidSignOut((outcome) => {
			// `id === null` is a sign-out the user started from the browser's own
			// button while this one was pending: same thing happened, so it counts.
			if (outcome.id === null || outcome.id === id) finish(outcome.report ?? emptyReport());
		});
	});
}

function emptyReport(): SignOutReport {
	return {
		cookiesRemoved: 0,
		cookiesFailed: 0,
		originsCleared: 0,
		dataTypes: [],
		skippedDataTypes: [],
		tabsClosed: 0,
		signedOutFrom: [],
		errors: [],
	};
}

/** The whole report in the log: the notification only has room for the headline. */
function logReport(report: SignOutReport): void {
	log(
		t(
			'log.signOut.report',
			report.cookiesRemoved,
			report.cookiesFailed,
			report.originsCleared,
			report.tabsClosed,
			report.signedOutFrom.length,
		),
	);
	if (report.dataTypes.length > 0) log(t('log.signOut.dataTypes', report.dataTypes.join(', ')));
	if (report.skippedDataTypes.length > 0) {
		log(t('log.signOut.skippedDataTypes', report.skippedDataTypes.join(', ')));
	}
	for (const error of report.errors) log(t('log.signOut.error', error));
}

/**
 * What was deleted, in one line — and whether to go on waiting for the new
 * token. A report with errors is still a sign-out (the session is gone), so it
 * is a warning and not a failure, with the log one click away.
 */
async function announceSignOut(report: SignOutReport): Promise<boolean> {
	const summary = t('signOut.done', report.cookiesRemoved, report.originsCleared);
	if (report.errors.length === 0) {
		void vscode.window.showInformationMessage(summary);
		return true;
	}
	const showLog = t('signOut.showLog');
	const goOn = t('signOut.signInAnyway');
	const picked = await vscode.window.showWarningMessage(
		t('signOut.partial', summary, report.errors.length),
		goOn,
		showLog,
	);
	if (picked === showLog) await vscode.commands.executeCommand('m365copilot.showLog');
	return picked !== undefined;
}

/**
 * The user is now on Microsoft's sign-in page. Once they are in, the browser
 * extension captures the fresh token and posts it here by itself: all this
 * does is say so, and confirm it out loud when it lands.
 */
async function waitForNewToken(store: ProfileStore): Promise<void> {
	let cancelled = false;
	const profile = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t('signOut.waitingToken'), cancellable: true },
		(_progress, token) => {
			token.onCancellationRequested(() => (cancelled = true));
			return waitForUsableProfile(store, token, SIGN_IN_TIMEOUT_MS);
		},
	);
	if (profile) await announceProfile(profile);
	// Dismissing the wait is not a problem worth a notification: the token
	// still arrives on its own, and the status bar says when it does.
	else if (!cancelled) void vscode.window.showInformationMessage(t('signOut.tokenPending'));
}

/** Resolves once the store holds a usable token, or undefined on cancel/timeout. */
export function waitForUsableProfile(
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
		const timer = setTimeout(() => finish(undefined), timeoutMs);
		const cancel = token.onCancellationRequested(() => finish(undefined));
		const listener = store.onDidChange(async () => {
			const profile = await store.get();
			if (profile && isTokenUsable(profile)) finish(profile);
		});
	});
}

/**
 * Nobody answered: either the browser extension is not installed (the
 * userscript cannot clear cookies — it does not have the APIs) or the browser
 * never opened. Microsoft's logout endpoints still work by hand, and they are
 * the half of the session that matters: with the server-side session gone, the
 * next visit asks for credentials even if the local cookies survive.
 */
async function offerManualSignOut(): Promise<void> {
	log(t('log.signOut.timeout', SIGN_OUT_URLS.join(' , ')));
	const open = t('signOut.openLogout');
	const showLog = t('signOut.showLog');
	const picked = await vscode.window.showWarningMessage(
		t('signOut.timeout'),
		{ modal: true, detail: t('signOut.timeout.detail', SIGN_OUT_URLS.join('\n')) },
		open,
		showLog,
	);
	if (picked === showLog) await vscode.commands.executeCommand('m365copilot.showLog');
	if (picked !== open) return;
	// One tab per endpoint, in order: organisation account, personal account,
	// Office. The browser follows each one on its own.
	for (const url of SIGN_OUT_URLS) await vscode.env.openExternal(vscode.Uri.parse(url));
}

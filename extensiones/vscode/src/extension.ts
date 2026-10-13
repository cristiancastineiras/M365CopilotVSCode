import * as vscode from 'vscode';
import { registerTracedCommand } from './debugMode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerM365WorkspaceTools } from './agentTools';
import { registerM365SubagentTools } from './subagents';
import { M365InlineCompletionProvider } from './completions';
import { M365CopilotProvider } from './provider';
import { ProfileStore } from './secrets';
import { TokenAutoRefreshServer } from './tokenServer';
import { WorkspaceEditManager } from '../tools/writeFile';
import { minutesUntilExpiry } from './profile';
import { installModelRegistry } from './models';
import { debug, initLogger, log, showLog, type LogSink } from './logger';
import { clearDebugLog, DebugSession, exportDebugLog, toggleDeepDebug } from './debugMode';
import { getLocale, resolveLocale, setLocale, t } from './i18n';
import { M365StatusBar } from './statusBar';
import { TokenWatcher } from './tokenWatcher';
import { EditorHandoff, registerEditorActions } from './editorActions';
import { registerChatParticipant } from './participant';
import { registerScmCommands } from './scmCommit';
import { AutoCommitter } from './autoCommit';
import { registerInlineEdit } from './inlineEdit';
import { TerminalHistory } from './terminalHistory';
import { M365AuthenticationProvider } from './account';
import { registerReview, ReviewComments } from './review';
import { migrateFromLegacy } from './migration';
import { setTestEndpointBase } from './client';
import { signOutAndSignIn } from './signOut';
import { ProjectIndexService } from './projectIndex';
import { registerWebSearchTool } from './webSearch';
import type { Hunk } from '../tools/lineDiff';
import {
	checkModels,
	clearProfile,
	currentLanguageSetting,
	languageName,
	openWalkthrough,
	pasteProfile,
	refreshModels,
	selectLanguage,
	showMenu,
	showStatus,
	toggleInlineCompletions,
} from './commands';

const VENDOR = 'm365copilot';

/** Diagnostics also stream to this file so raw frames can be inspected. */
const DEBUG_FILE = path.join(os.tmpdir(), 'm365copilot-debug.log');

/** What `activate` hands to the extension's own integration tests (and only to them). */
export interface TestingApi {
	readonly workspaceEdits: WorkspaceEditManager;
	/** To hand the extension a profile (e.g. with observed models) without the local server. */
	readonly store: ProfileStore;
	/** The Accounts menu provider, to check its sessions. */
	readonly account: M365AuthenticationProvider;
	/** The review comment threads. */
	readonly reviewComments: ReviewComments;
	/** The project index (RAG). */
	readonly projectIndex: ProjectIndexService;
	/** The chat model provider, to drive a request without the chat UI. */
	readonly provider: M365CopilotProvider;
	/** Sends every BizChat turn to a local mock (`ws://…/m365Copilot/Chathub`), or back to BizChat. */
	readonly useEndpoint: (base: string | undefined) => void;
	/** The auto-commit, to drive a look without waiting for the idle timer. */
	readonly autoCommit: AutoCommitter;
}

export function activate(context: vscode.ExtensionContext): TestingApi | undefined {
	// Before anything says a word: every message below goes through t().
	setLocale(resolveLocale(currentLanguageSetting(), vscode.env.language));

	const channel = vscode.window.createOutputChannel('M365 Copilot');

	// Composite sink: the output channel (for the user) plus a temp file (for
	// deep debugging of the reverse-engineered protocol).
	try {
		fs.writeFileSync(DEBUG_FILE, `# M365 Copilot debug — ${new Date().toISOString()}\n`);
	} catch {
		/* temp not writable — the output channel still works */
	}
	const sink: LogSink = {
		appendLine(line) {
			channel.appendLine(line);
			try {
				fs.appendFileSync(DEBUG_FILE, line + '\n');
			} catch {
				/* ignore file errors */
			}
		},
		show: (preserve) => channel.show(preserve),
		clear: () => channel.clear(),
	};
	initLogger(sink);
	const activationStarted = Date.now();
	log(t('ext.activated', DEBUG_FILE));
	// Settings of the `ms365-copilot-vscode` builds; the listeners below pick them up.
	void migrateFromLegacy(context, log);

	const store = new ProfileStore(context.secrets);
	const statusBar = new M365StatusBar(store);
	// Right after the store and the status bar, before the first request can
	// arrive: deep debug mode (m365copilot.debug.deep) has to be on by then.
	const debugSession = new DebugSession({
		context,
		store,
		debugFile: DEBUG_FILE,
		onChange: (on) => statusBar.setDebug(on),
	});
	const tokenServer = new TokenAutoRefreshServer(store, (profile) => {
		const minutes = minutesUntilExpiry(profile);
		if (minutes !== null) void vscode.window.setStatusBarMessage(t('statusbar.renewed', minutes), 5000);
	});
	tokenServer.start();
	// The local project index (RAG): context for every request, tools, search.
	const projectIndex = new ProjectIndexService(log);
	const provider = new M365CopilotProvider(store, (message) =>
		projectIndex.contextFor(message, { activeUri: vscode.window.activeTextEditor?.document.uri }),
	);
	// Before anything reads the model list: it replaces the built-in one.
	const modelRegistry = installModelRegistry(context.globalState, store, log);
	const workspaceEdits = new WorkspaceEditManager();
	const completions = new M365InlineCompletionProvider(store, statusBar);
	const handoff = new EditorHandoff();
	const terminals = new TerminalHistory();
	const account = new M365AuthenticationProvider(store);
	const reviewComments = new ReviewComments(context.extensionUri);
	const autoCommit = new AutoCommitter({ store, edits: workspaceEdits, memento: context.workspaceState, log });
	const tokenWatcher = new TokenWatcher(
		store,
		() => statusBar.refresh(),
		// Token just expired (or came back): the picker's warning icon and the
		// Accounts menu must follow.
		() => {
			provider.refresh();
			void account.refresh();
		},
	);

	context.subscriptions.push(
		channel,
		store,
		statusBar,
		debugSession,
		tokenServer,
		provider,
		workspaceEdits,
		tokenWatcher,
		terminals,
		account,
		reviewComments,
		autoCommit,
		projectIndex,
		...projectIndex.registerTools(),
		...projectIndex.registerCommands(),
		registerWebSearchTool(store, log),
		modelRegistry,
		modelRegistry.onDidChange(() => provider.refresh()),
		workspaceEdits.onDidChangePending((count) => statusBar.setPendingEdits(count)),
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completions),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('m365copilot.inlineCompletions')) completions.clearCache();
			if (event.affectsConfiguration('m365copilot.language')) {
				applyLanguage(() => {
					statusBar.refresh();
					provider.refresh();
					workspaceEdits.refreshLocale();
					autoCommit.render();
				});
			}
		}),
		registerChatParticipant({
			store,
			handoff,
			edits: workspaceEdits,
			terminals,
			extensionUri: context.extensionUri,
			log,
			projectContext: (message, options) => projectIndex.contextFor(message, options),
		}),
		...registerEditorActions(handoff, terminals),
		...registerInlineEdit({ store, edits: workspaceEdits, memento: context.globalState, log }),
		...registerScmCommands(store, log),
		...autoCommit.registerCommands(),
		...registerReview({ store, log }, reviewComments),
		...registerM365WorkspaceTools(workspaceEdits),
		...registerM365SubagentTools(store, log),
		registerTracedCommand('m365copilot.showMenu', () =>
			showMenu(store, workspaceEdits, projectIndex.status(), autoCommit.enabled),
		),
		registerTracedCommand('m365copilot.toggleInlineCompletions', () => toggleInlineCompletions()),
		registerTracedCommand('m365copilot.pasteProfile', () => pasteProfile(store)),
		registerTracedCommand('m365copilot.clearProfile', () => clearProfile(store)),
		registerTracedCommand('m365copilot.signOut', () => signOutAndSignIn(store, tokenServer)),
		registerTracedCommand('m365copilot.showStatus', () => showStatus(store)),
		registerTracedCommand('m365copilot.selectLanguage', () => selectLanguage()),
		registerTracedCommand('m365copilot.refreshModels', () => refreshModels(modelRegistry, store)),
		registerTracedCommand('m365copilot.checkModels', () => checkModels(modelRegistry, store)),
		registerTracedCommand('m365copilot.openWalkthrough', () => openWalkthrough()),
		registerTracedCommand('m365copilot.showLog', () => showLog()),
		registerTracedCommand('m365copilot.toggleDebug', () => toggleDeepDebug()),
		registerTracedCommand('m365copilot.exportLog', () => exportDebugLog()),
		registerTracedCommand('m365copilot.clearLog', () => clearDebugLog()),
		registerTracedCommand('m365copilot.reviewPendingEdits', () => workspaceEdits.reviewPendingEdits()),
		registerTracedCommand('m365copilot.keepEdits', (uri?: vscode.Uri) => workspaceEdits.keep(asUri(uri))),
		registerTracedCommand('m365copilot.undoEdits', (uri?: vscode.Uri) => workspaceEdits.undo(asUri(uri))),
		registerTracedCommand('m365copilot.showEditDiff', (uri?: vscode.Uri) =>
			workspaceEdits.showDiff(asUri(uri)),
		),
		registerTracedCommand('m365copilot.discardPendingEdits', () => workspaceEdits.undo()),
		// Per-hunk actions come from CodeLens only, with the hunk as argument.
		registerTracedCommand('m365copilot.keepHunk', (uri?: unknown, hunk?: unknown) =>
			asUri(uri) && isHunk(hunk) ? workspaceEdits.keepHunk(asUri(uri)!, hunk) : undefined,
		),
		registerTracedCommand('m365copilot.undoHunk', (uri?: unknown, hunk?: unknown) =>
			asUri(uri) && isHunk(hunk) ? workspaceEdits.undoHunk(asUri(uri)!, hunk) : undefined,
		),
		registerTracedCommand('m365copilot.nextChange', () => workspaceEdits.goToChange(1)),
		registerTracedCommand('m365copilot.previousChange', () => workspaceEdits.goToChange(-1)),
		registerTracedCommand('m365copilot.undoLastAgentEdit', () => workspaceEdits.undoLastBatch()),
	);

	// Nudge Copilot Chat to pick up our models on activation.
	void activateCopilotChat().then(() => provider.refresh());
	debug('ext', `activate() finished in ${Date.now() - activationStarted} ms`);

	// Only when VS Code runs the extension's tests (--extensionTestsPath): lets
	// them drive the Keep/Undo review directly, without the chat UI or the
	// tool-confirmation dialog, which a test host refuses to show.
	return context.extensionMode === vscode.ExtensionMode.Test
		? {
				workspaceEdits,
				store,
				account,
				reviewComments,
				projectIndex,
				provider,
				useEndpoint: setTestEndpointBase,
				autoCommit,
			}
		: undefined;
}

export function deactivate(): void {
	debug('ext', 'deactivate(): the disposables clean up');
}

/**
 * Re-resolve the locale after `m365copilot.language` changed and re-render
 * whatever already showed text. Command titles and setting descriptions come
 * from package.nls*.json and follow VS Code's own display language, which an
 * extension cannot switch — say so once, so a half-translated UI is expected.
 */
function applyLanguage(rerender: () => void): void {
	const before = getLocale();
	const next = resolveLocale(currentLanguageSetting(), vscode.env.language);
	setLocale(next);
	rerender();
	if (next !== before) void vscode.window.showInformationMessage(t('ext.languageChanged', languageName(next)));
}

/**
 * Commands also run from menus that pass something other than a Uri (the
 * editor title passes the resource Uri; the palette passes nothing), and a
 * non-Uri argument must mean "all pending files", not a lookup that fails.
 */
function asUri(value: unknown): vscode.Uri | undefined {
	return value instanceof vscode.Uri ? value : undefined;
}

function isHunk(value: unknown): value is Hunk {
	if (!value || typeof value !== 'object') return false;
	const hunk = value as Record<string, unknown>;
	return ['oldStart', 'oldLength', 'newStart', 'newLength'].every((key) => Number.isInteger(hunk[key]));
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch {
		/* Copilot Chat not installed; provider still registers for the API */
	}
}

import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerM365WorkspaceTools } from './agentTools';
import { registerM365SubagentTools } from './subagents';
import { Ms365InlineCompletionProvider } from './completions';
import { Ms365CopilotProvider } from './provider';
import { ProfileStore } from './secrets';
import { TokenAutoRefreshServer } from './tokenServer';
import { WorkspaceEditManager } from '../tools/writeFile';
import { minutesUntilExpiry } from './profile';
import { initLogger, log, showLog, type LogSink } from './logger';
import { getLocale, resolveLocale, setLocale, t } from './i18n';
import { M365StatusBar } from './statusBar';
import { TokenWatcher } from './tokenWatcher';
import { EditorHandoff, registerEditorActions } from './editorActions';
import { registerChatParticipant } from './participant';
import { registerScmCommands } from './scmCommit';
import {
	clearProfile,
	currentLanguageSetting,
	languageName,
	openWalkthrough,
	pasteProfile,
	selectLanguage,
	showMenu,
	showStatus,
	toggleInlineCompletions,
} from './commands';

const VENDOR = 'ms365copilot';

/** Diagnostics also stream to this file so raw frames can be inspected. */
const DEBUG_FILE = path.join(os.tmpdir(), 'ms365copilot-debug.log');

export function activate(context: vscode.ExtensionContext): void {
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
	};
	initLogger(sink);
	log(t('ext.activated', DEBUG_FILE));

	const store = new ProfileStore(context.secrets);
	const statusBar = new M365StatusBar(store);
	const tokenServer = new TokenAutoRefreshServer(store, (profile) => {
		const minutes = minutesUntilExpiry(profile);
		if (minutes !== null) void vscode.window.setStatusBarMessage(t('statusbar.renewed', minutes), 5000);
	});
	tokenServer.start();
	const provider = new Ms365CopilotProvider(store);
	const workspaceEdits = new WorkspaceEditManager();
	const completions = new Ms365InlineCompletionProvider(store, statusBar);
	const handoff = new EditorHandoff();
	const tokenWatcher = new TokenWatcher(
		store,
		() => statusBar.refresh(),
		// Token just expired (or came back): the picker's warning icon must follow.
		() => provider.refresh(),
	);

	context.subscriptions.push(
		channel,
		store,
		statusBar,
		tokenServer,
		provider,
		workspaceEdits,
		tokenWatcher,
		workspaceEdits.onDidChangePending((count) => statusBar.setPendingEdits(count)),
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completions),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('ms365copilot.inlineCompletions')) completions.clearCache();
			if (event.affectsConfiguration('ms365copilot.language')) {
				applyLanguage(() => {
					statusBar.refresh();
					provider.refresh();
					workspaceEdits.refreshLocale();
				});
			}
		}),
		registerChatParticipant({ store, handoff, edits: workspaceEdits, extensionUri: context.extensionUri, log }),
		...registerEditorActions(handoff),
		...registerScmCommands(store, log),
		...registerM365WorkspaceTools(workspaceEdits),
		...registerM365SubagentTools(store, log),
		vscode.commands.registerCommand('ms365copilot.showMenu', () => showMenu(store, workspaceEdits)),
		vscode.commands.registerCommand('ms365copilot.toggleInlineCompletions', () => toggleInlineCompletions()),
		vscode.commands.registerCommand('ms365copilot.pasteProfile', () => pasteProfile(store)),
		vscode.commands.registerCommand('ms365copilot.clearProfile', () => clearProfile(store)),
		vscode.commands.registerCommand('ms365copilot.showStatus', () => showStatus(store)),
		vscode.commands.registerCommand('ms365copilot.selectLanguage', () => selectLanguage()),
		vscode.commands.registerCommand('ms365copilot.openWalkthrough', () => openWalkthrough()),
		vscode.commands.registerCommand('ms365copilot.showLog', () => showLog()),
		vscode.commands.registerCommand('ms365copilot.reviewPendingEdits', () => workspaceEdits.reviewPendingEdits()),
		vscode.commands.registerCommand('ms365copilot.keepEdits', (uri?: vscode.Uri) => workspaceEdits.keep(asUri(uri))),
		vscode.commands.registerCommand('ms365copilot.undoEdits', (uri?: vscode.Uri) => workspaceEdits.undo(asUri(uri))),
		vscode.commands.registerCommand('ms365copilot.showEditDiff', (uri?: vscode.Uri) =>
			workspaceEdits.showDiff(asUri(uri)),
		),
		vscode.commands.registerCommand('ms365copilot.discardPendingEdits', () => workspaceEdits.undo()),
		vscode.commands.registerCommand('ms365copilot.undoLastAgentEdit', () => workspaceEdits.undoLastBatch()),
	);

	// Nudge Copilot Chat to pick up our models on activation.
	void activateCopilotChat().then(() => provider.refresh());
}

export function deactivate(): void {
	/* disposables handle cleanup */
}

/**
 * Re-resolve the locale after `ms365copilot.language` changed and re-render
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

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch {
		/* Copilot Chat not installed; provider still registers for the API */
	}
}

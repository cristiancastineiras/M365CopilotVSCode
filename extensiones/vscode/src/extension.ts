import * as vscode from 'vscode';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerM365WorkspaceTools } from './agentTools';
import { CompletionStatus, M365InlineCompletionProvider } from './completions';
import { M365CopilotProvider } from './provider';
import { ProfileStore } from './secrets';
import { TokenAutoRefreshServer } from './tokenServer';
import { WorkspaceEditManager } from '../tools/writeFile';
import { ProfileParseError, minutesUntilExpiry, isTokenUsable } from './profile';
import { initLogger, log, showLog, type LogSink } from './logger';

const VENDOR = 'm365copilot';

/** Diagnostics also stream to this file so raw frames can be inspected. */
const DEBUG_FILE = path.join(os.tmpdir(), 'm365copilot-debug.log');

export function activate(context: vscode.ExtensionContext): void {
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
	log(`Extensión M365 Copilot activada. Registro en: ${DEBUG_FILE}`);
	const store = new ProfileStore(context.secrets);
	const tokenServer = new TokenAutoRefreshServer(store);
	tokenServer.start();
	const provider = new M365CopilotProvider(store);
	const workspaceEdits = new WorkspaceEditManager();
	const completionStatus = new CompletionStatus();
	const completions = new M365InlineCompletionProvider(store, completionStatus);

	context.subscriptions.push(
		channel,
		store,
		tokenServer,
		provider,
		workspaceEdits,
		completionStatus,
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completions),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('m365copilot.inlineCompletions')) {
				completions.clearCache();
				completionStatus.refresh();
			}
		}),
		vscode.commands.registerCommand('m365copilot.toggleInlineCompletions', () =>
			toggleInlineCompletions(completionStatus),
		),
		...registerM365WorkspaceTools(workspaceEdits),
		vscode.commands.registerCommand('m365copilot.pasteProfile', () => pasteProfile(store, provider)),
		vscode.commands.registerCommand('m365copilot.clearProfile', () => clearProfile(store)),
		vscode.commands.registerCommand('m365copilot.showStatus', () => showStatus(store)),
		vscode.commands.registerCommand('m365copilot.showLog', () => showLog()),
		vscode.commands.registerCommand('m365copilot.reviewPendingEdits', () => workspaceEdits.reviewPendingEdits()),
		vscode.commands.registerCommand('m365copilot.keepEdits', (uri?: vscode.Uri) => workspaceEdits.keep(uri)),
		vscode.commands.registerCommand('m365copilot.undoEdits', (uri?: vscode.Uri) => workspaceEdits.undo(uri)),
		vscode.commands.registerCommand('m365copilot.showEditDiff', (uri?: vscode.Uri) => workspaceEdits.showDiff(uri)),
		vscode.commands.registerCommand('m365copilot.discardPendingEdits', () => workspaceEdits.undo()),
		vscode.commands.registerCommand('m365copilot.undoLastAgentEdit', () => workspaceEdits.undoLastBatch()),
	);

	// Nudge Copilot Chat to pick up our models on activation.
	void activateCopilotChat().then(() => provider.refresh());
}

export function deactivate(): void {
	/* disposables handle cleanup */
}

async function pasteProfile(store: ProfileStore, provider: M365CopilotProvider): Promise<void> {
	const pasted = await vscode.window.showInputBox({
		title: 'M365 Copilot — pegar perfil o token',
		prompt: 'Pega el token del userscript de Tampermonkey (el «perfil completo» JSON también vale: sólo se usa su accessToken).',
		placeHolder: 'eyJ…  o  { "accessToken": "eyJ…" }',
		password: true,
		ignoreFocusOut: true,
	});
	if (pasted === undefined) return;

	try {
		const profile = await store.setFromPaste(pasted);
		provider.refresh();
		const who = profile.claims?.upn ? ` (${profile.claims.upn})` : '';
		const mins = minutesUntilExpiry(profile);
		const expiry = mins !== null ? `, válido ~${mins} min` : '';
		void vscode.window.showInformationMessage(
			`M365 Copilot listo${who}${expiry}. Elige un modelo «M365 Copilot» en el selector del chat.`,
		);
	} catch (error) {
		const msg = error instanceof ProfileParseError ? error.message : String(error);
		void vscode.window.showErrorMessage(`No se pudo guardar el perfil: ${msg}`);
	}
}

async function toggleInlineCompletions(status: CompletionStatus): Promise<void> {
	const config = vscode.workspace.getConfiguration('m365copilot.inlineCompletions');
	const enabled = config.get<boolean>('enabled', true);
	// Global target: the toggle is about how you want the editor to behave, not
	// a property of whichever folder happens to be open.
	await config.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
	status.refresh();
	void vscode.window.showInformationMessage(
		`Autocompletado de M365 Copilot ${!enabled ? 'activado' : 'desactivado'}.`,
	);
}

async function clearProfile(store: ProfileStore): Promise<void> {
	const ok = await vscode.window.showWarningMessage(
		'¿Borrar el token de M365 Copilot guardado?',
		{ modal: true },
		'Borrar',
	);
	if (ok !== 'Borrar') return;
	await store.clear();
	void vscode.window.showInformationMessage('Token de M365 Copilot borrado.');
}

async function showStatus(store: ProfileStore): Promise<void> {
	const profile = await store.get();
	if (!profile) {
		void vscode.window.showInformationMessage(
			'M365 Copilot: sin token. Ejecuta «M365 Copilot: Pegar perfil o token».',
		);
		return;
	}
	const mins = minutesUntilExpiry(profile);
	const usable = isTokenUsable(profile);
	const lines = [
		`Usuario: ${profile.claims?.upn ?? '(desconocido)'}`,
		`Estado: ${usable ? 'token válido' : 'token CADUCADO'}${
			mins !== null ? ` (${mins > 0 ? mins + ' min restantes' : 'caducó hace ' + Math.abs(mins) + ' min'})` : ''
		}`,
		`Capturado: ${profile.capturedAt}`,
	];
	void vscode.window.showInformationMessage(lines.join('  ·  '), { modal: false });
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch {
		/* Copilot Chat not installed; provider still registers for the API */
	}
}

import { exec, type ExecException } from 'node:child_process';
import * as vscode from 'vscode';
import { boundedInteger, ensureNotCancelled, resolveWorkspacePath } from './common';
import { cleanTerminalOutput, truncateOutput } from './terminalOutput';
import { t } from '../src/i18n';

export { looksRisky } from './commandSafety';

const DEFAULT_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 300;
const MAX_COMMAND_CHARS = 4000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const TERMINAL_NAME = 'M365 Copilot';
/** How long to wait for the shell to complete VS Code's shell-integration
 * handshake before giving up and running the command headlessly. */
const SHELL_INTEGRATION_TIMEOUT_MS = 5000;

export interface RunCommandInput {
	readonly command: string;
	readonly cwd?: string;
	readonly workspaceFolder?: string;
	readonly timeoutSeconds?: number;
}

interface CommandResult {
	readonly output: string;
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	/** How it ran, so the caller can say so — a headless fallback is worth
	 * surfacing because the user did not get to watch it happen. */
	readonly channel: 'terminal' | 'headless';
}

/**
 * Runs a shell command for the model.
 *
 * Preferred path is VS Code's integrated terminal via shell integration: the
 * user watches the command run in a real terminal, in their own shell profile
 * (so PATH, nvm, conda and friends behave as they do by hand), and the
 * scrollback stays afterwards. That visibility matters — this is the one tool
 * that executes arbitrary code. If shell integration is unavailable (an
 * unsupported shell, or the feature turned off) it falls back to a headless
 * child process so the tool still works.
 *
 * Either way, `agentTools.ts` requires the user to see the literal command and
 * confirm it before `invoke` reaches this function.
 */
export async function runWorkspaceCommand(
	input: RunCommandInput,
	token: vscode.CancellationToken,
): Promise<string> {
	const command = typeof input.command === 'string' ? input.command.trim() : '';
	if (!command) throw new Error(t('run.empty'));
	if (command.length > MAX_COMMAND_CHARS) throw new Error(t('run.tooLong', MAX_COMMAND_CHARS));

	const target = resolveWorkspacePath(input.cwd ?? '', input.workspaceFolder, { allowEmpty: true });
	const timeoutSeconds = boundedInteger(input.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, 1, MAX_TIMEOUT_SECONDS);
	ensureNotCancelled(token);

	const result =
		(await runInIntegratedTerminal(command, target.uri, timeoutSeconds * 1000, token)) ??
		(await runHeadless(command, target.uri.fsPath, timeoutSeconds * 1000, token));

	const body = truncateOutput(result.output, MAX_OUTPUT_CHARS) || t('run.noOutput');
	const status = result.timedOut
		? t('run.timedOut', timeoutSeconds)
		: result.exitCode === null
			? t('run.noExitCode')
			: t('run.exitCode', result.exitCode);
	const where = result.channel === 'terminal' ? t('run.inTerminal', TERMINAL_NAME) : t('run.headless');

	return [`$ ${command}`, `(cwd: ${target.relativePath || '.'})`, '```text', body, '```', status, where].join('\n');
}

// ------------------------------------------------------ integrated terminal

let cached: { terminal: vscode.Terminal; cwd: string } | undefined;

/** Drop the cached terminal when the user closes it by hand. */
export function registerTerminalCleanup(): vscode.Disposable {
	return vscode.window.onDidCloseTerminal((closed) => {
		if (cached?.terminal === closed) cached = undefined;
	});
}

async function terminalFor(cwd: vscode.Uri): Promise<vscode.Terminal> {
	const key = cwd.toString();
	if (cached && cached.cwd === key) return cached.terminal;
	// A terminal's cwd is fixed when it is created, so a different working
	// directory needs a different terminal.
	cached?.terminal.dispose();
	const terminal = vscode.window.createTerminal({
		name: TERMINAL_NAME,
		cwd,
		iconPath: new vscode.ThemeIcon('sparkle'),
		isTransient: true,
	});
	cached = { terminal, cwd: key };
	return terminal;
}

/** Resolves once the shell finishes VS Code's shell-integration handshake. */
async function awaitShellIntegration(terminal: vscode.Terminal): Promise<vscode.TerminalShellIntegration | undefined> {
	if (terminal.shellIntegration) return terminal.shellIntegration;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			listener.dispose();
			resolve(undefined);
		}, SHELL_INTEGRATION_TIMEOUT_MS);
		const listener = vscode.window.onDidChangeTerminalShellIntegration((event) => {
			if (event.terminal !== terminal) return;
			clearTimeout(timer);
			listener.dispose();
			resolve(event.shellIntegration);
		});
	});
}

/** Returns undefined when shell integration is unavailable, so the caller
 * can fall back instead of failing the tool. */
async function runInIntegratedTerminal(
	command: string,
	cwd: vscode.Uri,
	timeoutMs: number,
	token: vscode.CancellationToken,
): Promise<CommandResult | undefined> {
	let terminal: vscode.Terminal;
	try {
		terminal = await terminalFor(cwd);
	} catch {
		return undefined;
	}

	const shell = await awaitShellIntegration(terminal);
	if (!shell) return undefined;

	terminal.show(true);
	const execution = shell.executeCommand(command);

	// Register the end listener BEFORE reading: the command can finish while
	// the stream is still being drained, and that event carries the exit code.
	let exitCode: number | null = null;
	const finished = new Promise<void>((resolve) => {
		const listener = vscode.window.onDidEndTerminalShellExecution((event) => {
			if (event.execution !== execution) return;
			exitCode = event.exitCode ?? null;
			listener.dispose();
			resolve();
		});
	});

	let raw = '';
	let timedOut = false;
	let cancelled = false;

	const interrupt = () => {
		// There is no API to kill a shell execution, but Ctrl+C (ETX) is
		// exactly what a person would press.
		try {
			terminal.sendText('\x03', false);
		} catch {
			/* terminal already gone */
		}
	};

	const timer = setTimeout(() => {
		timedOut = true;
		interrupt();
	}, timeoutMs);
	const cancelListener = token.onCancellationRequested(() => {
		cancelled = true;
		interrupt();
	});

	try {
		for await (const chunk of execution.read()) {
			raw += chunk;
			if (raw.length > MAX_OUTPUT_CHARS * 4) break; // plenty; the rest is truncated anyway
			if (timedOut || cancelled) break;
		}
		// The stream can end slightly before the exit code arrives.
		await Promise.race([finished, new Promise((resolve) => setTimeout(resolve, 1500))]);
	} finally {
		clearTimeout(timer);
		cancelListener.dispose();
	}

	return {
		output: cleanTerminalOutput(raw, command),
		exitCode: timedOut || cancelled ? null : exitCode,
		timedOut,
		channel: 'terminal',
	};
}

// ---------------------------------------------------------------- fallback

function runHeadless(
	command: string,
	cwd: string,
	timeoutMs: number,
	token: vscode.CancellationToken,
): Promise<CommandResult> {
	return new Promise((resolve) => {
		let cancelledByUser = false;
		const child = exec(
			command,
			{ cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, windowsHide: true },
			(error: ExecException | null, stdout, stderr) => {
				cancelListener.dispose();
				const exitCode = typeof error?.code === 'number' ? error.code : error ? null : 0;
				resolve({
					output: cleanTerminalOutput(`${stdout}${stderr}`, command),
					exitCode,
					timedOut: Boolean(error?.killed) && !cancelledByUser,
					channel: 'headless',
				});
			},
		);
		const cancelListener = token.onCancellationRequested(() => {
			cancelledByUser = true;
			child.kill();
		});
	});
}

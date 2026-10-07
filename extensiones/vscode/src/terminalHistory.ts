/**
 * The last commands run in each terminal, with their output and exit code,
 * so `@m365 /terminal` (and "Explain last terminal command" in the terminal's
 * context menu) can explain a failure without anyone copying the output.
 *
 * Relies on VS Code's shell integration, which reports every command line,
 * streams its output and its exit code. Everything stays in memory, bounded
 * per command and per terminal, and is only sent to the model when the user
 * asks for it; `ms365copilot.terminal.captureOutput` turns it off entirely.
 */
import * as vscode from 'vscode';
import { cleanTerminalOutput } from '../tools/terminalOutput';
import type { PromptTerminalRun } from './participantPrompts';

const RUNS_PER_TERMINAL = 5;
/** Raw output kept per command (escape sequences included): the tail is what explains a failure. */
const MAX_RAW_CHARS = 64_000;
/** Clean output handed to the model. */
const MAX_PROMPT_CHARS = 12_000;

interface TerminalRun {
	readonly commandLine: string;
	readonly cwd: string | undefined;
	raw: string;
	dropped: number;
	exitCode: number | undefined;
	running: boolean;
}

export class TerminalHistory implements vscode.Disposable {
	private readonly runs = new Map<vscode.Terminal, TerminalRun[]>();
	private readonly byExecution = new Map<vscode.TerminalShellExecution, TerminalRun>();
	private readonly disposables: vscode.Disposable[];

	constructor() {
		this.disposables = [
			vscode.window.onDidStartTerminalShellExecution((event) => this.start(event)),
			vscode.window.onDidEndTerminalShellExecution((event) => this.end(event)),
			vscode.window.onDidCloseTerminal((terminal) => this.runs.delete(terminal)),
		];
	}

	/**
	 * The most relevant run of `terminal`: the last finished command, or the
	 * one still running when nothing has finished yet. Shaped for the prompt.
	 */
	lastRun(terminal: vscode.Terminal | undefined): PromptTerminalRun | undefined {
		if (!terminal) return undefined;
		const runs = this.runs.get(terminal) ?? [];
		const run = [...runs].reverse().find((candidate) => !candidate.running) ?? runs[runs.length - 1];
		if (!run) return undefined;
		const clean = cleanTerminalOutput(run.raw, run.commandLine);
		const output = clean.length > MAX_PROMPT_CHARS ? clean.slice(-MAX_PROMPT_CHARS) : clean;
		return {
			terminalName: terminal.name,
			commandLine: run.commandLine,
			cwd: run.cwd,
			exitCode: run.exitCode,
			running: run.running,
			output,
			truncatedChars: run.dropped + (clean.length - output.length),
		};
	}

	private start(event: vscode.TerminalShellExecutionStartEvent): void {
		if (!vscode.workspace.getConfiguration('ms365copilot.terminal').get<boolean>('captureOutput', true)) return;
		const run: TerminalRun = {
			commandLine: event.execution.commandLine.value,
			cwd: event.execution.cwd?.fsPath,
			raw: '',
			dropped: 0,
			exitCode: undefined,
			running: true,
		};
		const runs = this.runs.get(event.terminal) ?? [];
		runs.push(run);
		if (runs.length > RUNS_PER_TERMINAL) runs.shift();
		this.runs.set(event.terminal, runs);
		this.byExecution.set(event.execution, run);

		// read() must be called right away, or the start of the output is lost.
		const stream = event.execution.read();
		void (async () => {
			try {
				for await (const chunk of stream) {
					run.raw += chunk;
					if (run.raw.length > MAX_RAW_CHARS) {
						const excess = run.raw.length - MAX_RAW_CHARS;
						run.raw = run.raw.slice(excess);
						run.dropped += excess;
					}
				}
			} catch {
				/* terminal closed mid-stream: keep what arrived */
			}
		})();
	}

	private end(event: vscode.TerminalShellExecutionEndEvent): void {
		const run = this.byExecution.get(event.execution);
		if (!run) return;
		run.exitCode = event.exitCode;
		run.running = false;
		this.byExecution.delete(event.execution);
	}

	dispose(): void {
		for (const disposable of this.disposables) disposable.dispose();
		this.runs.clear();
		this.byExecution.clear();
	}
}

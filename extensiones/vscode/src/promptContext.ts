/**
 * Pieces of context the extension hands to the model as text: the code an
 * editor action is about and the last command of a terminal.
 *
 * Kept free of the `vscode` import, like toolCatalog.ts, so test/e2e.mts can
 * check exactly what the model receives.
 */
import { t } from "./i18n";

/** The code a request is about, already captured from the editor. */
export interface PromptCodeContext {
  readonly relativePath: string;
  readonly languageId: string;
  /** 1-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  /** Characters cut from the end of {@link text} to keep the prompt bounded. */
  readonly truncatedChars: number;
  /** Diagnostics VS Code reports inside that range, already formatted. */
  readonly diagnostics: readonly string[];
}

/** The last command of a terminal (see terminalHistory.ts). */
export interface PromptTerminalRun {
  readonly terminalName: string;
  readonly commandLine: string;
  readonly cwd: string | undefined;
  /** Undefined while running, or when the shell did not report it. */
  readonly exitCode: number | undefined;
  readonly running: boolean;
  /** Clean output (no escape sequences), its tail when it was long. */
  readonly output: string;
  /** Characters of output left out from the start. */
  readonly truncatedChars: number;
}

/** A fence longer than any backtick run inside the code, so the code can never close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** The code with where it comes from, fenced, for a message to the model. */
export function renderCode(code: PromptCodeContext): string {
  const fence = fenceFor(code.text);
  const lines = [
    t("prompt.code.context", code.relativePath, code.startLine, code.endLine, code.languageId),
    `${fence}${code.languageId}`,
    code.text,
    fence,
  ];
  if (code.truncatedChars > 0) lines.push(t("prompt.code.truncated", code.truncatedChars));
  return lines.join("\n");
}

/** The diagnostics of {@link PromptCodeContext} as a list, or "" when there are none. */
export function renderDiagnostics(diagnostics: readonly string[]): string {
  if (diagnostics.length === 0) return "";
  return [t("prompt.code.diagnostics"), ...diagnostics.map((line) => `- ${line}`)].join("\n");
}

/**
 * What `m365_last_terminal_command` returns: the command, how it ended, where
 * it ran and its output, fenced.
 */
export function renderTerminalRun(run: PromptTerminalRun): string {
  const status = run.running
    ? t("prompt.terminal.running")
    : run.exitCode === undefined
      ? t("prompt.terminal.noExitCode")
      : t("prompt.terminal.exitCode", run.exitCode);
  const lines = [
    t("prompt.terminal.header", run.terminalName),
    `$ ${run.commandLine}`,
    `${status}${run.cwd ? ` · cwd: ${run.cwd}` : ""}`,
  ];
  if (run.output.trim()) {
    const fence = fenceFor(run.output);
    if (run.truncatedChars > 0) lines.push(t("prompt.terminal.truncated", run.truncatedChars));
    lines.push(`${fence}text`, run.output, fence);
  } else {
    lines.push(t("prompt.terminal.noOutput"));
  }
  return lines.join("\n");
}

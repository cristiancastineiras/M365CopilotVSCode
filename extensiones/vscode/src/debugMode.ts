/**
 * Deep debug mode (`m365copilot.debug.deep`): the half of it that needs VS Code.
 * The trace itself — `debug()`, the redaction, the buffer — lives in logger.ts,
 * which has no `vscode` import so tests can use it; this file owns what is
 * tied to the editor:
 *
 *  - {@link DebugSession}: follows the setting, announces the mode in the log,
 *    describes the environment once, and traces every later change of settings;
 *  - the commands behind the buttons: toggle, export to .txt, clear;
 *  - {@link registerTracedCommand} / {@link registerTracedTool}: the same as
 *    `vscode.commands.registerCommand` / `vscode.lm.registerTool`, plus a trace
 *    of each call (arguments, result, time) while the mode is on.
 */
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  debug,
  formatDebugData,
  isDeepDebug,
  log,
  logEntryCount,
  clearLog,
  renderLogText,
  setDeepDebug,
  showLog,
} from "./logger";
import { describeProfile } from "./profile";
import type { ProfileStore } from "./secrets";
import { getLocale, t } from "./i18n";

const SECTION = "m365copilot.debug";
const DEEP_KEY = `${SECTION}.deep`;

/** `m365copilot.debug.deep`. */
export function deepDebugSetting(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>("deep", false);
}

// ------------------------------------------------------------------- session

export interface DebugSessionOptions {
  readonly context: vscode.ExtensionContext;
  readonly store: ProfileStore;
  /** The temp file the log also streams to (shown in the environment snapshot). */
  readonly debugFile: string;
  /** Told when the mode flips, to show it in the status bar. */
  readonly onChange: (on: boolean) => void;
}

/**
 * Applies the setting to the logger — at start and whenever it changes — and
 * while the mode is on, writes down the environment and every setting change,
 * so a log read later explains how the extension was configured when it ran.
 */
export class DebugSession implements vscode.Disposable {
  private readonly listener: vscode.Disposable;
  private settings = snapshotSettings();

  constructor(private readonly options: DebugSessionOptions) {
    this.listener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("m365copilot")) return;
      const changes = this.refreshSettings();
      if (event.affectsConfiguration(DEEP_KEY)) this.apply(deepDebugSetting(), true);
      for (const change of changes) debug("config", change);
    });
    this.apply(deepDebugSetting(), false);
  }

  /** `reveal`: the user just flipped it, so bring the console up; at startup it stays where it is. */
  private apply(on: boolean, reveal: boolean): void {
    const was = isDeepDebug();
    setDeepDebug(on);
    this.options.onChange(on);
    if (on) {
      log(t("debug.enabled"));
      void this.describeSession();
      if (reveal) showLog();
    } else if (was) {
      log(t("debug.disabled"));
    }
  }

  /** Settings that changed since the last look, as `key: old → new` lines. */
  private refreshSettings(): string[] {
    const next = snapshotSettings();
    const changes: string[] = [];
    for (const key of [...new Set([...this.settings.keys(), ...next.keys()])].sort()) {
      const before = this.settings.get(key);
      const after = next.get(key);
      if (before !== after) changes.push(`${key}: ${before ?? "(unset)"} → ${after ?? "(unset)"}`);
    }
    this.settings = next;
    return changes;
  }

  private async describeSession(): Promise<void> {
    const { context, store, debugFile } = this.options;
    try {
      const profile = await store.get();
      const copilotChat = vscode.extensions.getExtension("github.copilot-chat");
      debug("session", "environment snapshot", () => ({
        extension: {
          id: context.extension.id,
          version: (context.extension.packageJSON as { version?: string }).version,
          mode: vscode.ExtensionMode[context.extensionMode],
          path: context.extensionPath,
          language: getLocale(),
          logFile: debugFile,
        },
        vscode: {
          version: vscode.version,
          app: vscode.env.appName,
          host: vscode.env.appHost,
          uiKind: vscode.UIKind[vscode.env.uiKind],
          displayLanguage: vscode.env.language,
          remote: vscode.env.remoteName ?? null,
          shell: vscode.env.shell,
          telemetryEnabled: vscode.env.isTelemetryEnabled,
        },
        runtime: {
          platform: `${process.platform} ${process.arch} (${os.release()})`,
          node: process.versions.node,
          electron: process.versions.electron ?? null,
          pid: process.pid,
          memoryMB: Object.fromEntries(
            Object.entries(process.memoryUsage()).map(([key, bytes]) => [
              key,
              Math.round(bytes / 1024 / 1024),
            ]),
          ),
        },
        workspace: {
          name: vscode.workspace.name ?? null,
          folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()),
          trusted: vscode.workspace.isTrusted,
        },
        copilotChat: copilotChat
          ? {
              version: (copilotChat.packageJSON as { version?: string }).version,
              active: copilotChat.isActive,
            }
          : null,
        profile: describeProfile(profile),
        settings: JSON.parse(
          JSON.stringify(vscode.workspace.getConfiguration("m365copilot")),
        ) as unknown,
      }));
    } catch (error) {
      debug("session", "could not describe the environment", error);
    }
  }

  dispose(): void {
    this.listener.dispose();
  }
}

/** Every `m365copilot.*` setting as `dotted.key → JSON`, to tell what changed between two looks. */
function snapshotSettings(): Map<string, string> {
  const flat = new Map<string, string>();
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "function") return;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, child] of Object.entries(value)) walk(`${key}.${name}`, child);
      return;
    }
    flat.set(key, JSON.stringify(value));
  };
  walk("m365copilot", vscode.workspace.getConfiguration("m365copilot"));
  return flat;
}

// ------------------------------------------------------------------ commands

/** Flips the setting; the session reacts to the change, this only says what to do next. */
export async function toggleDeepDebug(): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const next = !config.get<boolean>("deep", false);
  try {
    // Global: it is a switch about how this machine diagnoses, not a property of one folder.
    await config.update("deep", next, vscode.ConfigurationTarget.Global);
  } catch (error) {
    void vscode.window.showErrorMessage(
      t("debug.toggleFailed", error instanceof Error ? error.message : String(error)),
    );
    return;
  }
  const show = t("debug.button.show");
  const exportLog = t("debug.button.export");
  void vscode.window
    .showInformationMessage(
      t(next ? "debug.toggledOn" : "debug.toggledOff"),
      ...(next ? [show, exportLog] : [exportLog]),
    )
    .then((picked) => {
      if (picked === show) showLog();
      if (picked === exportLog) void exportDebugLog();
    });
}

/** Saves everything buffered as a .txt of the user's choosing. */
export async function exportDebugLog(): Promise<void> {
  if (logEntryCount() === 0) {
    void vscode.window.showInformationMessage(t("debug.export.empty"));
    return;
  }
  const target = await vscode.window.showSaveDialog({
    title: t("debug.export.title"),
    defaultUri: vscode.Uri.file(
      path.join(defaultExportFolder(), `m365copilot-log-${fileStamp(new Date())}.txt`),
    ),
    filters: { [t("debug.export.filter")]: ["txt"] },
    saveLabel: t("debug.export.save"),
  });
  if (!target) return;
  try {
    const text = renderLogText(exportHeader());
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
    log(`log exported to ${target.fsPath} (${text.length} chars)`);
    const open = t("debug.export.open");
    const reveal = t("debug.export.reveal");
    const picked = await vscode.window.showInformationMessage(
      t("debug.export.saved", target.fsPath),
      open,
      reveal,
    );
    if (picked === open) await vscode.window.showTextDocument(target);
    if (picked === reveal) await vscode.commands.executeCommand("revealFileInOS", target);
  } catch (error) {
    void vscode.window.showErrorMessage(
      t("debug.export.failed", error instanceof Error ? error.message : String(error)),
    );
  }
}

export function clearDebugLog(): void {
  clearLog();
  log(t("debug.cleared"));
  void vscode.window.showInformationMessage(t("debug.cleared"));
}

/** Downloads if the machine has the folder, else the home folder — never the workspace, where a log could end up committed. */
function defaultExportFolder(): string {
  const downloads = path.join(os.homedir(), "Downloads");
  return fs.existsSync(downloads) ? downloads : os.homedir();
}

function fileStamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

function exportHeader(): string {
  const extension = vscode.extensions.getExtension("m365-copilot-vscode.m365-copilot-vscode");
  const version = (extension?.packageJSON as { version?: string } | undefined)?.version ?? "?";
  return [
    "M365 Copilot for VS Code — log export",
    `Exported:        ${new Date().toISOString()}`,
    `Extension:       ${version}`,
    `VS Code:         ${vscode.version} (${vscode.env.appName}, display language ${vscode.env.language})`,
    `System:          ${process.platform} ${process.arch} ${os.release()} · Node ${process.versions.node}`,
    `Deep debug mode: ${isDeepDebug() ? "ON — full trace of requests, frames, tools, commands and processes" : "OFF — only the standard log"}`,
    `Entries:         ${logEntryCount()}`,
    "Times are UTC. Tokens, JWTs and credential headers are redacted.",
    "Prompts, answers, file paths and tool results are NOT: read it before sharing it.",
  ].join("\n");
}

// ------------------------------------------------------------------- tracing

type CommandCallback = Parameters<typeof vscode.commands.registerCommand>[1];
let commandSeq = 0;

/** `vscode.commands.registerCommand`, plus a trace of each run while deep debug is on. */
export function registerTracedCommand(
  id: string,
  callback: CommandCallback,
  thisArg?: unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    id,
    (...args: unknown[]) => {
      if (!isDeepDebug()) return callback.apply(thisArg, args);
      const scope = `cmd#${++commandSeq}`;
      const started = Date.now();
      debug(scope, `▶ ${id}`, () => (args.length > 0 ? args.map(describeArgument) : undefined));
      const finish = (outcome: string) =>
        debug(scope, `◀ ${id} ${outcome} (${Date.now() - started} ms)`);
      let result: unknown;
      try {
        result = callback.apply(thisArg, args);
      } catch (error) {
        debug(scope, `✖ ${id} threw (${Date.now() - started} ms)`, error);
        throw error;
      }
      if (isThenable(result)) {
        return result.then(
          (value) => {
            finish("done");
            return value;
          },
          (error: unknown) => {
            debug(scope, `✖ ${id} rejected (${Date.now() - started} ms)`, error);
            throw error;
          },
        );
      }
      finish("done");
      return result;
    },
    thisArg,
  );
}

let toolSeq = 0;

/**
 * `vscode.lm.registerTool`, plus a trace of each invocation while deep debug is
 * on: the input the model gave, what the tool answered, how long it took.
 */
export function registerTracedTool<T>(
  name: string,
  tool: vscode.LanguageModelTool<T>,
): vscode.Disposable {
  return vscode.lm.registerTool<T>(name, {
    prepareInvocation: tool.prepareInvocation?.bind(tool),
    invoke: async (options, token) => {
      if (!isDeepDebug()) return tool.invoke(options, token);
      const scope = `tool#${++toolSeq}`;
      const started = Date.now();
      debug(scope, `▶ ${name}`, () => ({
        input: options.input,
        chatRequest: options.toolInvocationToken !== undefined,
        tokenBudget: options.tokenizationOptions?.tokenBudget,
      }));
      try {
        const result = await tool.invoke(options, token);
        debug(scope, `◀ ${name} answered (${Date.now() - started} ms)`, () =>
          result ? describeToolResult(result) : "(no result)",
        );
        return result;
      } catch (error) {
        debug(scope, `✖ ${name} threw (${Date.now() - started} ms)`, error);
        throw error;
      }
    },
  });
}

/** A caller of `vscode.lm.invokeTool` (the chat participant, the sub-agents): note the call and how it went. */
export async function traceInvokeTool(
  caller: string,
  name: string,
  input: object,
  run: () => Thenable<vscode.LanguageModelToolResult>,
): Promise<vscode.LanguageModelToolResult> {
  if (!isDeepDebug()) return run();
  const started = Date.now();
  debug(caller, `→ vscode.lm.invokeTool(${name})`, input);
  try {
    const result = await run();
    debug(caller, `← ${name} returned (${Date.now() - started} ms)`, () =>
      describeToolResult(result),
    );
    return result;
  } catch (error) {
    debug(caller, `✖ ${name} failed (${Date.now() - started} ms)`, error);
    throw error;
  }
}

function describeToolResult(result: vscode.LanguageModelToolResult): string {
  return result.content
    .map((part: unknown) =>
      part instanceof vscode.LanguageModelTextPart
        ? part.value
        : `<${part && typeof part === "object" ? (part.constructor?.name ?? "part") : typeof part}>`,
    )
    .join("\n");
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

/** A command argument short enough to read: Uris and ranges as text, small plain objects whole, the rest by type. */
function describeArgument(arg: unknown): unknown {
  if (arg === null || typeof arg !== "object") return arg;
  if (arg instanceof vscode.Uri) return arg.toString();
  if (arg instanceof vscode.Range)
    return `Range(${arg.start.line}:${arg.start.character}-${arg.end.line}:${arg.end.character})`;
  if (Array.isArray(arg)) return `Array(${arg.length})`;
  if (Object.getPrototypeOf(arg) === Object.prototype && formatDebugData(arg).length <= 500)
    return arg;
  return `<${arg.constructor?.name ?? "object"}>`;
}

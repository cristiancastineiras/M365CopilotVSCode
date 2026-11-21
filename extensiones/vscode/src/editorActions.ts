import * as vscode from "vscode";
import { registerTracedCommand } from "./debugMode";
import { captureCodeContext, currentTextEditor, type CodeContext } from "./editorContext";
import {
  buildChatOpenOptions,
  isModelSelectorError,
  type ChatOpenOptions,
  type EditorTask,
} from "./chatLaunch";
import { editorModelId } from "./models";
import type { TerminalHistory } from "./terminalHistory";
import { errorMessage } from "../tools/common";
import { debug } from "@m365copilot/core/bizchat";
import { t } from "./i18n";

const MAX_DIAGNOSTIC_TITLE_CHARS = 60;

/** A file range as `workbench.action.chat.open` attaches it (`attachFiles`). */
interface ChatAttachment {
  readonly uri: vscode.Uri;
  readonly range: vscode.Range;
}

const ACTION_COMMANDS: readonly (readonly [string, EditorTask])[] = [
  ["m365copilot.explainCode", "explain"],
  ["m365copilot.fixCode", "fix"],
  ["m365copilot.documentCode", "doc"],
  ["m365copilot.generateTests", "tests"],
];

export function registerEditorActions(terminals: TerminalHistory): vscode.Disposable[] {
  const selector: vscode.DocumentSelector = [
    { scheme: "file" },
    { scheme: "untitled" },
    { scheme: "vscode-remote" },
    { scheme: "vscode-vfs" },
  ];
  return [
    ...ACTION_COMMANDS.map(([id, task]) =>
      registerTracedCommand(id, (uri?: vscode.Uri, range?: vscode.Range) =>
        runEditorAction(task, uri, range),
      ),
    ),
    registerTracedCommand("m365copilot.askAboutCode", () => askAboutCode()),
    registerTracedCommand("m365copilot.explainTerminal", () => explainTerminal(terminals)),
    registerTracedCommand("m365copilot.openChat", () => openChat({ partial: true })),
    vscode.languages.registerCodeActionsProvider(selector, new M365CodeActionProvider(), {
      providedCodeActionKinds: M365CodeActionProvider.kinds,
    }),
  ];
}

/**
 * Explain / fix / document / test the code at hand. `uri` + `range` come from
 * a code action (the diagnostic or selection it was offered for); from the
 * context menu or the palette they are absent and the active editor is used.
 */
async function runEditorAction(
  task: EditorTask,
  uri?: vscode.Uri,
  range?: vscode.Range,
): Promise<void> {
  const editor = currentTextEditor();
  let code: CodeContext;
  if (uri instanceof vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    const given = range instanceof vscode.Range ? range : undefined;
    // A diagnostic's range (fix) is widened to the code around it; a
    // selection the user made (explain/doc) is taken exactly as selected.
    code = await captureCodeContext(
      document,
      task === "fix" || !given
        ? { range: given }
        : { selection: new vscode.Selection(given.start, given.end) },
    );
  } else if (editor) {
    code = await captureCodeContext(editor.document, { selection: editor.selection });
  } else {
    void vscode.window.showWarningMessage(t("actions.noEditor"));
    return;
  }
  await openChat({ task, code });
}

/** Free-form question about the code at hand: asked first, then sent with that code attached. */
async function askAboutCode(): Promise<void> {
  const editor = currentTextEditor();
  if (!editor) {
    void vscode.window.showWarningMessage(t("actions.noEditor"));
    return;
  }
  // Captured before the input box: it is the selection the user asked about.
  const code = await captureCodeContext(editor.document, { selection: editor.selection });
  const question = await vscode.window.showInputBox({
    title: "M365 Copilot",
    prompt: t("actions.ask.prompt"),
    placeHolder: t("actions.ask.placeholder"),
    ignoreFocusOut: true,
  });
  if (!question?.trim()) return;
  await openChat({ request: question.trim(), code });
}

/**
 * Last terminal command → `/m365-terminal`, whose skill has the model read it
 * with `m365_last_terminal_command`. Checked here first, so a terminal without
 * shell integration is reported before the chat opens.
 */
async function explainTerminal(terminals: TerminalHistory): Promise<void> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    void vscode.window.showWarningMessage(t("terminal.none"));
    return;
  }
  if (!terminals.lastRun(terminal)) {
    void vscode.window.showWarningMessage(t("terminal.noRun"));
    return;
  }
  await openChat({ task: "terminal" });
}

/**
 * Opens the chat in the M365 Copilot agent with the editor's M365 model (see
 * chatLaunch.ts). Agent mode, not Ask: the skills edit files and run tools.
 */
async function openChat(input: {
  readonly task?: EditorTask;
  readonly request?: string;
  readonly code?: CodeContext;
  readonly partial?: boolean;
}): Promise<void> {
  const attachment =
    input.code && (await attachable(input.code.uri))
      ? { uri: input.code.uri, range: input.code.range }
      : undefined;
  const options = buildChatOpenOptions<ChatAttachment>({
    ...input,
    attachment,
    modelId: editorModelId(),
  });
  debug("actions", `opening the chat${input.task ? ` (${input.task})` : ""}`, () => ({
    mode: options.mode,
    model: options.modelSelector?.id ?? null,
    attached: attachment
      ? `${attachment.uri.toString()}#L${attachment.range.start.line + 1}-L${attachment.range.end.line + 1}`
      : null,
    queryChars: options.query.length,
    partial: options.isPartialQuery,
  }));
  try {
    await executeChatOpen(options);
  } catch (error) {
    // Right after start the models may not be registered yet: the agent's own
    // model is better than no chat at all.
    if (!options.modelSelector || !isModelSelectorError(errorMessage(error))) {
      void vscode.window.showErrorMessage(t("actions.chatUnavailable", errorMessage(error)));
      return;
    }
    debug("actions", "the M365 model could not be selected; opening with the agent's", error);
    const { modelSelector: _unavailable, ...withoutModel } = options;
    try {
      await executeChatOpen(withoutModel);
    } catch (retryError) {
      void vscode.window.showErrorMessage(t("actions.chatUnavailable", errorMessage(retryError)));
    }
  }
}

function executeChatOpen(options: ChatOpenOptions<ChatAttachment>): Thenable<unknown> {
  return vscode.commands.executeCommand("workbench.action.chat.open", options);
}

/**
 * The chat attaches a file it can read through the file system; an untitled
 * editor is not one, so its code goes inside the message instead.
 */
async function attachable(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme === "untitled") return false;
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lightbulb integration: "Fix with M365 Copilot" on errors/warnings under the
 * cursor — an inline edit with the diagnostic as the instruction, so the fix
 * lands right there under Keep/Undo — and "Edit… / Explain / Document with
 * M365 Copilot" on a selection (the last two in the chat, see chatLaunch.ts).
 */
class M365CodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!vscode.workspace.getConfiguration("m365copilot.editor").get<boolean>("codeActions", true))
      return [];
    const actions: vscode.CodeAction[] = [];

    const problems = context.diagnostics
      .filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
      .slice(0, 2);
    // Offered on a problem only: "fix all" is a quick fix like the others.
    const inFile =
      problems.length > 0
        ? vscode.languages
            .getDiagnostics(document.uri)
            .filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning).length
        : 0;
    for (const diagnostic of problems) {
      const action = new vscode.CodeAction(
        t("actions.codeAction.fixDiagnostic", shorten(diagnostic.message)),
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      action.command = {
        command: "m365copilot.editCode",
        title: action.title,
        arguments: [
          document.uri,
          diagnostic.range,
          t("inlineEdit.fixInstruction", diagnostic.message),
        ],
      };
      actions.push(action);
    }
    if (inFile >= 2) {
      const action = new vscode.CodeAction(
        t("actions.codeAction.fixAll", inFile),
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: "m365copilot.fixAllProblems",
        title: action.title,
        arguments: [document.uri],
      };
      actions.push(action);
    }

    if (!range.isEmpty) {
      for (const [command, key] of [
        ["m365copilot.editCode", "actions.codeAction.edit"],
        ["m365copilot.explainCode", "actions.codeAction.explain"],
        ["m365copilot.documentCode", "actions.codeAction.document"],
      ] as const) {
        const action = new vscode.CodeAction(t(key), vscode.CodeActionKind.RefactorRewrite);
        action.command = { command, title: action.title, arguments: [document.uri, range] };
        actions.push(action);
      }
    }
    return actions;
  }
}

function shorten(message: string): string {
  const firstLine = (message.split("\n", 1)[0] ?? "").trim();
  return firstLine.length > MAX_DIAGNOSTIC_TITLE_CHARS
    ? `${firstLine.slice(0, MAX_DIAGNOSTIC_TITLE_CHARS - 1)}…`
    : firstLine;
}

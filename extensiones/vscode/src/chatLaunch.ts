/**
 * How the editor actions open the chat (Explain, Fix, Document, Generate
 * tests, Ask about this code, Explain last terminal command, Open chat).
 *
 * They used to send `@m365 /explain`… to this extension's chat participant.
 * VS Code is retiring chat participants (the Copilot harness, which replaces
 * the Local one in February 2027, has none), so the same requests now go
 * through what both harnesses support:
 *
 *  - the **M365 Copilot** custom agent (agents/m365-copilot.agent.md), which
 *    answers with an M365 model, like `@m365` did;
 *  - one of the extension's skills (skills/<name>/SKILL.md), invoked as a
 *    slash command — `/m365-explain`, `/m365-fix`… — with the task's
 *    instructions, which the participant used to add itself;
 *  - the code the action is about, attached as a file range like `#selection`,
 *    or written into the message when the chat cannot attach it (an unsaved
 *    untitled editor).
 *
 * Kept free of the `vscode` import so test/e2e.mts can check what is sent.
 */
import { renderCode, renderDiagnostics, type PromptCodeContext } from "./promptContext";

/** `name` of agents/m365-copilot.agent.md: the mode `workbench.action.chat.open` switches to. */
export const M365_AGENT_NAME = "M365 Copilot";

/** The vendor this extension's chat models are registered under. */
export const M365_VENDOR = "m365copilot";

export const EDITOR_TASKS = ["explain", "fix", "doc", "tests", "terminal"] as const;
export type EditorTask = (typeof EDITOR_TASKS)[number];

/**
 * The skill behind each task: its folder under skills/, its `name` and the
 * slash command that invokes it. Prefixed, because Copilot's own `/explain`,
 * `/fix`, `/doc` and `/tests` already exist.
 */
export const TASK_SKILLS: Readonly<Record<EditorTask, string>> = {
  explain: "m365-explain",
  fix: "m365-fix",
  doc: "m365-doc",
  tests: "m365-tests",
  terminal: "m365-terminal",
};

/** The options of `workbench.action.chat.open` this extension uses. */
export interface ChatOpenOptions<Attachment> {
  readonly query: string;
  readonly isPartialQuery: boolean;
  /** A chat mode or custom agent, by name; VS Code keeps the current one when it does not know it. */
  readonly mode: string;
  readonly modelSelector?: { readonly vendor: string; readonly id: string };
  readonly attachFiles?: readonly Attachment[];
}

export interface ChatLaunchInput<Attachment> {
  readonly task?: EditorTask;
  /** What the user typed, if anything. */
  readonly request?: string;
  /** The code the action is about. */
  readonly code?: PromptCodeContext;
  /**
   * {@link code} as the chat attaches it (`{ uri, range }`), when it can — a
   * file it can read. Without one, the code goes inside the message.
   */
  readonly attachment?: Attachment;
  /** The M365 model to select (`m365copilot.editor.model`); none keeps the agent's. */
  readonly modelId?: string;
  /** Leave the query in the input box for the user to finish, instead of sending it. */
  readonly partial?: boolean;
}

export function buildChatOpenOptions<Attachment>(
  input: ChatLaunchInput<Attachment>,
): ChatOpenOptions<Attachment> {
  const command = input.task ? `/${TASK_SKILLS[input.task]}` : "";
  const sections = [[command, input.request?.trim() ?? ""].filter(Boolean).join(" ")];
  if (input.code && input.attachment === undefined) sections.push(renderCode(input.code));
  // A fix is about what VS Code reports there: say it, rather than hope the
  // model looks it up — the old `/fix` put the diagnostics in its prompt too.
  if (input.code && input.task === "fix") sections.push(renderDiagnostics(input.code.diagnostics));

  return {
    query: sections.filter(Boolean).join("\n\n"),
    isPartialQuery: input.partial ?? false,
    mode: M365_AGENT_NAME,
    ...(input.modelId ? { modelSelector: { vendor: M365_VENDOR, id: input.modelId } } : {}),
    ...(input.attachment !== undefined ? { attachFiles: [input.attachment] } : {}),
  };
}

/**
 * Whether a failure of `workbench.action.chat.open` came from `modelSelector`
 * ("No language models found matching selector", "Language model not
 * loaded"): the models are not registered yet, right after start. It throws
 * before the query is sent, so opening again without the selector is safe.
 */
export function isModelSelectorError(message: string): boolean {
  return /language models? (?:found|not loaded)/i.test(message);
}

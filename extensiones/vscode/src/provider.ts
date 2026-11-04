import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  streamCopilotTurnWithRetry,
  CopilotClientError,
  CopilotAuthError,
  CopilotModelUnavailableError,
  accountTier,
  isAccountLevelError,
  type TurnMode,
  type WebSource,
  debug,
  log,
  isTokenUsable,
  minutesUntilExpiry,
  buildToolCatalog,
  ToolCallDecoder,
  type DuplicatePolicy,
} from "@m365copilot/core/bizchat";

import { currentEnvironment, currentSkills } from "./editorContext";
import { MarkdownStreamFormatter } from "./markdown";
import { flattenMessages, imagesOf, recentUserTexts } from "./messages";
import { FORCE_NOTE_KEYS, looksLikeRemoteSandbox, ProseHold, toolFreeProblem } from "./giveUp";
import {
  CHARS_PER_TOKEN,
  isTurnRefusal,
  retrievalText,
  TRANSCRIPT_LIMITS,
  transcriptLimitsFor,
  type TranscriptLimits,
} from "./transcript";
import { webSearchEnabled } from "./webSearch";
import { sourcesMarkdown } from "./webSearchPrompt";
import { allModels, findModel, modelRegistry, toChatInformation, type TokenState } from "./models";
import type { ProfileStore } from "./secrets";
import { t } from "./i18n";

/** Numbers each chat request in the deep trace (`chat#3`), so interleaved requests can be told apart. */
let chatSeq = 0;

/** Cómo se describen en el prompt las herramientas que ofrece VS Code. */
function readToolSettings(): {
  includeEditorTools: boolean;
  duplicates: DuplicatePolicy;
  maxTools: number;
  singleRoot: boolean;
} {
  const config = vscode.workspace.getConfiguration("m365copilot.tools");
  return {
    includeEditorTools: config.get<boolean>("includeEditorTools", true),
    duplicates: config.get<DuplicatePolicy>("duplicates", "preferEditor"),
    maxTools: config.get<number>("maxAdvertised", 20),
    singleRoot: (vscode.workspace.workspaceFolders?.length ?? 0) <= 1,
  };
}

/** The project context for a chat message (see projectIndex.ts), or undefined. */
export type ProjectContextSource = (message: string) => Promise<string | undefined>;

export class M365CopilotProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  private readonly storeListener: vscode.Disposable;

  /** The service refused a long message that a shorter one got past: keep to short ones. */
  private shortPromptsOnly = false;
  constructor(
    private readonly store: ProfileStore,
    private readonly projectContext?: ProjectContextSource,
  ) {
    this.storeListener = store.onDidChange(() => this.changeEmitter.fire());
  }

  /** Force Copilot Chat to re-query the model list. */
  refresh(): void {
    this.changeEmitter.fire();
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const profile = await this.store.get();
    const state: TokenState = !profile ? "missing" : isTokenUsable(profile) ? "ok" : "expired";
    const registry = modelRegistry();
    const tier = profile ? accountTier(profile) : "unknown";
    const infos = allModels().map((m) =>
      toChatInformation(m, state, registry?.unavailability(m.tone), tier),
    );
    // One line: VS Code asks again every time the picker refreshes.
    debug("chat", `VS Code asked for the model list (${infos.length} models, token ${state})`);
    return infos;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const scope = `chat#${++chatSeq}`;
    const started = Date.now();
    debug(scope, `request received for ${model.id}`, () => ({
      model: { id: model.id, name: model.name, family: model.family },
      messages: describeMessages(messages),
      toolMode:
        options.toolMode === undefined ? null : vscode.LanguageModelChatToolMode[options.toolMode],
      tools: (options.tools ?? []).map((tool) => tool.name),
      modelOptions: options.modelOptions,
    }));
    const profile = await this.store.get();
    if (!profile) {
      debug(scope, "refused: no token stored");
      throw userError(t("provider.noToken"));
    }
    if (!isTokenUsable(profile)) {
      const mins = minutesUntilExpiry(profile);
      debug(scope, `refused: the stored token expired (${mins} min)`);
      this.changeEmitter.fire();
      throw userError(
        t("provider.tokenExpired", mins !== null ? t("provider.expiredAgo", Math.abs(mins)) : ""),
      );
    }

    const selected = findModel(model.id);
    // `options.tools` trae TODAS las herramientas activas del turno: las
    // nuestras, las nativas del editor/modo agente, las de MCP y las de otras
    // extensiones. Se describen todas en el prompt y VS Code ejecuta la que el
    // modelo pida — es lo que hace que el modo agente funcione con este
    // proveedor, y no sólo con las siete herramientas de la extensión.
    const catalog = buildToolCatalog(options.tools, readToolSettings());
    const toolsRequired = options.toolMode === vscode.LanguageModelChatToolMode.Required;
    // Without tools to call there is no text protocol to protect, so the
    // turn can go out the way the web app sends it: with web search (its
    // captured invocation, or the lean one with the search plugin).
    const webTurn = catalog.callable.size === 0 && webSearchEnabled();
    debug(
      scope,
      `turn mode decided: ${webTurn ? "web (with BizChat plugins)" : "tools (lean invocation)"}`,
      () => ({
        callableTools: [...catalog.callable.keys()],
        omittedTools: catalog.omitted,
        toolsRequired,
        webSearchEnabled: webSearchEnabled(),
        hasInvocationTemplate: Boolean(profile.invocationTemplate),
        selectedModel: selected
          ? { id: selected.id, tone: selected.tone, source: selected.source }
          : null,
      }),
    );
    let projectContext: string | undefined;
    try {
      projectContext = await this.projectContext?.(retrievalText(recentUserTexts(messages, 2)));
    } catch (error) {
      log(t("log.indexContextFailed", error instanceof Error ? error.message : String(error)));
    }
    debug(scope, `project context (${projectContext?.length ?? 0} chars)`, projectContext);
    // Screenshots pasted in the chat go with the turn, uploaded like the web app does.
    const images = imagesOf(messages);
    const flatten = (limits: TranscriptLimits) =>
      flattenMessages(messages, {
        catalog,
        toolsRequired,
        environment: currentEnvironment(),
        skills: currentSkills(),
        projectContext,
        attachedImages: new Set(images),
        limits,
      });
    let prompt = flatten(
      this.shortPromptsOnly ? TRANSCRIPT_LIMITS : transcriptLimitsFor(model.maxInputTokens),
    );
    debug(
      scope,
      `prompt flattened (${prompt.length} chars) — exactly what goes to BizChat as the user message`,
      prompt,
    );
    log(
      t(
        "log.chatRequest",
        model.id,
        messages.length,
        prompt.length,
        catalog.entries.length,
        catalog.callable.size,
        catalog.m365Count,
        catalog.editorCount,
      ) +
        (catalog.omitted.length > 0 ? t("log.chatRequestOmitted", catalog.omitted.join(", ")) : ""),
    );
    if (!prompt.trim()) {
      log(t("log.emptyPrompt"));
      return;
    }

    const controller = new AbortController();
    const markdown = new MarkdownStreamFormatter();
    const emitMarkdown = (text: string) => {
      const formatted = markdown.push(text);
      if (formatted) {
        debug(scope, `→ text part to VS Code (${formatted.length} chars)`);
        progress.report(new vscode.LanguageModelTextPart(formatted));
      }
    };
    const cancelListener = token.onCancellationRequested(() => controller.abort());
    const sources: WebSource[] = [];
    const toolsOffered = catalog.callable.size > 0;
    // What could not be attached is said once, before the answer.
    const skippedImages = new Set<string>();
    const onImageSkipped = (reason: string) => {
      if (skippedImages.has(reason)) return;
      skippedImages.add(reason);
      progress.report(new vscode.LanguageModelTextPart(t("provider.imageSkipped", reason)));
    };

    let emitted = false;
    /**
     * One BizChat turn. With tools offered, the start of the reply is held back
     * (giveUp.ts) until it is long or reaches its tool call, so that a reply
     * that gives up — or works in M365's own sandbox — can be retried before the
     * user sees it.
     */
    const attempt = async (turnPrompt: string, hold: boolean) => {
      // Ends the BizChat turn as soon as the tool call is complete: the decoder
      // ignores whatever the model writes after it (often invented results, for
      // minutes), and VS Code only runs the tool once the turn is over.
      const finishTurn = new AbortController();
      const held = new ProseHold(emitMarkdown);
      if (!hold) held.flush();
      let prose = "";
      let called = false;
      let remoteWork = false;
      const toolDecoder = new ToolCallDecoder(
        catalog.callable,
        (text) => {
          prose += text;
          held.push(text);
        },
        (toolCall) => {
          called = true;
          held.flush();
          log(t("log.toolCallRequested", toolCall.name));
          debug(scope, `→ tool call to VS Code: ${toolCall.name}`, toolCall.input);
          progress.report(
            new vscode.LanguageModelToolCallPart(randomUUID(), toolCall.name, toolCall.input),
          );
          finishTurn.abort();
        },
        catalog.fenced,
      );
      const run = (mode: TurnMode) => {
        debug(scope, `starting the BizChat turn in "${mode}" mode`);
        return streamCopilotTurnWithRetry({
          profile,
          prompt: turnPrompt,
          tone: selected?.tone ?? null,
          mode,
          signal: controller.signal,
          stopSignal: finishTurn.signal,
          images,
          log,
          callbacks: {
            onText: (delta) => {
              if (delta) emitted = true;
              toolDecoder.push(delta);
            },
            onSources: (found) => sources.push(...found),
            onRemoteWork: () => (remoteWork = true),
            onImageSkipped,
          },
        });
      };
      try {
        try {
          await run(webTurn ? "web" : "tools");
        } catch (error) {
          // The web app's invocation is captured, not designed for us: if
          // BizChat turns it down, answer the plain way instead of failing.
          const retryable =
            webTurn && !emitted && !token.isCancellationRequested && isTurnRefusal(error);
          if (!retryable) throw error;
          log(t("log.webFallback", error instanceof Error ? error.message : String(error)));
          debug(
            scope,
            'the web invocation was turned down; falling back to the lean "tools" invocation',
            error,
          );
          await run("tools");
        }
      } catch (error) {
        // A reply that fails half-way still shows what had arrived.
        held.flush();
        throw error;
      }
      toolDecoder.finish();
      return { held, prose, called, remoteWork };
    };

    try {
      let turn = await firstAttempt();
      // No tool call although tools were offered, and the reply gave up, worked
      // in M365's own sandbox or claims changes nothing could have made: once
      // more, with a note that says what is true. What it wrote is dropped
      // unseen (it was still held back).
      const toolsRan = messages.some((message) =>
        message.content.some((part) => part instanceof vscode.LanguageModelToolResultPart),
    /**
     * The first try, with a shorter message if the service refuses this one
     * before answering: only a tenant's real limit tells how long is too long.
     * A shorter one that gets through also clears the "not available" flag that
     * the refusal may have put on a forced model.
     */
    const firstAttempt = async () => {
      try {
        return await attempt(prompt, toolsOffered);
      } catch (error) {
        if (emitted || token.isCancellationRequested || !isTurnRefusal(error)) throw error;
        const shorter = flatten(TRANSCRIPT_LIMITS);
        if (shorter.length >= prompt.length) throw error;
        debug(scope, `refused with ${prompt.length} chars; trying ${shorter.length}`, error);
        const turn = await attempt(shorter, toolsOffered);
        log(t("log.promptShortened", prompt.length, shorter.length));
        prompt = shorter;
        this.shortPromptsOnly = true;
        return turn;
      }
    };

      );
      const problem =
        toolsOffered && !turn.called && turn.held.holding
          ? toolFreeProblem(turn.prose, turn.remoteWork, toolsRan)
          : null;
      if (problem) {
        const dropped = turn.held.discard();
        log(t("log.forcedRetry", problem));
        debug(scope, `no tool call and the reply looks like "${problem}": retrying once`, dropped);
        turn = await attempt(`${prompt}\n\n${t(FORCE_NOTE_KEYS[problem])}`, false);
      }
      turn.held.flush();
      // Still in its sandbox: say plainly that nothing happened here.
      if (toolsOffered && !turn.called && (turn.remoteWork || looksLikeRemoteSandbox(turn.prose))) {
        emitMarkdown(t("turn.remoteSandbox"));
      }
      const formatted = markdown.finish();
      if (formatted) progress.report(new vscode.LanguageModelTextPart(formatted));
      const cited = sourcesMarkdown(sources);
      if (cited) progress.report(new vscode.LanguageModelTextPart(cited));
      debug(scope, `request finished in ${Date.now() - started} ms`, () => ({
        calledTool: turn.called,
        forcedRetry: problem,
        images: images.length,
        sources: sources.map((source) => source.url),
      }));
    } catch (error) {
      debug(scope, `request ended with an error after ${Date.now() - started} ms`, error);
      if (error instanceof CopilotClientError && error.message === "__CANCELLED__") {
        return; // user cancelled — swallow quietly
      }
      if (token.isCancellationRequested) return;
      // The server rejected the token mid-flight (even though its `exp` had not
      // passed); refresh the picker so its warning state reflects that the token
      // needs re-capturing.
      if (error instanceof CopilotAuthError) this.changeEmitter.fire();
      // A model that did not ship with this version (catalog, detected or
      // custom) may simply not exist in this tenant: say so instead of
      // leaving a bare "rejected the request". (A model the service refused
      // already says all that.)
      if (
        error instanceof CopilotClientError &&
        !(error instanceof CopilotAuthError) &&
        !(error instanceof CopilotModelUnavailableError) &&
        !isAccountLevelError(error) &&
        selected &&
        selected.source !== "builtin"
      ) {
        throw userError(`${error.message}${t("models.rejectedHint", selected.name)}`);
      }
      throw userError(error);
    } finally {
      cancelListener.dispose();
    }
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Thenable<number> {
    const raw =
      typeof text === "string"
        ? text
        : text.content
            .map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : JSON.stringify(p)))
            .join("");
    const tokens = Math.ceil(raw.length / CHARS_PER_TOKEN);
    debug(
      "chat",
      `token count asked for ${raw.length} chars → ${tokens} (estimate: ${CHARS_PER_TOKEN} chars per token)`,
    );
    return Promise.resolve(tokens);
  }

  dispose(): void {
    this.storeListener.dispose();
    this.changeEmitter.dispose();
  }
}

/**
 * Copilot Chat shows a provider's error as "Reason: <message>: <stack>" (VS Code's
 * verbose toErrorMessage), so the stack is dropped: it is in the deep trace already.
 */
function userError(error: unknown): Error {
  const shown = error instanceof Error ? error : new Error(String(error));
  shown.stack = "";
  return shown;
}

/** What a chat request carries, for the deep trace: roles and part sizes (the flattened prompt is logged whole separately). */
function describeMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): unknown[] {
  return messages.map((message, index) => ({
    index,
    role: vscode.LanguageModelChatMessageRole[message.role] ?? message.role,
    name: message.name,
    parts: message.content.map(describePart),
  }));
}

function describePart(part: unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return `text(${part.value.length} chars)`;
  if (part instanceof vscode.LanguageModelToolCallPart)
    return `toolCall(${part.name}, ${part.callId})`;
  if (part instanceof vscode.LanguageModelToolResultPart)
    return `toolResult(${part.callId}, ${part.content.length} parts)`;
  return part && typeof part === "object" ? (part.constructor?.name ?? "object") : typeof part;
}

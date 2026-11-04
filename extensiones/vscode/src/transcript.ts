/**
 * How a chat transcript becomes the single prompt BizChat takes per turn
 * (see `flattenMessages` in messages.ts), squeezed so that the model keeps
 * the most context per character:
 *
 *  - the request being worked on is PINNED: in agent mode every step adds a
 *    tool result, and before, once a few big ones filled the budget, the
 *    user's own request was the first thing dropped — the model went on
 *    working without knowing what for;
 *  - only the latest tool results travel whole; older ones shrink to their
 *    start (the model can call the tool again), and an older result repeated
 *    word for word later on becomes a one-line pointer;
 *  - messages that only carry tool results are labelled as such, not as if
 *    the user had written them;
 *  - when something still has to go, it is the oldest turns, with a note
 *    where they were.
 *
 * Kept free of the `vscode` import so test/e2e.mts can check it.
 */
import {
  CopilotAuthError,
  CopilotClientError,
  isAccountLevelError,
} from "@m365copilot/core/bizchat";
import { t } from "./i18n";
import { retrievalQuery } from "./rag/text";

export type TranscriptPart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "toolCall";
      readonly name: string;
      readonly input: string;
      /** The call as the model is asked to write it: seeing it so, it keeps writing it so. */
      readonly block?: string;
    }
  | { readonly kind: "toolResult"; readonly name: string; readonly text: string };

export interface TranscriptMessage {
  readonly role: "user" | "assistant";
  readonly parts: readonly TranscriptPart[];
}

export interface TranscriptLimits {
  /** Everything but the pinned request. */
  readonly maxContextChars: number;
  readonly maxMessageChars: number;
  /** The pinned request (or the latest message) gets more room. */
  readonly maxRequestChars: number;
  /** The latest {@link fullToolResults} results… */
  readonly maxToolResultChars: number;
  readonly fullToolResults: number;
  /** …and every older one. */
  readonly maxOldToolResultChars: number;
  readonly maxToolCallInputChars: number;
}

/** The smallest budget, and the one to fall back on when the service refuses a longer message. */
export const TRANSCRIPT_LIMITS: TranscriptLimits = {
  maxContextChars: 48_000,
  maxMessageChars: 12_000,
  maxRequestChars: 24_000,
  maxToolResultChars: 12_000,
  fullToolResults: 2,
  maxOldToolResultChars: 1_500,
  maxToolCallInputChars: 4_000,
};

/** Rough token estimate; BizChat exposes no tokenizer. */
export const CHARS_PER_TOKEN = 3.5;

/**
 * The most the context takes, whatever `m365copilot.models.maxInputTokens` says.
 * Measured against the real service in November 2026, on a personal account: a
 * message of 1,000,000 characters reached the model whole and one of 1,200,000
 * was refused. With the longest request this one allows, the total stays at the
 * first (the limit may not be in characters, so no closer).
 */
const MAX_CONTEXT_CHARS = 750_000;

/**
 * The limits for the context size VS Code was told a model has, so that what it
 * sends also reaches the model. All of it counts as context: VS Code's budget
 * already includes the request, whose own room is hardly ever used. The other
 * limits are {@link TRANSCRIPT_LIMITS} grown in proportion, never below it.
 */
export function transcriptLimitsFor(maxInputTokens: number): TranscriptLimits {
  const base = TRANSCRIPT_LIMITS.maxContextChars + TRANSCRIPT_LIMITS.maxRequestChars;
  const wanted = Math.min(maxInputTokens * CHARS_PER_TOKEN, MAX_CONTEXT_CHARS);
  if (wanted <= base) return TRANSCRIPT_LIMITS;
  const scale = wanted / base;
  const scaled = (chars: number) => Math.round(chars * scale);
  return {
    maxContextChars: wanted,
    maxMessageChars: scaled(TRANSCRIPT_LIMITS.maxMessageChars),
    maxRequestChars: scaled(TRANSCRIPT_LIMITS.maxRequestChars),
    maxToolResultChars: scaled(TRANSCRIPT_LIMITS.maxToolResultChars),
    fullToolResults: TRANSCRIPT_LIMITS.fullToolResults,
    maxOldToolResultChars: scaled(TRANSCRIPT_LIMITS.maxOldToolResultChars),
    maxToolCallInputChars: scaled(TRANSCRIPT_LIMITS.maxToolCallInputChars),
  };
}

/**
 * The service turned a turn down for a reason a different turn could avoid —
 * not the token, the account's limits or the user cancelling. BizChat has no
 * error for a message that is too long: it answers `InternalError`, which with a
 * model forced reads as "model not available", so that one counts too.
 */
export function isTurnRefusal(error: unknown): boolean {
  return (
    error instanceof CopilotClientError &&
    !(error instanceof CopilotAuthError) &&
    !isAccountLevelError(error) &&
    error.message !== "__CANCELLED__"
  );
}

/** A request shorter than this is a follow-up ("now the other one"): the previous one says what it is about. */
const SHORT_REQUEST_WORDS = 8;

export interface ResultLimits {
  readonly full: number;
  readonly maxChars: number;
  readonly maxOldChars: number;
}

export interface ResultBudget {
  /** How much of the result's text to keep. */
  readonly maxChars: number;
  /** The same tool returned the same text again later on. */
  readonly duplicate: boolean;
  readonly older: boolean;
}

/**
 * Room for each tool result, in transcript order: the newest `full` ones up
 * to `maxChars`, older ones up to `maxOldChars`, and an older exact repeat
 * of a later result (same tool, same text) marked `duplicate`.
 */
export function toolResultBudgets(
  results: readonly { readonly name: string; readonly text: string }[],
  limits: ResultLimits,
): ResultBudget[] {
  const seen = new Set<string>();
  const budgets: ResultBudget[] = [];
  for (let index = results.length - 1, rank = 0; index >= 0; index -= 1, rank += 1) {
    const result = results[index]!;
    const key = `${result.name}\0${result.text}`;
    const duplicate = seen.has(key);
    seen.add(key);
    const older = rank >= limits.full;
    budgets[index] = { maxChars: older ? limits.maxOldChars : limits.maxChars, duplicate, older };
  }
  return budgets;
}

/** The kept text of one tool result under its {@link ResultBudget}. */
export function condenseToolResult(text: string, budget: ResultBudget): string {
  if (budget.duplicate) return t("prompt.sameResultBelow");
  if (text.length <= budget.maxChars) return text;
  if (!budget.older) return trimForContext(text, budget.maxChars);
  return `${text.slice(0, budget.maxChars).trimEnd()}\n${t("prompt.olderResultShortened", text.length - budget.maxChars)}`;
}

/**
 * The transcript as one block of text: `User:` / `Assistant:` turns, tool
 * calls and results inline, squeezed as the module docs describe. A single
 * message is returned on its own; several get the "continue this
 * conversation" header and a trailing `Assistant:` cue.
 */
export function renderTranscript(
  messages: readonly TranscriptMessage[],
  limits: TranscriptLimits = TRANSCRIPT_LIMITS,
): string {
  const pinned = findLastIndex(
    messages,
    (message) => message.role === "user" && message.parts.some(isText),
  );
  const results = messages.flatMap((message) =>
    message.parts.filter(
      (part): part is Extract<TranscriptPart, { kind: "toolResult" }> => part.kind === "toolResult",
    ),
  );
  const budgets = toolResultBudgets(results, {
    full: limits.fullToolResults,
    maxChars: limits.maxToolResultChars,
    maxOldChars: limits.maxOldToolResultChars,
  });

  let resultIndex = 0;
  const blocks: { readonly index: number; readonly text: string }[] = [];
  for (const [index, message] of messages.entries()) {
    const lines = message.parts.map((part) => {
      if (part.kind === "text") return part.text;
      if (part.kind === "toolCall") {
        return part.block
          ? trimForContext(part.block, limits.maxToolCallInputChars)
          : t(
              "prompt.toolCall",
              part.name,
              trimForContext(part.input, limits.maxToolCallInputChars),
            );
      }
      const budget = budgets[resultIndex]!; // one budget per tool result, in order
      resultIndex += 1;
      return t("prompt.toolResult", part.name, condenseToolResult(part.text, budget));
    });
    const text = lines.join("\n").trim();
    if (!text) continue;
    const isRequest = index === pinned || index === messages.length - 1;
    const label =
      message.role === "assistant"
        ? "Assistant"
        : index === pinned && pinned < messages.length - 1
          ? t("prompt.role.request")
          : message.parts.every((part) => part.kind === "toolResult")
            ? t("prompt.role.toolResults")
            : "User";
    blocks.push({
      index,
      text: `${label}:\n${trimForContext(text, isRequest ? limits.maxRequestChars : limits.maxMessageChars)}`,
    });
  }
  if (blocks.length === 0) return "";
  if (messages.length === 1) return blocks[0]!.text;
  return `${t("prompt.continue")}\n\n${selectWithinBudget(blocks, pinned, limits.maxContextChars)}\n\nAssistant:`;
}

/**
 * Which blocks fit: the pinned request always; then what came after it
 * (the steps of the task at hand), newest first; then the older
 * conversation, newest first. A gap left by dropped blocks gets one note.
 */
function selectWithinBudget(
  blocks: readonly { readonly index: number; readonly text: string }[],
  pinned: number,
  maxChars: number,
): string {
  const kept = new Map<number, string>();
  const request = blocks.find((block) => block.index === pinned);
  if (request) kept.set(request.index, request.text);
  let remaining = maxChars;
  const after = blocks.filter((block) => block.index > pinned).reverse();
  const before = blocks.filter((block) => block.index < pinned).reverse();
  for (const block of [...after, ...before]) {
    if (remaining <= 0) break;
    if (block.text.length <= remaining) {
      kept.set(block.index, block.text);
      remaining -= block.text.length;
    } else {
      if (remaining >= 200) kept.set(block.index, trimForContext(block.text, remaining));
      remaining = 0;
    }
  }

  const out: string[] = [];
  for (const block of blocks) {
    const text = kept.get(block.index);
    if (text !== undefined) out.push(text);
    else if (out.at(-1) !== t("prompt.earlierOmitted")) out.push(t("prompt.earlierOmitted"));
  }
  return out.join("\n\n");
}

/**
 * What to look up in the project index: the latest request — and, when it
 * is a short follow-up ("now do the same in the other file") that names
 * nothing to search for, the previous one too. `requests` newest first.
 */
export function retrievalText(requests: readonly string[]): string {
  const [latest = "", previous = ""] = requests.slice(0, 2).map(retrievalQuery);
  if (!previous || latest.split(/\s+/).filter(Boolean).length >= SHORT_REQUEST_WORDS) return latest;
  return `${latest}\n${previous}`;
}

/** Head and tail of `value` within `maxChars`, with a note of what was cut in between. */
export function trimForContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars < 200) return value.slice(-maxChars);

  const headLength = Math.floor(maxChars * 0.65);
  const tailLength = maxChars - headLength - 72;
  const omitted = value.length - headLength - tailLength;
  return `${value.slice(0, headLength)}\n\n${t("prompt.charsOmitted", omitted)}\n\n${value.slice(-tailLength)}`;
}

function isText(part: TranscriptPart): boolean {
  return part.kind === "text" && part.text.trim() !== "";
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1)
    if (predicate(items[index]!)) return index;
  return -1;
}

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { describeProfile, foreignAudience, type CopilotProfile } from "./profile";
import { parseToneSelector, prettyTone } from "./modelCatalog";
import { RunawayRepetitionGuard } from "./repetitionGuard";
import { bizChatLocale, formatMoment, t } from "./i18n";
import { debug, redactUrl, truncate } from "./logger";
import { noteServed, noteThrottled, THROTTLE_HOLD_MS } from "./throttle";
import { NEAR_OUTPUT_LIMIT_CHARS } from "./toolProtocol";

/** SignalR frame terminator (record separator, U+001E). */
const RS = String.fromCharCode(0x1e);

const DEFAULT_ENDPOINT_HOST = "wss://substrate.office.com";
const DEFAULT_ENDPOINT_PATH = "/m365Copilot/Chathub";

/**
 * The `scenario` of the Chathub URL says which licence the turn uses, and that
 * decides which models serve: `OfficeWebIncludedCopilot` is Copilot Chat (what
 * every Microsoft 365 account has), `OfficeWebPaidCopilot` with
 * `licenseType=Premium` a Microsoft 365 Copilot licence — the only one where
 * Claude Opus 5.5, Claude Sonnet 5 / 5.5 and GPT-6 answer (see
 * `PAID_ONLY_TONES` in modelCatalog.ts). An entitlement, not a bypass: without
 * the licence the paid scenario is refused (`InvalidCopilotLicense`).
 * (github.com/cramt/m365-copilot-proxy, docs/m365-copilot-api.md §5.)
 */
const INCLUDED_SCENARIO = "OfficeWebIncludedCopilot";
const PAID_SCENARIO = "OfficeWebPaidCopilot";
const PAID_LICENSE_TYPE = "Premium";

/** The `scenario` and `licenseType` the web app used, from the endpoint the browser side captured. */
export function capturedScenario(
  endpoint: string | null | undefined,
): { scenario: string; licenseType?: string } | undefined {
  if (!endpoint) return undefined;
  try {
    const params = new URL(endpoint.replace(/^wss?:/, "https:")).searchParams;
    const scenario = params.get("scenario");
    if (!scenario) return undefined;
    const licenseType = params.get("licenseType");
    return licenseType ? { scenario, licenseType } : { scenario };
  } catch {
    return undefined;
  }
}

/**
 * Which licence the account has, as far as the web app showed it: `paid` when
 * it ran on the paid scenario, `included` on Copilot Chat's, `unknown` when no
 * endpoint was captured (a token pasted by hand).
 */
export type AccountTier = "paid" | "included" | "unknown";

export function accountTier(profile: Pick<CopilotProfile, "endpoint">): AccountTier {
  const captured = capturedScenario(profile.endpoint);
  if (!captured) return "unknown";
  if (/paid/i.test(captured.scenario) || /premium/i.test(captured.licenseType ?? "")) return "paid";
  return /included/i.test(captured.scenario) ? "included" : "unknown";
}

/**
 * The scenario for a turn. Only models that need it go on the paid one: the
 * same tone can be a metered model there (Claude Sonnet is Sonnet 5.5, 80 turns
 * a day; GPT-6.1 Sol spends its own allowance), so the rest stay where they are
 * free. A paid turn reuses the names the web app sent, if it was the paid one.
 */
function scenarioFor(
  profile: CopilotProfile,
  paid: boolean,
): { scenario: string; licenseType?: string } {
  if (!paid) return { scenario: INCLUDED_SCENARIO };
  const captured = capturedScenario(profile.endpoint);
  return captured && accountTier(profile) === "paid"
    ? { scenario: captured.scenario, licenseType: captured.licenseType ?? PAID_LICENSE_TYPE }
    : { scenario: PAID_SCENARIO, licenseType: PAID_LICENSE_TYPE };
}

/**
 * Where every turn connects instead of BizChat while the extension's own
 * integration tests run: set only through the TestingApi that `activate`
 * returns in `ExtensionMode.Test`, so they can answer from a local mock.
 */
let testEndpointBase: string | undefined;

export function setTestEndpointBase(base: string | undefined): void {
  testEndpointBase = base;
}

/**
 * Temporary chats: `disableMemory=1` on the Chathub URL. The turn keeps its
 * context while it runs, but leaves no thread in the user's Copilot history.
 * Every turn here is a conversation of its own — each agent step, each
 * ghost-text suggestion — so without it that history fills up with them.
 * `m365copilot.history.save` turns it off. (github.com/cramt/m365-copilot-proxy,
 * docs/hypotheses.md §16 F28/F29: context kept, thread absent from the sidebar.)
 */
let temporaryChat = true;

export function setTemporaryChat(on: boolean): void {
  temporaryChat = on;
}

/**
 * What the web app's "Stop generating" button sends, on the same socket: a
 * `stop` invocation with its own id. The server acks with a completion frame
 * and drops the half-written answer; closing the socket alone leaves it
 * generating (captured from m365.cloud.microsoft by cramt/m365-copilot-proxy).
 */
const STOP_FRAME =
  JSON.stringify({ arguments: [{}], invocationId: "1", target: "stop", type: 1 }) + RS;
/** How long to wait for that ack before closing anyway. */
const STOP_GRACE_MS = 2_000;

const HANDSHAKE_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 90_000;
/** Hard ceiling on a single turn, independent of activity — IDLE_TIMEOUT_MS
 * alone never fires if the server keeps sending *something*, even a model
 * stuck in a degenerate repetition loop (observed: 30+ minutes of the same
 * garbage frame repeating, never idle for more than a second at a time). */
const MAX_TURN_MS = 5 * 60_000;

export interface StreamCallbacks {
  /** Incremental assistant text. */
  onText: (delta: string) => void;
  /** Called once when the turn is fully complete. */
  onDone?: () => void;
  /** Web pages the answer cites (web turns, see {@link TurnMode}). */
  onSources?: (sources: readonly WebSource[]) => void;
  /**
   * The model ran something in M365's own cloud sandbox (`/mnt/data`,
   * `/home/claude`…) — not on this machine, whatever it says next. `detail` is
   * the command or the step, as the service named it.
   */
  onRemoteWork?: (detail: string) => void;
  /** An image could not be attached (unsupported, too big, upload refused); the turn goes on without it. */
  onImageSkipped?: (reason: string) => void;
}

/** An image for the turn: a screenshot pasted in the chat, sent the way the web app sends one. */
export interface TurnImage {
  readonly mimeType: string;
  readonly data: Uint8Array;
}

/** Images per turn, and bytes per image (the web app's own limits are not public). */
export const MAX_TURN_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_FILE_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

/** What BizChat's final item says about a turn it did not run: `result: { value, errorCode?, message? }`. */
export interface ServiceResult {
  readonly value: string;
  readonly errorCode?: string;
  readonly message?: string;
}

export interface WebSource {
  readonly title: string;
  readonly url: string;
}

/**
 * - `tools` (default): the lean invocation the text tool protocol was built
 *   on — no BizChat plugins, so no web search (see {@link buildInvocationArgs}).
 * - `web`: the invocation the M365 Copilot web app itself sent, as captured by
 *   the browser extension/userscript, with its plugins (web search) and
 *   endpoint `variants`. For turns that need the internet and no tools: the
 *   `m365_web_search` tool and chat requests without tools.
 */
export type TurnMode = "tools" | "web";

export class CopilotClientError extends Error {}

/**
 * Raised when the server rejects the WebSocket upgrade with an auth status
 * (HTTP 401/403). Distinct from a generic client error so the caller can refresh
 * the model picker's "token needs re-capturing" state.
 */
export class CopilotAuthError extends CopilotClientError {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** BizChat's own routing: the `tone` the web app sends for "Auto". */
export const AUTO_TONE = "magic";

/**
 * The service did not run the model (`tone`) that was asked for: it rejected
 * the turn, or answered with its canned "I can't help with that" reply instead
 * of the model — a message with `contentOrigin: "BotConnection"`, where a
 * real answer comes from the model pipeline. A tone the service knows is not
 * necessarily live for this account: new models roll out in phases, and the
 * Anthropic/OpenAI ones need the tenant admin to enable them. Not retried —
 * the same tone would fail again.
 */
export class CopilotModelUnavailableError extends CopilotClientError {
  readonly tone: string;
  readonly serverReply: string;
  constructor(tone: string, serverReply: string, message?: string) {
    super(
      message ?? t("client.error.modelUnavailable", prettyTone(tone), truncate(serverReply, 200)),
    );
    this.tone = tone;
    this.serverReply = serverReply;
  }
}

/**
 * A model that needs a Microsoft 365 Copilot licence (the paid scenario), on an
 * account the service says does not have one: the model is flagged like any
 * unavailable one, with that reason; the account's other models still work.
 */
export class CopilotPremiumRequiredError extends CopilotModelUnavailableError {
  constructor(tone: string, serverReply: string) {
    super(tone, serverReply, t("client.error.premiumRequired", prettyTone(tone)));
  }
}

/** " M365 Copilot said: “…”" after a message, when the service said something. */
function serverSaid(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  return text ? t("client.error.serverSaid", truncate(text, 300)) : "";
}

/**
 * M365 is throttling the account: the turn came back with `result.value:
 * "Throttled"` (`errorCode: "PerUserThrottled"`), or a completion error that
 * says so. Not retried — retrying only extends it — and recorded in
 * throttle.ts, so that automatic requests wait it out.
 */
export class CopilotThrottledError extends CopilotClientError {
  readonly errorCode: string;
  readonly serverMessage: string;
  /** When automatic requests may resume (epoch ms). */
  readonly until: number;
  constructor(errorCode: string, serverMessage: string, until: number) {
    super(t("client.error.throttled", formatMoment(until)));
    this.errorCode = errorCode;
    this.serverMessage = serverMessage;
    this.until = until;
  }
}

/** Which allowance a priority-access refusal is about. */
export type QuotaWindow = "day" | "week";

/**
 * A metered model's priority access is used up (`result.value: "OutOfCredits"`):
 * Claude Opus 5.5 has 40 turns a day and 75 a week, Claude Sonnet 5.5 80 a day,
 * one per turn whatever its size (cramt/m365-copilot-proxy, docs §24 F55, §26).
 * Every later turn on that model is refused until the reset, so it is not
 * retried and the model is flagged until then.
 */
export class CopilotQuotaExhaustedError extends CopilotClientError {
  readonly tone: string | null;
  readonly serverMessage: string;
  readonly window: QuotaWindow;
  /** When the allowance refills (epoch ms): midnight UTC, the weekly one on Monday. */
  readonly resetsAt: number;
  constructor(tone: string | null, serverMessage: string, window: QuotaWindow, resetsAt: number) {
    super(
      t(
        window === "week" ? "client.error.quotaWeek" : "client.error.quotaDay",
        tone ? prettyTone(tone) : "M365 Copilot",
        formatMoment(resetsAt),
      ),
    );
    this.tone = tone;
    this.serverMessage = serverMessage;
    this.window = window;
    this.resetsAt = resetsAt;
  }
}

/**
 * The service says the account has no valid licence for the request
 * (`errorCode: "InvalidCopilotLicense"`, "It looks like you don't have a valid
 * licence…"). About the account, not the model: nothing is flagged, nothing
 * retried.
 */
export class CopilotLicenseError extends CopilotClientError {
  readonly errorCode: string;
  readonly serverMessage: string;
  constructor(errorCode: string, serverMessage: string) {
    super(t("client.error.license"));
    this.errorCode = errorCode;
    this.serverMessage = serverMessage;
  }
}

/**
 * The service's safety filter declined to answer (a bot message with
 * `messageType: "Disengaged"` and no text). Raised as an error, not as text,
 * so that no feature takes the notice for the model's answer (an inline edit
 * would write it into the code). Not retried: the same request disengages again.
 */
export class CopilotDisengagedError extends CopilotClientError {
  constructor() {
    super(t("client.error.disengaged"));
  }
}

/** Errors about the account or the request as a whole: no retry, no fallback, no model to blame. */
export function isAccountLevelError(error: unknown): boolean {
  return (
    error instanceof CopilotThrottledError ||
    error instanceof CopilotQuotaExhaustedError ||
    error instanceof CopilotLicenseError ||
    error instanceof CopilotDisengagedError
  );
}

/** The weekly allowance names the week or Monday (in English or Spanish); otherwise it is today's. */
export function quotaWindowOf(text: string): QuotaWindow {
  return /\bweek|monday|semana|lunes/i.test(text) ? "week" : "day";
}

/** When an allowance refills: the next midnight UTC, or the next Monday at midnight UTC for the weekly one. */
export function quotaResetAt(window: QuotaWindow, now = Date.now()): number {
  const today = new Date(now);
  const days = window === "week" ? (8 - today.getUTCDay()) % 7 || 7 : 1;
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days);
}

/** A canned refusal that is about priority access (when the result does not say `OutOfCredits`). */
const PRIORITY_ACCESS_TEXT = /priority access|acceso prioritario/i;
/** A canned refusal about the licence ("It looks like you don't have a valid licence…"). */
const LICENCE_TEXT = /valid licen[cs]e|licencia válida/i;

/**
 * The specific error for a turn the service did not run, when its result says
 * why: throttled, priority access used up, no valid licence. Null for any other
 * result (the generic "rejected the request" handling applies).
 */
export function serviceResultError(
  result: ServiceResult,
  tone: string | null,
  now = Date.now(),
  paid = false,
): CopilotClientError | null {
  const message = result.message ?? "";
  if (result.value === "Throttled" || result.errorCode === "PerUserThrottled") {
    return new CopilotThrottledError(
      result.errorCode || result.value,
      message,
      now + THROTTLE_HOLD_MS,
    );
  }
  if (result.value === "OutOfCredits") {
    const window = quotaWindowOf(message);
    return new CopilotQuotaExhaustedError(tone, message, window, quotaResetAt(window, now));
  }
  if (result.errorCode === "InvalidCopilotLicense" || result.value === "InvalidCopilotLicense") {
    // On the paid scenario it is about the model the turn needed it for.
    if (paid && tone)
      return new CopilotPremiumRequiredError(tone, message || result.errorCode || result.value);
    return new CopilotLicenseError(result.errorCode || result.value, message);
  }
  return null;
}

/**
 * What the service said about a turn besides its text, for the deep-debug
 * trace: which back-end answered (`contentOrigin`), the classifier scores on the
 * bot's messages (`dea_violation` climbs before a Disengaged), the priority
 * access left (`throttling.metering`, only on the paid scenario), the
 * conversation's message counter, the final `result`, and any work the model did
 * in its own sandbox. Collecting it is a few property reads per frame.
 */
export class TurnSummary {
  readonly origins = new Set<string>();
  /** Highest score per classifier component. */
  readonly scores = new Map<string, number>();
  /** Priority access left per allowance (`remainingAllowance`). */
  readonly metering = new Map<string, number>();
  readonly remoteWork: string[] = [];
  offense: string | undefined;
  result: { value: string; errorCode?: string; serviceVersion?: string } | undefined;
  conversation: string | undefined;
  turnState: string | undefined;
  scenario = INCLUDED_SCENARIO;
  chars = 0;

  /** One `arguments[]` entry of an update, or a stream item. */
  observe(payload: Record<string, unknown>): void {
    const throttling = payload.throttling;
    if (throttling && typeof throttling === "object") {
      const record = throttling as Record<string, unknown>;
      const used = record.numUserMessagesInConversation;
      const max = record.maxNumUserMessagesInConversation;
      if (typeof used === "number" && typeof max === "number") this.conversation = `${used}/${max}`;
      const metering = record.metering;
      if (metering && typeof metering === "object") {
        for (const [key, value] of Object.entries(metering as Record<string, unknown>)) {
          const left =
            value && typeof value === "object"
              ? (value as { remainingAllowance?: unknown }).remainingAllowance
              : undefined;
          if (typeof left === "number") this.metering.set(key, left);
        }
      }
    }
    const result = payload.result;
    if (result && typeof result === "object") {
      const record = result as Record<string, unknown>;
      if (typeof record.value === "string") {
        this.result = {
          value: record.value,
          ...(typeof record.errorCode === "string" ? { errorCode: record.errorCode } : {}),
          ...(typeof record.serviceVersion === "string"
            ? { serviceVersion: record.serviceVersion }
            : {}),
        };
      }
    }
    if (typeof payload.turnState === "string") this.turnState = payload.turnState;
    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages) {
        if (message && typeof message === "object")
          this.observeMessage(message as Record<string, unknown>);
      }
    }
  }

  private observeMessage(message: Record<string, unknown>): void {
    if (message.author !== "bot") return;
    if (typeof message.contentOrigin === "string" && message.messageType === undefined)
      this.origins.add(message.contentOrigin);
    if (typeof message.offense === "string") this.offense = message.offense;
    if (typeof message.turnState === "string") this.turnState = message.turnState;
    if (!Array.isArray(message.scores)) return;
    for (const entry of message.scores) {
      if (!entry || typeof entry !== "object") continue;
      const { component, score } = entry as { component?: unknown; score?: unknown };
      if (typeof component !== "string" || typeof score !== "number") continue;
      this.scores.set(
        component,
        Math.max(score, this.scores.get(component) ?? Number.NEGATIVE_INFINITY),
      );
    }
  }

  /** The one line the trace shows at the end of the turn. */
  line(): string {
    const parts = [`origin=${[...this.origins].join("+") || "-"}`];
    for (const [component, score] of this.scores)
      parts.push(`${component}=${score.toExponential(1)}`);
    if (this.offense) parts.push(`offense=${this.offense}`);
    parts.push(
      `result=${this.result ? [this.result.value, this.result.errorCode].filter(Boolean).join("/") : "-"}`,
    );
    if (this.metering.size > 0) {
      parts.push(
        `metering: ${[...this.metering].map(([key, left]) => `${key}=${left}`).join(", ")}`,
      );
    }
    if (this.conversation) parts.push(`messages=${this.conversation}`);
    parts.push(`scenario=${this.scenario}`, `chars=${this.chars}`);
    if (this.chars >= NEAR_OUTPUT_LIMIT_CHARS) parts.push("near the ~12k-char output limit");
    if (this.remoteWork.length > 0) parts.push(`remote sandbox: ${this.remoteWork.length} step(s)`);
    return parts.join(" · ");
  }

  toJSON(): Record<string, unknown> {
    return {
      contentOrigins: [...this.origins],
      scores: Object.fromEntries(this.scores),
      offense: this.offense ?? null,
      result: this.result ?? null,
      metering: Object.fromEntries(this.metering),
      messagesInConversation: this.conversation ?? null,
      turnState: this.turnState ?? null,
      scenario: this.scenario,
      charsEmitted: this.chars,
      nearOutputLimit: this.chars >= NEAR_OUTPUT_LIMIT_CHARS,
      remoteSandbox: this.remoteWork,
    };
  }
}

/**
 * A `Progress` message about work the model did in M365's own cloud sandbox:
 * "Coding and executing" (`contentType: "Code"`, the command in `hiddenText`) or
 * a file it made there (`contentOrigin: "CreateFileExecutor"`). GPT-6 Sol and
 * Claude Sonnet 5 do it on their own (cramt/m365-copilot-proxy, §5).
 */
function remoteWorkOf(message: Record<string, unknown>): string | null {
  const origin = message.contentOrigin;
  if (message.contentType !== "Code" && origin !== "CreateFileExecutor") return null;
  const detail = [message.hiddenText, message.text].find(
    (value) => typeof value === "string" && value.trim(),
  );
  return typeof detail === "string" ? truncate(detail.trim(), 300) : String(origin ?? "Code");
}

/**
 * Told whether each forced `tone` worked: the model registry flags the ones that
 * do not — until `until` (epoch ms) when the service said when they come back.
 */
export type ModelOutcomeListener = (
  tone: string,
  available: boolean,
  reason?: string,
  until?: number,
) => void;
let modelOutcomeListener: ModelOutcomeListener | undefined;

/** Set (or clear, with undefined) the one listener for model outcomes. */
export function onModelOutcome(listener: ModelOutcomeListener | undefined): void {
  modelOutcomeListener = listener;
}

/** A rejection that says nothing about the model: retry later instead of flagging it. */
const TRANSIENT_REJECTION = /thrott|rate.?limit|too many|capacity|busy|timeout|try again|429|503/i;

/** Map a rejected WS upgrade status to an accurate, actionable client error. */
function describeUpgradeFailure(
  status: number,
  statusMessage: string,
  token: string,
): CopilotClientError {
  // A token for another service (pasted by hand) explains the rejection better
  // than "expired": the fix is copying the right one, not re-capturing.
  const audience = status === 401 || status === 403 ? foreignAudience(token) : null;
  if (audience) return new CopilotAuthError(t("client.error.foreignAudience", audience), status);
  if (status === 401) return new CopilotAuthError(t("client.error.401"), status);
  if (status === 403) return new CopilotAuthError(t("client.error.403"), status);
  if (status === 429) return new CopilotClientError(t("client.error.429"));
  return new CopilotClientError(
    t("client.error.upgrade", `${status}${statusMessage ? ` ${statusMessage}` : ""}`),
  );
}

/**
 * A single Copilot turn over the BizChat/Sydney WebSocket. We open one socket
 * per turn (mirroring the web app), replay the captured invocation frame with
 * the user's prompt and chosen `tone`, then stream the reply.
 */
/** Conversation and routing affinity shared by the turns of one agent loop. */
export interface CopilotConversation {
  conversationId: string;
  sessionKey: string;
  isStartOfSession: boolean;
}

export function createCopilotConversation(): CopilotConversation {
  return { conversationId: randomUUID(), sessionKey: randomUUID(), isStartOfSession: true };
}

export async function streamCopilotTurn(options: {
  profile: CopilotProfile;
  prompt: string;
  /** `tone` override, or null to reuse the captured template's tone. */
  tone: string | null;
  callbacks: StreamCallbacks;
  signal: AbortSignal;
  /** Optional diagnostics sink; defaults to a no-op (keeps the client pure). */
  log?: (message: string) => void;
  /**
   * Host + path to connect to, overriding {@link DEFAULT_ENDPOINT_HOST}. Exists
   * so the tests can point a turn at a local mock BizChat server; production
   * never sets it.
   */
  endpointBase?: string;
  /** Omit for an independent turn; agent loops keep this object across steps. */
  conversation?: CopilotConversation;
  /** See {@link TurnMode}. */
  mode?: TurnMode;
  /** Images to attach (uploaded first, like the web app does with a pasted one). */
  images?: readonly TurnImage[];
  /**
   * Ends the turn early, successfully, when aborted: the server is told to stop
   * (the stop frame) and the turn resolves with what arrived. For a tool call
   * that is already complete — whatever the model writes after it is ignored,
   * and can run for minutes. `signal`, by contrast, cancels.
   */
  stopSignal?: AbortSignal;
}): Promise<void> {
  const { profile, prompt, tone, callbacks, signal } = options;
  const log = options.log ?? (() => {});
  const mode = options.mode ?? "tools";
  // `tone` may name the paid scenario (`Claude_Sonnet@paid`); BizChat gets the bare tone.
  const selector = tone ? parseToneSelector(tone) : null;
  const wireTone = selector?.tone ?? null;
  const scenario = scenarioFor(profile, selector?.paid ?? false);

  // The URL and invocation must agree; routing affinity must also survive
  // reconnects so subsequent turns reach the same regional conversation.
  const conversation = options.conversation ?? createCopilotConversation();
  const { conversationId, sessionKey, isStartOfSession } = conversation;
  const base =
    options.endpointBase ?? testEndpointBase ?? `${DEFAULT_ENDPOINT_HOST}${DEFAULT_ENDPOINT_PATH}`;
  const url = buildEndpoint(profile, conversationId, base, mode, scenario);
  const invocationId = "0";
  const invocationType = profile.invocationType || 4;

  log(t("log.newTurn"));
  log(`endpoint: ${redactUrl(url)}`);
  log(
    `invocationType=${invocationType}, tone=${wireTone ?? AUTO_TONE}, scenario=${scenario.scenario}, mode=${mode}`,
  );
  log(`origin=${profile.origin}`);

  // Deep-debug trace of this turn: one scope per turn, so interleaved turns
  // (sub-agents run in parallel) can be told apart in the log.
  const scope = `ws#${conversationId.slice(0, 8)}`;
  const startedAt = Date.now();
  const since = () => `+${Date.now() - startedAt}ms`;
  let framesIn = 0;
  let charsIn = 0;
  let firstTextAt: number | undefined;
  debug(
    scope,
    `turn start (mode=${mode}, tone=${wireTone ?? AUTO_TONE}, scenario=${scenario.scenario})`,
    () => ({
      mode,
      tone: wireTone ?? `${AUTO_TONE} (auto)`,
      scenario,
      images: options.images?.length ?? 0,
      invocationType,
      conversationId,
      promptChars: prompt.length,
      endpoint: redactUrl(url),
      timeoutsMs: { handshake: HANDSHAKE_TIMEOUT_MS, idle: IDLE_TIMEOUT_MS, turn: MAX_TURN_MS },
      profile: describeProfile(profile),
    }),
  );

  // Pasted images go up first, tied to this conversation; the chat message
  // then points at them. One that fails is left out, not the whole turn.
  const annotations = await uploadImages({
    images: options.images ?? [],
    uploadUrl: uploadUrlFor(base),
    profile,
    conversationId,
    scenario: scenario.scenario,
    signal,
    scope,
    onSkipped: (reason) => {
      log(t("log.imageSkipped", reason));
      callbacks.onImageSkipped?.(reason);
    },
  });
  if (signal.aborted) throw new CopilotClientError("__CANCELLED__");

  const summary = new TurnSummary();
  summary.scenario = scenario.scenario;

  const ws = new WebSocket(url, {
    headers: {
      Origin: profile.origin,
      "User-Agent": profile.userAgent,
      "X-RoutingParameter-SessionKey": sessionKey,
    },
    // Sydney refuses connections without a browser-like handshake; ws lets
    // us set the headers Node's native WebSocket cannot.
    followRedirects: true,
  });
  debug(scope, "WebSocket created, upgrading", () => ({
    url: redactUrl(url),
    requestHeaders: {
      Origin: profile.origin,
      "User-Agent": profile.userAgent,
      "X-RoutingParameter-SessionKey": sessionKey,
    },
    followRedirects: true,
  }));

  /** Every frame that leaves goes through here, so the trace shows exactly what was sent. */
  const send = (data: string, label: string, show = true) => {
    debug(
      scope,
      `→ ${label} (${data.length} chars) ${since()}`,
      show ? data.replaceAll(RS, "␞") : undefined,
    );
    ws.send(data);
  };

  let settled = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let handshakeDone = false;
  /** The server sent its final frame (stream item, completion or close): nothing left to stop. */
  let serverEnded = false;
  /** We sent the stop frame and are waiting for the server's ack to close. */
  let stopSent = false;
  let stopTimer: NodeJS.Timeout | undefined;

  // Streaming reassembly. BizChat can split ONE answer across several bot
  // "messages" — observed: the prose before a tool-call marker and the
  // marker itself arrive as two separate message objects, each with its
  // own messageId — and mixes two delivery styles per message:
  //   - `writeAtCursor` deltas: always incremental, carry no messageId of
  //     their own — they extend whichever message was introduced most
  //     recently.
  //   - `messages` snapshots: report one message's FULL text so far, keyed
  //     by messageId — diffed against what we've already shown for THAT
  //     message so a re-snapshot of already-delta-streamed content doesn't
  //     double-emit.
  // Tracking this with a single turn-wide "have we seen a delta yet?" flag
  // (the old approach) silently drops the first snapshot chunk of every
  // message AFTER the first one — exactly the bug that truncated
  // `<m365_tool_call>` down to `365_tool_call>` when Claude split its
  // answer into two messages, leaking the tool call as visible text
  // instead of executing it. Track per messageId instead.
  const knownMessageText = new Map<string, string>();
  const NO_MESSAGE_ID = "__default__";
  let currentMessageId = NO_MESSAGE_ID;
  let totalEmittedChars = 0;

  const repetitionGuard = new RunawayRepetitionGuard();

  return new Promise<void>((resolve, reject) => {
    /**
     * `stopServer`: the turn ends on our side while the server may still be
     * generating (cancel, timeout, runaway, a tool call that is complete) — tell
     * it to stop, the way the web app's Stop button does, and close on its ack.
     * A turn the server finished itself just closes.
     */
    const cleanup = (stopServer: boolean) => {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(turnTimer);
      signal.removeEventListener("abort", onAbort);
      options.stopSignal?.removeEventListener("abort", onStop);
      try {
        if (stopServer && handshakeDone && !serverEnded && ws.readyState === WebSocket.OPEN) {
          stopSent = true;
          send(STOP_FRAME, "stop");
          log(t("log.stopSent"));
          stopTimer = setTimeout(() => ws.close(), STOP_GRACE_MS);
          return;
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (error.message !== "__CANCELLED__") log(t("log.turnFailed", error.message));
      else log(t("log.turnCancelled"));
      debug(
        scope,
        `turn ended: ${error.message === "__CANCELLED__" ? "cancelled" : "failed"} ${since()}`,
        () => ({
          error: error.message === "__CANCELLED__" ? "cancelled by the caller" : error,
          kind: error.constructor.name,
          framesReceived: framesIn,
          charsReceived: charsIn,
          charsEmitted: totalEmittedChars,
          wsReadyState: ws.readyState,
        }),
      );
      if (error instanceof CopilotModelUnavailableError)
        modelOutcomeListener?.(error.tone, false, error.serverReply);
      if (error instanceof CopilotQuotaExhaustedError && error.tone) {
        modelOutcomeListener?.(
          error.tone,
          false,
          error.serverMessage || error.message,
          error.resetsAt,
        );
      }
      if (error instanceof CopilotThrottledError) {
        log(t("log.throttled", error.errorCode, formatMoment(error.until)));
        noteThrottled();
      }
      summary.chars = totalEmittedChars;
      debug(scope, `turn summary: ${summary.line()}`, () => summary.toJSON());
      cleanup(!serverEnded);
      reject(error);
    };

    /**
     * The service turned the turn down. With a model forced and nothing shown
     * yet, that is the model not being available for this account — unless
     * the reason is plainly transient (throttling, capacity).
     */
    const rejected = (error: CopilotClientError, reason: string) => {
      // A completion or close frame whose error says the account is throttled.
      if (/^throttled\b/i.test(reason)) {
        fail(new CopilotThrottledError("Throttled", reason, Date.now() + THROTTLE_HOLD_MS));
        return;
      }
      debug(scope, "the service turned the turn down", () => ({
        reason,
        forcedTone: tone,
        charsEmittedSoFar: totalEmittedChars,
        looksTransient: TRANSIENT_REJECTION.test(reason),
      }));
      if (tone && totalEmittedChars === 0 && !TRANSIENT_REJECTION.test(reason)) {
        fail(new CopilotModelUnavailableError(tone, reason));
      } else {
        fail(error);
      }
    };

    // Hard ceiling, started once and never reset — catches a turn that
    // keeps receiving *something* (so IDLE_TIMEOUT_MS never fires) without
    // ever actually finishing.
    const turnTimer = setTimeout(() => {
      debug(scope, `turn timer fired (${MAX_TURN_MS} ms ceiling)`);
      fail(new CopilotClientError(t("client.error.turnTimeout")));
    }, MAX_TURN_MS);

    /** Every character the model emits passes through here — the one place
     * that can detect it's stuck in a degenerate repetition loop instead of
     * making real progress, regardless of whether that garbage would later
     * be recognized as prose or as part of a tool call. */
    const emit = (text: string) => {
      // The turn already ended (stopped early, or failed) while this frame
      // was being read: nothing more reaches the caller.
      if (settled) return;
      if (repetitionGuard.push(text)) {
        fail(new CopilotClientError(t("client.error.repetition")));
        return;
      }
      firstTextAt ??= Date.now();
      callbacks.onText(text);
    };

    /** `early`: the caller ended the turn (stopSignal) — the server is told to stop. */
    const succeed = (early = false) => {
      if (settled) return;
      settled = true;
      log(t("log.turnCompleted", totalEmittedChars));
      debug(scope, `turn ended: completed ${since()}`, () => ({
        framesReceived: framesIn,
        charsReceived: charsIn,
        charsEmitted: totalEmittedChars,
        timeToFirstTextMs: firstTextAt === undefined ? null : firstTextAt - startedAt,
        messages: knownMessageText.size,
      }));
      if (totalEmittedChars === 0) log(t("log.turnEmpty"));
      else {
        if (tone) modelOutcomeListener?.(tone, true);
        // An answer: whatever throttle there was has lifted.
        noteServed();
      }
      summary.chars = totalEmittedChars;
      debug(scope, `turn summary: ${summary.line()}`, () => summary.toJSON());
      cleanup(early);
      callbacks.onDone?.();
      resolve();
    };

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        debug(scope, `idle timer fired (no frame for ${IDLE_TIMEOUT_MS} ms)`);
        fail(new CopilotClientError(t("client.error.idle")));
      }, IDLE_TIMEOUT_MS);
    };

    const onAbort = () => {
      debug(scope, `abort signal received ${since()}`);
      fail(new CopilotClientError("__CANCELLED__"));
    };
    const onStop = () => {
      if (settled) return;
      debug(scope, `the caller ended the turn early (its tool call is complete) ${since()}`);
      log(t("log.turnStoppedEarly", totalEmittedChars));
      succeed(true);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (options.stopSignal?.aborted) {
      onStop();
      return;
    }
    options.stopSignal?.addEventListener("abort", onStop, { once: true });

    const handshakeTimer = setTimeout(() => {
      debug(scope, `handshake timer fired (no ack within ${HANDSHAKE_TIMEOUT_MS} ms)`);
      fail(new CopilotClientError(t("client.error.handshake")));
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on("open", () => {
      log(t("log.wsOpen"));
      debug(scope, `← socket open ${since()}`);
      // SignalR JSON handshake.
      send(JSON.stringify({ protocol: "json", version: 1 }) + RS, "SignalR handshake");
    });

    ws.on("upgrade", (res) => {
      debug(
        scope,
        `← upgrade ${res.statusCode ?? "?"} ${res.statusMessage ?? ""}`.trimEnd() + ` ${since()}`,
        () => ({
          headers: res.headers,
        }),
      );
    });
    ws.on("ping", (data: Buffer) => debug(scope, `← ws ping (${data.length} bytes) ${since()}`));
    ws.on("pong", (data: Buffer) => debug(scope, `← ws pong (${data.length} bytes) ${since()}`));

    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(handshakeTimer);
      const status = res.statusCode ?? 0;
      const statusMessage = res.statusMessage ?? "";
      log(t("log.unexpectedResponse", `${status} ${statusMessage}`.trimEnd()));
      debug(
        scope,
        `← upgrade refused: ${status} ${statusMessage}`.trimEnd() + ` ${since()}`,
        () => ({
          headers: res.headers,
        }),
      );

      // Azure AD / Substrate usually explain a 401/403 in a `WWW-Authenticate`
      // header and a JSON body (`error`, `error_description`, correlation id).
      // Log both — this is the difference between "recaptura y ya" and an
      // actual root cause (wrong audience, Conditional Access, expired token).
      for (const h of [
        "www-authenticate",
        "x-ms-diagnostics",
        "x-ms-request-id",
        "client-request-id",
      ]) {
        const v = res.headers[h];
        if (v) log(t("log.header", h, String(v)));
      }

      const bodyChunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(bodyChunks).toString("utf8").trim();
        if (body) log(t("log.body", truncate(body, 500)));
        debug(scope, `← upgrade refused: body (${body.length} chars)`, body);
        // A non-101 upgrade response means the socket will never open, so fail
        // now with an accurate message instead of waiting out the generic
        // handshake timeout — that 15 s stall misled users into thinking the
        // connection stalled when the token was actually rejected outright.
        fail(describeUpgradeFailure(status, statusMessage, profile.accessToken));
      });
    });

    ws.on("error", (err: Error) => {
      debug(scope, `socket error ${since()}`, err);
      clearTimeout(handshakeTimer);
      fail(new CopilotClientError(t("client.error.connection", err.message)));
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(handshakeTimer);
      if (stopTimer) clearTimeout(stopTimer);
      log(t("log.wsClosed", code, reason?.length ? `, ${reason.toString()}` : ""));
      debug(
        scope,
        `← socket closed: code ${code}${reason?.length ? `, reason "${reason.toString()}"` : ""} ${since()}`,
        () => ({
          settledBeforeClose: settled,
          framesReceived: framesIn,
          charsEmitted: totalEmittedChars,
        }),
      );
      if (!settled) {
        // A clean close after we have some text is a normal end for a few
        // rings; treat any accumulated content as a completed turn.
        if (totalEmittedChars > 0) succeed();
        else fail(new CopilotClientError(t("client.error.closed")));
      }
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      const text = raw.toString();
      for (const chunk of text.split(RS)) {
        if (!chunk) continue;
        framesIn++;
        charsIn += chunk.length;
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(chunk) as Record<string, unknown>;
        } catch {
          log(`<< (no-JSON) ${truncate(chunk, 300)}`);
          debug(scope, `← frame #${framesIn} NOT JSON (${chunk.length} chars) ${since()}`, chunk);
          continue;
        }
        debug(
          scope,
          `← frame #${framesIn} ${describeFrame(frame)} (${chunk.length} chars) ${since()}`,
          chunk,
        );
        if (frame.type === 2 || frame.type === 3 || frame.type === 7) serverEnded = true;

        // Our side already ended the turn. After a stop, the server's
        // completion is its ack: close the socket then.
        if (settled) {
          if (stopSent && (frame.type === 3 || frame.type === 7)) ws.close();
          continue;
        }

        // First non-empty frame after our handshake send is the server's
        // handshake ack: `{}` (or `{ error }`).
        if (!handshakeDone) {
          handshakeDone = true;
          clearTimeout(handshakeTimer);
          log(`<< handshake ack: ${truncate(chunk, 300)}`);
          if (frame.error) {
            fail(new CopilotClientError(t("client.error.handshakeRejected", String(frame.error))));
            return;
          }
          log(t("log.sendingInvocation"));
          sendInvocation(
            send,
            profile,
            prompt,
            wireTone,
            invocationType,
            invocationId,
            conversationId,
            log,
            mode,
            scope,
            annotations,
            isStartOfSession,
          );
          bumpIdle();
          // The `{}` ack frame carries no chat data; done with it.
          continue;
        }

        log(`<< ${truncate(chunk)}`);
        bumpIdle();
        handleFrame(frame, invocationId, mode, {
          emitText: (text, isDelta, messageId) => {
            if (isDelta) {
              // writeAtCursor: always incremental; extends whatever
              // message was introduced most recently.
              const known = knownMessageText.get(currentMessageId) ?? "";
              knownMessageText.set(currentMessageId, known + text);
              totalEmittedChars += text.length;
              if (text) emit(text);
              return;
            }

            const id = messageId ?? NO_MESSAGE_ID;
            currentMessageId = id;
            const known = knownMessageText.get(id);
            if (known === undefined) {
              // First time we see THIS message: it's new (even if other
              // messages earlier in the turn already streamed via
              // deltas) — emit its text in full, not just a suffix.
              knownMessageText.set(id, text);
              totalEmittedChars += text.length;
              if (text) emit(text);
              return;
            }
            if (text.startsWith(known)) {
              const add = text.slice(known.length);
              knownMessageText.set(id, text);
              totalEmittedChars += add.length;
              if (add) emit(add);
            } else {
              // Rare: the snapshot doesn't extend what we've already
              // shown for this message (edited/replaced mid-stream) —
              // best effort, surface the new text as-is.
              knownMessageText.set(id, text);
              totalEmittedChars += text.length;
              emit(text);
            }
          },
          onComplete: () => succeed(),
          onError: fail,
          onRejected: rejected,
          onServiceResult: (result) => {
            const known = serviceResultError(result, tone, Date.now(), selector?.paid ?? false);
            if (known) {
              debug(scope, `the service did not run the turn: ${known.constructor.name}`, result);
              fail(known);
              return;
            }
            const reply = `${result.value}${result.message ? `: ${result.message}` : ""}`;
            rejected(new CopilotClientError(t("client.error.rejected") + serverSaid(reply)), reply);
          },
          onDisengaged: () => {
            // The service ended the conversation itself: nothing to stop.
            serverEnded = true;
            log(t("log.disengaged"));
            fail(new CopilotDisengagedError());
          },
          onCannedReply: (text, messageId, emitText) => {
            // The service's own canned reply instead of the forced
            // model: that model did not run. With Auto, or after real
            // text, it is just part of the answer.
            debug(scope, "canned reply from the service (contentOrigin=BotConnection)", () => ({
              text,
              forcedTone: tone,
              treatedAsModelUnavailable: Boolean(tone) && totalEmittedChars === 0,
            }));
            if (tone && totalEmittedChars === 0 && PRIORITY_ACCESS_TEXT.test(text)) {
              // The priority-access refusal, when the result did not say OutOfCredits.
              const window = quotaWindowOf(text);
              fail(new CopilotQuotaExhaustedError(tone, text, window, quotaResetAt(window)));
            } else if (tone && totalEmittedChars === 0 && LICENCE_TEXT.test(text)) {
              // No licence for what the turn asked: the paid model, or the account.
              fail(
                selector?.paid
                  ? new CopilotPremiumRequiredError(tone, text)
                  : new CopilotLicenseError("InvalidCopilotLicense", text),
              );
            } else if (tone && totalEmittedChars === 0)
              fail(new CopilotModelUnavailableError(tone, text));
            else emitText(text, false, messageId);
          },
          respondPing: () => send(JSON.stringify({ type: 6 }) + RS, "SignalR ping reply"),
          onSources: (sources) => callbacks.onSources?.(sources),
          observe: (payload) => summary.observe(payload),
          onProgress: (message) => {
            const detail = remoteWorkOf(message);
            if (detail === null) return;
            summary.remoteWork.push(detail);
            log(t("log.remoteWork", detail));
            debug(scope, `the model is working in M365's own cloud sandbox: ${detail}`, message);
            callbacks.onRemoteWork?.(detail);
          },
        });
      }
    });
  });
}

interface FrameHandlers {
  /** `messageId` is present only for snapshot text (`isDelta === false`); deltas carry none. */
  emitText: (text: string, isDelta: boolean, messageId?: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  /** The service turned the turn down; `reason` is its own words. */
  onRejected: (error: CopilotClientError, reason: string) => void;
  /** The final item's `result` was not a success. */
  onServiceResult: (result: ServiceResult) => void;
  /** The safety filter declined to answer (`messageType: "Disengaged"`). */
  onDisengaged: () => void;
  /** A reply written by the service itself (`contentOrigin: "BotConnection"`), not by the model. */
  onCannedReply: (
    text: string,
    messageId: string | undefined,
    emitText: FrameHandlers["emitText"],
  ) => void;
  respondPing: () => void;
  onSources: (sources: readonly WebSource[]) => void;
  /** Every payload, for the turn's summary (scores, metering, result). */
  observe: (payload: Record<string, unknown>) => void;
  /** A bot `Progress` message (its own sandbox work shows up here). */
  onProgress: (message: Record<string, unknown>) => void;
}

const FRAME_TYPES: Record<number, string> = {
  1: "Invocation",
  2: "StreamItem",
  3: "Completion",
  4: "StreamInvocation",
  5: "CancelInvocation",
  6: "Ping",
  7: "Close",
};

/** One line saying what a SignalR frame is and carries, to head its dump in the deep trace. */
function describeFrame(frame: Record<string, unknown>): string {
  const parts = [
    typeof frame.type === "number"
      ? (FRAME_TYPES[frame.type] ?? `type ${frame.type}`)
      : "handshake",
  ];
  if (typeof frame.target === "string") parts.push(`target=${frame.target}`);
  if (frame.error) parts.push("ERROR");
  const args = Array.isArray(frame.arguments)
    ? (frame.arguments as unknown[])
    : frame.item !== undefined
      ? [frame.item]
      : [];
  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;
    const payload = arg as Record<string, unknown>;
    if (typeof payload.writeAtCursor === "string")
      parts.push(`delta ${payload.writeAtCursor.length} chars`);
    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages) {
        if (!message || typeof message !== "object") continue;
        const m = message as Record<string, unknown>;
        const size = typeof m.text === "string" ? ` ${m.text.length} chars` : "";
        parts.push(`message(${String(m.author ?? "?")}/${String(m.messageType ?? "text")}${size})`);
      }
    }
    const result = payload.result as { value?: unknown } | undefined;
    if (result && typeof result.value === "string") parts.push(`result=${result.value}`);
  }
  return parts.join(" ");
}

function handleFrame(
  frame: Record<string, unknown>,
  invocationId: string,
  mode: TurnMode,
  h: FrameHandlers,
): void {
  const type = frame.type;

  // Keepalive.
  if (type === 6) {
    h.respondPing();
    return;
  }
  // Close frame.
  if (type === 7) {
    if (frame.error) h.onRejected(new CopilotClientError(String(frame.error)), String(frame.error));
    else h.onComplete();
    return;
  }
  // Completion of our StreamInvocation.
  if (type === 3) {
    if (frame.invocationId === invocationId || frame.invocationId === undefined) {
      if (frame.error)
        h.onRejected(new CopilotClientError(String(frame.error)), String(frame.error));
      else h.onComplete();
    }
    return;
  }

  // Streaming payload: types 1 (Invocation "update") and 2 (StreamItem).
  const args = Array.isArray(frame.arguments)
    ? (frame.arguments as unknown[])
    : frame.item !== undefined
      ? [frame.item]
      : [];

  for (const arg of args) {
    if (!arg || typeof arg !== "object") continue;
    const payload = arg as Record<string, unknown>;
    h.observe(payload);

    // StreamInvocation result channel (type 2 item): `{ result: { value } }`.
    // Any non-success value means the service rejected/failed the request —
    // surface it instead of silently completing with no text.
    const result = payload.result as
      | { value?: unknown; errorCode?: unknown; message?: unknown }
      | undefined;
    if (result && typeof result.value === "string" && result.value !== "Success") {
      h.onServiceResult({
        value: result.value,
        ...(typeof result.errorCode === "string" && result.errorCode
          ? { errorCode: result.errorCode }
          : {}),
        ...(typeof result.message === "string" && result.message
          ? { message: result.message }
          : {}),
      });
      return;
    }

    // Incremental delta.
    if (typeof payload.writeAtCursor === "string") {
      h.emitText(payload.writeAtCursor, true);
    }

    // Full message snapshots.
    const messages = payload.messages;
    if (Array.isArray(messages)) {
      for (const m of messages) {
        const outcome = consumeBotMessage(m, mode, h);
        if (outcome === "end") {
          h.onComplete();
          return;
        }
        if (outcome === "filtered") {
          h.onDisengaged();
          return;
        }
      }
    }
  }
}

/** Returns 'text' when it emitted content, 'end'/'filtered' when the turn ends. */
function consumeBotMessage(
  m: unknown,
  mode: TurnMode,
  h: FrameHandlers,
): "text" | "end" | "filtered" | "skip" {
  if (!m || typeof m !== "object") return "skip";
  const msg = m as Record<string, unknown>;
  if (msg.author !== "bot") return "skip";

  const messageType = msg.messageType;

  // Content-filter / declined engagement.
  if (messageType === "Disengaged") return "filtered";
  if (messageType === "Progress") {
    h.onProgress(msg);
    return "skip";
  }

  const sources = sourcesOf(msg);
  if (sources.length > 0) h.onSources(sources);

  // End marker. A web turn sends its search cards (`RenderCardRequest`)
  // while the answer is still coming, so there only EndOfRequest ends it.
  if (messageType === "EndOfRequest" || (messageType === "RenderCardRequest" && mode === "tools"))
    return "end";

  // Control/meta frames (Progress, InternalSearchQuery, etc.) carry a
  // messageType and no user-facing prose — skip them.
  if (messageType !== undefined && messageType !== null) return "skip";

  if (typeof msg.text === "string" && msg.text) {
    const messageId = typeof msg.messageId === "string" ? msg.messageId : undefined;
    if (msg.contentOrigin === "BotConnection") h.onCannedReply(msg.text, messageId, h.emitText);
    else h.emitText(msg.text, false, messageId);
    return "text";
  }
  return "skip";
}

/**
 * The pages a bot message cites: `sourceAttributions` (BizChat's own field),
 * with a title and a URL each.
 */
export function sourcesOf(message: Record<string, unknown>): WebSource[] {
  const list = message.sourceAttributions;
  if (!Array.isArray(list)) return [];
  const sources: WebSource[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const url = [record.seeMoreUrl, record.url, record.link].find(
      (value) => typeof value === "string" && /^https?:\/\//.test(value),
    );
    if (typeof url !== "string") continue;
    const title = [record.providerDisplayName, record.title, record.name].find(
      (value) => typeof value === "string" && value.trim(),
    );
    sources.push({ url, title: typeof title === "string" ? title.trim() : url });
  }
  return sources;
}

function sendInvocation(
  send: (data: string, label: string, show?: boolean) => void,
  profile: CopilotProfile,
  prompt: string,
  tone: string | null,
  invocationType: number,
  invocationId: string,
  conversationId: string,
  log: (message: string) => void,
  mode: TurnMode,
  scope: string,
  annotations: readonly Record<string, unknown>[],
  isStartOfSession = true,
): void {
  // A web turn replays the web app's own invocation when the browser side
  // captured one; with a token pasted by hand, the lean one plus web search.
  const args =
    mode === "web"
      ? buildWebInvocationArgs(
          profile.invocationTemplate ?? syntheticWebTemplate(),
          prompt,
          tone,
          conversationId,
          annotations,
        )
      : buildInvocationArgs(prompt, tone, conversationId, annotations);

  args.isStartOfSession = isStartOfSession;

  const chatFrame = {
    arguments: [args],
    invocationId,
    target: "chat",
    type: invocationType,
  };

  // Metrics frame — several rings silently produce no output without it.
  const now = new Date();
  const metricsFrame = {
    arguments: [
      {
        Timestamps: {
          ConnectionStart: now.toISOString(),
          ConnectionEstablished: now.toISOString(),
          UserInputStart: now.toISOString(),
          UserInputSubmit: now.toISOString(),
        },
      },
    ],
    target: "Metrics",
    type: 1,
  };

  // Full frame (untruncated) so the temp-file dump captures exactly what we
  // sent — invaluable when a tenant returns InvalidRequest.
  log(t("log.chatFrame", JSON.stringify(chatFrame)));
  // The chat frame is already logged whole just above; the trace only notes
  // that it left, and shows the metrics frame (which carries nothing private).
  debug(scope, "metrics frame", metricsFrame);
  send(
    JSON.stringify(chatFrame) + RS + JSON.stringify(metricsFrame) + RS,
    "chat invocation + metrics",
    false,
  );
}

/**
 * Build the `arguments[0]` object for the `chat` invocation. We deliberately
 * do NOT replay the browser's captured `invocationTemplate` here, even when
 * one was captured: it carries the real web app's `plugins` (e.g.
 * `BingWebSearch`), its full `optionsSets` and a production `tone` — with
 * those in place BizChat treats the turn as a real Copilot web session with
 * its own native tool/plugin access, and the model has no reason to obey our
 * injected `<m365_tool_call>` instructions (see toolProtocol.ts) since it
 * "already" has real tools. The lean default below is what that text-based
 * protocol was actually built and tested against, so we always start from it
 * — a captured profile only ever contributes the access token now.
 */
function buildInvocationArgs(
  prompt: string,
  tone: string | null,
  conversationId: string,
  annotations: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  const base = defaultInvocationArgs();

  // Message text.
  const message = base.message as Record<string, unknown>;
  message.text = prompt;
  message.author = "user";
  if (annotations.length > 0) message.messageAnnotations = [...annotations];

  // Tone / model selection; defaultInvocationArgs() already set Auto.
  if (tone) base.tone = tone;

  // Fresh conversation each turn (see messages.ts for why). The id MUST match
  // the URL's `ConversationId` — a mismatch is rejected as InvalidRequest.
  base.conversationId = conversationId;
  base.isStartOfSession = true;

  return base;
}

/**
 * A web turn's `arguments[0]`: the M365 Copilot web app's own invocation (as
 * captured), with its plugins — web search — and options intact, but this
 * turn's text, a fresh conversation (no `previousMessages`), fresh request ids
 * and the extension's locale. `tone` is the model to use (null = Auto).
 */
export function buildWebInvocationArgs(
  template: Record<string, unknown>,
  prompt: string,
  tone: string | null,
  conversationId: string,
  annotations: readonly Record<string, unknown>[] = [],
): Record<string, unknown> {
  const args = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
  const captured =
    args.message && typeof args.message === "object"
      ? (args.message as Record<string, unknown>)
      : {};
  const message: Record<string, unknown> = {
    ...captured,
    author: "user",
    messageType: "Chat",
    text: prompt,
    locale: bizChatLocale(),
  };
  for (const key of ["requestId", "messageId"]) if (key in message) message[key] = randomUUID();
  if ("timestamp" in message) message.timestamp = new Date().toISOString();
  // What the web page attached to ITS message (files, cards…) is not ours.
  for (const key of [
    "attachments",
    "contextualInfo",
    "adaptiveCards",
    "imageUrl",
    "originalImageUrl",
    "messageAnnotations",
  ]) {
    delete message[key];
  }
  if (annotations.length > 0) message.messageAnnotations = [...annotations];
  args.message = message;
  for (const key of ["previousMessages", "conversationSignature", "gptId"]) delete args[key];
  if ("requestId" in args) args.requestId = randomUUID();
  if ("traceId" in args) args.traceId = randomUUID().replace(/-/g, "");
  // Auto is Auto here too: the captured template carries whichever model the
  // user last picked in the web app, not the one chosen in VS Code.
  args.tone = tone ?? AUTO_TONE;
  args.conversationId = conversationId;
  args.isStartOfSession = true;
  // So that a filtered web turn says so instead of arriving empty (see defaultInvocationArgs).
  if (Array.isArray(args.allowedMessageTypes) && !args.allowedMessageTypes.includes("Disengaged")) {
    args.allowedMessageTypes = [...(args.allowedMessageTypes as unknown[]), "Disengaged"];
  }
  return args;
}

/**
 * A web turn when the browser side captured no invocation (a token pasted by
 * hand): the lean one with the web app's search plugin, which is all web search
 * needs (cramt/m365-copilot-proxy, docs §4), and the message types its answer
 * comes with.
 */
export function syntheticWebTemplate(): Record<string, unknown> {
  const args = defaultInvocationArgs();
  args.plugins = [{ Id: "BingWebSearch", Source: "BuiltIn" }];
  const types = (args.allowedMessageTypes as string[]).filter((type) => type !== "EndOfRequest");
  args.allowedMessageTypes = [
    ...types,
    "InternalSearchQuery",
    "SearchQuery",
    "RenderCardRequest",
    "ReferencesListComplete",
    "EndOfRequest",
  ];
  return args;
}

function defaultInvocationArgs(): Record<string, unknown> {
  return {
    source: "officeweb",
    tone: AUTO_TONE,
    streamingMode: "ConciseWithPadding",
    isStartOfSession: true,
    // The server only sends the message types a client declares: without
    // `Disengaged` a filtered turn arrives as an empty one (cramt/m365-copilot-proxy).
    allowedMessageTypes: ["Chat", "Suggestion", "Progress", "Disengaged", "EndOfRequest"],
    clientInfo: { clientPlatform: "mcmcopilot-web", clientAppName: "Office" },
    message: { author: "user", messageType: "Chat", locale: bizChatLocale() },
  };
}

/**
 * `true` for a {@link CopilotClientError} worth retrying automatically: a
 * transient failure (rate limit, handshake/connection blip, a clean close
 * with no content) rather than something a retry can't fix. Deliberately NOT
 * pattern-matched against the exact message text (which drifts as the error
 * copy is tuned) — every non-auth, non-cancellation client error qualifies,
 * because the caller only retries when nothing has been shown to the user
 * yet, so a wasted retry costs latency, never a wrong/duplicate answer.
 */
export function isRetryableClientError(error: unknown): boolean {
  if (error instanceof CopilotAuthError) return false; // same bad token would fail again
  if (error instanceof CopilotModelUnavailableError) return false; // same tone would fail again
  if (isAccountLevelError(error)) return false; // throttled, out of quota, no licence, filtered: the same again
  if (!(error instanceof CopilotClientError)) return false;
  if (error.message === "__CANCELLED__") return false;
  return true;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps {@link streamCopilotTurn} with a single automatic retry for turns
 * that fail before emitting any text at all — nothing has reached the user
 * yet, so a retry is invisible except for latency. Once so much as one
 * character has streamed, a failure is surfaced as-is: silently restarting a
 * partially-shown answer would risk a duplicated/contradictory reply.
 */
export async function streamCopilotTurnWithRetry(
  options: Parameters<typeof streamCopilotTurn>[0] & { retryDelayMs?: number },
): Promise<void> {
  const conversation = options.conversation ?? createCopilotConversation();
  let emittedAny = false;
  const log = options.log ?? (() => {});
  const callbacks: StreamCallbacks = {
    ...options.callbacks,
    onText: (delta) => {
      if (delta) emittedAny = true;
      options.callbacks.onText(delta);
    },
  };

  try {
    await streamCopilotTurn({ ...options, conversation, callbacks });
  } catch (error) {
    if (emittedAny || options.signal.aborted || !isRetryableClientError(error)) throw error;
    log(t("log.retrying", error instanceof Error ? error.message : String(error)));
    debug(
      "ws",
      `retrying the turn once in ${options.retryDelayMs ?? 1200} ms (nothing had been shown yet)`,
      error,
    );
    await delay(options.retryDelayMs ?? 1200, options.signal);
    if (options.signal.aborted) throw error;
    await streamCopilotTurn({ ...options, conversation, callbacks });
  }
}

/**
 * Produce the wss URL to connect to. We always build this from the token's own
 * claims (`oid`/`tid`) instead of replaying the browser's captured `endpoint`,
 * even when one is available — its `variants` query string turns on the real
 * web app's feature set (native plugins, rich message types), which is the
 * same thing that breaks our text-based tool-call protocol (see
 * {@link buildInvocationArgs}). The default host/path below is what BizChat's
 * `officeweb` surface actually expects; if Microsoft ever rotates it (e.g.
 * `Chathub` → `ChatHubV2`) it needs to change here for everyone.
 */
function buildEndpoint(
  profile: CopilotProfile,
  conversationId: string,
  base: string,
  mode: TurnMode,
  scenario: { scenario: string; licenseType?: string },
): string {
  const sessionId = randomUUID();

  const oid = profile.claims?.oid ?? "";
  const tid = profile.claims?.tid ?? "";
  const params = new URLSearchParams({
    access_token: profile.accessToken,
    ConversationId: conversationId,
    chatsessionid: sessionId,
    clientrequestid: sessionId,
    "X-SessionId": sessionId,
    source: "officeweb",
    product: "Office",
    agentHost: "Bizchat.FullScreen",
    scenario: scenario.scenario,
  });
  if (scenario.licenseType) params.set("licenseType", scenario.licenseType);
  // A web turn carries the web app's feature flags too (see above): they are
  // what turns its plugins on.
  const variants = mode === "web" ? capturedVariants(profile.endpoint) : undefined;
  if (variants) params.set("variants", variants);
  if (temporaryChat) params.set("disableMemory", "1");
  return `${base}/${oid}@${tid}?${params.toString()}`;
}

/** `…/m365Copilot/Chathub` → `…/m365Copilot/UploadFile`, over https (http for a local mock). */
function uploadUrlFor(base: string): string {
  return `${base.replace(/^ws/i, "http").replace(/\/Chathub\/?$/i, "")}/UploadFile`;
}

/**
 * Upload the turn's images the way the web app uploads a pasted one: a form
 * POST to `UploadFile` with the chat token, tied to the conversation, which
 * answers with a `docId`; the chat message then carries an `ImageFile`
 * annotation per image (cramt/m365-copilot-proxy, docs §4, core/image-input.ts).
 * Returns the annotations of those that made it.
 */
async function uploadImages(options: {
  images: readonly TurnImage[];
  uploadUrl: string;
  profile: CopilotProfile;
  conversationId: string;
  scenario: string;
  signal: AbortSignal;
  scope: string;
  onSkipped: (reason: string) => void;
}): Promise<Record<string, unknown>[]> {
  const { images, profile, signal, scope } = options;
  const annotations: Record<string, unknown>[] = [];
  if (images.length > MAX_TURN_IMAGES)
    options.onSkipped(t("client.image.tooMany", images.length - MAX_TURN_IMAGES, MAX_TURN_IMAGES));
  for (const [index, image] of images.slice(-MAX_TURN_IMAGES).entries()) {
    if (signal.aborted) break;
    const mime =
      image.mimeType.toLowerCase() === "image/jpg" ? "image/jpeg" : image.mimeType.toLowerCase();
    const fileType = IMAGE_FILE_TYPES[mime];
    if (!fileType) {
      options.onSkipped(t("client.image.type", image.mimeType));
      continue;
    }
    if (image.data.byteLength > MAX_IMAGE_BYTES) {
      options.onSkipped(
        t(
          "client.image.tooBig",
          Math.ceil(image.data.byteLength / (1024 * 1024)),
          MAX_IMAGE_BYTES / (1024 * 1024),
        ),
      );
      continue;
    }
    const form = new URLSearchParams({
      scenario: "UploadImage",
      conversationId: options.conversationId,
      FileBase64: `data:${mime};base64,${Buffer.from(image.data).toString("base64")}`,
    });
    for (const set of ["cwcgptvsan", "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch"])
      form.append("optionsSets", set);
    const startedAt = Date.now();
    debug(
      scope,
      `→ UploadFile: image ${index + 1} (${mime}, ${image.data.byteLength} bytes)`,
      () => ({ url: options.uploadUrl }),
    );
    try {
      const response = await fetch(options.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${profile.accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Scenario": options.scenario,
          "X-Variants": "feature.EnableImageSupportInUploadFile",
          Origin: profile.origin,
          Referer: `${profile.origin.replace(/\/$/, "")}/`,
          "User-Agent": profile.userAgent,
        },
        body: form,
        signal,
      });
      const body = await response.text();
      debug(scope, `← UploadFile ${response.status} (${Date.now() - startedAt} ms)`, body);
      if (!response.ok) throw new Error(`UploadFile ${response.status}: ${truncate(body, 200)}`);
      let docId: unknown;
      try {
        docId = (JSON.parse(body) as { docId?: unknown }).docId;
      } catch {
        /* not JSON: reported below */
      }
      if (typeof docId !== "string" || !docId)
        throw new Error(`UploadFile: no docId (${truncate(body, 200)})`);
      annotations.push({
        id: docId,
        messageAnnotationType: "ImageFile",
        messageAnnotationMetadata: {
          "@type": "File",
          annotationType: "File",
          fileType,
          fileName: `image-${annotations.length + 1}.${fileType}`,
        },
      });
    } catch (error) {
      if (signal.aborted) break;
      options.onSkipped(
        t("client.image.upload", error instanceof Error ? error.message : String(error)),
      );
    }
  }
  return annotations;
}

/** The `variants` query parameter of the captured endpoint, if any. */
export function capturedVariants(endpoint: string | null | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint.replace(/^wss?:/, "https:")).searchParams.get("variants") || undefined;
  } catch {
    return undefined;
  }
}

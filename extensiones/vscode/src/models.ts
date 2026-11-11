import * as vscode from "vscode";
import {
  onModelOutcome,
  type AccountTier,
  BUILTIN_MODELS,
  fetchModelMenu,
  isPaidSelector,
  isTokenUsable,
  mergeModels,
  parseCustomModels,
  unannounced,
  type CatalogModel,
  type ModelEntry,
  debug,
} from "@m365copilot/core/bizchat";
import { boundedInteger } from "../tools/common";
import { formatMoment, getLocale, t } from "./i18n";
import type { ProfileStore } from "./secrets";

/**
 * M365 Copilot / BizChat selects a model through the `tone` field of the chat
 * invocation, not a model id. The "Auto" model sends no override and lets
 * BizChat route; the others force a tone. Which tones exist depends on the
 * account, so the list is its own model menu: see modelCatalog.ts for the
 * sources and {@link ModelRegistry} for how it is kept up to date.
 */
export type CopilotModel = CatalogModel;

/** Give activation room before going to the network. */
const FIRST_FETCH_DELAY_MS = 5_000;

const MENU_CACHE_KEY = "m365copilot.models.account";
/** Left by versions that took the list from models.json and the web app's chats. */
const RETIRED_KEYS = ["m365copilot.models.catalog", "m365copilot.models.observed"];
const ANNOUNCED_KEY = "m365copilot.models.announced";
const UNAVAILABLE_KEY = "m365copilot.models.unavailable";
/**
 * How long a model the service refused stays flagged. Not for ever: new
 * models reach a tenant in phases over days, and usage limits reset.
 */
const UNAVAILABLE_TTL_MS = 12 * 60 * 60_000;

/** A model (tone) the service refused for this account, and its words. */
export interface Unavailability {
  readonly at: number;
  readonly reason: string;
  /**
   * When it comes back, if the service said so (epoch ms): a used-up priority
   * access refills at midnight UTC. Otherwise the flag lasts UNAVAILABLE_TTL_MS.
   */
  readonly until?: number;
}

/** Whether a flag still holds at `now`. */
function stillUnavailable(entry: Unavailability, now: number): boolean {
  return entry.until !== undefined ? now < entry.until : now - entry.at < UNAVAILABLE_TTL_MS;
}

const DEFAULT_MAX_INPUT_TOKENS = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
const MIN_TOKEN_SETTING = 1_000;
const MAX_TOKEN_SETTING = 2_000_000;

let registry: ModelRegistry | undefined;

/** Every model offered right now (built-ins only until the registry starts). */
export function allModels(): readonly CopilotModel[] {
  return registry?.models ?? BUILTIN_MODELS;
}

export function findModel(id: string): CopilotModel | undefined {
  return allModels().find((model) => model.id === id);
}

/**
 * Tone for answers written straight into the editor — inline edits, the
 * lightbulb fix, the Source Control commit message (`m365copilot.editor.model`).
 */
export function editorTone(): string | null {
  const id = vscode.workspace
    .getConfiguration("m365copilot.editor")
    .get<string>("model", "m365-copilot-auto");
  return findModel(id)?.tone ?? null;
}

interface MenuCache {
  readonly entries: ModelEntry[];
  readonly fetchedAt: number;
}

/**
 * Keeps the model list up to date: loads the account's model menu (on start,
 * with every new token — it may be another account — and from "Update
 * models"; cached for offline use), reads the custom ones from settings, and
 * fires {@link onDidChange} when the merged list changes — the provider
 * re-announces it and the chat's model picker updates. New models are
 * announced once each.
 */
export class ModelRegistry implements vscode.Disposable {
  private current: CopilotModel[] = [...BUILTIN_MODELS];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private loading: Promise<string | undefined> | undefined;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly store: ProfileStore,
    private readonly log: (message: string) => void,
  ) {
    for (const key of RETIRED_KEYS)
      if (memento.get(key) !== undefined) void memento.update(key, undefined);
    this.disposables.push(
      store.onDidChange(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("m365copilot.models")) return;
        this.recompute();
        // Not part of the list recompute() compares, but VS Code shows and budgets by them.
        if (
          event.affectsConfiguration("m365copilot.models.maxInputTokens") ||
          event.affectsConfiguration("m365copilot.models.maxOutputTokens")
        ) {
          this.changed.fire();
        }
      }),
    );
    this.recompute(false);
    this.timer = setTimeout(() => void this.refresh(), FIRST_FETCH_DELAY_MS);
  }

  get models(): readonly CopilotModel[] {
    return this.current;
  }

  /**
   * Load the account's model menu now. Resolves with why it could not — the
   * last menu (or the built-ins) stays in use then — or undefined. Calls that
   * overlap share one load.
   */
  refresh(): Promise<string | undefined> {
    this.loading ??= this.loadMenu().finally(() => (this.loading = undefined));
    return this.loading;
  }

  private async loadMenu(): Promise<string | undefined> {
    const profile = await this.store.get();
    if (!profile || !isTokenUsable(profile)) return t("models.noToken");
    try {
      const entries = await fetchModelMenu({ profile });
      await this.memento.update(MENU_CACHE_KEY, {
        entries,
        fetchedAt: Date.now(),
      } satisfies MenuCache);
      this.log(t("log.modelsMenu", entries.length));
      this.recompute();
      return undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(t("log.modelsMenuFailed", reason));
      return reason;
    }
  }

  /** Whether the service recently refused this model for this account (Auto never is). */
  unavailability(tone: string | null): Unavailability | undefined {
    if (!tone) return undefined;
    const entry = this.memento.get<Record<string, Unavailability>>(UNAVAILABLE_KEY, {})[tone];
    return entry && stillUnavailable(entry, Date.now()) ? entry : undefined;
  }

  /**
   * Record what a turn with a forced model showed: it ran (clears the flag) or
   * the service refused it (flags it). The picker is refreshed when the flag
   * flips, so the model shows its warning — or loses it — right away.
   */
  async setAvailability(
    tone: string,
    available: boolean,
    reason = "",
    until?: number,
  ): Promise<void> {
    const wasFlagged = Boolean(this.unavailability(tone));
    const now = Date.now();
    const next = Object.fromEntries(
      Object.entries(this.memento.get<Record<string, Unavailability>>(UNAVAILABLE_KEY, {})).filter(
        ([key, entry]) => key !== tone && stillUnavailable(entry, now),
      ),
    );
    if (!available) {
      next[tone] = {
        at: now,
        reason: reason.replace(/\s+/g, " ").trim().slice(0, 200),
        ...(until !== undefined && until > now ? { until } : {}),
      };
    } else if (!wasFlagged) return;
    await this.memento.update(UNAVAILABLE_KEY, next);
    this.log(t(available ? "log.modelAvailable" : "log.modelUnavailable", tone, reason));
    if (wasFlagged !== !available) this.changed.fire();
  }

  private recompute(announce = true): void {
    const next = mergeModels({
      account: this.memento.get<MenuCache>(MENU_CACHE_KEY)?.entries ?? null,
      custom: parseCustomModels(
        vscode.workspace.getConfiguration("m365copilot.models").get<unknown>("custom", []),
      ),
    });
    const before = this.current.map((model) => `${model.id}|${model.name}|${model.tone}`).join(",");
    const after = next.map((model) => `${model.id}|${model.name}|${model.tone}`).join(",");
    this.current = next;
    debug(
      "models",
      `model list recomputed: ${next.length} models${before !== after ? " (changed)" : " (same as before)"}`,
      () => next.map((model) => ({ id: model.id, tone: model.tone, source: model.source })),
    );
    if (before !== after) this.changed.fire();
    if (announce) void this.announce(next);
  }

  /** One notification per model that appears for the first time (not on every start). */
  private async announce(models: readonly CopilotModel[]): Promise<void> {
    const known = new Set(this.memento.get<string[]>(ANNOUNCED_KEY, []));
    const fresh = unannounced(models, known);
    if (fresh.length === 0) return;
    for (const model of fresh) known.add(model.tone!);
    await this.memento.update(ANNOUNCED_KEY, [...known]);
    const names = fresh.map((model) => model.name.replace(/^M365 Copilot · /, "")).join(", ");
    const open = t("paste.openChat");
    const picked = await vscode.window.showInformationMessage(t("models.new", names), open);
    if (picked === open) await vscode.commands.executeCommand("workbench.action.chat.open");
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (registry === this) onModelOutcome(undefined);
    this.changed.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    if (registry === this) registry = undefined;
  }
}

/** Create the registry and make it the source of {@link allModels} / {@link findModel}. */
export function installModelRegistry(
  memento: vscode.Memento,
  store: ProfileStore,
  log: (message: string) => void,
): ModelRegistry {
  registry = new ModelRegistry(memento, store, log);
  // Every turn with a forced model, from any feature (chat, inline edit,
  // review, commit messages…), tells the registry whether that model ran.
  const current = registry;
  onModelOutcome(
    (tone, available, reason, until) =>
      void current.setAvailability(tone, available, reason, until),
  );
  return registry;
}

/** The registry, once installed: for the picker's "not available" flags. */
export function modelRegistry(): ModelRegistry | undefined {
  return registry;
}

/**
 * The context and reply size VS Code is told about, the same for every model.
 * It also sets how much of it reaches the model (transcriptLimitsFor, loopLimitsFor).
 */
export function tokenLimits(): { maxInputTokens: number; maxOutputTokens: number } {
  const config = vscode.workspace.getConfiguration("m365copilot.models");
  const limit = (key: string, fallback: number) =>
    boundedInteger(config.get<number>(key), fallback, MIN_TOKEN_SETTING, MAX_TOKEN_SETTING);
  return {
    maxInputTokens: limit("maxInputTokens", DEFAULT_MAX_INPUT_TOKENS),
    maxOutputTokens: limit("maxOutputTokens", DEFAULT_MAX_OUTPUT_TOKENS),
  };
}

/** The picker's one-line description of a model. */
export function modelDetail(model: CopilotModel): string {
  if (model.detailKey) return t(model.detailKey);
  const text = model.detail?.[getLocale()] ?? model.detail?.en;
  if (text) return text;
  return t(
    model.source === "custom" ? "models.source.custom" : "models.source.account",
    model.tone ?? "",
  );
}

/**
 * Extra fields Copilot Chat reads from a model's information that are not (yet)
 * on the stable `LanguageModelChatInformation` type. They live in the same
 * proposed-API bucket, so we attach them via a cast — exactly what the
 * minimax / deepseek BYOK providers do.
 *
 * - `isUserSelectable` — WITHOUT this the model is registered (and shows in
 *   "Manage Models") but Copilot Chat never offers it in the in-chat model
 *   picker. This is the field that makes the picker list our models.
 * - `isBYOK` — tokens are billed to the user's M365 plan, not Copilot's
 *   premium-request quota, so Copilot must not count the round-trip against
 *   its own budget.
 */
type PickerChatInformation = vscode.LanguageModelChatInformation & {
  readonly isUserSelectable: boolean;
  readonly isBYOK?: true;
  readonly statusIcon?: vscode.ThemeIcon;
};

/** Whether the stored token can be used right now — drives the picker's warning state. */
export type TokenState = "ok" | "missing" | "expired";

/**
 * Build the model information VS Code renders in the picker. A model the
 * service recently refused stays selectable — it may have arrived since — but
 * says so, with the service's reason in the tooltip.
 */
export function toChatInformation(
  model: CopilotModel,
  tokenState: TokenState,
  unavailable?: Unavailability,
  tier: AccountTier = "unknown",
): vscode.LanguageModelChatInformation {
  // A model of the Microsoft 365 Copilot licence, on an account the web app
  // showed with Copilot Chat only: it stays selectable, but says so.
  const detail =
    tier === "included" && isPaidSelector(model.tone)
      ? t("model.needsPremium")
      : modelDetail(model);
  const tone = model.tone ? ` (tone: ${model.tone})` : "";
  const unavailableText = unavailable ? unavailabilityText(unavailable) : "";
  const info: PickerChatInformation = {
    id: model.id,
    name: model.name,
    family: model.family,
    version: "1.0.0",
    ...tokenLimits(),
    detail:
      tokenState !== "ok"
        ? t(tokenState === "missing" ? "model.needsToken" : "model.tokenExpired")
        : unavailable
          ? unavailableText
          : detail,
    tooltip: unavailable ? `${unavailableText}${tone} — ${unavailable.reason}` : `${detail}${tone}`,
    // This is what surfaces the model in the in-chat picker (not just in
    // "Manage Models").
    isUserSelectable: true,
    isBYOK: true,
    statusIcon: tokenState === "ok" && !unavailable ? undefined : new vscode.ThemeIcon("warning"),
    capabilities: {
      // We advertise tool calling so the models also appear in the default
      // Agent/Edit chat mode (which filters out models without it). BizChat
      // has no native tool execution: the calls are a text protocol we
      // describe in the prompt and decode from the reply (see
      // toolProtocol.ts), covering both our tools and the editor's own —
      // so the agent loop does work, one tool call per turn.
      toolCalling: true,
      // Screenshots pasted in the chat are uploaded like the web app does
      // (client.ts, `images`).
      imageInput: true,
    },
  };
  return info;
}

/** How the picker says a model is flagged: until when, when the service said so. */
export function unavailabilityText(unavailable: Unavailability): string {
  return unavailable.until !== undefined
    ? t("model.quotaUntil", formatMoment(unavailable.until))
    : t("model.unavailable");
}

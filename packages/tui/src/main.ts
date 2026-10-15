/**
 * m365-copilot-tui — the terminal chat: BizChat over the terminal, and nothing
 * else.
 *
 * Everything it needs lives here — client, profile, i18n, modelCatalog,
 * logger — with no `vscode` import anywhere; scripts/build.mjs bundles it into
 * one file that only needs Node to run.
 *
 * Ways in: the token the browser extension or the userscript pushes to the
 * local receiver (localhost:51827 — only one process can own the port),
 * `--token`, a paste at the prompt, or /login. Everything else is the loop:
 * ask, echo, stream the answer in a box.
 */
import * as fs from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { TOKEN_SERVER_PORT } from "@m365copilot/core";
import { OnlineCatalog } from "./catalog";
import {
  accountTier,
  CopilotAuthError,
  CopilotLicenseError,
  CopilotModelUnavailableError,
  CopilotQuotaExhaustedError,
  createCopilotConversation,
  MAX_TURN_IMAGES,
  streamCopilotTurnWithRetry,
  type AccountTier,
  type CopilotConversation,
  type TurnImage,
} from "./client";
import {
  formatMoment,
  resolveLocale,
  setLocale,
  t,
  type LanguageSetting,
  type MessageKey,
} from "./i18n";
import { initLogger, log as writeLog, setDeepDebug } from "./logger";
import {
  BUILTIN_MODELS,
  mergeModels,
  normalizeSelector,
  PAID_SUFFIX,
  prettyTone,
} from "./modelCatalog";
import {
  accountOf,
  foreignAudience,
  isTokenUsable,
  looksLikeProfile,
  minutesUntilExpiry,
  parsePastedProfile,
  type CopilotProfile,
} from "./profile";
import {
  defaultConfigDir,
  TokenReceiver,
  TuiStore,
  type ReceiverEvent,
  type TuiConfig,
} from "./store";
import { ChatUi, ExitRequested } from "./ui";

/**
 * Keeps process warnings off the screen. Node's own stderr printer is itself
 * an internal 'warning' listener — it survives any listener we merely add — and
 * the OpenTUI renderer registers a console.warn one of its own while starting.
 * Once the renderer owns the screen (the NODE_TLS_REJECT_UNAUTHORIZED warning
 * is the usual culprit) either one lands over the drawn UI, so drop them all
 * and forward to the log file instead. Installed here, and again right after
 * `ui.start()` so the renderer's handler goes too.
 */
function redirectWarningsToLog(): void {
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    writeLog(`[node] ${warning.name}: ${warning.message}`);
  });
}
redirectWarningsToLog();

/** Replaced at build time (scripts/build.mjs); "dev" when run from source. */
const VERSION = process.env.M365_TUI_VERSION ?? "dev";

/** Tab completion and /help. */
const COMMANDS = [
  "/help",
  "/model",
  "/web",
  "/img",
  "/new",
  "/clear",
  "/status",
  "/login",
  "/logout",
  "/exit",
] as const;

/** MIME types the service accepts, by extension (the extension's own list). */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
/** Mirrors the client's per-image bound. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const TIER_KEYS: Readonly<Record<AccountTier, MessageKey>> = {
  paid: "tui.status.tier.paid",
  included: "tui.status.tier.included",
  unknown: "tui.status.tier.unknown",
};

// ------------------------------------------------------------------ arguments

interface CliArgs {
  token?: string;
  /** `-m` was given; empty means Auto. */
  model?: string;
  web: boolean;
  lang?: string;
  configDir?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
  prompt?: string;
}

const LANGS = new Set(["auto", "en", "es", "zh"]);

function isLanguage(value: string): value is LanguageSetting {
  return LANGS.has(value);
}

/** `--flag=value`, `--flag value` and the short forms; anything else is reported. */
function parseArgs(argv: readonly string[]): { args: CliArgs; unknown: string[] } {
  const args: CliArgs = { web: false, verbose: false, help: false, version: false };
  const unknown: string[] = [];
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i] ?? "";
    if (item === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!item.startsWith("-") || item === "-") {
      positional.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    const flag = eq === -1 ? item : item.slice(0, eq);
    const inline = eq === -1 ? undefined : item.slice(eq + 1);
    const value = (): string | undefined => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        i += 1;
        return next;
      }
      return undefined;
    };

    switch (flag) {
      case "-t":
      case "--token": {
        const taken = value();
        if (taken === undefined) unknown.push(flag);
        else args.token = taken;
        break;
      }
      case "-m":
      case "--model": {
        const taken = value();
        if (taken === undefined) unknown.push(flag);
        else args.model = taken;
        break;
      }
      case "-w":
      case "--web":
        args.web = true;
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-V":
      case "--version":
        args.version = true;
        break;
      case "--lang": {
        const taken = value();
        if (taken === undefined) unknown.push(flag);
        else args.lang = taken;
        break;
      }
      case "--config-dir": {
        const taken = value();
        if (taken === undefined) unknown.push(flag);
        else args.configDir = taken;
        break;
      }
      default:
        unknown.push(flag);
        break;
    }
  }

  if (positional.length > 0) args.prompt = positional.join(" ");
  return { args, unknown };
}

/** What the terminal is set to: `LC_ALL`/`LANG` on Unix, the Intl locale otherwise. */
function systemLocale(): string {
  const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  if (raw) return raw;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

/** Quoted or bare items of `/img`'s argument list. */
function splitList(text: string): string[] {
  const items: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const item = match[1] ?? match[2] ?? match[3];
    if (item) items.push(item);
  }
  return items;
}

interface QueuedImage {
  /** As the user named it (basename), for the notices. */
  readonly name: string;
  readonly mimeType: string;
  readonly data: Uint8Array;
}

// ---------------------------------------------------------------- the app

/**
 * The whole program behind {@link main}: the receiver, the config, one
 * conversation across turns (like the extension's chat panels) and the loop
 * that reads a line and either runs a command, takes a pasted token, or
 * streams a turn.
 */
class TuiApp {
  private readonly ui: ChatUi;
  private readonly store: TuiStore;
  private readonly version: string;
  private readonly logPath: string;
  private readonly initialToken: string | undefined;
  private readonly initialPrompt: string | undefined;
  private readonly receiver: TokenReceiver;
  private readonly catalog: OnlineCatalog;

  private profile: CopilotProfile | null;
  private model: string | null;
  private web: boolean;
  private conversation: CopilotConversation = createCopilotConversation();
  private images: QueuedImage[] = [];
  private onboarded = false;

  constructor(options: {
    ui: ChatUi;
    store: TuiStore;
    version: string;
    logPath: string;
    model: string | null;
    web: boolean;
    token?: string;
    prompt?: string;
  }) {
    this.ui = options.ui;
    this.store = options.store;
    this.version = options.version;
    this.logPath = options.logPath;
    this.model = options.model;
    this.web = options.web;
    this.initialToken = options.token;
    this.initialPrompt = options.prompt;
    this.profile = options.store.readProfile();
    this.receiver = new TokenReceiver(options.store, this.onReceiverEvent);
    this.catalog = new OnlineCatalog(options.store.dir);
  }

  async run(): Promise<void> {
    await this.ui.start(this.store.readHistory());
    // The renderer registered its own 'warning' printer while starting.
    redirectWarningsToLog();
    await this.receiver.start();
    this.ui.banner(this.version, this.logPath);
    try {
      if (this.initialToken) this.acceptToken(this.initialToken);
      if (!this.usable()) await this.ensureToken();

      let pending = this.initialPrompt?.trim() ?? "";
      // The loop is the program: read a line, finish what it asked (a command,
      // a paste, a whole streamed answer) and only then ask for the next one.
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const line = pending || (await this.ui.ask({ status: this.statusLine(), commands: COMMANDS }));
        pending = "";
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!looksLikeProfile(trimmed)) this.store.appendHistory(trimmed);
        // eslint-disable-next-line no-await-in-loop
        await this.handleLine(trimmed);
      }
    } catch (error) {
      if (error instanceof ExitRequested) {
        this.ui.notice("info", t("tui.goodbye", this.store.dir));
        return;
      }
      throw error;
    } finally {
      this.receiver.stop();
    }
  }

  private usable(): boolean {
    return this.profile !== null && isTokenUsable(this.profile);
  }

  private async handleLine(line: string): Promise<void> {
    if (looksLikeProfile(line)) {
      this.acceptToken(line);
      return;
    }
    if (line.startsWith("/")) {
      await this.runCommand(line);
      return;
    }
    await this.runTurn(line);
  }

  // ------------------------------------------------------------- the token

  /**
   * What a paste (or `--token`, or `/login <token>`) does: normalize, refuse a
   * token that is not the Copilot one, store it 0600 and update the status.
   */
  private acceptToken(text: string): void {
    let profile: CopilotProfile;
    try {
      profile = parsePastedProfile(text);
    } catch (error) {
      this.ui.notice(
        "warn",
        t("tui.token.bad", error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    const audience = foreignAudience(profile.accessToken);
    if (audience !== null) {
      this.ui.notice("warn", t("tui.token.badAudience", audience));
      return;
    }
    this.store.saveProfile(profile);
    this.profile = profile;
    const label = profile.claims?.upn?.trim() || "?";
    const minutes = minutesUntilExpiry(profile);
    if (minutes === null) this.ui.notice("ok", t("tui.token.savedNoExp", label));
    else if (minutes > 0) this.ui.notice("ok", t("tui.token.saved", label, minutes));
    else this.ui.notice("warn", t("tui.status.tokenExpired"));
  }

  /** Waits — at the onboarding prompt — until a usable token is stored. */
  private async ensureToken(): Promise<CopilotProfile> {
    for (;;) {
      const profile = this.store.readProfile();
      if (profile && isTokenUsable(profile)) {
        this.profile = profile;
        return profile;
      }
      if (!this.onboarded) {
        this.onboarded = true;
        this.ui.notice("info", t("tui.onboarding.title"));
        this.ui.notice("info", t("tui.onboarding.body", TOKEN_SERVER_PORT));
      }
      // The onboarding prompt, one paste at a time.
      // eslint-disable-next-line no-await-in-loop
      const line = (await this.ui.ask({ status: this.statusLine(), commands: COMMANDS })).trim();
      if (!line) continue;
      if (!looksLikeProfile(line)) {
        this.ui.notice("warn", t("tui.token.bad", line.slice(0, 100)));
        continue;
      }
      this.acceptToken(line);
    }
  }

  private readonly onReceiverEvent = (event: ReceiverEvent): void => {
    if (event.kind === "signOut") {
      this.profile = null;
      this.ui.notice("warn", t("tui.token.gone"));
      return;
    }
    this.profile = event.profile;
    this.ui.notice("ok", t("tui.token.pushed", event.profile.claims?.upn?.trim() || "?"));
  };

  // ------------------------------------------------------------- the turn

  private async runTurn(prompt: string): Promise<void> {
    this.ui.echoInput(prompt);
    const profile = await this.ensureToken();

    const images = this.images;
    const sentLabel = images.map((image) => image.name).join(", ");
    this.images = [];

    const box = this.ui.startAnswer();
    const controller = new AbortController();
    this.ui.setTurnCanceller(() => controller.abort());
    try {
      await streamCopilotTurnWithRetry({
        profile,
        prompt,
        tone: this.model,
        callbacks: {
          onText: (delta) => box.update(delta),
          onSources: (sources) => box.setSources(sources),
          onRemoteWork: (detail) => this.ui.notice("dim", t("tui.remoteWork", detail)),
          onImageSkipped: (reason) =>
            this.ui.notice("warn", t("tui.image.failed", sentLabel || "image", reason)),
        },
        signal: controller.signal,
        conversation: this.conversation,
        mode: this.web ? "web" : "tools",
        images: images.map((image): TurnImage => ({ mimeType: image.mimeType, data: image.data })),
        log: writeLog,
      });
      this.conversation.isStartOfSession = false;
    } catch (error) {
      this.reportTurnError(error, controller.signal.aborted);
    } finally {
      this.ui.setTurnCanceller(null);
      box.finish();
    }
  }

  /** The client errors already say what happened; the hints say what to do. */
  private reportTurnError(error: unknown, aborted: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    if (aborted || message === "__CANCELLED__") {
      this.ui.notice("dim", t("tui.cancelled"));
      return;
    }
    this.ui.notice("error", message);
    if (error instanceof CopilotAuthError) this.ui.notice("dim", t("tui.err.auth"));
    else if (error instanceof CopilotModelUnavailableError)
      this.ui.notice("dim", t("tui.err.model"));
    else if (error instanceof CopilotQuotaExhaustedError)
      this.ui.notice("dim", t("tui.err.quota", formatMoment(error.resetsAt)));
    else if (error instanceof CopilotLicenseError) this.ui.notice("dim", t("tui.err.license"));
  }

  // ------------------------------------------------------------- commands

  private async runCommand(line: string): Promise<void> {
    const match = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/.exec(line);
    const name = (match?.[1] ?? "").toLowerCase();
    const rest = (match?.[2] ?? "").trim();
    switch (name) {
      case "help":
        this.ui.help();
        return;
      case "model":
        await this.commandModel(rest);
        return;
      case "web":
        this.commandWeb(rest);
        return;
      case "img":
      case "image":
        this.commandImg(rest);
        return;
      case "new":
        this.conversation = createCopilotConversation();
        this.ui.notice("ok", t("tui.new"));
        return;
      case "clear":
        this.ui.clear();
        return;
      case "status":
        this.ui.say(this.statusLine());
        return;
      case "login":
        if (rest) this.acceptToken(rest);
        else this.ui.notice("dim", t("tui.login.hint"));
        return;
      case "logout":
        this.store.clearProfile();
        this.profile = null;
        this.ui.notice("warn", t("tui.logout.hint", this.store.dir));
        return;
      case "exit":
      case "quit":
        throw new ExitRequested();
      default:
        this.ui.notice("warn", t("tui.cmd.unknown", name ? `/${name}` : line));
        return;
    }
  }

  private async commandModel(rest: string): Promise<void> {
    await this.ensureCatalog();
    const models = mergeModels({
      catalog: this.catalog.current(),
      observed: this.profile?.observedTones ?? [],
      custom: [],
    });
    if (!rest) {
      const rows = models.map((model, index) => {
        const current = this.isCurrentTone(model.tone) ? `  ← ${t("tui.model.current")}` : "";
        return `${index + 1}. ${model.name}${current}`;
      });
      this.ui.say([t("tui.model.title"), ...rows].join("\n"));
      return;
    }
    let picked: string | null | undefined;
    if (/^\d+$/.test(rest)) picked = models[Number(rest) - 1]?.tone;
    else {
      const byId = models.find((model) => model.id === rest);
      picked = byId ? byId.tone : (normalizeSelector(rest) ?? undefined);
    }
    if (picked === undefined) {
      this.ui.notice("warn", t("tui.model.unknown", rest));
      return;
    }
    this.model = picked;
    this.store.writeConfig({ model: picked });
    this.ui.notice("ok", t("tui.model.set", this.modelLabel()));
  }

  /** Downloads the online catalog when the cached copy is missing or old. */
  private async ensureCatalog(): Promise<void> {
    if (!this.catalog.needsRefresh()) return;
    this.ui.notice("dim", t("tui.model.catalog.fetching"));
    const ok = await this.catalog.refresh();
    if (!ok) this.ui.notice("warn", t("tui.model.catalog.failed"));
  }

  /** A stored selector names the current entry, with or without its `@paid`. */
  private isCurrentTone(tone: string | null): boolean {
    if (tone === null) return this.model === null;
    return this.model === tone || this.model === `${tone}${PAID_SUFFIX}`;
  }

  private commandWeb(rest: string): void {
    const value = rest.toLowerCase();
    let next: boolean;
    if (!value) next = !this.web;
    else if (value === "on" || value === "true" || value === "1") next = true;
    else if (value === "off" || value === "false" || value === "0") next = false;
    else {
      this.ui.notice("warn", t("tui.cmd.unknown", `/web ${rest}`));
      return;
    }
    this.web = next;
    this.store.writeConfig({ web: next });
    this.ui.notice("ok", next ? t("tui.web.on") : t("tui.web.off"));
  }

  private commandImg(rest: string): void {
    if (!rest) {
      if (this.images.length === 0) {
        this.ui.notice("dim", t("tui.image.none"));
        return;
      }
      const names = this.images.map((image) => image.name).join(", ");
      this.ui.notice("info", t("tui.image.list", this.images.length, names));
      return;
    }
    if (rest.toLowerCase() === "clear") {
      this.images = [];
      this.ui.notice("ok", t("tui.image.cleared"));
      return;
    }
    const queued: string[] = [];
    for (const item of splitList(rest)) {
      const file = item.startsWith("~") ? join(homedir(), item.slice(1)) : item;
      const path = resolve(file);
      const mime = IMAGE_MIME[extname(path).toLowerCase()];
      if (!mime) {
        this.ui.notice("warn", t("tui.image.failed", item, "unsupported image type"));
        continue;
      }
      try {
        if (fs.statSync(path).size > MAX_IMAGE_BYTES) {
          this.ui.notice("warn", t("tui.image.failed", item, "larger than 10 MB"));
          continue;
        }
        if (this.images.length >= MAX_TURN_IMAGES) {
          this.ui.notice(
            "warn",
            t("tui.image.failed", item, `the next turn already carries ${MAX_TURN_IMAGES} images`),
          );
          continue;
        }
        const data = fs.readFileSync(path);
        this.images.push({ name: basename(path), mimeType: mime, data });
        queued.push(basename(path));
      } catch (error) {
        this.ui.notice(
          "warn",
          t("tui.image.failed", item, error instanceof Error ? error.message : String(error)),
        );
      }
    }
    if (queued.length > 0) this.ui.notice("ok", t("tui.image.queued", queued.join(", ")));
  }

  // ------------------------------------------------------------- the status

  /** The dim row above the prompt: who, how much token is left, and the rest. */
  private statusLine(): string {
    const account = accountOf(this.profile);
    const parts: string[] = [
      account ? t("tui.status.user", account.label) : t("tui.status.noUser"),
    ];
    if (this.profile) {
      const minutes = minutesUntilExpiry(this.profile);
      if (minutes === null) parts.push(t("tui.status.tokenUnknown"));
      else if (minutes <= 0) parts.push(t("tui.status.tokenExpired"));
      else parts.push(t("tui.status.token", minutes));
      parts.push(t(TIER_KEYS[accountTier(this.profile)]));
    }
    parts.push(t("tui.status.model", this.modelLabel()));
    parts.push(this.web ? t("tui.status.web.on") : t("tui.status.web.off"));
    parts.push(
      this.receiver.status === "listening"
        ? t("tui.status.receiver", TOKEN_SERVER_PORT)
        : t("tui.status.receiverOff", TOKEN_SERVER_PORT),
    );
    return parts.join(" · ");
  }

  private modelLabel(): string {
    if (this.model) return prettyTone(this.model);
    return BUILTIN_MODELS[0]?.name ?? "M365 Copilot (Auto)";
  }
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const { args, unknown } = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.lang !== undefined && !isLanguage(args.lang)) {
    process.stderr.write(`${t("tui.cli.unknown", `--lang ${args.lang}`)}\n`);
    process.exitCode = 2;
    return;
  }

  const dir = args.configDir ? resolve(args.configDir) : defaultConfigDir();
  const store = new TuiStore(dir);
  const config = store.readConfig();
  setLocale(resolveLocale(args.lang ?? config.language, systemLocale()));

  if (args.help) {
    process.stdout.write(`${t("tui.cli.body")}\n`);
    return;
  }
  if (unknown.length > 0) {
    for (const flag of unknown) process.stderr.write(`${t("tui.cli.unknown", flag)}\n`);
    process.exitCode = 2;
    return;
  }

  let model = config.model;
  if (args.model !== undefined) {
    const raw = args.model.trim();
    model = raw ? normalizeSelector(raw) : null;
    if (raw && model === null) {
      process.stderr.write(`${t("tui.model.unknown", raw)}\n`);
      process.exitCode = 2;
      return;
    }
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`${t("tui.needTty")}\n`);
    process.exitCode = 1;
    return;
  }

  // The flags are remembered, like the /model and /web commands do.
  const patch: Partial<TuiConfig> = {};
  if (args.model !== undefined) patch.model = model;
  if (args.web) patch.web = true;
  if (args.lang !== undefined) patch.language = args.lang;
  if (Object.keys(patch).length > 0) store.writeConfig(patch);

  fs.mkdirSync(dir, { recursive: true });
  const logPath = join(dir, "tui.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });
  initLogger({ appendLine: (line) => logStream.write(`${line}\n`) });
  setDeepDebug(args.verbose);
  writeLog(`--- m365-copilot-tui v${VERSION} (${dir}) ---`);

  const ui = new ChatUi();
  const app = new TuiApp({
    ui,
    store,
    version: VERSION,
    logPath,
    model,
    web: args.web || config.web,
    token: args.token,
    prompt: args.prompt,
  });

  const shutdown = (code: number): void => {
    // The renderer has to put the terminal back together before we leave.
    void ui.stop().finally(() => process.exit(code));
  };
  process.on("SIGINT", () => shutdown(130));
  process.on("SIGTERM", () => shutdown(143));

  try {
    await app.run();
  } finally {
    await ui.stop();
    // Leaving the alternate screen wiped everything the TUI drew: the
    // farewell goes to the normal screen, where it stays.
    process.stdout.write(`${t("tui.goodbye", dir)}\n`);
    logStream.end();
  }
}

try {
  await main();
} catch (error) {
  // The OpenTUI renderer rides on Node's experimental FFI module: without
  // `--experimental-ffi` the native backend fails to load before the first
  // frame, and the raw error says nothing about how to fix it.
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("OpenTUI native FFI")) {
    process.stderr.write(`${t("tui.needFfi")}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}

/**
 * Persistent state for the terminal TUI, and the local server that receives
 * the token the browser extension or the userscript pushes.
 *
 * The profile saved here is the same JSON the browser side sends (this
 * package's profile.ts normalizes a bare JWT, `Bearer …`, the Chathub URL or
 * a full profile into one {@link CopilotProfile}); it lives in a 0600 file
 * under `~/.m365copilot` together with the small configuration (model, web
 * mode, language) and the input history.
 *
 * {@link TokenReceiver} speaks the same local contract the browser side
 * already knows — same fixed port, same origin allow-list, same JSON
 * responses — so the browser extension and the userscript work against either
 * backend without knowing which one is listening. Only one process can own
 * the port: when something else holds it, the receiver here reports the port
 * as busy and the TUI relies on the paste path (or on whatever token it was
 * already given).
 */
import * as fs from "node:fs";
import * as http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  HEALTH_ENDPOINT_PATH,
  SIGNOUT_ENDPOINT_PATH,
  TOKEN_ENDPOINT_PATH,
  TOKEN_SERVER_HOST,
  TOKEN_SERVER_PORT,
  type CopilotProfile,
} from "@m365copilot/core";
import { parsePastedProfile } from "./profile";
import type { LanguageSetting } from "./i18n";

/** Where the token and the settings live when `--config-dir` does not say otherwise. */
export function defaultConfigDir(): string {
  return join(homedir(), ".m365copilot");
}

export interface TuiConfig {
  /** Tone to send (`Claude_Sonnet`, `Claude_Sonnet@paid`…), or null for Auto. */
  model: string | null;
  /** Send turns the way the web app does (Bing search, no workspace tools). */
  web: boolean;
  /** Language of the interface; `auto` follows the system's. */
  language: LanguageSetting;
}

const DEFAULT_CONFIG: TuiConfig = { model: null, web: false, language: "auto" };

function isLanguage(value: unknown): value is LanguageSetting {
  return value === "auto" || value === "en" || value === "es" || value === "zh";
}

export class TuiStore {
  constructor(readonly dir: string) {}

  get profilePath(): string {
    return join(this.dir, "tui-profile.json");
  }

  get configPath(): string {
    return join(this.dir, "tui-config.json");
  }

  get historyPath(): string {
    return join(this.dir, "tui-history.json");
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /** The stored settings, with anything unreadable falling back to the defaults. */
  readConfig(): TuiConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as Partial<TuiConfig>;
      return {
        model: typeof raw.model === "string" && raw.model ? raw.model : null,
        web: raw.web === true,
        language: isLanguage(raw.language) ? raw.language : "auto",
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Merges `patch` into the stored settings and returns the result. */
  writeConfig(patch: Partial<TuiConfig>): TuiConfig {
    const next = { ...this.readConfig(), ...patch };
    this.ensureDir();
    fs.writeFileSync(this.configPath, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  /** The stored profile, or null when there is none — or it is not one. */
  readProfile(): CopilotProfile | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.profilePath, "utf8")) as Partial<CopilotProfile>;
      if (typeof parsed.accessToken !== "string" || parsed.accessToken.split(".").length !== 3)
        return null;
      return parsed as CopilotProfile;
    } catch {
      return null;
    }
  }

  /** Stores a profile (the token), only readable by its user. */
  saveProfile(profile: CopilotProfile): void {
    this.ensureDir();
    fs.writeFileSync(this.profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  }

  clearProfile(): void {
    fs.rmSync(this.profilePath, { force: true });
  }

  readHistory(): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.historyPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter((line): line is string => typeof line === "string").slice(-200);
    } catch {
      return [];
    }
  }

  appendHistory(line: string): void {
    const text = line.trim();
    if (!text) return;
    const history = this.readHistory();
    if (history[history.length - 1] === text) return;
    history.push(text);
    this.ensureDir();
    fs.writeFileSync(this.historyPath, `${JSON.stringify(history.slice(-200), null, 2)}\n`);
  }
}

// ---------------------------------------------------------------- receiver

// The same origins the extension's tokenServer allows (the userscript's own
// `@match` set plus the extension's `chrome-extension://`/`moz-extension://`
// origin): a random page the browser has open cannot complete a cross-origin
// POST to this port, so it cannot overwrite the stored profile.
const ALLOWED_ORIGINS = new Set([
  "https://www.office.com",
  "https://outlook.office.com",
  "https://teams.microsoft.com",
]);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol === "chrome-extension:" || protocol === "moz-extension:") return true;
    return (
      protocol === "https:" &&
      (hostname === "cloud.microsoft" || hostname.endsWith(".cloud.microsoft"))
    );
  } catch {
    return false;
  }
}

/** A captured profile is a few KB; a much bigger body is not one. */
const MAX_BODY_BYTES = 256 * 1024;

export type ReceiverState = "listening" | "busy" | "off";

export type ReceiverEvent =
  | { readonly kind: "token"; readonly profile: CopilotProfile }
  | { readonly kind: "signOut" };

function respond(res: http.ServerResponse, status: number, payload?: unknown): void {
  if (payload === undefined) res.writeHead(status);
  else res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload === undefined ? undefined : JSON.stringify(payload));
}

/**
 * The local receiver: the browser side posts the token to `/token` (and its
 * sign-outs to `/signout`), answers `/health` so it can tell whether anything
 * is listening at all, and only the allowed origins get CORS headers.
 * `start()` resolves to `"busy"` — never throws — when the port already has
 * an owner (another instance, say).
 */
export class TokenReceiver {
  private server: http.Server | null = null;
  private current: ReceiverState = "off";

  constructor(
    private readonly store: TuiStore,
    private readonly onReceived: (event: ReceiverEvent) => void,
  ) {}

  get status(): ReceiverState {
    return this.current;
  }

  start(): Promise<ReceiverState> {
    if (this.server) return Promise.resolve(this.current);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (state: ReceiverState): void => {
        if (settled) return;
        settled = true;
        this.current = state;
        resolve(state);
      };
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        server.close();
        settle(error.code === "EADDRINUSE" ? "busy" : "off");
      });
      server.listen(TOKEN_SERVER_PORT, TOKEN_SERVER_HOST, () => {
        this.server = server;
        settle("listening");
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.current = "off";
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const origin = req.headers.origin;
    const originAllowed = typeof origin === "string" && isAllowedOrigin(origin);
    if (typeof origin === "string" && origin) {
      res.setHeader("Vary", "Origin");
      if (originAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }
    }

    if (req.method === "OPTIONS") {
      respond(res, originAllowed || !origin ? 200 : 403);
      return;
    }

    if (
      req.method === "POST" &&
      (req.url === TOKEN_ENDPOINT_PATH || req.url === SIGNOUT_ENDPOINT_PATH)
    ) {
      if (typeof origin === "string" && origin && !originAllowed) {
        // API errors stay in English: the browser side reads them, not a person.
        respond(res, 403, { success: false, error: "Origin not allowed" });
        return;
      }
      let body = "";
      let tooLarge = false;
      req.on("data", (chunk: Buffer) => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > MAX_BODY_BYTES) {
          tooLarge = true;
          respond(res, 413, { success: false, error: "Payload too large" });
          req.destroy();
        }
      });
      req.on("end", () => {
        if (tooLarge) return;
        try {
          if (req.url === SIGNOUT_ENDPOINT_PATH) {
            this.store.clearProfile();
            this.onReceived({ kind: "signOut" });
            respond(res, 200, { success: true, id: null });
            return;
          }
          const profile = parsePastedProfile(body);
          this.store.saveProfile(profile);
          this.onReceived({ kind: "token", profile });
          respond(res, 200, {
            success: true,
            expiresAt: profile.claims?.exp,
            user: profile.claims?.upn,
          });
        } catch (error) {
          respond(res, 400, {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      return;
    }

    if (req.method === "GET" && req.url === HEALTH_ENDPOINT_PATH) {
      respond(res, 200, { status: "ok", service: "m365-copilot-tui", pendingSignOut: null });
      return;
    }

    respond(res, 404);
  }
}

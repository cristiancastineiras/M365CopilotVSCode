import * as vscode from "vscode";
import { accountKind } from "@m365copilot/core";
import {
  describeProfile,
  parsePastedProfile,
  type CopilotProfile,
  debug,
} from "@m365copilot/core/bizchat";
import { t } from "./i18n";

const SECRET_KEY = "m365copilot.profile.v1";

/** What to do about a token that cannot be used, which depends on the kind of account. */
export function unusableTokenMessage(profile: CopilotProfile): string {
  return t(
    accountKind(profile) === "personal" ? "watcher.rejectedPersonal" : "participant.tokenExpired",
  );
}

/**
 * Stores the captured Copilot profile in VS Code SecretStorage (encrypted,
 * per-machine) and notifies listeners when it changes so the model picker can
 * refresh its warning state.
 */
export class ProfileStore {
  private cached: CopilotProfile | null | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly secrets: vscode.SecretStorage) {
    // Cross-window sync: another window writing the secret should refresh
    // this window's cache and picker.
    this.disposable = secrets.onDidChange((e) => {
      if (e.key === SECRET_KEY) {
        debug("profile", "the stored secret changed (this or another window); cache dropped");
        this.cached = undefined;
        this.changeEmitter.fire();
      }
    });
  }

  private readonly disposable: vscode.Disposable;

  async get(): Promise<CopilotProfile | null> {
    if (this.cached !== undefined) return this.cached;
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) {
      this.cached = null;
      return null;
    }
    try {
      this.cached = JSON.parse(raw) as CopilotProfile;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  async has(): Promise<boolean> {
    return (await this.get()) !== null;
  }

  /**
   * Store what the browser pushed. Returns the normalized profile. The browser
   * also sends the same token again (a model it saw, its retries), which does
   * not bring a rejected one back to life.
   */
  async setFromPaste(pasted: string): Promise<CopilotProfile> {
    const profile = parsePastedProfile(pasted);
    const current = await this.get();
    const stillRejected = current?.tokenRejected && current.accessToken === profile.accessToken;
    return this.set(stillRejected ? { ...profile, tokenRejected: true } : profile);
  }

  /** The service refused this token: from now on it counts as expired. */
  async markRejected(accessToken: string): Promise<void> {
    const current = await this.get();
    if (!current || current.accessToken !== accessToken || current.tokenRejected) return;
    await this.set({ ...current, tokenRejected: true });
  }

  /** Store an already parsed profile (see {@link parsePastedProfile}). */
  async set(profile: CopilotProfile): Promise<CopilotProfile> {
    await this.secrets.store(SECRET_KEY, JSON.stringify(profile));
    debug("profile", "profile stored in SecretStorage", () => describeProfile(profile));
    this.cached = profile;
    this.changeEmitter.fire();
    return profile;
  }

  async clear(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    debug("profile", "profile deleted from SecretStorage");
    this.cached = null;
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.disposable.dispose();
    this.changeEmitter.dispose();
  }
}

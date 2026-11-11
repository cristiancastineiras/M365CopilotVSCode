/**
 * The account's model menu: what the M365 Copilot web app's model picker
 * offers it, from `getgptlist` (fetchModelMenu in the shared client) — the same
 * list the VS Code extension shows.
 *
 * Loaded at most once every {@link MENU_REFRESH_MS} and kept in the tool's own
 * directory, so `/model` still shows the last menu it saw when the network is
 * down.
 */
import * as fs from "node:fs";
import { join } from "node:path";
import {
  fetchModelMenu,
  log as writeLog,
  type CopilotProfile,
  type ModelEntry,
} from "@m365copilot/core/bizchat";

const MENU_REFRESH_MS = 12 * 60 * 60_000;

interface MenuCache {
  readonly entries: ModelEntry[];
  readonly fetchedAt: number;
}

export class ModelMenu {
  private readonly file: string;
  private entries: ModelEntry[] | null = null;
  private fetchedAt = 0;
  private loaded = false;

  constructor(private readonly dir: string) {
    this.file = join(dir, "tui-model-menu.json");
  }

  /** The last menu loaded (the disk copy included); null until one exists. */
  current(): readonly ModelEntry[] | null {
    this.load();
    return this.entries;
  }

  /** Whether a load is due: nothing cached, or the copy is older than the TTL. */
  needsRefresh(now = Date.now()): boolean {
    this.load();
    return this.fetchedAt === 0 || now - this.fetchedAt >= MENU_REFRESH_MS;
  }

  /**
   * Load the account's menu now. False when it could not be had — the cached
   * copy (or just the built-ins) stays in use then.
   */
  async refresh(profile: CopilotProfile): Promise<boolean> {
    const started = Date.now();
    try {
      const entries = await fetchModelMenu({ profile });
      this.entries = entries;
      this.fetchedAt = Date.now();
      this.save();
      writeLog(`model menu loaded: ${entries.length} models (${Date.now() - started} ms)`);
      return true;
    } catch (error) {
      writeLog(`model menu not loaded: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** The disk copy, read once; anything unreadable counts as no copy at all. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<MenuCache>;
      if (!Array.isArray(raw.entries) || typeof raw.fetchedAt !== "number") return;
      this.entries = raw.entries.filter(
        (entry) => Boolean(entry) && typeof entry.tone === "string",
      );
      this.fetchedAt = raw.fetchedAt;
    } catch {
      // No cache yet (or unreadable): the next refresh will write one.
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const cache: MenuCache = { entries: this.entries ?? [], fetchedAt: this.fetchedAt };
      fs.writeFileSync(this.file, `${JSON.stringify(cache, null, 2)}\n`);
    } catch (error) {
      writeLog(
        `model menu cache write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

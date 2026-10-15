/**
 * The online model catalog: models.json in the project's GitHub repository —
 * the same file the VS Code extension downloads. The maintainer adds a model
 * (or hides a retired one) there and every user gets it without a new release.
 *
 * Downloaded at most once every {@link CATALOG_REFRESH_MS} and kept in the
 * tool's own directory, so `/model` still shows the last catalog it saw when
 * the network is down.
 */
import * as fs from "node:fs";
import { join } from "node:path";
import { debug, log as writeLog } from "./logger";
import { parseModelCatalog, type ModelEntry } from "./modelCatalog";

/** models.json in the project's repository — edit it there to add or retire a model for everyone. */
export const MODEL_CATALOG_URL =
  "https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/models.json";

const CATALOG_REFRESH_MS = 12 * 60 * 60_000;
const CATALOG_TIMEOUT_MS = 8_000;

interface CatalogCache {
  readonly entries: ModelEntry[];
  readonly fetchedAt: number;
}

export class OnlineCatalog {
  private readonly file: string;
  private entries: ModelEntry[] = [];
  private fetchedAt = 0;
  private loaded = false;

  constructor(private readonly dir: string) {
    this.file = join(dir, "tui-models.json");
  }

  /** The last downloaded entries (the disk copy included); empty until one exists. */
  current(): readonly ModelEntry[] {
    this.load();
    return this.entries;
  }

  /** Whether a download is due: nothing cached, or the copy is older than the TTL. */
  needsRefresh(now = Date.now()): boolean {
    this.load();
    return this.fetchedAt === 0 || now - this.fetchedAt >= CATALOG_REFRESH_MS;
  }

  /**
   * Download models.json now. False when it could not be fetched or parsed —
   * the cached copy (or just the built-ins) stays in use then.
   */
  async refresh(): Promise<boolean> {
    const started = Date.now();
    try {
      debug("catalog", `→ GET ${MODEL_CATALOG_URL}`, { timeoutMs: CATALOG_TIMEOUT_MS });
      const response = await fetch(MODEL_CATALOG_URL, {
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = parseModelCatalog(await response.json());
      if (!entries) throw new Error('models.json has no "models" array');
      this.entries = entries;
      this.fetchedAt = Date.now();
      this.save();
      writeLog(`model catalog updated: ${entries.length} entries (${Date.now() - started} ms)`);
      return true;
    } catch (error) {
      writeLog(
        `model catalog fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** The disk copy, read once; anything unreadable counts as no copy at all. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<CatalogCache>;
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
      const cache: CatalogCache = { entries: this.entries, fetchedAt: this.fetchedAt };
      fs.writeFileSync(this.file, `${JSON.stringify(cache, null, 2)}\n`);
    } catch (error) {
      writeLog(
        `model catalog cache write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

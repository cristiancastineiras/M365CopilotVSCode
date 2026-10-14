/**
 * A tiny logging sink used for diagnostics. The BizChat/Sydney protocol is
 * reverse-engineered, so when something goes wrong the raw frames are the only
 * way to see how a given tenant/ring actually behaves.
 *
 * Two levels share one pipeline:
 *  - {@link log}: the lines the extension always writes (a handful per turn);
 *  - {@link debug}: the deep trace — every request, response, frame, tool call,
 *    command, process and setting change — that costs nothing (one boolean
 *    check) until {@link setDeepDebug} turns it on (`m365copilot.debug.deep`).
 *
 * Everything that is written passes through {@link redactSecrets} first and is
 * also kept in a bounded in-memory buffer, which is what "Export log" saves to
 * a .txt — so a log is always safe to hand over, even when the Output channel
 * has already scrolled past what happened.
 *
 * This module deliberately does NOT import `vscode` — the extension injects a
 * VS Code OutputChannel (which satisfies {@link LogSink}) at activation, while
 * unit tests can run the client without a VS Code host.
 */
export interface LogSink {
  appendLine(line: string): void;
  show?(preserveFocus?: boolean): void;
  clear?(): void;
}

interface Entry {
  readonly at: number;
  readonly text: string;
}

/** Oldest entries are dropped past either bound: a deep trace must not eat the extension host's memory. */
const MAX_ENTRIES = 40_000;
const MAX_BUFFER_CHARS = 8_000_000;
/** One entry (a whole prompt, say) never grows past this; the rest is summarised. */
const MAX_ENTRY_CHARS = 200_000;

let sink: LogSink | undefined;
let deep = false;
let entries: Entry[] = [];
let bufferedChars = 0;
let dropped = 0;

export function initLogger(target: LogSink): void {
  sink = target;
}

/** A line that is always written, whatever the debug setting. */
export function log(message: string): void {
  record(undefined, message);
}

export function showLog(): void {
  sink?.show?.(true);
}

// ------------------------------------------------------------------ deep debug

export function setDeepDebug(on: boolean): void {
  deep = on;
}

/** Whether the deep trace is on — for call sites that would pay to build their data. */
export function isDeepDebug(): boolean {
  return deep;
}

/**
 * A line of the deep trace. `scope` says who is talking (`ws#1a2b3c4d`,
 * `http#3`, `tool#7`…); `data` is the payload to print under it — a string
 * as it is, anything else as indented JSON — or a function that builds it, so
 * nothing is formatted while the mode is off. Never throws.
 */
export function debug(scope: string, message: string, data?: unknown): void {
  if (!deep) return;
  let detail: string | undefined;
  try {
    const value = typeof data === "function" ? (data as () => unknown)() : data;
    if (value !== undefined) detail = formatDebugData(value);
  } catch (error) {
    detail = `<could not format the data: ${String(error)}>`;
  }
  record(scope, message, detail);
}

/** Strings as they are (prompts stay readable); everything else as JSON that survives errors, cycles and binary. */
export function formatDebugData(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(
        value,
        (_key, item: unknown) => {
          if (typeof item === "bigint") return item.toString();
          if (typeof item === "function") return undefined;
          if (item instanceof Error)
            return { name: item.name, message: item.message, stack: item.stack };
          if (item instanceof Map) return Object.fromEntries(item);
          if (item instanceof Set) return [...item];
          if (ArrayBuffer.isView(item)) return `<${item.byteLength} bytes>`;
          if (item && typeof item === "object") {
            const record = item as { type?: unknown; data?: unknown };
            // Buffer#toJSON runs before this replacer.
            if (record.type === "Buffer" && Array.isArray(record.data))
              return `<${record.data.length} bytes>`;
            if (seen.has(item)) return "[Circular]";
            seen.add(item);
          }
          return item;
        },
        2,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

// ------------------------------------------------------------------- redaction

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const URL_SECRET =
  /([?&](?:access_token|id_token|refresh_token|token|sig|signature|client_secret|password|api[_-]?key)=)[^&\s"'#]+/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const JSON_SECRET =
  /("(?:access_?token|id_?token|refresh_?token|token|password|passwd|secret|client_?secret|authorization|cookie|set-cookie|api_?key)"\s*:\s*")((?:[^"\\]|\\.)*)(")/gi;
const HEADER_SECRET =
  /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*).+$/gim;

/**
 * Hides what must never leave the machine in a shared log: JWTs (shown as a
 * length, so "is there a token?" is still answerable), `access_token=` style
 * query values, `Bearer …`, secret-looking JSON fields and credential headers.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_SECRET, "$1<REDACTED>")
    .replace(JSON_SECRET, "$1<REDACTED>$3")
    .replace(HEADER_SECRET, "$1<REDACTED>")
    .replace(AUTH_SCHEME, "$1 <REDACTED>")
    .replace(JWT, (jwt) => `<JWT ${jwt.length} chars>`);
}

/** Redact the access_token query param so logs are safe to share. */
export function redactUrl(url: string): string {
  return redactSecrets(url);
}

/** Truncate a long frame for readable logs. */
export function truncate(text: string, max = 1200): string {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}

// ---------------------------------------------------------------------- buffer

function record(scope: string | undefined, message: string, detail?: string): void {
  const at = Date.now();
  let text = scope ? `[${scope}] ${message}` : message;
  if (detail) text += `\n${indent(detail)}`;
  text = redactSecrets(text);
  if (text.length > MAX_ENTRY_CHARS) {
    text = `${text.slice(0, MAX_ENTRY_CHARS)}\n… (+${text.length - MAX_ENTRY_CHARS} chars not kept)`;
  }
  entries.push({ at, text });
  bufferedChars += text.length;
  trim();
  sink?.appendLine(`[${new Date(at).toISOString().slice(11, 23)}] ${text}`);
}

function indent(text: string): string {
  return text.replace(/^/gm, "    ");
}

/** Drops the oldest tenth in one go, so trimming stays cheap on every append. */
function trim(): void {
  if (entries.length <= MAX_ENTRIES && bufferedChars <= MAX_BUFFER_CHARS) return;
  const count = Math.max(1, Math.ceil(entries.length / 10));
  for (const entry of entries.slice(0, count)) bufferedChars -= entry.text.length;
  entries = entries.slice(count);
  dropped += count;
}

export function logEntryCount(): number {
  return entries.length;
}

/** Forgets everything buffered (and clears the Output channel), to reproduce a problem from a clean slate. */
export function clearLog(): void {
  entries = [];
  bufferedChars = 0;
  dropped = 0;
  sink?.clear?.();
}

/** The whole buffered log as plain text — `header` first, then one stamped entry per line block. */
export function renderLogText(header: string): string {
  const lines = [redactSecrets(header).trimEnd(), ""];
  if (dropped > 0)
    lines.push(`# ${dropped} older entries were dropped to keep the log bounded`, "");
  for (const entry of entries) lines.push(`${new Date(entry.at).toISOString()} ${entry.text}`);
  return `${lines.join("\n")}\n`;
}

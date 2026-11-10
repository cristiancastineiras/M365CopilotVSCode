/**
 * Protocolo de llamada a herramientas sobre texto plano.
 *
 * BizChat no expone function-calling nativo, así que las herramientas se
 * describen en el prompt y el modelo las invoca escribiendo un bloque de código
 * con el nombre de la herramienta como lenguaje (fencedCalls.ts). Lo importante
 * es QUÉ herramientas se describen: no sólo las nuestras, sino todas las que
 * VS Code ofrece en el turno (nativas del editor, del modo agente, de servidores
 * MCP y de otras extensiones), que llegan en `options.tools` y se normalizan en
 * {@link ./toolCatalog}. Cuando el modelo emite una llamada a una de ellas,
 * `provider.ts` reporta un `LanguageModelToolCallPart` y es VS Code quien la
 * ejecuta — igual que con un modelo con function-calling nativo.
 *
 * El marcador `<m365_tool_call>{json}` de versiones anteriores ya no se enseña,
 * pero se sigue entendiendo: un modelo puede escribirlo por su cuenta.
 */
import { M365_TOOL_NAMES, type CatalogEntry, type ToolCatalog } from "./toolCatalog";
import {
  isShellLanguage,
  parseFencedBody,
  renderFencedTemplate,
  shellInput,
  type FencedCalls,
} from "./fencedCalls";
import { bizChatLocale, t } from "./i18n";

export {
  M365_TOOL_NAMES,
  M365_WORKSPACE_TOOL_NAMES,
  buildToolCatalog,
  isM365Tool,
  renderCallFor,
  type M365ToolName,
  type ToolCatalog,
  type OfferedTool,
  type DuplicatePolicy,
} from "./toolCatalog";

const TOOL_CALL_OPEN = "<m365_tool_call>";
const MAX_TOOL_CALL_CHARS = 60_000;

/**
 * Opening marker, tolerant of the ways non-GPT rings mangle it: a stray extra
 * `<` (`<<m365_tool_call>`) and incidental spaces around the tag name. The
 * closing marker is treated as OPTIONAL — Claude and the reasoning ring often
 * emit the JSON and stop without it, so we detect the end of the call by
 * balancing the JSON braces instead of requiring `</m365_tool_call>`.
 */
const TOOL_CALL_OPEN_RE = /<{1,3}[ \t]*m365_tool_call[ \t]*>/i;

/** Whitespace and an optional opening code fence between the marker and the JSON. */
const JSON_LEADING_RE = /^\s*(?:(?:`{3,}|~{3,})[A-Za-z0-9_-]*[ \t]*\r?\n\s*)?/;

/**
 * Cualquier campo de texto de cualquier herramienta puede llegar como este
 * marcador en vez de como literal JSON, con el texto real en un
 * `<m365_block>` posterior. Existe porque pedirle a un modelo de chat (BizChat
 * no es un tool-caller nativo) que escape código arbitrario dentro de una
 * cadena JSON es frágil: una sola `"` sin escapar dentro del código desincroniza
 * el balanceador de llaves de abajo y corrompe la llamada entera — observado en
 * la práctica con código que contiene comillas dobles normales. Los bloques
 * crudos no necesitan escapado: su final se localiza buscando literalmente la
 * etiqueta de cierre, así que comillas, backslashes y llaves dentro del código
 * no pueden romper nada.
 *
 * Es OBLIGATORIO en `m365_apply_edits` y recomendado para las herramientas de
 * edición nativas de VS Code, que tienen exactamente el mismo problema.
 */
const BLOCK_REF_RE = /@@block:([A-Za-z0-9_-]{1,64})@@/g;
const BLOCK_OPEN_RE = /<m365_block[ \t]+id=["']?([A-Za-z0-9_-]+)["']?[ \t]*>/i;
const BLOCK_CLOSE_RE = /<\/m365_block[ \t]*>/i;
const BLOCK_CLOSE_LITERAL = "</m365_block>";
/** Generous cap on a single block's raw text while still streaming in. */
const MAX_BLOCK_CHARS = 600_000;

/**
 * M365 Copilot's replies end around 12,000–13,000 characters, with no error:
 * the model wraps up early, so a file written in one go comes out cut short
 * while looking finished (github.com/cramt/m365-copilot-proxy, quirk #20). From
 * {@link NEAR_OUTPUT_LIMIT_CHARS} on, a reply is treated as having run into it.
 */
export const OUTPUT_LIMIT_CHARS = 12_000;
export const NEAR_OUTPUT_LIMIT_CHARS = 10_500;

/** Profundidad y nodos máximos al recorrer el `input` buscando bloques. */
const MAX_INPUT_DEPTH = 8;
const MAX_INPUT_NODES = 5_000;

/** The tool name of a call whose JSON never closed (`"name":"…"` near the marker), or `?`. */
function nameInPartialCall(text: string): string {
  return /"name"\s*:\s*"([^"]{1,128})"/.exec(text)?.[1] ?? "?";
}

export interface DecodedToolCall {
  /** Nombre exacto tal y como lo ofreció el host (nuestro o nativo). */
  readonly name: string;
  readonly input: Record<string, unknown>;
}

// ------------------------------------------------------------------ prompt

/**
 * What the model reads about the tools. Worded as the user asking for a way of
 * working, and on purpose: M365's own system prompt sits above this one, so a
 * text that tells the model it IS an agent with real access ("IMPORTANT: you DO
 * have…", "NEVER answer…") gets checked against it, concludes it has none, or
 * works in its own cloud sandbox — and that override-shaped text is also what
 * M365's jailbreak filter looks for. Asking "guide me, I'll run it and paste the
 * output back" needs no belief about access at all: 0/30 → 30/30 on GPT-6, 6/40
 * → 45/50 on Claude Sonnet 5 (github.com/cramt/m365-copilot-proxy,
 * docs/prompt-engineering.md, `relay`). Keep it plain: no capitals, no "never".
 */
export function buildToolProtocolInstructions(catalog: ToolCatalog): string {
  if (catalog.entries.length === 0) return "";

  const hasDiagnostics = catalog.entries.some((entry) => entry.capability === "diagnostics");
  const editors = catalog.entries.filter((entry) => entry.capability === "edit");
  const hasNative = catalog.entries.some((entry) => entry.origin === "editor");
  const hasOurs = catalog.entries.some((entry) => entry.origin === "m365");
  const hasSpawnAgents = catalog.entries.some(
    (entry) => entry.name === M365_TOOL_NAMES.spawnAgents,
  );
  const hasGitCommit = catalog.entries.some((entry) => entry.name === M365_TOOL_NAMES.gitCommit);

  const rules = [
    t("protocol.rule.oneCall"),
    ...(hasNative && hasOurs ? [t("protocol.rule.paths")] : []),
    ...(hasNative && !hasOurs ? [t("protocol.rule.absolutePaths")] : []),
    ...(catalog.hasEditTools ? [t("protocol.rule.readFirst"), t("protocol.rule.longFence")] : []),
    ...(hasSpawnAgents ? [t("protocol.rule.spawn", M365_TOOL_NAMES.spawnAgents)] : []),
    ...(hasGitCommit
      ? [
          t(
            "protocol.rule.commit",
            M365_TOOL_NAMES.gitCommit,
            M365_TOOL_NAMES.generateCommitMessage,
          ),
        ]
      : []),
    ...(editors.length > 1 ? [t("protocol.rule.sameEditor", editors[0]?.name ?? "")] : []),
    ...(catalog.hasEditTools
      ? [t("protocol.rule.outputLimit", OUTPUT_LIMIT_CHARS.toLocaleString(bizChatLocale()))]
      : []),
    ...(catalog.hasEditTools && hasDiagnostics ? [t("protocol.rule.diagnostics")] : []),
    t("protocol.rule.errors"),
    t("protocol.rule.report"),
    t("protocol.rule.noSilentOptional"),
  ].join("\n");

  return [
    t("protocol.relay"),
    t("protocol.howTo") + (catalog.fenced.shell ? t("protocol.howTo.shell") : ""),
    t("protocol.untrusted"),
    `${t("protocol.rulesHeader")}\n${rules}`,
    `${t("protocol.toolsHeader")}\n\n${catalog.entries.map(renderCatalogEntry).join("\n\n")}`,
  ].join("\n\n");
}

/** A tool as the model sees it: what it does, and the block to send to use it. */
function renderCatalogEntry(entry: CatalogEntry): string {
  const about = entry.description || t("protocol.noDescription");
  const template = entry.spec.batchEdits
    ? [
        `\`\`\`${entry.name}`,
        `path: ${t("protocol.template.path")}`,
        "<<<<<<< SEARCH",
        t("protocol.template.search"),
        "=======",
        t("protocol.template.replace"),
        ">>>>>>> REPLACE",
        "```",
      ].join("\n")
    : renderFencedTemplate(entry.spec, entry.parameters, t("protocol.template.optional"));
  return `${entry.name}: ${about}\n${template}`;
}

/**
 * A short reminder meant for the END of the prompt (right before the model
 * answers): recency beats a rule stated far above a long transcript, which is
 * where the models that default to prose tend to drop it.
 */
export function buildToolProtocolReminder(catalog: ToolCatalog, toolsRequired = false): string {
  if (catalog.entries.length === 0) return "";
  return t(toolsRequired ? "protocol.reminder.required" : "protocol.reminder.optional");
}

/**
 * Streaming decoder that splits a plain-text model reply into user-visible text
 * and tool calls. BizChat is a chat model, not a native tool-caller, so the
 * "tool call" is a code block named after the tool (fencedCalls.ts), or the older
 * marker `<m365_tool_call>{json}</m365_tool_call>`, optionally followed by
 * `<m365_block>` sections (see the module docs above `BLOCK_REF_RE`). A block in
 * another language is just code in the answer, and a shell block counts as a call
 * only if the reply opens with it. The decoder is deliberately forgiving because
 * each ring formats it differently:
 *
 *  - the marker can appear anywhere, not only at the very start (models like to
 *    say "I'll read the file first" before calling a tool);
 *  - a code fence the model may wrap the marker in is stripped;
 *  - the opening marker tolerates a stray extra `<` and spaces;
 *  - the CLOSING marker is optional — the end of the call is found by balancing
 *    the JSON braces, so Claude/reasoning replies that omit `</m365_tool_call>`
 *    still execute instead of leaking the raw marker into the chat;
 *  - if a fresh `<m365_tool_call>` appears again before the previous one
 *    finished, the earlier (abandoned) attempt is dropped silently and only
 *    the later one is parsed — observed in practice: BizChat occasionally
 *    restarts a message mid-call, and blindly concatenating the restart onto
 *    the abandoned attempt corrupts the JSON;
 *  - the first valid call ends decoding for the turn (VS Code re-invokes us with
 *    the tool result), and any trailing prose is dropped so it can't leak as a
 *    second, contradictory answer.
 */
export class ToolCallDecoder {
  private mode: "scan" | "collecting-blocks" | "collecting-fence" | "passthrough" | "done";
  private buffer = "";
  /** Everything the reply has written so far, to tell a cut-off call from a malformed one. */
  private received = 0;
  private readonly allowedNames: ReadonlySet<string>;
  private readonly onText: (text: string) => void;
  private readonly onToolCall: (call: DecodedToolCall) => void;
  private readonly fenced: FencedCalls | undefined;

  // State of the prose already let through, to tell code in the answer from a call.
  /** Length of the code fence the prose is inside of, or 0. */
  private proseFence = 0;
  private proseTail = "";
  private proseHead = "";

  // State while reading a tool's code block.
  private fenceCall: OpenFence | null = null;
  private fenceLines: string[] = [];
  private fenceDepth = 0;
  private inSearchReplace = false;

  // State while collecting <m365_block> sections for a call whose text
  // fields were "@@block:ID@@" placeholders (m365_apply_edits).
  private pendingCall: DecodedToolCall | null = null;
  private neededBlockIds = new Set<string>();
  private collectedBlocks = new Map<string, string>();
  private currentBlockId: string | null = null;
  private blockBuffer = "";

  constructor(
    allowedNames: ReadonlySet<string>,
    onText: (text: string) => void,
    onToolCall: (call: DecodedToolCall) => void,
    fenced?: FencedCalls,
  ) {
    this.allowedNames = allowedNames;
    this.onText = onText;
    this.onToolCall = onToolCall;
    this.fenced = fenced;
    this.mode = allowedNames.size === 0 ? "passthrough" : "scan";
  }

  push(delta: string): void {
    if (!delta) return;
    this.received += delta.length;
    if (this.mode === "passthrough") {
      this.onText(delta);
      return;
    }
    if (this.mode === "done") return;
    this.buffer += delta;
    this.drain();
  }

  finish(): void {
    // A block whose closing fence had no line break after it, or a last line
    // that opens one and ends the reply.
    if (this.fenced && this.mode === "scan" && this.buffer && !this.buffer.endsWith("\n")) {
      if (this.findToolFence(`${this.buffer}\n`)) {
        this.buffer += "\n";
        this.drain();
      }
    }
    if (this.mode === "collecting-fence") this.finishFence();
    if (this.mode === "scan" && this.buffer) {
      // We were mid tool-call but the JSON never completed. Drop the marker
      // and its partial JSON instead of leaking it into the chat; keep only
      // any prose that preceded it (normally none — drain already flushed it).
      const open = findOpenMarker(this.buffer);
      if (open) {
        const preamble = stripTrailingOpenFence(this.buffer.slice(0, open.index));
        if (preamble) this.emit(preamble);
        // Cut off by the output limit, not malformed: say so, or the turn ends blank.
        if (this.received >= NEAR_OUTPUT_LIMIT_CHARS)
          this.onText(this.incompleteCallNotice(nameInPartialCall(this.buffer)));
      } else {
        this.emit(stripTrailingPartialOpen(this.buffer));
      }
    }
    // A call whose <m365_block> sections never fully arrived. The marker,
    // JSON and half-written blocks must not leak into the chat, but dropping
    // everything silently leaves the turn blank and the user with no idea
    // why nothing happened — so say it in one line instead.
    if (this.mode === "collecting-blocks" && this.pendingCall) {
      this.onText(this.incompleteCallNotice(this.pendingCall.name));
    }
    this.buffer = "";
    this.blockBuffer = "";
    this.pendingCall = null;
    this.neededBlockIds.clear();
    this.collectedBlocks.clear();
    this.currentBlockId = null;
    if (this.mode === "scan" || this.mode === "collecting-blocks") this.mode = "passthrough";
  }

  /** Prose reaching the user, noted so that code in the answer is not read as a call. */
  private emit(text: string): void {
    if (!text) return;
    this.noteProse(text);
    this.onText(text);
  }

  private noteProse(text: string): void {
    if (!this.fenced) return;
    if (this.proseHead.length < PROSE_HEAD_CHARS) this.proseHead += text.slice(0, PROSE_HEAD_CHARS);
    const lines = `${this.proseTail}${text}`.split("\n");
    this.proseTail = lines.pop() ?? "";
    for (const line of lines) this.proseFence = fenceStateAfter(line, this.proseFence);
  }

  /** The first complete line of `text` that opens a call as a code block, if any. */
  private findToolFence(text: string): OpenFence | null {
    if (!this.fenced) return null;
    let state = this.proseFence;
    let offset = 0;
    for (;;) {
      const end = text.indexOf("\n", offset);
      if (end === -1) return null;
      const line = text.slice(offset, end).replace(/\r$/, "");
      if (state === 0) {
        const whole = FENCE_LINE.exec(line);
        const glued = whole ? null : GLUED_OPENER.exec(line);
        const language = whole?.[2] ?? glued?.[2] ?? "";
        const index = offset + (glued?.index ?? 0);
        const target = language ? this.fenceTarget(language, text.slice(0, index), !glued) : null;
        if (target) {
          const length = (whole ?? glued)![1]!.length;
          return { ...target, language, index, bodyStart: end + 1, length };
        }
      }
      state = fenceStateAfter(line, state);
      offset = end + 1;
    }
  }

  /** The tool a block in `language` calls: one named so, or the shell if the reply opens with it. */
  private fenceTarget(
    language: string,
    preamble: string,
    wholeLine: boolean,
  ): Pick<OpenFence, "name" | "shell"> | null {
    const name = resolveToolName(language, this.allowedNames);
    if (name && this.fenced?.specs.has(name)) return { name, shell: false };
    const shell = this.fenced?.shell;
    if (!shell || !wholeLine || !isShellLanguage(language)) return null;
    // A document or an explanation announces itself before its first block: a
    // heading, earlier code, a long intro. Then this is an example, not a request.
    const before = `${this.proseHead}${preamble}`;
    const opensWithIt =
      before.trim().length < MAX_SHELL_PREAMBLE_CHARS &&
      !before.includes("```") &&
      !/^#{1,6}\s/m.test(before);
    return opensWithIt ? { name: shell.name, shell: true } : null;
  }

  /** One step of reading a call's block. Returns true to keep looping, false to wait for more. */
  private drainFence(): boolean {
    const end = this.buffer.indexOf("\n");
    if (end === -1) {
      if (this.buffer.length > MAX_BLOCK_CHARS) this.abandonFence();
      return false;
    }
    const line = this.buffer.slice(0, end).replace(/\r$/, "");
    this.buffer = this.buffer.slice(end + 1);
    if (this.closesFence(line)) {
      this.fireFence();
      return true;
    }
    this.fenceLines.push(line);
    if (this.fenceLines.length * 80 > MAX_BLOCK_CHARS) this.abandonFence();
    return true;
  }

  /** Whether this line ends the block. Whatever is between SEARCH and REPLACE is text. */
  private closesFence(line: string): boolean {
    if (this.inSearchReplace) {
      if (/^[ \t]*>{5,}[ \t]*REPLACE[ \t]*$/.test(line)) this.inSearchReplace = false;
      return false;
    }
    if (/^[ \t]*<{5,}[ \t]*SEARCH[ \t]*$/.test(line)) {
      this.inSearchReplace = true;
      return false;
    }
    const open = this.fenceCall;
    if (!open) return false;
    const fence = FENCE_LINE.exec(line);
    if (fence) {
      // shortcut: a new file with unnamed ``` pairs inside closes early; the prompt
      // asks for a longer fence then, and the result is under review anyway.
      if (fence[2]) {
        this.fenceDepth += 1;
        return false;
      }
      if ((fence[1]?.length ?? 0) < open.length) return false;
      if (this.fenceDepth > 0) {
        this.fenceDepth -= 1;
        return false;
      }
      return true;
    }
    // `ls -la```: the closing fence stuck to the command.
    if (open.shell && this.fenceDepth === 0 && /\S`{3,}[ \t]*$/.test(line)) {
      this.fenceLines.push(line.replace(/`{3,}[ \t]*$/, ""));
      return true;
    }
    return false;
  }

  private fireFence(): void {
    const open = this.fenceCall;
    const fenced = this.fenced;
    const body = this.fenceLines.join("\n");
    this.resetFence();
    if (!open || !fenced) return;
    const spec = fenced.specs.get(open.name);
    const input =
      open.shell && fenced.shell
        ? shellInput(fenced.shell, body)
        : spec
          ? parseFencedBody(spec, body)
          : null;
    if (!input) {
      // Not a usable call after all: it stays in the answer, nothing is lost.
      this.emit(
        `${"`".repeat(open.length)}${open.language}\n${body}\n${"`".repeat(open.length)}\n`,
      );
      this.mode = "scan";
      return;
    }
    this.mode = "done";
    this.buffer = "";
    this.onToolCall({ name: open.name, input });
  }

  /** The reply ended inside a block. A call that writes nothing is complete enough to run. */
  private finishFence(): void {
    const open = this.fenceCall;
    const fenced = this.fenced;
    if (!open || !fenced) return;
    const rest = this.buffer.replace(/\r?\n$/, "");
    this.buffer = "";
    if (rest && this.closesFence(rest)) {
      this.fireFence();
      return;
    }
    if (rest) this.fenceLines.push(rest);
    const spec = fenced.specs.get(open.name);
    if (open.shell || (spec && !spec.batchEdits && !spec.editPair && !spec.body)) {
      this.fireFence();
      if (this.mode === "done") return;
    } else {
      this.onText(this.incompleteCallNotice(open.name));
    }
    this.resetFence();
    this.mode = "passthrough";
  }

  private abandonFence(): void {
    const name = this.fenceCall?.name ?? "?";
    this.resetFence();
    this.buffer = "";
    this.mode = "passthrough";
    this.onText(this.incompleteCallNotice(name));
  }

  private resetFence(): void {
    this.fenceCall = null;
    this.fenceLines = [];
    this.fenceDepth = 0;
    this.inSearchReplace = false;
  }

  private drain(): void {
    for (;;) {
      if (this.mode === "scan") {
        if (!this.drainScan()) return;
        continue;
      }
      if (this.mode === "collecting-blocks") {
        if (!this.drainBlocks()) return;
        continue;
      }
      if (this.mode === "collecting-fence") {
        if (!this.drainFence()) return;
        continue;
      }
      return;
    }
  }

  /** One scanning step. Returns true to keep looping now, false to wait for more data. */
  private drainScan(): boolean {
    if (!this.buffer) return false;

    const open = findOpenMarker(this.buffer);
    const fence = this.findToolFence(this.buffer);
    if (fence && (!open || fence.index < open.index)) {
      this.emit(this.buffer.slice(0, fence.index));
      this.buffer = this.buffer.slice(fence.bodyStart);
      this.fenceCall = fence;
      this.fenceLines = [];
      this.mode = "collecting-fence";
      return true;
    }
    if (!open) {
      // No opening marker yet: emit everything except a trailing fragment
      // that could still grow into a marker on the next chunk — a partial
      // marker prefix, or an opening code fence the model might wrap the
      // marker in. Held text is never dropped, only deferred to finish().
      const hold = this.fenced
        ? Math.max(holdBackLength(this.buffer), partialFenceLength(this.buffer))
        : holdBackLength(this.buffer);
      const safe = this.buffer.length - hold;
      if (safe > 0) {
        this.emit(this.buffer.slice(0, safe));
        this.buffer = this.buffer.slice(safe);
        return true;
      }
      return false;
    }

    if (open.index > 0) {
      const preamble = stripTrailingOpenFence(this.buffer.slice(0, open.index));
      if (preamble) this.emit(preamble);
      this.buffer = this.buffer.slice(open.index);
      return true; // reprocess with the marker at index 0
    }

    // Resync to a later marker if it already arrived: a sign the previous
    // attempt was abandoned/restarted before it closed. Drop the abandoned
    // span silently — it's protocol scaffolding, not prose.
    const rest = this.buffer.slice(open.length);
    const later = findOpenMarker(rest);
    if (later) {
      this.buffer = rest.slice(later.index);
      return true;
    }

    const afterOpen = open.length;
    const start = locateJsonStart(this.buffer, afterOpen);
    if (start.kind === "wait") {
      this.spillIfRunaway();
      return false; // JSON hasn't started yet; wait for more text
    }
    if (start.kind === "reject") {
      // A literal marker in prose, not an actual call (no JSON follows it).
      // Surface it verbatim and keep scanning the rest of the stream.
      this.emit(this.buffer.slice(0, afterOpen));
      this.buffer = this.buffer.slice(afterOpen);
      return true;
    }

    const end = findJsonEnd(this.buffer, start.index);
    if (end === -1) {
      this.spillIfRunaway();
      return false; // marker + JSON opened but not balanced yet
    }

    const rawSpan = this.buffer.slice(0, end);
    const call = parseToolCall(this.buffer.slice(start.index, end), this.allowedNames);
    this.buffer = this.buffer.slice(end);
    if (call) {
      this.beginCall(call);
      return true;
    }
    // Complete JSON but not a valid/known tool call: surface the raw span so
    // nothing is lost and keep scanning after it.
    this.emit(rawSpan);
    return true;
  }

  /** A JSON call was parsed. Fire it immediately, or start collecting its raw blocks. */
  private beginCall(call: DecodedToolCall): void {
    const needed = collectBlockRefs(call);
    if (needed.length === 0) {
      this.mode = "done";
      this.buffer = "";
      this.onToolCall(call);
      return;
    }
    this.pendingCall = call;
    this.neededBlockIds = new Set(needed);
    this.collectedBlocks = new Map();
    this.currentBlockId = null;
    this.blockBuffer = "";
    this.mode = "collecting-blocks";
  }

  /** One block-collecting step. Returns true to keep looping now, false to wait for more data. */
  private drainBlocks(): boolean {
    if (this.currentBlockId === null) {
      const open = findBlockOpen(this.buffer);
      if (!open) {
        // Boilerplate/whitespace between blocks — never shown to the user.
        // Hold back from the last unmatched `<` onward: it could be the
        // start of the next `<m365_block …>` still streaming in.
        const lastLt = this.buffer.lastIndexOf("<");
        const safe = lastLt === -1 ? this.buffer.length : lastLt;
        if (safe > 0) this.buffer = this.buffer.slice(safe);
        return this.spillBlocksIfRunaway();
      }
      this.currentBlockId = open.id;
      this.buffer = this.buffer.slice(open.index + open.length);
      return true;
    }

    const close = BLOCK_CLOSE_RE.exec(this.buffer);
    if (!close) {
      const hold = partialSuffixLength(this.buffer, BLOCK_CLOSE_LITERAL);
      const consume = this.buffer.length - hold;
      if (consume > 0) {
        this.blockBuffer += this.buffer.slice(0, consume);
        this.buffer = this.buffer.slice(consume);
      }
      return this.spillBlocksIfRunaway();
    }

    this.blockBuffer += this.buffer.slice(0, close.index);
    this.buffer = this.buffer.slice(close.index + close[0].length);
    this.collectedBlocks.set(this.currentBlockId, stripOneEdgeNewline(this.blockBuffer));
    this.neededBlockIds.delete(this.currentBlockId);
    this.currentBlockId = null;
    this.blockBuffer = "";

    if (this.neededBlockIds.size === 0 && this.pendingCall) {
      const call = this.pendingCall;
      substituteBlockRefs(call, this.collectedBlocks);
      this.pendingCall = null;
      this.mode = "done";
      this.buffer = "";
      this.onToolCall(call);
      return false;
    }
    return true;
  }

  /** Give up if the blocks never close, so a huge/garbled stream can't get stuck. */
  private spillBlocksIfRunaway(): boolean {
    if (this.blockBuffer.length + this.buffer.length <= MAX_BLOCK_CHARS) return false;
    if (this.pendingCall) this.onText(this.incompleteCallNotice(this.pendingCall.name));
    this.mode = "passthrough";
    this.buffer = "";
    this.blockBuffer = "";
    this.pendingCall = null;
    this.neededBlockIds.clear();
    this.collectedBlocks.clear();
    this.currentBlockId = null;
    return false;
  }

  private incompleteCallNotice(name: string): string {
    return this.received >= NEAR_OUTPUT_LIMIT_CHARS
      ? t("protocol.incompleteCallLimit", name, OUTPUT_LIMIT_CHARS.toLocaleString(bizChatLocale()))
      : t("protocol.incompleteCall", name);
  }

  /** Give up buffering if a marker never closes, so a huge stream can't get stuck. */
  private spillIfRunaway(): void {
    if (this.buffer.length > MAX_TOOL_CALL_CHARS) {
      this.onText(this.buffer);
      this.buffer = "";
      this.mode = "passthrough";
    }
  }
}

/** A code fence on a line of its own: its backticks and its language, if any. */
const FENCE_LINE = /^[ \t]*(`{3,})([A-Za-z0-9_.-]*)[ \t]*$/;
/** An opening fence at the end of a line of prose (`Reading it: ```read_file`). */
const GLUED_OPENER = /(`{3,})([A-Za-z0-9_.-]+)[ \t]*$/;
/** How much of the reply's start is kept to tell an answer from a reply that opens with a command. */
const PROSE_HEAD_CHARS = 400;
const MAX_SHELL_PREAMBLE_CHARS = 200;

interface OpenFence {
  readonly name: string;
  /** The model wrote a shell block: its body is the command. */
  readonly shell: boolean;
  readonly index: number;
  readonly bodyStart: number;
  /** How many backticks the block opened with. */
  readonly length: number;
  readonly language: string;
}

/** Whether prose is inside a code block after `line`: the opening fence's length, or 0. */
function fenceStateAfter(line: string, state: number): number {
  const fence = FENCE_LINE.exec(line.replace(/\r$/, ""));
  if (!fence) return state;
  const length = fence[1]?.length ?? 0;
  if (state === 0) return length;
  return !fence[2] && length >= state ? 0 : state;
}

/** A trailing line that may still become an opening fence: hold it until it is complete. */
function partialFenceLength(buffer: string): number {
  const match = /`+[A-Za-z0-9_.-]*[ \t]*\r?$/.exec(buffer);
  return match ? buffer.length - match.index : 0;
}

function parseToolCall(payload: string, allowed: ReadonlySet<string>): DecodedToolCall | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const record = asPlainObject(parsed);
  if (!record) return null;

  const rawName = NAME_KEYS.map((key) => record[key]).find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (!rawName) return null;
  const name = resolveToolName(rawName, allowed);
  if (!name) return null;

  const input = resolveInput(record);
  return input ? { name, input } : null;
}

const NAME_KEYS = ["name", "tool", "tool_name", "toolName", "function"] as const;
const INPUT_KEYS = [
  "input",
  "arguments",
  "args",
  "parameters",
  "params",
  "tool_input",
  "toolInput",
] as const;

/**
 * Resuelve el nombre emitido contra lo que el host ofreció DE VERDAD: sólo se
 * ejecuta lo que VS Code puede ejecutar. Con decenas de herramientas en juego
 * (nativas, MCP y las nuestras) el modelo confunde a menudo el separador o
 * arrastra el prefijo `functions.` del function-calling nativo, así que se
 * intenta también una coincidencia normalizada antes de rendirse.
 */
function resolveToolName(raw: string, allowed: ReadonlySet<string>): string | null {
  const candidate = raw.trim();
  if (allowed.has(candidate)) return candidate;

  const bare = candidate.split(/[./]/).pop() ?? candidate;
  if (allowed.has(bare)) return bare;

  const wanted = normalizeToolName(bare);
  if (!wanted) return null;
  for (const name of allowed) {
    if (normalizeToolName(name) === wanted) return name;
  }
  return null;
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Los argumentos, vengan como vengan: `input` (lo que pedimos), `arguments`
 * como objeto o como cadena JSON (lo que arrastran los modelos con
 * function-calling nativo) o directamente al mismo nivel que `name`.
 */
function resolveInput(record: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of INPUT_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    const object = asPlainObject(value);
    if (object) return object;
    if (typeof value === "string") {
      try {
        const nested = asPlainObject(JSON.parse(value));
        if (nested) return nested;
      } catch {
        /* no era JSON: la llamada no es utilizable */
      }
    }
    return null;
  }

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if ((NAME_KEYS as readonly string[]).includes(key)) continue;
    rest[key] = value;
  }
  return rest;
}

/** IDs de bloque referenciados en cualquier campo de texto del `input`. */
function collectBlockRefs(call: DecodedToolCall): string[] {
  const ids = new Set<string>();
  walkStrings(call.input, (text) => {
    for (const match of text.matchAll(BLOCK_REF_RE)) if (match[1]) ids.add(match[1]);
    return undefined;
  });
  return [...ids];
}

/** Sustituye cada "@@block:ID@@" del `input` por el texto crudo ya recogido. */
function substituteBlockRefs(call: DecodedToolCall, blocks: ReadonlyMap<string, string>): void {
  walkStrings(call.input, (text) =>
    text.replace(BLOCK_REF_RE, (marker, id: string) => blocks.get(id) ?? marker),
  );
}

/**
 * Recorre en profundidad las cadenas del `input`, sustituyéndolas cuando
 * `visit` devuelve algo. Acotado en profundidad y en número de nodos: el
 * `input` lo escribe un modelo, así que no se da por hecho que sea pequeño ni
 * sensato. Es genérico a propósito — el formato de bloques vale para cualquier
 * herramienta, no sólo para `m365_apply_edits`, y las de edición nativas de
 * VS Code lo necesitan igual.
 */
function walkStrings(root: unknown, visit: (text: string) => string | undefined): void {
  let budget = MAX_INPUT_NODES;

  const step = (value: unknown, depth: number): void => {
    if (depth > MAX_INPUT_DEPTH || budget <= 0) return;

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if ((budget -= 1) <= 0) return;
        const item: unknown = value[index];
        if (typeof item === "string") {
          const replacement = visit(item);
          if (replacement !== undefined) value[index] = replacement;
        } else {
          step(item, depth + 1);
        }
      }
      return;
    }

    const record = asPlainObject(value);
    if (!record) return;
    for (const key of Object.keys(record)) {
      if ((budget -= 1) <= 0) return;
      const item = record[key];
      if (typeof item === "string") {
        const replacement = visit(item);
        if (replacement !== undefined) record[key] = replacement;
      } else {
        step(item, depth + 1);
      }
    }
  };

  step(root, 0);
}

/** Locate the first (possibly mangled) opening marker in the buffer. */
function findOpenMarker(buffer: string): { index: number; length: number } | null {
  const match = TOOL_CALL_OPEN_RE.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

/** Locate a `<m365_block id="...">` opening tag. */
function findBlockOpen(buffer: string): { index: number; length: number; id: string } | null {
  const match = BLOCK_OPEN_RE.exec(buffer);
  return match ? { index: match.index, length: match[0].length, id: match[1] ?? "" } : null;
}

/** Strip exactly one newline immediately inside each edge, if present — lets the
 * model put a block's content on its own line(s) without that formatting
 * becoming part of the captured text. */
function stripOneEdgeNewline(text: string): string {
  let out = text;
  if (out.startsWith("\r\n")) out = out.slice(2);
  else if (out.startsWith("\n")) out = out.slice(1);
  if (out.endsWith("\r\n")) out = out.slice(0, -2);
  else if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

type JsonStart = { kind: "found"; index: number } | { kind: "wait" } | { kind: "reject" };

/**
 * Find where the tool-call JSON begins after an opening marker. Only whitespace
 * and an optional opening code fence may sit between the marker and the `{`, so
 * a marker the model merely mentioned in prose (followed by words, not JSON) is
 * rejected instead of swallowing unrelated text.
 */
function locateJsonStart(buffer: string, afterOpen: number): JsonStart {
  const lead = JSON_LEADING_RE.exec(buffer.slice(afterOpen));
  const index = afterOpen + (lead ? lead[0].length : 0);
  if (index >= buffer.length) return { kind: "wait" }; // only whitespace/fence so far
  return buffer[index] === "{" ? { kind: "found", index } : { kind: "reject" };
}

/**
 * Index just past the end of the balanced JSON object starting at `start`, or
 * -1 if it is not closed yet. Tracks string state so braces inside string
 * values (e.g. an `oldText` snippet) never end the object early.
 */
function findJsonEnd(buffer: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && (depth -= 1) === 0) return i + 1;
  }
  return -1;
}

/** Length of the longest buffer suffix that is a proper prefix of `literal`. */
function partialSuffixLength(buffer: string, literal: string): number {
  const max = Math.min(buffer.length, literal.length - 1);
  for (let k = max; k >= 1; k -= 1) {
    if (buffer.endsWith(literal.slice(0, k))) return k;
  }
  return 0;
}

/** Length of the longest buffer suffix that is a proper prefix of the marker. */
function partialOpenSuffixLength(buffer: string): number {
  return partialSuffixLength(buffer, TOOL_CALL_OPEN);
}

/** How many trailing chars to keep buffered because they might precede a marker. */
function holdBackLength(buffer: string): number {
  let hold = partialOpenSuffixLength(buffer);
  // A code fence at the very end may be immediately followed by a marker on the
  // next chunk; hold it so it can be stripped instead of leaking as a stray ```.
  const fence = buffer.match(/(?:^|\n)[ \t]*(?:`{3,}|~{3,})[A-Za-z0-9_-]*[ \t]*\n?$/);
  if (fence && fence.index !== undefined) {
    const fenceStart = fence.index + (fence[0].startsWith("\n") ? 1 : 0);
    hold = Math.max(hold, buffer.length - fenceStart);
  }
  return hold;
}

/** Drop a trailing opening code fence (```json etc.) the model wrapped the call in. */
function stripTrailingOpenFence(text: string): string {
  return text.replace(/\r?\n?[ \t]*(?:`{3,}|~{3,})[A-Za-z0-9_-]*[ \t]*\r?\n?$/, "");
}

/** Drop a trailing partial opening marker so a half-written marker never leaks. */
function stripTrailingPartialOpen(text: string): string {
  const n = partialOpenSuffixLength(text);
  return n > 0 ? text.slice(0, text.length - n) : text;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

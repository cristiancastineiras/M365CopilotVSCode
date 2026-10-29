/**
 * Runtime smoke tests — no VS Code host required.
 *  - profile.ts: parse a bare JWT and a full JSON profile.
 *  - client.ts:  run streamCopilotTurn against a mock SignalR server that
 *                speaks the real BizChat handshake + frame protocol, in both
 *                snapshot mode and delta mode.
 *
 * Run: node --experimental-strip-types test/e2e.mts
 */
import { WebSocketServer } from "ws";
import assert from "node:assert/strict";
import http from "node:http";
import {
  streamCopilotTurn,
  streamCopilotTurnWithRetry,
  CopilotAuthError,
  CopilotClientError,
  CopilotModelUnavailableError,
  CopilotDisengagedError,
  CopilotLicenseError,
  CopilotQuotaExhaustedError,
  CopilotThrottledError,
  CopilotPremiumRequiredError,
  TurnSummary,
  accountTier,
  capturedScenario,
  syntheticWebTemplate,
  type TurnImage,
  onModelOutcome,
  buildWebInvocationArgs,
  capturedVariants,
  isAccountLevelError,
  isRetryableClientError,
  quotaResetAt,
  quotaWindowOf,
  serviceResultError,
  setTemporaryChat,
  sourcesOf,
  type TurnMode,
  accountThrottledUntil,
  noteServed,
  noteThrottled,
  onThrottleChange,
  THROTTLE_HOLD_MS,
  type ThrottleChange,
  accountOf,
  foreignAudience,
  looksLikeProfile,
  parsePastedProfile,
  M365_TOOL_NAMES,
  NEAR_OUTPUT_LIMIT_CHARS,
  OUTPUT_LIMIT_CHARS,
  ToolCallDecoder,
  buildToolCatalog,
  buildToolProtocolInstructions,
  buildToolProtocolReminder,
  type OfferedTool,
  type ToolCatalog,
  BUILTIN_MODELS,
  PAID_ONLY_TONES,
  isPaidSelector,
  mergeModels,
  modelIdForTone,
  normalizeSelector,
  parseToneSelector,
  parseCustomModels,
  parseModelCatalog,
  prettyTone,
  unannounced,
  describeProfile,
  type CopilotProfile,
  clearLog,
  debug,
  formatDebugData,
  initLogger,
  isDeepDebug,
  log,
  logEntryCount,
  redactSecrets,
  registerCatalogs,
  renderLogText,
  setDeepDebug,
  translate,
  translateIn,
  setLocale as setCoreLocale,
} from "@m365copilot/core/bizchat";
import { en as appEn } from "../src/locales/en.ts";
import { es as appEs } from "../src/locales/es.ts";
import { buildWebSearchPrompt, formatWebResult, sourcesMarkdown } from "../src/webSearchPrompt.ts";
import {
  cognates,
  excludeGlobs,
  globToRegExp,
  isExcluded,
  isSkippedPath,
  looksGenerated,
  normalizeTerm,
  queryTerms,
  retrievalQuery,
  splitIdentifier,
  tokenize,
} from "../src/rag/text.ts";
import { chunkLines, extractImports, extractSymbols, languageOf } from "../src/rag/code.ts";
import { analyzeFile, bestWindow, SearchIndex } from "../src/rag/searchIndex.ts";
import {
  formatAutoContext,
  formatSearchResults,
  renderFileDetail,
  renderFolderDetail,
  renderHits,
  renderProjectMap,
  renderSummary,
} from "../src/rag/projectMap.ts";

import { MarkdownStreamFormatter } from "../src/markdown.ts";
import {
  LEGACY_EXTENSION_ID,
  legacySettingKey,
  migrateLegacyValue,
  shouldMigrate,
} from "../src/legacy.ts";
import {
  buildReviewPrompt,
  formatRanges,
  mergeRanges,
  numberLines,
  parseReviewFindings,
  parseUnifiedDiff,
  touchesRanges,
  windowsAround,
  MAX_FINDINGS,
} from "../src/reviewPrompt.ts";
import { buildInlineEditPrompt, extractEditedCode, reindent } from "../src/inlineEditPrompt.ts";
import {
  renderTranscript,
  retrievalText,
  TRANSCRIPT_LIMITS,
  type TranscriptMessage,
} from "../src/transcript.ts";
import { describeShell, localDate, renderEnvironment } from "../src/environment.ts";
import { renderSkills } from "../src/skills.ts";
import { ConcurrencyLimiter, clip, runSubagentTask, runToolLoop } from "../src/subagentCore.ts";
import { replaceTextOnce } from "../tools/replaceText.ts";
import {
  looksLikeGiveUp,
  looksLikeRemoteSandbox,
  ProseHold,
  PROSE_HOLD_CHARS,
  toolFreeProblem,
} from "../src/giveUp.ts";
import {
  buildCommitMessagePrompt,
  cleanGeneratedCommitMessage,
  commitMessageProblem,
  normalizeCommitMessage,
  validateConventionalCommitMessage,
} from "../tools/commitMessage.ts";
import {
  budgetDiff,
  diffStats,
  historyContext,
  isNoisePath,
  splitDiff,
  ticketFromBranch,
} from "../tools/commitContext.ts";
import {
  formatMoment,
  LOCALES,
  messageKeys,
  placeholdersOf,
  resolveLocale,
  setLocale,
  t,
  tIn,
} from "../src/i18n.ts";
import {
  buildAutoCommitPrompt,
  describeEntry,
  MAX_COMMITS_PER_ROUND,
  parseAutoCommitDecision,
} from "../src/autoCommitPrompt.ts";
import {
  commitFiles,
  cooldownRemaining,
  hasConflicts,
  HeadMovedError,
  parseStatus,
  pathsToCommit,
  readChanges,
  readRepoState,
  recentSubjects,
  undoCommits,
  type GitRunner,
  type StatusEntry,
} from "../src/autoCommitGit.ts";
import { readChangesToDescribe } from "../src/scmChanges.ts";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asParticipantCommand,
  buildParticipantFraming,
  DEFAULT_MAX_TOOL_CALLS,
  fenceFor,
  maxStepsForCommand,
  toolsForCommand,
} from "../src/participantPrompts.ts";
import { readFileSync } from "node:fs";
import {
  acceptHunk,
  diffLines,
  revertHunkEdit,
  splitLines,
  type Hunk,
  type LineEdit,
} from "../tools/lineDiff.ts";

const RS = String.fromCharCode(0x1e);
const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fakeJwt(extra: Record<string, unknown> = {}): string {
  const payload = {
    aud: "https://substrate.office.com/sydney",
    oid: "user-oid",
    tid: "tenant-tid",
    upn: "someone@contoso.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  };
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.sig`;
}

// ---- profile.ts ------------------------------------------------------------

function testProfileParsing() {
  const bare = parsePastedProfile(fakeJwt());
  assert.equal(bare.claims?.upn, "someone@contoso.com");
  assert.equal(bare.claims?.oid, "user-oid");
  assert.equal(bare.invocationType, 4);

  const full = parsePastedProfile(
    JSON.stringify({
      accessToken: fakeJwt(),
      endpoint:
        "wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=old&source=officeweb",
      invocationTemplate: { tone: "magic", message: { author: "user" } },
      invocationType: 4,
      origin: "https://m365.cloud.microsoft",
    }),
  );
  assert.equal(full.endpoint?.includes("Chathub"), true);
  assert.equal((full.invocationTemplate as Record<string, unknown>).tone, "magic");

  assert.throws(() => parsePastedProfile("not a token"));

  // Copiado a mano de DevTools: `Bearer …`, o la URL del WebSocket del chat,
  // que es donde viaja de verdad el token de Copilot.
  assert.equal(parsePastedProfile(`Bearer ${fakeJwt()}`).claims?.oid, "user-oid");
  const fromUrl = parsePastedProfile(
    `wss://substrate.office.com/m365Copilot/Chathub/user-oid@tenant-tid?clientrequestid=c1&X-SessionId=s1` +
      `&access_token=${fakeJwt()}&variants=feature.a,feature.b&source=officeweb`,
  );
  assert.equal(fromUrl.claims?.upn, "someone@contoso.com");
  assert.doesNotMatch(
    fromUrl.endpoint ?? "",
    /access_token|clientrequestid|X-SessionId/,
    "el endpoint guardado no lleva el token",
  );
  assert.match(fromUrl.endpoint ?? "", /variants=feature\.a/);
  assert.throws(
    () => parsePastedProfile("wss://substrate.office.com/m365Copilot/Chathub/o@t?source=officeweb"),
    /access_token/,
  );

  // Un token de otro servicio se decodifica y no ha caducado (todo parece
  // conectado), pero el chat lo rechaza con 401: hay que reconocerlo.
  assert.equal(foreignAudience(fakeJwt()), null);
  assert.equal(
    foreignAudience(fakeJwt({ aud: "https://graph.microsoft.com" })),
    "https://graph.microsoft.com",
  );
  assert.equal(foreignAudience(fakeJwt({ aud: undefined })), "?");
  console.log(
    "  ✓ profile parsing (bare JWT, Bearer, Chathub URL, full JSON, rejects garbage, foreign audience)",
  );
}

// ---- markdown.ts ----------------------------------------------------------

function formatMarkdown(...chunks: string[]): string {
  const formatter = new MarkdownStreamFormatter();
  return chunks.map((chunk) => formatter.push(chunk)).join("") + formatter.finish();
}

function testMarkdownFormatting() {
  // The model is asked to fence its own code. When it complies, its fences
  // pass through completely untouched (never re-wrapped, never double-fenced).
  assert.equal(formatMarkdown("```ts\nconst value = 1;\n```\n"), "```ts\nconst value = 1;\n```\n");
  // CRLF is normalised to LF so streamed fences stay intact.
  assert.equal(formatMarkdown("a\r\nb\r\n"), "a\nb\n");

  // Plain prose, even multi-line, is never mistaken for code.
  assert.equal(
    formatMarkdown("Esto aplica el cambio propuesto.\nRevisa el resultado antes de continuar.\n"),
    "Esto aplica el cambio propuesto.\nRevisa el resultado antes de continuar.\n",
  );
  // Lists and headings are never mistaken for code either, despite short,
  // punctuation-heavy lines.
  assert.equal(
    formatMarkdown("## Pasos\n\n- Abre el archivo\n- Guarda los cambios\n- Ejecuta las pruebas\n"),
    "## Pasos\n\n- Abre el archivo\n- Guarda los cambios\n- Ejecuta las pruebas\n",
  );

  // SAFETY NET: a ring that ignores the "always fence code" instruction and
  // answers in unfenced multi-line code (observed on the GPT and reasoning
  // tones) gets auto-fenced, because Markdown otherwise collapses each line
  // break into a space and the code renders as one broken run-on line.
  assert.equal(
    formatMarkdown(
      "Aplica estas ediciones:\n\n",
      "const edit = new vscode.WorkspaceEdit();\n",
      "vscode.workspace.applyEdit(edit);\n",
    ),
    "Aplica estas ediciones:\n\n```\nconst edit = new vscode.WorkspaceEdit();\nvscode.workspace.applyEdit(edit);\n```\n",
  );

  // The blank line separating two paragraphs can itself arrive split across
  // two deltas (one push ending in a single \n, the next starting with the
  // second \n) — the boundary must still resolve without waiting for finish().
  assert.equal(
    formatMarkdown("function f() {\n  return 1;\n}\n", "\nMás detalles arriba.\n"),
    "```\nfunction f() {\n  return 1;\n}\n```\n\nMás detalles arriba.\n",
  );

  // A single unfenced code-like line is left alone — one line renders fine
  // inline, nothing collapses, so wrapping it would just be noise.
  assert.equal(formatMarkdown("const x = 1;\n"), "const x = 1;\n");

  // Mixed prose + unfenced code + more prose: only the code paragraph is
  // wrapped, each part streamed independently and in order.
  assert.equal(
    formatMarkdown(
      "Primero define la función:\n\n" +
        "function suma(a, b) {\n  return a + b;\n}\n\n" +
        "Luego llámala con dos números.\n",
    ),
    "Primero define la función:\n\n" +
      "```\nfunction suma(a, b) {\n  return a + b;\n}\n```\n\n" +
      "Luego llámala con dos números.\n",
  );

  // An unfenced code paragraph split across arbitrary chunk boundaries (mid
  // line, mid keyword) still resolves to one correctly fenced block — the
  // decision is only ever made once the whole paragraph has arrived.
  assert.equal(
    formatMarkdown("func", "tion f() {\n", "  return 1;\n", "}", "\n"),
    "```\nfunction f() {\n  return 1;\n}\n```\n",
  );

  // A fence opened but never closed by the time the stream ends is passed
  // through as-is at finish() — we never guess at unterminated fences.
  assert.equal(formatMarkdown("```ts\nconst x = 1;\n"), "```ts\nconst x = 1;\n");

  console.log(
    "  ✓ markdown formatter fences unfenced code, leaves prose/lists/existing fences untouched",
  );
}

// ---- toolProtocol.ts ------------------------------------------------------

function testToolProtocol() {
  const text: string[] = [];
  const calls: unknown[] = [];
  const decoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => text.push(chunk),
    (call) => calls.push(call),
  );
  decoder.push(`<m365_tool_call>{"name":"${M365_TOOL_NAMES.readFile}",`);
  decoder.push('"input":{"path":"src/extension.ts","startLine":1}}</m365_tool_call>');
  decoder.finish();
  assert.deepEqual(calls, [
    { name: M365_TOOL_NAMES.readFile, input: { path: "src/extension.ts", startLine: 1 } },
  ]);
  assert.deepEqual(text, []);

  const prose: string[] = [];
  const proseDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => prose.push(chunk),
    () => assert.fail("No debe llamar una herramienta para texto normal."),
  );
  proseDecoder.push("Explico el cambio antes de proponerlo.");
  proseDecoder.finish();
  assert.deepEqual(prose, ["Explico el cambio antes de proponerlo."]);

  // A short preamble before the marker must NOT hide the tool call, and any
  // prose after the call is dropped (the model was told to stop).
  const pre = { text: [] as string[], calls: [] as unknown[] };
  const preDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => pre.text.push(chunk),
    (call) => pre.calls.push(call),
  );
  preDecoder.push("Voy a leer el archivo primero.\n");
  preDecoder.push(
    `<m365_tool_call>{"name":"${M365_TOOL_NAMES.readFile}","input":{"path":"a.ts"}}</m365_tool_call>`,
  );
  preDecoder.push("texto que se descarta tras la llamada");
  preDecoder.finish();
  assert.deepEqual(pre.calls, [{ name: M365_TOOL_NAMES.readFile, input: { path: "a.ts" } }]);
  assert.equal(pre.text.join(""), "Voy a leer el archivo primero.\n");

  // A marker the model wrapped in a ```json fence, split across chunks, is
  // still decoded cleanly and the fence never leaks as text.
  const fenced = { text: [] as string[], calls: [] as unknown[] };
  const fencedDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.listFiles]),
    (chunk) => fenced.text.push(chunk),
    (call) => fenced.calls.push(call),
  );
  fencedDecoder.push("```json\n");
  fencedDecoder.push(
    `<m365_tool_call>{"name":"${M365_TOOL_NAMES.listFiles}","input":{}}</m365_tool_call>\n`,
  );
  fencedDecoder.push("```");
  fencedDecoder.finish();
  assert.deepEqual(fenced.calls, [{ name: M365_TOOL_NAMES.listFiles, input: {} }]);
  assert.equal(fenced.text.join("").trim(), "");

  // The reasoning/Claude rings often omit the closing </m365_tool_call>. The
  // end of the call must still be found by balancing the JSON braces, and the
  // raw marker must NOT leak into the chat.
  const noClose = { text: [] as string[], calls: [] as unknown[] };
  const noCloseDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.applyWorkspaceEdits]),
    (chunk) => noClose.text.push(chunk),
    (call) => noClose.calls.push(call),
  );
  // Braces inside a string value (oldText/newText) must not end the object early.
  noCloseDecoder.push(
    `<m365_tool_call>{"name":"${M365_TOOL_NAMES.applyWorkspaceEdits}","input":{"edits":[` +
      `{"operation":"replace","path":"a.ts","oldText":"function f() {}","newText":"const f = () => {}"}]}}`,
  );
  noCloseDecoder.finish();
  assert.deepEqual(noClose.calls, [
    {
      name: M365_TOOL_NAMES.applyWorkspaceEdits,
      input: {
        edits: [
          {
            operation: "replace",
            path: "a.ts",
            oldText: "function f() {}",
            newText: "const f = () => {}",
          },
        ],
      },
    },
  ]);
  assert.equal(noClose.text.join(""), "");

  // A stray extra `<` (<<m365_tool_call>) with no closing marker, split across
  // chunks, still decodes into a single clean call.
  const doubled = { text: [] as string[], calls: [] as unknown[] };
  const doubledDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => doubled.text.push(chunk),
    (call) => doubled.calls.push(call),
  );
  doubledDecoder.push(`<<m365_tool_call>{"name":"${M365_TOOL_NAMES.readFile}",`);
  doubledDecoder.push('"input":{"path":"test.js","startLine":1,"endLine":30}}');
  doubledDecoder.finish();
  assert.deepEqual(doubled.calls, [
    { name: M365_TOOL_NAMES.readFile, input: { path: "test.js", startLine: 1, endLine: 30 } },
  ]);
  assert.equal(doubled.text.join("").trim(), "");

  // A marker merely mentioned in prose (no JSON after it) must be treated as
  // text, never as a call.
  const mention = { text: [] as string[], calls: [] as unknown[] };
  const mentionDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => mention.text.push(chunk),
    (call) => mention.calls.push(call),
  );
  mentionDecoder.push("Para llamar una herramienta escribe <m365_tool_call> seguido del JSON.");
  mentionDecoder.finish();
  assert.deepEqual(mention.calls, []);
  assert.equal(
    mention.text.join(""),
    "Para llamar una herramienta escribe <m365_tool_call> seguido del JSON.",
  );

  // With tools enabled, a plain answer that contains a fenced code block must
  // stream through byte-for-byte (holding fences must never corrupt output).
  const codeChunks = ["Aquí tienes:\n", "```ts\n", "const x = 1;\n", "```\n"];
  const streamed: string[] = [];
  const codeDecoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => streamed.push(chunk),
    () => assert.fail("No hay marcador: no debe emitir una llamada."),
  );
  for (const chunk of codeChunks) codeDecoder.push(chunk);
  codeDecoder.finish();
  assert.equal(streamed.join(""), codeChunks.join(""));

  assert.equal(replaceTextOnce("uno\ndos\n", "dos", "tres", "demo.txt"), "uno\ntres\n");
  assert.throws(() => replaceTextOnce("uno uno", "uno", "dos", "demo.txt"), /más de una vez/);
  console.log("  ✓ tool protocol decodes calls (preamble, fenced) and guards replacements");
}

// ---- toolCatalog.ts --------------------------------------------------------

/** Herramientas con la forma de las que ofrece VS Code en modo agente. */
const EDITOR_TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file in the workspace.",
    inputSchema: {
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string", description: "The absolute path of the file to read." },
        startLine: { type: "integer", description: "First line to read." },
      },
    },
  },
  {
    name: "replace_string_in_file",
    description: "Replace an exact string in a file.",
    inputSchema: {
      type: "object",
      required: ["filePath", "oldString", "newString"],
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
      },
    },
  },
  {
    name: "run_in_terminal",
    description: "Run a shell command in the integrated terminal.",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        isBackground: { type: "boolean" },
      },
    },
  },
  {
    name: "mcp_postgres_query",
    description: "Run a read-only SQL query.",
    inputSchema: { type: "object", required: ["sql"], properties: { sql: { type: "string" } } },
  },
  {
    name: "mcp_github_create_issue",
    description: "Create an issue on GitHub.",
    inputSchema: { type: "object", properties: { title: { type: "string" } } },
  },
];

const M365_TOOLS = Object.values(M365_TOOL_NAMES).map((name) => ({
  name,
  description: `Descripción de package.json para ${name}.`,
  inputSchema: { type: "object", properties: { path: { type: "string" } } },
}));

function entry(catalog: ToolCatalog, name: string) {
  const found = catalog.entries.find((candidate) => candidate.name === name);
  assert.ok(found, `${name} debería estar en el catálogo`);
  return found;
}

function testToolCatalog() {
  const offered = [...M365_TOOLS, ...EDITOR_TOOLS];
  const catalog = buildToolCatalog(offered);

  // Lo esencial: las herramientas del editor y las de MCP se describen igual
  // que las nuestras — antes se descartaban y el modo agente se quedaba ciego.
  for (const tool of offered) {
    assert.ok(catalog.callable.has(tool.name), `${tool.name} debe ser invocable`);
    assert.ok(
      catalog.entries.some((candidate) => candidate.name === tool.name),
      `${tool.name} debe describirse en el prompt`,
    );
  }
  assert.equal(catalog.m365Count, M365_TOOLS.length);
  assert.equal(catalog.editorCount, EDITOR_TOOLS.length);

  // Clasificación por capacidad (ordena y agrupa; nunca decide si se ejecuta).
  assert.equal(entry(catalog, "read_file").capability, "read");
  assert.equal(entry(catalog, "replace_string_in_file").capability, "edit");
  assert.equal(entry(catalog, "run_in_terminal").capability, "terminal");
  assert.equal(entry(catalog, M365_TOOL_NAMES.searchText).capability, "search");
  assert.equal(entry(catalog, M365_TOOL_NAMES.gitInfo).capability, "git");
  assert.equal(entry(catalog, "mcp_postgres_query").capability, "other");
  // «github» no es «git»: si no, la herramienta MCP competiría con la nuestra.
  assert.notEqual(entry(catalog, "mcp_github_create_issue").capability, "git");

  // Duplicados: por defecto gana la nativa, pero la nuestra sigue disponible.
  assert.equal(entry(catalog, M365_TOOL_NAMES.readFile).preferInstead, "read_file");
  assert.equal(
    entry(catalog, M365_TOOL_NAMES.applyWorkspaceEdits).preferInstead,
    "replace_string_in_file",
  );
  assert.equal(entry(catalog, M365_TOOL_NAMES.runCommand).preferInstead, "run_in_terminal");
  assert.equal(entry(catalog, "read_file").preferInstead, null);
  // Sin equivalente nativo, la nuestra no se marca como secundaria.
  assert.equal(entry(catalog, M365_TOOL_NAMES.gitInfo).preferInstead, null);

  const reversed = buildToolCatalog(offered, { duplicates: "preferM365" });
  assert.equal(entry(reversed, "read_file").preferInstead, M365_TOOL_NAMES.readFile);
  assert.equal(entry(reversed, M365_TOOL_NAMES.readFile).preferInstead, null);

  const neutral = buildToolCatalog(offered, { duplicates: "both" });
  assert.equal(
    neutral.entries.every((candidate) => candidate.preferInstead === null),
    true,
  );

  // El interruptor de escape: volver a describir sólo las nuestras.
  const onlyOurs = buildToolCatalog(offered, { includeEditorTools: false });
  assert.equal(onlyOurs.entries.length, M365_TOOLS.length);
  assert.equal(
    onlyOurs.callable.has("read_file"),
    true,
    "sigue siendo ejecutable aunque no se describa",
  );

  // Presupuesto: lo que no cabe se omite del prompt, pero sigue siendo llamable.
  const trimmed = buildToolCatalog(offered, { maxTools: 3 });
  assert.equal(trimmed.entries.length, 3);
  assert.equal(trimmed.omitted.length, offered.length - 3);
  assert.equal(trimmed.callable.size, offered.length);
  // Y lo primero que se cae son los duplicados, no las herramientas únicas.
  assert.equal(
    trimmed.entries.every((candidate) => candidate.preferInstead === null),
    true,
  );

  console.log(
    "  ✓ el catálogo describe las herramientas nativas/MCP, las clasifica y marca duplicados",
  );
}

/**
 * Regresión: `m365_spawn_agents` es de capacidad 'agent', la ÚLTIMA de
 * `CAPABILITY_ORDER`, así que sin la excepción en `selectionRank` era la
 * primera candidata a quedar fuera del catálogo en cuanto el presupuesto de
 * caracteres se ajustaba (fácil con bastantes herramientas nativas/MCP
 * activas en modo agente) — el modelo principal nunca se enteraba de que
 * existía, así que nunca podía delegar en sub-agentes.
 */
function testSpawnAgentsNeverTrimmed() {
  const filler = Array.from({ length: 6 }, (_, i) => ({
    name: `read_file_variant_${i}`,
    description: "x".repeat(280),
  }));
  const offered = [...filler, ...M365_TOOLS];

  // Sólo los 6 "filler" ya superan este presupuesto, así que en el orden
  // antiguo (agrupado por capacidad) se comían todo el presupuesto antes de
  // llegar siquiera a la única herramienta de capacidad 'agent'.
  const tight = buildToolCatalog(offered, { maxChars: 1200 });
  assert.ok(tight.omitted.length > 0, "(sanity) el presupuesto ajustado sí debería recortar algo");
  assert.ok(
    tight.entries.some((e) => e.name === M365_TOOL_NAMES.spawnAgents),
    "m365_spawn_agents no debería quedar fuera del catálogo aunque el presupuesto sea ajustado",
  );
  assert.ok(
    !tight.omitted.includes(M365_TOOL_NAMES.spawnAgents),
    "m365_spawn_agents no debería aparecer en la lista de herramientas omitidas",
  );

  console.log(
    "  ✓ m365_spawn_agents nunca se recorta del catálogo por presupuesto/nº de herramientas",
  );
}

function testToolPromptRendering() {
  const catalog = buildToolCatalog([...M365_TOOLS, ...EDITOR_TOOLS]);
  const prompt = buildToolProtocolInstructions(catalog);

  assert.match(prompt, /read_file \(nativa de VS Code\)/);
  assert.match(prompt, new RegExp(`${M365_TOOL_NAMES.readFile} \\(de esta extensión\\)`));
  // La firma de entrada viaja al modelo: sin ella pasaría rutas relativas a
  // herramientas nativas que piden rutas absolutas.
  assert.match(prompt, /filePath\*: string — The absolute path of the file to read\./);
  assert.match(prompt, /run_in_terminal/);
  assert.match(prompt, /<m365_tool_call>/);

  // A duplicate goes in one line: which tool it stands in for and its bare
  // signature, no description or example — enough to call it if the other fails.
  assert.match(
    prompt,
    /\n- m365_read_file \(de esta extensión\): duplicada de read_file; úsala sólo si esa falla\. Entrada: path: string\n/,
  );
  assert.doesNotMatch(prompt, /m365_read_file \(de esta extensión\): Lee/);
  // When the native editor wins, m365_apply_edits' own rules and example go,
  // and neither the block example nor the worked example teaches a duplicate.
  assert.doesNotMatch(
    prompt,
    /En m365_apply_edits es OBLIGATORIO|En m365_apply_edits cada operación/,
  );
  assert.match(prompt, /Ejemplo:\n<m365_tool_call>\{"name":"replace_string_in_file"/);
  assert.match(prompt, /Asistente: [^\n]*\n<m365_tool_call>\{"name":"read_file"/);
  assert.doesNotMatch(buildToolProtocolReminder(catalog), /m365_apply_edits/);
  // With only ours (the @m365 participant), they are the editor: rules and example stay.
  const oursOnly = buildToolProtocolInstructions(buildToolCatalog(M365_TOOLS));
  assert.match(oursOnly, /En m365_apply_edits es OBLIGATORIO/);
  assert.match(oursOnly, /Asistente: [^\n]*\n<m365_tool_call>\{"name":"m365_read_file"/);

  // Single-folder workspace: our "only for multi-root" parameter is noise.
  const withFolder = [
    {
      name: M365_TOOL_NAMES.readFile,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, workspaceFolder: { type: "string" } },
      },
    },
  ];
  assert.deepEqual(
    entry(buildToolCatalog(withFolder), M365_TOOL_NAMES.readFile).parameters.map((p) => p.name),
    ["path", "workspaceFolder"],
  );
  assert.deepEqual(
    entry(
      buildToolCatalog(withFolder, { singleRoot: true }),
      M365_TOOL_NAMES.readFile,
    ).parameters.map((p) => p.name),
    ["path"],
  );

  // El ejemplo del formato de bloques tiene que usar los campos DE la
  // herramienta que nombra: sin las nuestras se sintetiza con los parámetros
  // de la nativa de edición, no con la forma de `m365_apply_edits`.
  const nativeOnly = buildToolProtocolInstructions(buildToolCatalog(EDITOR_TOOLS));
  assert.match(
    nativeOnly,
    /"name":"replace_string_in_file","input":\{"filePath":"[^"]+","oldString":"@@block:1@@","newString":"@@block:2@@"\}/,
  );
  assert.doesNotMatch(nativeOnly, /"name":"replace_string_in_file","input":\{"edits"/);

  // Sin herramientas no hay protocolo que explicar.
  assert.equal(buildToolProtocolInstructions(buildToolCatalog([])), "");

  console.log("  ✓ el prompt describe cada herramienta con su origen, firma y preferencia");
}

function testTranscript() {
  setLocale("en");
  const user = (text: string): TranscriptMessage => ({
    role: "user",
    parts: [{ kind: "text", text }],
  });
  const answer = (text: string): TranscriptMessage => ({
    role: "assistant",
    parts: [{ kind: "text", text }],
  });
  const call = (name: string, input = "{}"): TranscriptMessage => ({
    role: "assistant",
    parts: [
      { kind: "text", text: "Checking." },
      { kind: "toolCall", name, input },
    ],
  });
  const result = (name: string, text: string): TranscriptMessage => ({
    role: "user",
    parts: [{ kind: "toolResult", name, text }],
  });

  assert.equal(renderTranscript([user("hola")]), "User:\nhola", "un solo mensaje va tal cual");

  // An agent session of 8 reads of ~9 KB: before, the request fell out after
  // a few steps; now the last two results go whole, older ones shortened,
  // and everything — the request and the earlier chat included — fits.
  const file = (i: number) =>
    `// file ${i}\n${`const value${i} = ${"x".repeat(60)};\n`.repeat(110)}`;
  const session: TranscriptMessage[] = [
    user("old question"),
    answer("old answer"),
    user("Refactor the parser so empty files return an empty tree"),
    ...Array.from({ length: 8 }, (_, i) => [
      call("read_file", `{"filePath":"/w/f${i + 1}.ts"}`),
      result("read_file", file(i + 1)),
    ]).flat(),
  ];
  const prompt = renderTranscript(session);
  assert.ok(prompt.startsWith(`${t("prompt.continue")}\n\n`) && prompt.endsWith("\n\nAssistant:"));
  assert.match(
    prompt,
    /User:\nold question\n\nAssistant:\nold answer\n\nUser \(current request\):\nRefactor the parser/,
  );
  assert.ok(
    prompt.includes(file(8)) && prompt.includes(file(7)),
    "los dos últimos resultados enteros",
  );
  assert.ok(
    !prompt.includes(file(6)) && prompt.includes("// file 6\n"),
    "los anteriores, sólo su principio",
  );
  assert.match(
    prompt,
    /\[older result shortened: \d+ more characters; call the tool again if you need them\]/,
  );
  assert.match(prompt, /Tool results:\n\[result of tool read_file\]\n\/\/ file 1\n/);
  assert.doesNotMatch(prompt, /earlier turns omitted/);
  assert.ok(prompt.length < 40_000, `cabe holgado (${prompt.length})`);

  // The same result twice: the older copy becomes a pointer.
  const repeated = renderTranscript([
    user("task"),
    call("read_file"),
    result("read_file", "same text"),
    call("read_file"),
    result("read_file", "same text"),
  ]);
  assert.equal(repeated.split("same text").length - 1, 1);
  assert.match(
    repeated,
    /\[result of tool read_file\]\n\[same result as a later call below\][\s\S]*\[result of tool read_file\]\nsame text/,
  );

  // Under pressure the request stays; what goes is the oldest, with a note per gap.
  const huge = "y".repeat(11_000);
  const pressure = [
    user("first chat turn"),
    answer("first answer"),
    user("THE TASK"),
    ...Array.from({ length: 12 }, (_, i) => [
      call("grep_search"),
      result("grep_search", `result ${i} ${huge}`),
    ]).flat(),
  ];
  const squeezed = renderTranscript(pressure, { ...TRANSCRIPT_LIMITS, maxContextChars: 20_000 });
  assert.ok(squeezed.length < 22_000, `respeta el presupuesto (${squeezed.length})`);
  assert.doesNotMatch(squeezed, /first chat turn/);
  assert.match(
    squeezed,
    /\[earlier turns omitted[^\]]*\]\n\nUser \(current request\):\nTHE TASK\n\n\[earlier turns omitted[^\]]*\]\n\n/,
  );
  assert.match(squeezed, /result 11 y/, "el último resultado sigue ahí");

  // Retrieval: a short follow-up brings the previous request along.
  const long = "explain how the token server validates incoming profiles before storing them";
  assert.equal(retrievalText([long, "something else"]), long);
  assert.equal(
    retrievalText(["ahora en el otro", "refactoriza parseStatus en autoCommitGit"]),
    "ahora en el otro\nrefactoriza parseStatus en autoCommitGit",
  );
  assert.equal(
    retrievalText([
      "<userRequest>y en este?</userRequest>",
      "<context>x</context><userRequest>arregla el login</userRequest>",
    ]),
    "y en este?\narregla el login",
    "del prompt del modo agente sólo cuenta <userRequest>",
  );
  assert.equal(retrievalText(["solo"]), "solo");
  assert.equal(retrievalText([]), "");
  console.log(
    "  ✓ transcript: petición fijada, resultados antiguos recortados y repetidos resumidos, y búsqueda con la petición anterior",
  );
}

function testSkills() {
  setLocale("en");
  assert.equal(renderSkills({ ponytail: false, agentSkills: false, graphify: false }), "");
  const all = renderSkills({ ponytail: true, agentSkills: true, graphify: true });
  assert.match(all, /^WORKING STYLE[\s\S]*ENGINEERING DISCIPLINE[\s\S]*graphify query/);
  assert.doesNotMatch(
    renderSkills({ ponytail: true, agentSkills: false, graphify: false }),
    /DISCIPLINE|graphify/,
  );
  setLocale("es");
  console.log(
    "  ✓ skills: Ponytail, agent-skills y Graphify se añaden al prompt sólo si están activados",
  );
}

function testEnvironment() {
  setLocale("en");
  assert.equal(
    describeShell("C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
    "Windows PowerShell 5.1 (no `&&`: chain commands with `;`)",
  );
  assert.equal(describeShell("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), "PowerShell 7");
  assert.equal(describeShell("/bin/zsh"), "zsh");
  assert.equal(describeShell(undefined), undefined);
  assert.equal(
    renderEnvironment({
      platform: "win32",
      shell: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      folders: [{ name: "repo", path: "C:\\dev\\repo" }],
      date: "2026-10-13",
    }),
    "Environment: Windows · Windows PowerShell 5.1 (no `&&`: chain commands with `;`) · today 2026-10-13\n" +
      "Workspace root (absolute paths start here): C:\\dev\\repo",
  );
  assert.equal(
    renderEnvironment({
      platform: "linux",
      folders: [
        { name: "a", path: "/a" },
        { name: "b", path: "/b" },
      ],
      date: "2026-01-05",
    }),
    "Environment: Linux · today 2026-01-05\nWorkspace folders: a (/a), b (/b)",
  );
  assert.equal(
    renderEnvironment({ platform: "darwin", shell: "/bin/zsh", folders: [], date: "2026-01-05" }),
    "Environment: macOS · zsh · today 2026-01-05",
  );
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
  setLocale("es");
  assert.match(
    renderEnvironment({ platform: "win32", folders: [], date: "2026-10-13" }),
    /^Entorno: Windows · hoy 2026-10-13$/,
  );
  console.log(
    "  ✓ entorno: sistema, shell (PowerShell 5.1 sin &&), raíz absoluta del workspace y fecha",
  );
}

// ---- commitMessage.ts -------------------------------------------------------

function testCommitMessageValidation() {
  assert.equal(
    validateConventionalCommitMessage("fix(auth): evitar token nulo en refresh"),
    "fix(auth): evitar token nulo en refresh",
  );
  // Cuerpo opcional tras la primera línea: sólo la primera se valida.
  assert.equal(
    validateConventionalCommitMessage(
      "feat!: soporte multi-repo\n\nBREAKING CHANGE: cambia la firma pública.",
    ),
    "feat!: soporte multi-repo\n\nBREAKING CHANGE: cambia la firma pública.",
  );
  // Espacio sobrante en los bordes y CRLF se normalizan.
  assert.equal(
    validateConventionalCommitMessage("  chore: limpiar deps\r\n"),
    "chore: limpiar deps",
  );

  assert.throws(() => validateConventionalCommitMessage(""), /no puede estar vacío/);
  assert.throws(() => validateConventionalCommitMessage("   "), /no puede estar vacío/);
  assert.throws(() => validateConventionalCommitMessage(undefined), /no puede estar vacío/);
  // Sin tipo válido de Conventional Commits.
  assert.throws(
    () => validateConventionalCommitMessage("arreglado el bug del login"),
    /Conventional Commits/,
  );
  // Tipo inventado.
  assert.throws(
    () => validateConventionalCommitMessage("feature: algo nuevo"),
    /Conventional Commits/,
  );
  // Punto final en la primera línea.
  assert.throws(
    () => validateConventionalCommitMessage("fix: arregla el bug."),
    /no debe terminar en punto/,
  );
  // Ámbito con letras no ASCII (antes `\w` lo rechazaba).
  assert.equal(
    validateConventionalCommitMessage("fix(configuración): leer el ajuste"),
    "fix(configuración): leer el ajuste",
  );
  assert.throws(
    () => validateConventionalCommitMessage("fix(con espacio): algo"),
    /Conventional Commits/,
  );

  console.log("  ✓ valida (sin reescribir) que la primera línea siga Conventional Commits");
}

/** Decodifica un turno completo y devuelve el texto y las llamadas emitidas. */
function decodeTurn(allowed: ReadonlySet<string>, chunks: readonly string[]) {
  const out = { text: [] as string[], calls: [] as unknown[] };
  const decoder = new ToolCallDecoder(
    allowed,
    (chunk) => out.text.push(chunk),
    (call) => out.calls.push(call),
  );
  for (const chunk of chunks) decoder.push(chunk);
  decoder.finish();
  return out;
}

function testHostToolDecoding() {
  const allowed = new Set<string>([
    M365_TOOL_NAMES.readFile,
    "replace_string_in_file",
    "get_changed_files",
  ]);

  // Una herramienta nativa de VS Code se decodifica igual que las nuestras:
  // el nombre viaja tal cual y es VS Code quien la ejecuta.
  assert.deepEqual(
    decodeTurn(allowed, [
      '<m365_tool_call>{"name":"replace_string_in_file","input":{"filePath":"/a.ts","oldString":"a","newString":"b"}}</m365_tool_call>',
    ]).calls,
    [
      {
        name: "replace_string_in_file",
        input: { filePath: "/a.ts", oldString: "a", newString: "b" },
      },
    ],
  );

  // Formas que los modelos arrastran del function-calling nativo: prefijo
  // `functions.`, argumentos como cadena JSON, `tool` en vez de `name`, el
  // toolReferenceName en camelCase, o los argumentos al mismo nivel.
  assert.deepEqual(
    decodeTurn(allowed, [
      '<m365_tool_call>{"name":"functions.replace_string_in_file","arguments":"{\\"filePath\\":\\"/a.ts\\"}"}',
    ]).calls,
    [{ name: "replace_string_in_file", input: { filePath: "/a.ts" } }],
  );
  assert.deepEqual(
    decodeTurn(allowed, [
      '<m365_tool_call>{"tool":"m365ReadFile","input":{"path":"a.ts"}}</m365_tool_call>',
    ]).calls,
    [{ name: M365_TOOL_NAMES.readFile, input: { path: "a.ts" } }],
  );
  assert.deepEqual(
    decodeTurn(allowed, ['<m365_tool_call>{"name":"get_changed_files"}</m365_tool_call>']).calls,
    [{ name: "get_changed_files", input: {} }],
  );
  assert.deepEqual(
    decodeTurn(allowed, [
      '<m365_tool_call>{"name":"m365_read_file","path":"a.ts"}</m365_tool_call>',
    ]).calls,
    [{ name: M365_TOOL_NAMES.readFile, input: { path: "a.ts" } }],
  );

  // Una herramienta que el host NO ofreció nunca se ejecuta.
  const unknown = decodeTurn(allowed, [
    '<m365_tool_call>{"name":"borrar_el_disco","input":{}}</m365_tool_call>',
  ]);
  assert.deepEqual(unknown.calls, []);
  assert.match(unknown.text.join(""), /borrar_el_disco/);

  // El formato de bloques vale para CUALQUIER herramienta, no sólo la nuestra:
  // las de edición nativas tienen el mismo problema con el código sin escapar.
  assert.deepEqual(
    decodeTurn(allowed, [
      '<m365_tool_call>{"name":"replace_string_in_file","input":{"filePath":"/a.ts","oldString":"@@block:1@@","newString":"@@block:2@@"}}</m365_tool_call>\n',
      '<m365_block id="1">\nconsole.log("hola");\n</m365_block>\n',
      '<m365_block id="2">\nconsole.log("hola {mundo}");\n</m365_block>',
    ]).calls,
    [
      {
        name: "replace_string_in_file",
        input: {
          filePath: "/a.ts",
          oldString: 'console.log("hola");',
          newString: 'console.log("hola {mundo}");',
        },
      },
    ],
  );

  // Bloques que se cortan a medias: no se ejecuta nada y el turno no queda en
  // blanco, que era lo que dejaba al usuario sin saber qué había pasado.
  const truncated = decodeTurn(allowed, [
    '<m365_tool_call>{"name":"replace_string_in_file","input":{"filePath":"/a.ts","oldString":"@@block:1@@"}}</m365_tool_call>\n<m365_block id="1">\nconsole',
  ]);
  assert.deepEqual(truncated.calls, []);
  assert.match(truncated.text.join(""), /incompleta/);

  console.log(
    "  ✓ decodifica herramientas nativas/MCP, tolera formatos ajenos y bloques genéricos",
  );
}

// ---- mock SignalR server ---------------------------------------------------

type Ring = "snapshot" | "delta";

function startMockServer(
  ring: Ring,
): Promise<{ port: number; close: () => void; sawMetrics: () => boolean }> {
  return new Promise((resolve) => {
    let metricsSeen = false;
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => wss.close(), sawMetrics: () => metricsSeen });
    });

    wss.on("connection", (socket) => {
      let handshaken = false;
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          const frame = JSON.parse(chunk);

          if (!handshaken) {
            // handshake request {protocol,version}
            handshaken = true;
            socket.send("{}" + RS); // ack
            continue;
          }

          if (frame.target === "Metrics") {
            metricsSeen = true;
            continue;
          }

          if (frame.target === "chat") {
            // Verify the prompt we sent round-tripped.
            assert.equal(frame.arguments[0].message.text, "PROMPT");
            setTimeout(() => streamReply(socket, ring), 5);
          }
        }
      });
    });
  });
}

function botUpdate(messages: unknown[]) {
  return JSON.stringify({ type: 1, target: "update", arguments: [{ messages }] }) + RS;
}

function streamReply(socket: import("ws").WebSocket, ring: Ring) {
  if (ring === "snapshot") {
    socket.send(botUpdate([{ author: "bot", text: "Hola" }]));
    socket.send(botUpdate([{ author: "bot", text: "Hola, mundo" }]));
    socket.send(botUpdate([{ author: "bot", messageType: "EndOfRequest" }]));
  } else {
    // delta mode: writeAtCursor increments, plus a control snapshot that
    // must NOT double-count, then completion frame type 3.
    socket.send(
      JSON.stringify({ type: 1, target: "update", arguments: [{ writeAtCursor: "Hola" }] }) + RS,
    );
    socket.send(
      JSON.stringify({ type: 1, target: "update", arguments: [{ writeAtCursor: ", mundo" }] }) + RS,
    );
    socket.send(botUpdate([{ author: "bot", text: "Hola, mundo" }])); // snapshot ignored in delta mode
    socket.send(JSON.stringify({ type: 3, invocationId: "0" }) + RS); // completion
  }
}

/** Host+path of a local mock BizChat server, for `endpointBase`. */
function mockBase(port: number): string {
  return `ws://127.0.0.1:${port}/m365Copilot/Chathub`;
}

function makeProfile(port: number): CopilotProfile {
  return {
    version: 1,
    accessToken: fakeJwt(),
    endpoint: `ws://127.0.0.1:${port}/m365Copilot/Chathub/o@t?access_token=old&source=officeweb`,
    origin: "https://m365.cloud.microsoft",
    userAgent: "Mozilla/5.0 test",
    invocationTemplate: { tone: "magic", message: { author: "user", messageType: "Chat" } },
    invocationType: 4,
    claims: { oid: "o", tid: "t", exp: Math.floor(Date.now() / 1000) + 3600 },
    capturedAt: new Date().toISOString(),
  };
}

async function runRing(ring: Ring) {
  const server = await startMockServer(ring);
  let text = "";
  await streamCopilotTurn({
    profile: makeProfile(server.port),
    endpointBase: mockBase(server.port),
    prompt: "PROMPT",
    tone: null,
    signal: new AbortController().signal,
    callbacks: { onText: (d) => (text += d) },
  });
  assert.equal(text, "Hola, mundo", `[${ring}] expected "Hola, mundo", got "${text}"`);
  assert.equal(server.sawMetrics(), true, `[${ring}] server never received Metrics frame`);
  server.close();
  console.log(`  ✓ streamCopilotTurn (${ring} ring) → "${text}", Metrics frame sent`);
}

async function testCancellation() {
  const server = await startMockServer("snapshot");
  const controller = new AbortController();
  const profile = makeProfile(server.port);
  const p = streamCopilotTurn({
    profile,
    endpointBase: mockBase(server.port),
    prompt: "PROMPT",
    tone: null,
    signal: controller.signal,
    callbacks: { onText: () => controller.abort() }, // abort on first token
  });
  await assert.rejects(p, /__CANCELLED__/);
  server.close();
  console.log("  ✓ cancellation aborts the turn");
}

/** HTTP server that rejects any WS upgrade with a 401, like a stale token. */
function start401Server(): Promise<{ port: number; close: () => void; attempts: () => number }> {
  return new Promise((resolve) => {
    let attempts = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(401);
      res.end();
    });
    server.on("upgrade", (_req, socket) => {
      attempts += 1;
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => server.close(), attempts: () => attempts });
    });
  });
}

/** HTTP server that rejects only the FIRST WS upgrade with a 429, then serves
 * every later attempt normally through the mock BizChat protocol — proves
 * {@link streamCopilotTurnWithRetry} recovers from one transient failure. */
function start429ThenOkServer(
  ring: Ring,
  onUpgrade?: (sessionKey: string | string[] | undefined) => void,
  onChat?: (args: Record<string, unknown>) => void,
): Promise<{ port: number; close: () => void; attempts: () => number }> {
  return new Promise((resolve) => {
    let attempts = 0;
    const wss = new WebSocketServer({ noServer: true });
    wss.on("connection", (socket) => {
      let handshaken = false;
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          const frame = JSON.parse(chunk);
          if (!handshaken) {
            handshaken = true;
            socket.send("{}" + RS);
            continue;
          }
          if (frame.target === "chat") {
            onChat?.(frame.arguments[0] as Record<string, unknown>);
            setTimeout(() => streamReply(socket, ring), 5);
          }
        }
      });
    });

    const server = http.createServer((_req, res) => {
      res.writeHead(429);
      res.end();
    });
    server.on("upgrade", (req, socket, head) => {
      attempts += 1;
      onUpgrade?.(req.headers["x-routingparameter-sessionkey"]);
      if (attempts === 1) {
        socket.write(
          "HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => {
          wss.close();
          server.close();
        },
        attempts: () => attempts,
      });
    });
  });
}

async function test429Retry() {
  for (const conversation of [
    undefined,
    {
      conversationId: "retry-conversation",
      sessionKey: "retry-session-key",
      isStartOfSession: false,
    },
  ]) {
    const sessionKeys: (string | string[] | undefined)[] = [];
    const invocations: Record<string, unknown>[] = [];
    const server = await start429ThenOkServer(
      "snapshot",
      (key) => sessionKeys.push(key),
      (args) => invocations.push(args),
    );
    let text = "";
    try {
      await streamCopilotTurnWithRetry({
        profile: makeProfile(server.port),
        endpointBase: mockBase(server.port),
        prompt: "PROMPT",
        conversation,
        retryDelayMs: 0,
        tone: null,
        signal: new AbortController().signal,
        callbacks: { onText: (d) => (text += d) },
      });
      assert.equal(text, "Hola, mundo");
      assert.equal(
        server.attempts(),
        2,
        "esperaba un primer intento rechazado (429) y un reintento que sí conecta",
      );
      assert.equal(sessionKeys.length, 2);
      assert.equal(typeof sessionKeys[0], "string");
      assert.ok(sessionKeys[0]);
      assert.equal(sessionKeys[0], sessionKeys[1], "el reintento conserva la afinidad");
      assert.equal(invocations.length, 1);
      assert.equal(typeof invocations[0]!.conversationId, "string");
      assert.ok(invocations[0]!.conversationId);
      assert.equal(invocations[0]!.isStartOfSession, conversation?.isStartOfSession ?? true);
      if (conversation) {
        assert.equal(sessionKeys[0], conversation.sessionKey);
        assert.equal(invocations[0]!.conversationId, conversation.conversationId);
        assert.equal(
          conversation.isStartOfSession,
          false,
          "el reintento no reinicia la conversación",
        );
      }
    } finally {
      server.close();
    }
  }
  console.log("  ✓ streamCopilotTurnWithRetry reintenta una vez tras un 429 y recupera el turno");
}

async function testAuthErrorNotRetried() {
  // Un 401/403 no se reintenta: el mismo token caducado fallaría igual, y el
  // usuario necesita el aviso de "vuelve a capturar el token" cuanto antes.
  const server = await start401Server();
  await assert.rejects(
    streamCopilotTurnWithRetry({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    }),
    (err: unknown) => err instanceof CopilotAuthError,
  );
  assert.equal(server.attempts(), 1, "un CopilotAuthError no debe disparar un reintento");
  server.close();
  console.log("  ✓ streamCopilotTurnWithRetry NO reintenta un error de autenticación");
}

/**
 * Mock BizChat whose answer depends on the `tone` of the chat invocation, the
 * way the real service treats a model: it runs it (`DeepLeo`), turns the turn
 * down (a completion frame with an error) or answers with its own canned
 * reply (`BotConnection`) instead of the model.
 */
function startToneServer(): Promise<{ port: number; close: () => void; tones: string[] }> {
  const tones: string[] = [];
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => wss.close(), tones });
    });
    wss.on("connection", (socket) => {
      let handshaken = false;
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          const frame = JSON.parse(chunk);
          if (!handshaken) {
            handshaken = true;
            socket.send("{}" + RS);
            continue;
          }
          if (frame.target !== "chat") continue;
          const tone = String(frame.arguments[0].tone);
          tones.push(tone);
          const id = frame.invocationId;
          if (tone === "Gpt_9_Chat") {
            socket.send(
              JSON.stringify({
                type: 3,
                invocationId: id,
                error: "InvalidRequest: tone is not supported",
              }) + RS,
            );
          } else if (tone === "Gpt_9_Result") {
            socket.send(
              JSON.stringify({
                type: 2,
                invocationId: id,
                item: { result: { value: "UnsupportedTone", message: "no such model" } },
              }) + RS,
            );
          } else if (tone === "Gpt_Throttled") {
            socket.send(
              JSON.stringify({ type: 3, invocationId: id, error: "Throttled: too many requests" }) +
                RS,
            );
          } else if (tone === "Claude_Dead" || tone === "magic") {
            socket.send(
              botUpdate([
                {
                  author: "bot",
                  contentOrigin: "BotConnection",
                  text: "Sorry, I can’t help with that.",
                },
              ]),
            );
            socket.send(botUpdate([{ author: "bot", messageType: "EndOfRequest" }]));
          } else {
            socket.send(botUpdate([{ author: "bot", contentOrigin: "DeepLeo", text: "OK" }]));
            socket.send(botUpdate([{ author: "bot", messageType: "EndOfRequest" }]));
          }
        }
      });
    });
  });
}

async function testModelAvailability() {
  const server = await startToneServer();
  const outcomes: string[] = [];
  onModelOutcome((tone, available) => outcomes.push(`${tone}:${available ? "ok" : "unavailable"}`));
  const turn = (tone: string | null, retry = false) => {
    let text = "";
    const options = {
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone,
      signal: new AbortController().signal,
      callbacks: { onText: (delta: string) => (text += delta) },
      retryDelayMs: 1,
    };
    return (retry ? streamCopilotTurnWithRetry(options) : streamCopilotTurn(options)).then(
      () => text,
    );
  };
  try {
    // A model the service runs: its answer, and the registry hears it works.
    assert.equal(await turn("Gpt_5_6_Reasoning"), "OK");
    // Turned down with a model forced: the model is not available, said in
    // the web app's words, with the service's reason.
    await assert.rejects(turn("Gpt_9_Chat"), (error: unknown) => {
      assert.ok(
        error instanceof CopilotModelUnavailableError,
        "expected CopilotModelUnavailableError",
      );
      assert.equal(error.tone, "Gpt_9_Chat");
      assert.match(error.message, /GPT 9 Quick response/);
      assert.match(error.message, /tone is not supported/);
      assert.match(error.message, /Auto/);
      return true;
    });
    // The same through the `result` channel.
    await assert.rejects(turn("Gpt_9_Result"), (error: unknown) => {
      assert.ok(error instanceof CopilotModelUnavailableError);
      assert.match(error.serverReply, /UnsupportedTone: no such model/);
      return true;
    });
    // The service's canned reply instead of the model: not shown as the answer.
    await assert.rejects(turn("Claude_Dead"), (error: unknown) => {
      assert.ok(error instanceof CopilotModelUnavailableError);
      assert.match(error.serverReply, /can’t help/);
      return true;
    });
    // Throttling says nothing about the model: its own error (here a completion
    // frame that says so in words), nothing flagged.
    await assert.rejects(turn("Gpt_Throttled"), CopilotThrottledError);
    assert.ok(accountThrottledUntil() !== undefined, "las peticiones automáticas esperan");
    // Auto is never "unavailable": it sends `magic`, and a canned reply there is just the answer.
    assert.equal(await turn(null), "Sorry, I can’t help with that.");
    assert.equal(server.tones.at(-1), "magic");
    assert.equal(accountThrottledUntil(), undefined, "una respuesta levanta el throttling");
    // Not retried: the same model would be refused again.
    const before = server.tones.length;
    await assert.rejects(turn("Gpt_9_Chat", true), CopilotModelUnavailableError);
    assert.equal(server.tones.length - before, 1, "a refused model is not retried");
    assert.deepEqual(outcomes, [
      "Gpt_5_6_Reasoning:ok",
      "Gpt_9_Chat:unavailable",
      "Gpt_9_Result:unavailable",
      "Claude_Dead:unavailable",
      "Gpt_9_Chat:unavailable",
    ]);
  } finally {
    onModelOutcome(undefined);
    server.close();
  }
  console.log(
    "  ✓ modelos no disponibles: rechazo y respuesta enlatada → error claro, sin reintento; Auto manda magic",
  );
}

// ---- subagents.ts -----------------------------------------------------

async function testConcurrencyLimiter() {
  const limiter = new ConcurrencyLimiter(2);
  let active = 0;
  let maxActive = 0;

  const task = (ms: number) =>
    limiter.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
    });

  await Promise.all([task(30), task(10), task(20), task(15), task(5)]);
  assert.equal(active, 0);
  assert.ok(
    maxActive <= 2,
    `esperaba como mucho 2 ejecuciones simultáneas, se vieron ${maxActive}`,
  );
  console.log("  ✓ ConcurrencyLimiter respeta el máximo de ejecuciones simultáneas");
}

/** Servidor mock cuya respuesta depende de qué conexión (= qué paso del
 * sub-agente) es: cada turno de `runSubagentTask` abre un WebSocket nuevo. */
function startScriptedServer(
  getReply: (connectionIndex: number) => string,
  onChatFrame?: (frame: { arguments: [{ message: Record<string, unknown> }] }) => void,
  onConnection?: (sessionKey: string | string[] | undefined) => void,
): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    let connectionIndex = 0;
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => wss.close() });
    });
    wss.on("connection", (socket, request) => {
      onConnection?.(request.headers["x-routingparameter-sessionkey"]);
      const index = connectionIndex++;
      let handshaken = false;
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          const frame = JSON.parse(chunk);
          if (!handshaken) {
            handshaken = true;
            socket.send("{}" + RS);
            continue;
          }
          if (frame.target !== "chat") continue;
          onChatFrame?.(frame);
          setTimeout(() => {
            socket.send(botUpdate([{ author: "bot", text: getReply(index) }]));
            socket.send(botUpdate([{ author: "bot", messageType: "EndOfRequest" }]));
          }, 5);
        }
      });
    });
  });
}

async function testSubagentLoop() {
  const server = await startScriptedServer((index) =>
    index === 0
      ? `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`
      : "Resumen: encontré 2 coincidencias de foo.",
  );
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

  const result = await runSubagentTask({
    label: "buscar foo",
    task: "Busca foo en el repo y resume dónde aparece.",
    profile: makeProfile(server.port),
    tone: null,
    maxSteps: 4,
    signal: new AbortController().signal,
    offeredTools,
    endpointBase: mockBase(server.port),
    executeTool: async (name, input) => {
      calls.push({ name, input });
      return "Coincidencias: a.ts:1, b.ts:4";
    },
  });
  server.close();

  assert.equal(result.ok, true);
  assert.equal(result.steps, 2);
  assert.match(result.summary, /Resumen: encontré 2 coincidencias/);
  assert.deepEqual(calls, [{ name: M365_TOOL_NAMES.searchText, input: { query: "foo" } }]);
  console.log(
    "  ✓ runSubagentTask ejecuta un paso de herramienta, reinyecta el resultado y devuelve el resumen final",
  );
}

async function testSubagentConversationIsolation() {
  const invocations: Record<string, unknown>[][] = [[], []];
  const sessionKeys: (string | string[] | undefined)[][] = [[], []];
  const servers: { port: number; close: () => void }[] = [];
  try {
    for (let agent = 0; agent < 2; agent++) {
      servers.push(
        await startScriptedServer(
          (index) =>
            index === 0
              ? `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`
              : `Resumen del agente ${agent}.`,
          (frame) =>
            invocations[agent]!.push(frame.arguments[0] as unknown as Record<string, unknown>),
          (sessionKey) => sessionKeys[agent]!.push(sessionKey),
        ),
      );
    }
    const results = await Promise.all(
      servers.map((server, agent) =>
        runSubagentTask({
          label: `agente ${agent}`,
          task: `Busca foo para el agente ${agent}.`,
          profile: makeProfile(server.port),
          tone: null,
          maxSteps: 3,
          signal: new AbortController().signal,
          offeredTools: [{ name: M365_TOOL_NAMES.searchText }],
          endpointBase: mockBase(server.port),
          executeTool: async () => `resultado del agente ${agent}`,
        }),
      ),
    );
    for (let agent = 0; agent < 2; agent++) {
      assert.equal(results[agent]!.ok, true);
      assert.equal(results[agent]!.steps, 2);
      assert.equal(results[agent]!.summary, `Resumen del agente ${agent}.`);
      const turns = invocations[agent]!;
      const keys = sessionKeys[agent]!;
      assert.equal(turns.length, 2);
      assert.ok(turns[0]!.conversationId);
      assert.equal(turns[0]!.conversationId, turns[1]!.conversationId);
      assert.equal(turns[0]!.isStartOfSession, true);
      assert.equal(turns[1]!.isStartOfSession, false);
      assert.equal(keys.length, 2);
      assert.equal(typeof keys[0], "string");
      assert.ok(keys[0]);
      assert.equal(keys[0], keys[1]);
      const nextPrompt = String((turns[1]!.message as Record<string, unknown>).text);
      assert.ok(nextPrompt.includes(`resultado del agente ${agent}`));
      assert.ok(!nextPrompt.includes(`resultado del agente ${1 - agent}`));
    }
    assert.notEqual(invocations[0]![0]!.conversationId, invocations[1]![0]!.conversationId);
    assert.notEqual(sessionKeys[0]![0], sessionKeys[1]![0]);
  } finally {
    for (const server of servers) server.close();
  }
  console.log(
    "  ✓ los subagentes concurrentes mantienen conversaciones y afinidades independientes",
  );
}

async function testSubagentLoopStepLimit() {
  const server = await startScriptedServer(
    () =>
      `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`,
  );
  const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

  const result = await runSubagentTask({
    label: "bucle sin fin",
    task: "Una tarea que el modelo simulado nunca da por terminada.",
    profile: makeProfile(server.port),
    tone: null,
    maxSteps: 1,
    signal: new AbortController().signal,
    offeredTools,
    endpointBase: mockBase(server.port),
    executeTool: async () => "resultado parcial",
  });
  server.close();

  assert.equal(result.ok, false);
  assert.equal(result.steps, 1);
  assert.match(result.summary, /límite de 1 paso/);
  console.log("  ✓ runSubagentTask corta en maxSteps y devuelve un aviso de límite alcanzado");
}

/**
 * Regresión: cada paso tiene su propio techo de 5 min (`MAX_TURN_MS` en
 * client.ts), pero antes nada acotaba el tiempo TOTAL de un sub-agente — con
 * `maxSteps` alto eso permitía que una sola tarea tardara casi una hora en
 * darse por vencida, y desde el chat eso se ve igual que un cuelgue. Aquí
 * `maxSteps` se deja deliberadamente alto: lo que debe cortar el bucle es el
 * reloj, no el contador de pasos.
 */
async function testSubagentLoopWallClock() {
  const server = await startScriptedServer(
    () =>
      `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`,
  );
  const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

  const result = await runSubagentTask({
    label: "nunca termina",
    task: "Una tarea que iría bien de pasos pero se le acaba el tiempo total antes.",
    profile: makeProfile(server.port),
    tone: null,
    maxSteps: 50,
    signal: new AbortController().signal,
    offeredTools,
    endpointBase: mockBase(server.port),
    maxWallClockMs: 15,
    // La propia herramienta tarda más que el presupuesto: garantiza que el
    // reloj se agota entre el paso 1 y el 2, sin depender de la latencia real
    // del servidor simulado.
    executeTool: async () =>
      new Promise((resolve) => setTimeout(() => resolve("resultado parcial"), 40)),
  });
  server.close();

  assert.equal(result.ok, false);
  assert.ok(
    result.steps >= 1,
    "debería haber completado al menos un paso antes de cortar por tiempo",
  );
  assert.match(result.summary, /tiempo máximo/);
  console.log("  ✓ runSubagentTask corta por tiempo máximo total aunque queden pasos disponibles");
}

/**
 * Regresión: `clip()` recortaba a ciegas — si el corte caía a media valla de
 * código ```, el resto del texto (la nota de "caracteres omitidos" y, tras
 * ella, lo que el llamador concatene tras el recorte) quedaba renderizado
 * como si fuera parte del bloque de código. Con el informe combinado de
 * varios sub-agentes es fácil que el recorte caiga dentro de un bloque de
 * código que un sub-agente incluyó en su resumen.
 */
function testClipClosesDanglingFence() {
  const text =
    'Intro breve.\n```ts\nconst greeting = "hola";\nconsole.log(greeting);\n```\n' +
    "Texto después de la valla, que el agente principal también necesita leer sin que se lo trague el bloque.";

  const cutInsideFence = text.indexOf("console.log") + 5;
  const clippedInsideFence = clip(text, cutInsideFence);
  assert.equal(
    (clippedInsideFence.match(/```/g) ?? []).length % 2,
    0,
    "un recorte a media valla de código debe cerrarla, si no el resto del informe queda dentro del bloque",
  );

  const cutAfterFence = text.indexOf("Texto después") + 5;
  const clippedAfterFence = clip(text, cutAfterFence);
  assert.equal(
    (clippedAfterFence.match(/```/g) ?? []).length % 2,
    0,
    "un recorte que cae tras una valla ya cerrada no debe añadir una de cierre de más",
  );

  console.log(
    "  ✓ clip() cierra una valla ``` que el recorte deja abierta, sin tocar las que ya cerraban",
  );
}

async function test401FastFail() {
  // A rejected upgrade must fail immediately with an actionable auth error,
  // not stall until the 15 s handshake timeout with a misleading message.
  const server = await start401Server();
  const startedAt = Date.now();
  await assert.rejects(
    streamCopilotTurn({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    }),
    (err: unknown) => {
      assert.ok(err instanceof CopilotAuthError, "expected CopilotAuthError");
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /token/);
      assert.doesNotMatch(err.message, /handshake|401/i);
      return true;
    },
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 5000, `expected a fast fail, took ${elapsed}ms`);

  // Con un token de otro servicio (pegado a mano) el error dice cuál es, en
  // vez de «ha caducado»: recapturar no lo arreglaría.
  const graph = makeProfile(server.port);
  graph.accessToken = fakeJwt({ aud: "https://graph.microsoft.com" });
  await assert.rejects(
    streamCopilotTurn({
      profile: graph,
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    }),
    (err: unknown) => {
      assert.ok(err instanceof CopilotAuthError, "expected CopilotAuthError");
      assert.equal(err.statusCode, 401);
      assert.match(err.message, /graph\.microsoft\.com/);
      assert.match(err.message, /chathub/i);
      return true;
    },
  );
  server.close();
  console.log(`  ✓ streamCopilotTurn falla rápido con 401 (${elapsed}ms, sin esperar al timeout)`);
}

async function testEndpointRotation() {
  // The captured browser endpoint is deliberately NOT replayed: its `variants`
  // query string turns on the web app's native plugin/rich-message features,
  // which break the text tool-call protocol. Pointing it at a dead port proves
  // the URL is built from the token claims instead.
  const server = await startMockServer("snapshot");
  const profile = makeProfile(server.port);
  profile.endpoint =
    "ws://127.0.0.1:1/m365Copilot/ChatHubV2/o@t?variants=feature.x&access_token=old";
  let text = "";
  await streamCopilotTurn({
    profile,
    endpointBase: mockBase(server.port),
    prompt: "PROMPT",
    tone: null,
    signal: new AbortController().signal,
    callbacks: { onText: (d) => (text += d) },
  });
  assert.equal(text, "Hola, mundo", `captured endpoint must be ignored, got "${text}"`);
  server.close();
  console.log(
    "  ✓ streamCopilotTurn ignora el endpoint capturado (con variants) y usa el de los claims",
  );
}

/**
 * Reproduces a real bug observed with the Claude tone: BizChat can split ONE
 * answer across TWO bot "messages" — the prose, then the tool-call marker —
 * each introduced by a `messages` snapshot and continued via `writeAtCursor`
 * deltas that carry no messageId of their own. The first chunk of the SECOND
 * message arrives as a snapshot right after the first message already used
 * deltas; the old turn-wide "have we seen a delta yet?" tracking silently
 * dropped that first chunk (the opening `<ms` of `<m365_tool_call>`), so the
 * marker never matched and the whole JSON + closing tag leaked into the chat
 * as visible text instead of firing the tool call.
 */
async function testMultiMessageToolCall() {
  const server = await new Promise<{ port: number; close: () => void }>((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ port, close: () => wss.close() });
    });
    wss.on("connection", (socket) => {
      let handshaken = false;
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          const frame = JSON.parse(chunk);
          if (!handshaken) {
            handshaken = true;
            socket.send("{}" + RS);
            continue;
          }
          if (frame.target !== "chat") continue;

          const send = (obj: unknown) => socket.send(JSON.stringify(obj) + RS);
          const snapshot = (messages: unknown[]) =>
            send({ type: 1, target: "update", arguments: [{ messages }] });
          const delta = (writeAtCursor: string) =>
            send({ type: 1, target: "update", arguments: [{ writeAtCursor }] });

          setTimeout(() => {
            // Message 1: prose, snapshot then delta-continued (like the real log).
            snapshot([{ author: "bot", text: "Voy a bus", messageId: "m1" }]);
            delta("car el archivo.");
            snapshot([{ author: "bot", text: "Voy a buscar el archivo.", messageId: "m1" }]);
            // Message 2: the tool call — its first chunk is a SNAPSHOT (not a
            // delta) for a brand-new messageId, right after message 1 used
            // deltas. This exact shape used to lose the opening `<m`.
            snapshot([{ author: "bot", text: "<m", messageId: "m2" }]);
            delta('365_tool_call>{"name":"m365_read_file","');
            delta('input":{"path":"a.ts"}}</m365_tool_call>');
            snapshot([
              {
                author: "bot",
                text: '<m365_tool_call>{"name":"m365_read_file","input":{"path":"a.ts"}}</m365_tool_call>',
                messageId: "m2",
              },
            ]);
            snapshot([{ author: "bot", messageType: "EndOfRequest" }]);
          }, 5);
        }
      });
    });
  });

  const text: string[] = [];
  const calls: unknown[] = [];
  const decoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => text.push(chunk),
    (call) => calls.push(call),
  );

  await streamCopilotTurn({
    profile: makeProfile(server.port),
    endpointBase: mockBase(server.port),
    prompt: "PROMPT",
    tone: null,
    signal: new AbortController().signal,
    callbacks: { onText: (d) => decoder.push(d) },
  });
  decoder.finish();
  server.close();

  assert.equal(text.join(""), "Voy a buscar el archivo.");
  assert.deepEqual(calls, [{ name: M365_TOOL_NAMES.readFile, input: { path: "a.ts" } }]);
  console.log(
    "  ✓ streamCopilotTurn reconciles a tool call split across two bot messages (no leaked marker)",
  );
}

// ---- BizChat protocol: temporary chats, stop, account-level refusals --------

/** What the web app's "Stop generating" button sends; client.ts sends the same. */
const STOP_FRAME_JSON = '{"arguments":[{}],"invocationId":"1","target":"stop","type":1}';

type Send = (frame: unknown) => void;

interface ProtocolConnection {
  readonly index: number;
  /** Path and query the client connected to. */
  readonly url: string;
  /** What the client sent after the handshake, one raw frame each. */
  readonly sent: string[];
  /** When the stop frame arrived (epoch ms). */
  stopAt?: number;
  /** When the client closed the socket (epoch ms). */
  closedAt?: number;
  readonly closed: Promise<void>;
}

/**
 * Mock BizChat for the protocol details. Records each connection's URL and
 * every frame the client sends after the handshake; answers the chat
 * invocation with `answer`, which may return a function that ends the answer
 * (a model that keeps writing until it is told to stop); acks a `stop` with a
 * completion for the stop's own invocation, as the service does, unless
 * `ackStop` is false; and notes when the client closed.
 */
function startProtocolServer(
  answer: (send: Send, connection: ProtocolConnection) => (() => void) | void,
  {
    ackStop = true,
    onHttp,
  }: {
    ackStop?: boolean;
    /** Plain HTTP requests (UploadFile), with the whole body. */
    onHttp?: (request: http.IncomingMessage, response: http.ServerResponse, body: string) => void;
  } = {},
): Promise<{ port: number; connections: ProtocolConnection[]; close: () => void }> {
  const connections: ProtocolConnection[] = [];
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ noServer: true });
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (onHttp) onHttp(request, response, Buffer.concat(chunks).toString("utf8"));
        else response.writeHead(404).end();
      });
    });
    server.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        connections,
        close: () => {
          wss.close();
          server.close();
          // fetch keeps the UploadFile connection alive; it would hold the run open for seconds.
          server.closeAllConnections();
        },
      });
    });
    wss.on("connection", (socket, request) => {
      let markClosed = () => {};
      const connection: ProtocolConnection = {
        index: connections.length,
        url: request.url ?? "",
        sent: [],
        closed: new Promise<void>((done) => (markClosed = done)),
      };
      connections.push(connection);
      const send: Send = (frame) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame) + RS);
      };
      let endAnswer: (() => void) | undefined;
      let handshaken = false;
      socket.on("close", () => {
        connection.closedAt = Date.now();
        endAnswer?.();
        markClosed();
      });
      socket.on("message", (data) => {
        for (const chunk of data.toString().split(RS)) {
          if (!chunk) continue;
          if (!handshaken) {
            handshaken = true;
            socket.send("{}" + RS);
            continue;
          }
          connection.sent.push(chunk);
          const frame = JSON.parse(chunk);
          if (frame.target === "chat") {
            const end = answer(send, connection);
            if (typeof end === "function") endAnswer = end;
          }
          if (frame.target === "stop") {
            connection.stopAt = Date.now();
            endAnswer?.();
            if (ackStop) send({ type: 3, invocationId: frame.invocationId });
          }
        }
      });
    });
  });
}

/** An `update` that streams `writeAtCursor` text. */
function deltaFrame(writeAtCursor: string) {
  return { type: 1, target: "update", arguments: [{ writeAtCursor }] };
}

/** An `update` with one bot message snapshot. */
function botFrame(message: Record<string, unknown>) {
  return { type: 1, target: "update", arguments: [{ messages: [{ author: "bot", ...message }] }] };
}

/**
 * A model that goes on writing: `opening` as deltas, then made-up results
 * every few ms — for seconds, then it ends — until the returned function
 * stops it.
 */
function keepWriting(send: Send, opening: readonly string[], everyMs = 5): () => void {
  let count = 0;
  const timer = setInterval(() => {
    const chunk = opening[count];
    if (chunk !== undefined) send(deltaFrame(chunk));
    else if (count < opening.length + 600) send(deltaFrame(` made-up result #${count}.`));
    else {
      clearInterval(timer);
      send(botFrame({ messageType: "EndOfRequest" }));
    }
    count += 1;
  }, everyMs);
  return () => clearInterval(timer);
}

/** The stop frames a connection received. */
function stopFrames(connection: ProtocolConnection): string[] {
  return connection.sent.filter((frame) => JSON.parse(frame).target === "stop");
}

/** `promise`, or a failure after `ms`: a regression fails the run instead of hanging it. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} (${ms} ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Temporary chats (`disableMemory=1`) unless the history is kept; the chat frame declares `Disengaged`. */
async function testTemporaryChat() {
  const server = await startProtocolServer((send) => {
    send(botFrame({ text: "OK" }));
    send(botFrame({ messageType: "EndOfRequest" }));
  });
  const turn = (mode: TurnMode) =>
    streamCopilotTurn({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      mode,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    });
  const query = (index: number) =>
    new URL(`http://x${server.connections[index]?.url ?? ""}`).searchParams;
  try {
    await turn("tools");
    await turn("web");
    setTemporaryChat(false);
    await turn("tools");
  } finally {
    setTemporaryChat(true);
    server.close();
  }
  assert.equal(query(0).get("disableMemory"), "1", "chat temporal por defecto");
  assert.equal(query(1).get("disableMemory"), "1", "también en los turnos con web");
  assert.equal(
    query(2).has("disableMemory"),
    false,
    "m365copilot.history.save los guarda en el historial",
  );
  assert.equal(query(2).get("source"), "officeweb", "el resto de la URL no cambia");
  // The service only sends the message types a client declares.
  const chat = server.connections[0]?.sent
    .map((frame) => JSON.parse(frame))
    .find((frame) => frame.target === "chat");
  assert.deepEqual(chat?.arguments[0].allowedMessageTypes, [
    "Chat",
    "Suggestion",
    "Progress",
    "Disengaged",
    "EndOfRequest",
  ]);
  console.log(
    "  ✓ chats temporales (disableMemory=1) salvo con el historial activado; la invocación declara Disengaged",
  );
}

/** Cancelling sends the stop frame, so that the service stops writing; the socket closes even without its ack. */
async function testCancelSendsStop() {
  const server = await startProtocolServer((send) => keepWriting(send, ["Hola", ", mundo"]), {
    ackStop: false,
  });
  const controller = new AbortController();
  try {
    await assert.rejects(
      streamCopilotTurn({
        profile: makeProfile(server.port),
        endpointBase: mockBase(server.port),
        prompt: "PROMPT",
        tone: null,
        signal: controller.signal,
        callbacks: { onText: () => controller.abort() },
      }),
      /__CANCELLED__/,
    );
    const connection = server.connections[0];
    assert.ok(connection, "el turno llegó a conectar");
    await within(connection.closed, 6000, "el socket no se cerró");
    assert.deepEqual(
      stopFrames(connection),
      [STOP_FRAME_JSON],
      "una sola trama stop, la de la web",
    );
    const waited = (connection.closedAt ?? 0) - (connection.stopAt ?? 0);
    assert.ok(
      waited >= 1500 && waited < 5000,
      `cerró ${waited} ms después del stop, sin confirmación`,
    );
  } finally {
    server.close();
  }
  console.log(
    "  ✓ cancelar envía la trama stop de la web (y cierra aunque el servicio no la confirme)",
  );
}

/** A complete tool call ends the turn: stop frame, success, nothing the model wrote after it. */
async function testEarlyStopAfterToolCall() {
  const call = `<m365_tool_call>{"name":"${M365_TOOL_NAMES.readFile}","input":{"path":"a.ts"}}</m365_tool_call>`;
  const server = await startProtocolServer((send) =>
    keepWriting(send, ["Voy a leerlo.\n", call.slice(0, 30), call.slice(30)]),
  );
  const finishTurn = new AbortController();
  const calls: unknown[] = [];
  const prose: string[] = [];
  let received = "";
  let done = 0;
  const decoder = new ToolCallDecoder(
    new Set([M365_TOOL_NAMES.readFile]),
    (chunk) => prose.push(chunk),
    (decoded) => {
      calls.push(decoded);
      finishTurn.abort();
    },
  );
  const startedAt = Date.now();
  try {
    await streamCopilotTurn({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      stopSignal: finishTurn.signal,
      callbacks: {
        onText: (delta) => {
          received += delta;
          decoder.push(delta);
        },
        onDone: () => (done += 1),
      },
    });
    const elapsed = Date.now() - startedAt;
    decoder.finish();
    assert.ok(elapsed < 1500, `el turno siguió ${elapsed} ms después de su llamada a herramienta`);
    assert.deepEqual(calls, [{ name: M365_TOOL_NAMES.readFile, input: { path: "a.ts" } }]);
    assert.equal(prose.join(""), "Voy a leerlo.\n");
    assert.equal(received, `Voy a leerlo.\n${call}`, "lo que el modelo escribe después no llega");
    assert.equal(done, 1, "el turno termina bien, una vez");
    const connection = server.connections[0];
    assert.ok(connection);
    await within(connection.closed, 3000, "el socket no se cerró");
    assert.deepEqual(stopFrames(connection), [STOP_FRAME_JSON]);
    // With the service's ack it closes at once, without waiting out the grace.
    assert.ok((connection.closedAt ?? 0) - (connection.stopAt ?? 0) < 1000);
  } finally {
    server.close();
  }
  console.log(
    "  ✓ con la llamada a herramienta completa el turno termina (stop + éxito), sin esperar a que el modelo acabe",
  );
}

/** throttle.ts: the hold, its extension, its end (by time or by an answer), one "it began" per episode. */
function testThrottleState() {
  noteServed();
  const changes: ThrottleChange[] = [];
  // A listener with a bug, first: the others still hear, and nothing throws.
  const unsubscribeBroken = onThrottleChange(() => {
    throw new Error("a listener with a bug");
  });
  const unsubscribe = onThrottleChange((change) => changes.push(change));
  const t0 = Date.UTC(2026, 9, 14, 12, 0);
  try {
    assert.equal(accountThrottledUntil(t0), undefined);
    noteThrottled(t0);
    assert.equal(accountThrottledUntil(t0 + 1000), t0 + THROTTLE_HOLD_MS);
    // Throttled again while it lasts: the hold runs from the last time.
    noteThrottled(t0 + 10 * 60_000);
    assert.equal(accountThrottledUntil(t0 + 10 * 60_000), t0 + 10 * 60_000 + THROTTLE_HOLD_MS);
    // It lapses by itself…
    assert.equal(accountThrottledUntil(t0 + 10 * 60_000 + THROTTLE_HOLD_MS), undefined);
    // …or an answer lifts it at once; with nothing to lift, nothing is announced.
    noteThrottled(t0);
    noteServed();
    noteServed();
    assert.equal(accountThrottledUntil(t0), undefined);
  } finally {
    unsubscribe();
    unsubscribeBroken();
    noteServed();
  }
  assert.deepEqual(changes, [
    { until: t0 + THROTTLE_HOLD_MS, began: true },
    { until: t0 + 10 * 60_000 + THROTTLE_HOLD_MS, began: false },
    { until: undefined, began: false },
    { until: t0 + THROTTLE_HOLD_MS, began: true },
    { until: undefined, began: false },
  ]);
  assert.equal(THROTTLE_HOLD_MS, 75 * 60_000, "lo más largo que se midió");
  console.log(
    "  ✓ throttle: pausa de 75 min desde el último aviso, se levanta sola o con una respuesta, un aviso por episodio",
  );
}

/** Refusals about the account, not the model: which result means what, when quotas refill, how moments read. */
function testAccountLevelErrors() {
  const now = Date.UTC(2026, 9, 14, 15, 30); // a Wednesday
  // When an allowance refills: the next midnight UTC; the weekly one, the next Monday.
  assert.equal(quotaResetAt("day", now), Date.UTC(2026, 9, 15));
  assert.equal(quotaResetAt("week", now), Date.UTC(2026, 9, 19));
  assert.equal(
    quotaResetAt("week", Date.UTC(2026, 9, 19, 0, 0, 1)),
    Date.UTC(2026, 9, 26),
    "un lunes, el siguiente",
  );
  assert.equal(
    quotaResetAt("week", Date.UTC(2026, 9, 18, 23, 59)),
    Date.UTC(2026, 9, 19),
    "un domingo, mañana",
  );
  assert.equal(
    quotaResetAt("day", Date.UTC(2026, 11, 31, 23, 0)),
    Date.UTC(2027, 0, 1),
    "cambio de año",
  );
  assert.equal(quotaWindowOf("You have used up your priority access for today."), "day");
  assert.equal(quotaWindowOf("Your weekly limit resets on Monday."), "week");
  assert.equal(quotaWindowOf("Has agotado el acceso prioritario de esta semana."), "week");
  assert.equal(quotaWindowOf("Vuelve a intentarlo el lunes."), "week");
  assert.equal(quotaWindowOf(""), "day");

  // What the refusal's result says decides the error.
  const throttled = serviceResultError(
    { value: "Throttled", errorCode: "PerUserThrottled", message: "Slow down." },
    "Chat",
    now,
  );
  assert.ok(throttled instanceof CopilotThrottledError);
  assert.equal(throttled.errorCode, "PerUserThrottled");
  assert.equal(throttled.until, now + THROTTLE_HOLD_MS);
  assert.ok(
    serviceResultError({ value: "Failure", errorCode: "PerUserThrottled" }, null, now) instanceof
      CopilotThrottledError,
  );
  const quota = serviceResultError(
    { value: "OutOfCredits", message: "Your weekly limit is used up." },
    "Claude_Opus_5_5",
    now,
  );
  assert.ok(quota instanceof CopilotQuotaExhaustedError);
  assert.equal(quota.window, "week");
  assert.equal(quota.resetsAt, Date.UTC(2026, 9, 19));
  assert.ok(
    serviceResultError(
      { value: "Forbidden", errorCode: "InvalidCopilotLicense" },
      null,
      now,
    ) instanceof CopilotLicenseError,
  );
  assert.ok(
    serviceResultError({ value: "InvalidCopilotLicense" }, null, now) instanceof
      CopilotLicenseError,
  );
  assert.equal(
    serviceResultError({ value: "UnsupportedTone", message: "no such model" }, "Gpt_9", now),
    null,
  );
  // Without the service's own words, no "M365 Copilot dijo".
  assert.doesNotMatch(new CopilotLicenseError("InvalidCopilotLicense", "  ").message, /dijo/);

  // Never retried, never blamed on the model.
  for (const error of [
    throttled,
    quota,
    new CopilotLicenseError("InvalidCopilotLicense", ""),
    new CopilotDisengagedError(),
  ]) {
    assert.equal(isAccountLevelError(error), true, error.constructor.name);
    assert.equal(isRetryableClientError(error), false, error.constructor.name);
  }
  for (const error of [
    new CopilotClientError("blip"),
    new CopilotModelUnavailableError("Gpt_9", "no"),
    new CopilotAuthError("401", 401),
  ]) {
    assert.equal(isAccountLevelError(error), false, error.constructor.name);
  }
  assert.equal(isRetryableClientError(new CopilotClientError("blip")), true);

  // "Until…" in the user's time: just the time today, with the day otherwise.
  const local = new Date(2026, 9, 14, 9, 5).getTime();
  assert.match(formatMoment(local + 60 * 60_000, local), /^\d{2}:\d{2}$/);
  const later = formatMoment(local + 3 * 86_400_000, local);
  assert.match(later, /17/, "el día");
  assert.match(later, /\d{2}:\d{2}$/, "y la hora");
  console.log(
    "  ✓ errores de cuenta: throttling, cuota (día/semana y su renovación), licencia y Disengaged, sin reintento",
  );
}

/** A throttled turn: a clear error, not retried, automatic requests paused until a turn is answered. */
async function testThrottledTurn() {
  let throttle = true;
  const server = await startProtocolServer((send) => {
    if (throttle) {
      send({
        type: 2,
        invocationId: "0",
        item: {
          result: {
            value: "Throttled",
            errorCode: "PerUserThrottled",
            message: "You have sent too many messages.",
          },
        },
      });
      send({ type: 3, invocationId: "0" });
    } else {
      send(botFrame({ text: "OK" }));
      send(botFrame({ messageType: "EndOfRequest" }));
    }
  });
  const outcomes: string[] = [];
  onModelOutcome((tone, available) => outcomes.push(`${tone}:${available ? "ok" : "unavailable"}`));
  const changes: ThrottleChange[] = [];
  const unsubscribe = onThrottleChange((change) => changes.push(change));
  const turn = () => {
    let text = "";
    return streamCopilotTurnWithRetry({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: "Gpt_5_5_Chat",
      signal: new AbortController().signal,
      callbacks: { onText: (delta) => (text += delta) },
      retryDelayMs: 1,
    }).then(() => text);
  };
  noteServed();
  try {
    const before = Date.now();
    await assert.rejects(turn(), (error: unknown) => {
      assert.ok(error instanceof CopilotThrottledError, "esperaba CopilotThrottledError");
      assert.equal(error.errorCode, "PerUserThrottled");
      assert.ok(
        error.until >= before + THROTTLE_HOLD_MS && error.until <= Date.now() + THROTTLE_HOLD_MS,
      );
      // Human words only: the code and the server's own text stay on the error, not in the message.
      assert.doesNotMatch(error.message, /PerUserThrottled|You have sent/);
      assert.match(error.message, /reintentar antes solo lo alarga/);
      assert.equal(error.serverMessage, "You have sent too many messages.");
      return true;
    });
    assert.equal(server.connections.length, 1, "no se reintenta: solo lo alargaría");
    const until = accountThrottledUntil();
    assert.ok(
      until !== undefined && until >= before + THROTTLE_HOLD_MS,
      "las peticiones automáticas esperan",
    );
    assert.deepEqual(
      changes.map((change) => change.began),
      [true],
    );
    // Again while it lasts: the hold is extended, without a second "it began".
    await assert.rejects(turn(), CopilotThrottledError);
    assert.deepEqual(
      changes.map((change) => change.began),
      [true, false],
    );
    assert.deepEqual(outcomes, [], "el throttling no dice nada del modelo");
    // Any answered turn proves it lifted.
    throttle = false;
    assert.equal(await turn(), "OK");
    assert.equal(accountThrottledUntil(), undefined);
    assert.equal(changes.at(-1)?.until, undefined);
  } finally {
    unsubscribe();
    onModelOutcome(undefined);
    noteServed();
    server.close();
  }
  console.log(
    "  ✓ throttling: error claro, sin reintento, pausa las peticiones automáticas hasta que una respuesta llega",
  );
}

/** Priority access used up: said with when it refills, the model flagged until then; no licence: nothing flagged. */
async function testQuotaAndLicense() {
  let reply: (send: Send) => void = () => {};
  const server = await startProtocolServer((send) => reply(send));
  const result = (value: Record<string, unknown>) => (send: Send) => {
    send({ type: 2, invocationId: "0", item: { result: value } });
    send({ type: 3, invocationId: "0" });
  };
  const flagged: { tone: string; available: boolean; reason?: string; until?: number }[] = [];
  onModelOutcome((tone, available, reason, until) =>
    flagged.push({ tone, available, reason, until }),
  );
  const turn = (tone: string | null) =>
    streamCopilotTurnWithRetry({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
      retryDelayMs: 1,
    });
  try {
    const daily = "You have used up your priority access to Claude Opus for today.";
    reply = result({ value: "OutOfCredits", message: daily });
    let resetsAt = 0;
    await assert.rejects(turn("Claude_Opus_5_5"), (error: unknown) => {
      assert.ok(error instanceof CopilotQuotaExhaustedError, "esperaba CopilotQuotaExhaustedError");
      assert.equal(error.tone, "Claude_Opus_5_5");
      assert.equal(error.window, "day");
      assert.ok(
        [quotaResetAt("day"), quotaResetAt("day", Date.now() - 5000)].includes(error.resetsAt),
        "la próxima medianoche UTC",
      );
      assert.match(error.message, /Claude Opus 5\.5/);
      assert.match(error.message, /medianoche UTC/);
      assert.equal(error.serverMessage, daily);
      resetsAt = error.resetsAt;
      return true;
    });
    assert.equal(server.connections.length, 1, "no se reintenta");
    // Flagged until it refills, not for the usual hours.
    assert.deepEqual(flagged, [
      { tone: "Claude_Opus_5_5", available: false, reason: daily, until: resetsAt },
    ]);

    // The weekly allowance: until Monday.
    reply = result({
      value: "OutOfCredits",
      message: "You have reached your weekly limit for Claude Opus.",
    });
    await assert.rejects(turn("Claude_Opus_5_5"), (error: unknown) => {
      assert.ok(error instanceof CopilotQuotaExhaustedError);
      assert.equal(error.window, "week");
      assert.equal(new Date(error.resetsAt).getUTCDay(), 1, "un lunes");
      assert.match(error.message, /el lunes a medianoche UTC/);
      return true;
    });

    // The service's canned refusal, when the result does not say OutOfCredits.
    reply = (send) => {
      send(
        botFrame({
          contentOrigin: "BotConnection",
          text: "You have reached your priority access limit for this model. Try again tomorrow.",
        }),
      );
      send(botFrame({ messageType: "EndOfRequest" }));
    };
    await assert.rejects(turn("Claude_Opus_5_5"), (error: unknown) => {
      assert.ok(error instanceof CopilotQuotaExhaustedError, "el texto enlatado también cuenta");
      assert.equal(error.window, "day");
      return true;
    });

    // With Auto there is no model to flag.
    const flaggedBefore = flagged.length;
    reply = result({ value: "OutOfCredits", message: daily });
    await assert.rejects(turn(null), (error: unknown) => {
      assert.ok(error instanceof CopilotQuotaExhaustedError);
      assert.equal(error.tone, null);
      assert.match(error.message, /M365 Copilot/);
      return true;
    });
    assert.equal(flagged.length, flaggedBefore);

    // No valid licence: about the account — nothing flagged, nothing retried.
    const connectionsBefore = server.connections.length;
    reply = result({
      value: "Forbidden",
      errorCode: "InvalidCopilotLicense",
      message: "It looks like you don't have a valid license.",
    });
    await assert.rejects(turn("Gpt_5_5_Chat"), (error: unknown) => {
      assert.ok(error instanceof CopilotLicenseError, "esperaba CopilotLicenseError");
      assert.equal(error.errorCode, "InvalidCopilotLicense");
      assert.match(error.message, /licencia válida/);
      assert.equal(error.serverMessage, "It looks like you don't have a valid license.");
      return true;
    });
    assert.equal(server.connections.length - connectionsBefore, 1, "no se reintenta");
    assert.equal(flagged.length, flaggedBefore, "la licencia no es cosa del modelo");
  } finally {
    onModelOutcome(undefined);
    server.close();
  }
  console.log(
    "  ✓ cuota agotada (OutOfCredits o texto enlatado): hora de renovación y modelo marcado hasta entonces; licencia: aviso claro",
  );
}

/** The service declines to answer: an error (never text an editor feature could insert), not retried. */
async function testDisengaged() {
  const server = await startProtocolServer((send) => {
    send(botFrame({ messageType: "Disengaged", text: "" }));
    send({ type: 3, invocationId: "0" });
  });
  const outcomes: string[] = [];
  onModelOutcome((tone, available) => outcomes.push(`${tone}:${available ? "ok" : "unavailable"}`));
  let text = "";
  try {
    await assert.rejects(
      streamCopilotTurnWithRetry({
        profile: makeProfile(server.port),
        endpointBase: mockBase(server.port),
        prompt: "PROMPT",
        tone: "Gpt_5_5_Chat",
        signal: new AbortController().signal,
        callbacks: { onText: (delta) => (text += delta) },
        retryDelayMs: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CopilotDisengagedError, "esperaba CopilotDisengagedError");
        assert.match(error.message, /preferido no responder/);
        return true;
      },
    );
    assert.equal(text, "", "nada llega como texto");
    assert.equal(server.connections.length, 1, "no se reintenta: volvería a pasar");
    assert.deepEqual(outcomes, [], "no es cosa del modelo");
    const connection = server.connections[0];
    assert.ok(connection);
    await within(connection.closed, 3000, "el socket no se cerró");
    assert.deepEqual(stopFrames(connection), [], "el servicio ya terminó: nada que parar");
  } finally {
    onModelOutcome(undefined);
    server.close();
  }
  console.log("  ✓ Disengaged: error claro (nunca texto), sin reintento ni modelo marcado");
}

/** The @m365 / sub-agent loop ends each step's turn as soon as its tool call is complete. */
async function testToolLoopStopsAfterCall() {
  const server = await startProtocolServer((send, connection) => {
    if (connection.index === 0) {
      return keepWriting(send, [
        `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`,
      ]);
    }
    send(botFrame({ text: "Está en a.ts." }));
    send(botFrame({ messageType: "EndOfRequest" }));
  });
  const startedAt = Date.now();
  try {
    const result = await runToolLoop({
      framing: "Busca foo.",
      profile: makeProfile(server.port),
      tone: null,
      maxSteps: 3,
      signal: new AbortController().signal,
      offeredTools: [{ name: M365_TOOL_NAMES.searchText }],
      endpointBase: mockBase(server.port),
      executeTool: async () => "a.ts:1: foo",
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(result.outcome, "done");
    assert.equal(result.summary, "Está en a.ts.");
    assert.equal(result.steps, 2);
    assert.ok(
      elapsed < 1500,
      `el bucle esperó ${elapsed} ms a que el modelo terminara tras su llamada`,
    );
    const [first, second] = server.connections;
    assert.ok(first && second);
    await within(first.closed, 3000, "el socket del primer paso no se cerró");
    assert.deepEqual(stopFrames(first), [STOP_FRAME_JSON], "el paso con llamada se para");
    assert.deepEqual(stopFrames(second), [], "la respuesta final terminó sola");
  } finally {
    server.close();
  }
  console.log(
    "  ✓ runToolLoop termina el turno de cada paso en cuanto su llamada a herramienta está completa",
  );
}

// ---- paid scenario, images, web search, give-ups, output limit, turn summary --

/** The prompt a connection's chat invocation carried. */
function promptOf(connection: ProtocolConnection | undefined): string {
  const chat = connection?.sent
    .map((frame) => JSON.parse(frame))
    .find((frame) => frame.target === "chat");
  return String(chat?.arguments[0].message.text ?? "");
}

/** The chat invocation's arguments a connection carried. */
function chatArgsOf(connection: ProtocolConnection | undefined): Record<string, any> {
  const chat = connection?.sent
    .map((frame) => JSON.parse(frame))
    .find((frame) => frame.target === "chat");
  return chat?.arguments[0] ?? {};
}

/** Models of the Microsoft 365 Copilot licence: selectors, the scenario read from the web app and sent per model. */
async function testPaidScenario() {
  assert.deepEqual(parseToneSelector("Claude_Sonnet"), { tone: "Claude_Sonnet", paid: false });
  assert.deepEqual(parseToneSelector("Claude_Sonnet@paid"), { tone: "Claude_Sonnet", paid: true });
  assert.deepEqual(
    parseToneSelector("Claude_Opus"),
    { tone: "Claude_Opus", paid: true },
    "solo de pago: sin sufijo también",
  );
  assert.equal(
    normalizeSelector(" Claude_Opus@paid "),
    "Claude_Opus",
    "el sufijo sobra en un tone solo de pago",
  );
  assert.equal(normalizeSelector("Claude_Sonnet@paid"), "Claude_Sonnet@paid");
  assert.equal(normalizeSelector("bad tone@paid"), null);
  assert.equal(normalizeSelector("Gpt_5_5_Chat@premium"), null);
  assert.equal(isPaidSelector(null), false);
  assert.equal(isPaidSelector("Gpt_6_Reasoning"), true);
  assert.equal(
    isPaidSelector("Gpt_61_Sol_Reasoning"),
    false,
    "GPT-6.1 Sol sirve gratis en el escenario incluido",
  );
  assert.equal(prettyTone("Claude_Sonnet@paid"), "Claude Sonnet (paid)");
  assert.deepEqual([...PAID_ONLY_TONES].sort(), [
    "Claude_Opus",
    "Claude_Sonnet_5",
    "Gpt_6_Reasoning",
  ]);
  // Versions without paid models skip these catalog entries: `@` is not a tone for them.
  assert.equal(/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test("Claude_Sonnet@paid"), false);

  // The licence, as the web app showed it.
  const paidEndpoint =
    "wss://substrate.office.com/m365Copilot/Chathub/o@t?source=officeweb&scenario=OfficeWebPaidCopilot&licenseType=Premium";
  assert.deepEqual(capturedScenario(paidEndpoint), {
    scenario: "OfficeWebPaidCopilot",
    licenseType: "Premium",
  });
  assert.equal(accountTier({ endpoint: paidEndpoint }), "paid");
  assert.equal(
    accountTier({ endpoint: "wss://x/y?scenario=OfficeWebIncludedCopilot&licenseType=Starter" }),
    "included",
  );
  assert.equal(accountTier({ endpoint: null }), "unknown");
  assert.equal(accountTier({ endpoint: "wss://x/y?source=officeweb" }), "unknown");
  assert.equal(capturedScenario("not a url"), undefined);

  // On the wire: only the models that need it go on the paid scenario, with the bare tone.
  const server = await startProtocolServer((send) => {
    send(botFrame({ text: "OK" }));
    send(botFrame({ messageType: "EndOfRequest" }));
  });
  const turn = (tone: string | null, endpoint?: string) =>
    streamCopilotTurn({
      profile: { ...makeProfile(server.port), ...(endpoint ? { endpoint } : {}) },
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    });
  const sent = (index: number) => {
    const connection = server.connections[index];
    const query = new URL(`http://x${connection?.url ?? ""}`).searchParams;
    return {
      scenario: query.get("scenario"),
      licenseType: query.get("licenseType"),
      tone: chatArgsOf(connection).tone,
    };
  };
  try {
    await turn("Claude_Sonnet");
    await turn("Claude_Sonnet@paid");
    await turn("Claude_Opus");
    await turn(null);
    // A paid turn reuses the web app's own names for it.
    await turn(
      "Gpt_6_Reasoning",
      "wss://substrate.office.com/m365Copilot/Chathub/o@t?scenario=OfficeWebPaidCopilotV2&licenseType=PremiumPlus",
    );
  } finally {
    server.close();
  }
  assert.deepEqual(sent(0), {
    scenario: "OfficeWebIncludedCopilot",
    licenseType: null,
    tone: "Claude_Sonnet",
  });
  assert.deepEqual(sent(1), {
    scenario: "OfficeWebPaidCopilot",
    licenseType: "Premium",
    tone: "Claude_Sonnet",
  });
  assert.deepEqual(sent(2), {
    scenario: "OfficeWebPaidCopilot",
    licenseType: "Premium",
    tone: "Claude_Opus",
  });
  assert.deepEqual(sent(3), {
    scenario: "OfficeWebIncludedCopilot",
    licenseType: null,
    tone: "magic",
  });
  assert.deepEqual(sent(4), {
    scenario: "OfficeWebPaidCopilotV2",
    licenseType: "PremiumPlus",
    tone: "Gpt_6_Reasoning",
  });

  // Without the licence: that model is flagged, with a clear reason; the account's other models are fine.
  let refusal: (send: Send) => void = () => {};
  const refusing = await startProtocolServer((send) => refusal(send));
  const outcomes: string[] = [];
  onModelOutcome((tone, available) => outcomes.push(`${tone}:${available ? "ok" : "unavailable"}`));
  const refusedTurn = (tone: string) =>
    streamCopilotTurnWithRetry({
      profile: makeProfile(refusing.port),
      endpointBase: mockBase(refusing.port),
      prompt: "PROMPT",
      tone,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
      retryDelayMs: 1,
    });
  try {
    const licence =
      "It looks like you don't have a valid licence. To get access, please check with your administrator.";
    refusal = (send) => {
      send({
        type: 2,
        invocationId: "0",
        item: {
          result: {
            value: "ForbiddenRequest",
            errorCode: "InvalidCopilotLicense",
            message: licence,
          },
        },
      });
      send({ type: 3, invocationId: "0" });
    };
    await assert.rejects(refusedTurn("Claude_Sonnet@paid"), (error: unknown) => {
      assert.ok(
        error instanceof CopilotPremiumRequiredError,
        "esperaba CopilotPremiumRequiredError",
      );
      assert.ok(error instanceof CopilotModelUnavailableError, "cuenta como modelo no disponible");
      assert.match(error.message, /Claude Sonnet \(paid\)/);
      assert.match(error.message, /licencia de Microsoft 365 Copilot/);
      assert.match(error.serverReply, /It looks like you don't have a valid licence/);
      return true;
    });
    assert.equal(refusing.connections.length, 1, "no se reintenta");
    assert.deepEqual(
      outcomes,
      ["Claude_Sonnet@paid:unavailable"],
      "se marca ese modelo, por su selector",
    );
    // The service's canned licence text says the same.
    refusal = (send) => {
      send(botFrame({ contentOrigin: "BotConnection", text: licence }));
      send(botFrame({ messageType: "EndOfRequest" }));
    };
    await assert.rejects(refusedTurn("Claude_Opus"), CopilotPremiumRequiredError);
    // On Copilot Chat's own scenario the same refusal is about the account: nothing flagged.
    await assert.rejects(
      refusedTurn("Gpt_5_5_Chat"),
      (error: unknown) =>
        error instanceof CopilotLicenseError && !(error instanceof CopilotModelUnavailableError),
    );
    assert.deepEqual(outcomes, ["Claude_Sonnet@paid:unavailable", "Claude_Opus:unavailable"]);
  } finally {
    onModelOutcome(undefined);
    refusing.close();
  }
  console.log(
    "  ✓ modelos de pago: Tone@paid, escenario leído de la web y enviado solo donde hace falta; sin licencia, modelo marcado",
  );
}

/** Pasted images: uploaded first like the web app does, then referenced from the chat message. */
async function testImageUpload() {
  const uploads: { headers: http.IncomingHttpHeaders; form: URLSearchParams }[] = [];
  let failNext = false;
  const server = await startProtocolServer(
    (send) => {
      send(botFrame({ text: "Veo un botón." }));
      send(botFrame({ messageType: "EndOfRequest" }));
    },
    {
      onHttp: (request, response, body) => {
        if (request.method !== "POST" || request.url !== "/m365Copilot/UploadFile") {
          response.writeHead(404).end();
          return;
        }
        uploads.push({ headers: request.headers, form: new URLSearchParams(body) });
        if (failNext) {
          failNext = false;
          response.writeHead(500).end("boom");
          return;
        }
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ docId: `doc-${uploads.length}` }));
      },
    },
  );
  const png = new Uint8Array([1, 2, 3]);
  const profile = makeProfile(server.port);
  const skipped: string[] = [];
  const turn = (images: TurnImage[]) =>
    streamCopilotTurn({
      profile,
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      images,
      callbacks: { onText: () => {}, onImageSkipped: (reason) => skipped.push(reason) },
    });
  try {
    await turn([
      { mimeType: "image/png", data: png },
      { mimeType: "image/tiff", data: png },
      { mimeType: "image/jpg", data: png },
    ]);
    failNext = true;
    await turn([{ mimeType: "image/png", data: png }]);
    await turn(Array.from({ length: 6 }, () => ({ mimeType: "image/png", data: png })));
  } finally {
    server.close();
  }
  const [first, second] = uploads;
  assert.ok(first && second);
  const conversationId = new URL(`http://x${server.connections[0]?.url ?? ""}`).searchParams.get(
    "ConversationId",
  );
  assert.equal(first.form.get("scenario"), "UploadImage");
  assert.equal(
    first.form.get("conversationId"),
    conversationId,
    "la subida va ligada a la conversación del turno",
  );
  assert.equal(first.form.get("FileBase64"), "data:image/png;base64,AQID");
  assert.deepEqual(first.form.getAll("optionsSets"), [
    "cwcgptvsan",
    "flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch",
  ]);
  assert.equal(first.headers.authorization, `Bearer ${profile.accessToken}`);
  assert.equal(first.headers["x-scenario"], "OfficeWebIncludedCopilot");
  assert.equal(first.headers["x-variants"], "feature.EnableImageSupportInUploadFile");
  assert.equal(first.headers.origin, "https://m365.cloud.microsoft");
  assert.equal(
    second.form.get("FileBase64"),
    "data:image/jpeg;base64,AQID",
    "image/jpg se envía como image/jpeg",
  );
  const annotation = (id: string, fileType: string, fileName: string) => ({
    id,
    messageAnnotationType: "ImageFile",
    messageAnnotationMetadata: { "@type": "File", annotationType: "File", fileType, fileName },
  });
  assert.deepEqual(chatArgsOf(server.connections[0]).message.messageAnnotations, [
    annotation("doc-1", "png", "image-1.png"),
    annotation("doc-2", "jpg", "image-2.jpg"),
  ]);
  assert.match(skipped[0] ?? "", /image\/tiff/);
  // A refused upload leaves that image out, not the turn.
  assert.match(skipped[1] ?? "", /UploadFile 500/);
  assert.equal("messageAnnotations" in chatArgsOf(server.connections[1]).message, false);
  // At most four per turn, the latest.
  assert.match(skipped[2] ?? "", /\b2\b/);
  assert.equal(chatArgsOf(server.connections[2]).message.messageAnnotations.length, 4);
  assert.equal(uploads.length, 3 + 4);
  console.log(
    "  ✓ imágenes: se suben a UploadFile con el token y la conversación, y el mensaje las referencia (las que fallan se omiten)",
  );
}

/** Web search with a token pasted by hand: the lean invocation with the web app's search plugin. */
async function testWebSearchWithoutTemplate() {
  const server = await startProtocolServer((send) => {
    send(botFrame({ messageType: "InternalSearchQuery", text: "node lts" }));
    send(
      botFrame({
        text: "Node 24 is the LTS [^1^].",
        messageId: "a",
        sourceAttributions: [{ providerDisplayName: "Node.js", seeMoreUrl: "https://nodejs.org" }],
      }),
    );
    send(botFrame({ messageType: "EndOfRequest" }));
  });
  let text = "";
  const sources: unknown[] = [];
  try {
    await streamCopilotTurnWithRetry({
      profile: { ...makeProfile(server.port), invocationTemplate: null },
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      mode: "web",
      signal: new AbortController().signal,
      callbacks: {
        onText: (delta) => (text += delta),
        onSources: (found) => sources.push(...found),
      },
    });
  } finally {
    server.close();
  }
  const args = chatArgsOf(server.connections[0]);
  assert.deepEqual(args.plugins, [{ Id: "BingWebSearch", Source: "BuiltIn" }]);
  for (const type of ["InternalSearchQuery", "RenderCardRequest", "Disengaged", "EndOfRequest"]) {
    assert.ok(args.allowedMessageTypes.includes(type), type);
  }
  assert.equal(args.allowedMessageTypes.at(-1), "EndOfRequest");
  assert.equal(args.tone, "magic");
  assert.equal(args.message.text, "PROMPT");
  assert.equal(text, "Node 24 is the LTS [^1^].");
  assert.deepEqual(sources, [{ title: "Node.js", url: "https://nodejs.org" }]);
  // A fresh template every time: nothing leaks from one turn to the next.
  (syntheticWebTemplate().plugins as unknown[]).push("x");
  assert.equal((syntheticWebTemplate().plugins as unknown[]).length, 1);
  console.log(
    "  ✓ búsqueda web sin la plantilla capturada: invocación ligera con BingWebSearch, respuesta y fuentes",
  );
}

/** giveUp.ts: what counts as giving up or as M365's own sandbox, and the prose hold. */
function testGiveUpDetection() {
  const giveUps = [
    "I can't access your files from here. Please paste the contents of src/a.ts here and I'll fix it.",
    "I don't have access to the workspace, so I can't run the tests.",
    "Could you share the file so I can take a look?",
    "Unable to read the repository from this session.",
    "No puedo acceder a tus archivos desde aquí. Pégame el contenido de src/a.ts y lo arreglo.",
    "No tengo acceso al repositorio, así que no puedo ejecutar los tests.",
    "¿Puedes compartirme el archivo para revisarlo?",
    "Las herramientas no están disponibles en esta sesión.",
  ];
  for (const text of giveUps) assert.equal(looksLikeGiveUp(text), true, text);
  const answers = [
    "Copy the code below into src/a.ts:\n\n```ts\nexport const a = 1;\n```",
    "I can't see any error in this code: the loop ends at length - 1 on purpose.",
    "No veo ningún error en el código: el bucle termina en length - 1 a propósito.",
    "Paste the snippet into your browser console to try it.",
    "Pega el fragmento en la consola del navegador para probarlo.",
    "Done: activate() now registers the provider before the commands.",
    "Ok.",
  ];
  for (const text of answers) assert.equal(looksLikeGiveUp(text), false, text);

  for (const text of [
    "I ran `ls /mnt/data` and the folder is empty.",
    "Saved to sandbox:/mnt/data/fix.patch",
    "Here it is: https://eu-prod.asyncgw.teams.microsoft.com/v1/objects/abc/views/original/a.ts",
    "The working directory is /home/claude.",
  ]) {
    assert.equal(looksLikeRemoteSandbox(text), true, text);
  }
  for (const text of [
    "Run it from /mnt/c/Users/me/project (WSL).",
    "Your home is /home/carana.",
    "Mount the volume at /mnt/database.",
  ]) {
    assert.equal(looksLikeRemoteSandbox(text), false, text);
  }
  assert.equal(
    toolFreeProblem("Hecho.", true),
    "sandbox",
    "el servicio dijo que ejecutó en su sandbox",
  );
  assert.equal(toolFreeProblem(giveUps[0] ?? ""), "giveUp");
  assert.equal(
    toolFreeProblem("Saved to sandbox:/mnt/data/x. Paste the contents here."),
    "sandbox",
    "el sandbox pesa más",
  );
  assert.equal(toolFreeProblem("Done."), null);

  const out: string[] = [];
  const hold = new ProseHold((text) => out.push(text), 10);
  hold.push("abc");
  assert.deepEqual(out, []);
  assert.equal(hold.holding, true);
  assert.equal(hold.discard(), "abc");
  hold.push("0123456789X");
  assert.deepEqual(out, ["0123456789X"], "pasado el límite sale todo lo retenido");
  assert.equal(hold.holding, false);
  hold.push("y");
  assert.deepEqual(out, ["0123456789X", "y"]);
  const flushed: string[] = [];
  const other = new ProseHold((text) => flushed.push(text));
  other.push("a");
  other.flush();
  other.flush();
  assert.deepEqual(flushed, ["a"]);
  assert.equal(PROSE_HOLD_CHARS, 2_000);
  console.log(
    "  ✓ detecta rendiciones (inglés y español) y el sandbox remoto sin confundirlos con respuestas normales",
  );
}

/** The @m365 / sub-agent loop: a step that gives up or works in M365's sandbox is retried once, unseen. */
async function testToolLoopForcedRetry() {
  const loop = (
    port: number,
    onProse: (delta: string) => void,
    offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }],
  ) =>
    runToolLoop({
      framing: "Busca foo.",
      profile: makeProfile(port),
      tone: null,
      maxSteps: 3,
      signal: new AbortController().signal,
      offeredTools,
      endpointBase: mockBase(port),
      executeTool: async () => "a.ts:1: foo",
      onProse,
    });
  const reply = (text: string) => (send: Send) => {
    send(botFrame({ text }));
    send(botFrame({ messageType: "EndOfRequest" }));
  };
  const call = `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`;

  // Gives up, then calls the tool: the give-up never reaches the user, and the retry is not a step.
  const giveUp =
    "No puedo acceder a tus archivos desde aquí. Pégame el contenido de a.ts y lo miro.";
  const scripted = [reply(giveUp), reply(call), reply("Está en a.ts.")];
  const server = await startProtocolServer((send, connection) =>
    scripted[connection.index]?.(send),
  );
  const prose: string[] = [];
  try {
    const result = await loop(server.port, (delta) => prose.push(delta));
    assert.equal(result.outcome, "done");
    assert.equal(result.summary, "Está en a.ts.");
    assert.equal(result.steps, 2, "el reintento no cuenta como paso");
  } finally {
    server.close();
  }
  assert.equal(server.connections.length, 3);
  assert.equal(prose.join(""), "Está en a.ts.", "la rendición nunca llega al usuario");
  assert.ok(
    promptOf(server.connections[1]).endsWith(t("protocol.force.giveUp")),
    "el reintento lleva la nota al final",
  );
  assert.ok(
    !promptOf(server.connections[1]).includes("Busca foo."),
    "el reintento continúa la conversación sin repetir la tarea",
  );
  assert.ok(
    !promptOf(server.connections[1]).includes("a.ts:1: foo"),
    "no se envía un resultado antes de ejecutar la herramienta",
  );
  assert.ok(!promptOf(server.connections[0]).includes(t("protocol.force.giveUp")));
  assert.ok(
    !promptOf(server.connections[2]).includes(t("protocol.force.giveUp")),
    "la nota se quita en cuanto llama a una herramienta",
  );
  assert.match(
    promptOf(server.connections[2]),
    /a\.ts:1: foo/,
    "el turno siguiente recibe el resultado de la herramienta",
  );
  assert.ok(
    !promptOf(server.connections[2]).includes("Busca foo."),
    "el turno siguiente no repite la tarea inicial",
  );

  // Works in its own sandbox, twice: one retry only, then the answer with a clear warning.
  const sandbox = await startProtocolServer((send) => {
    send(
      botFrame({
        messageType: "Progress",
        contentType: "Code",
        text: "Coding and executing",
        hiddenText: "bash -lc ls /mnt/data",
      }),
    );
    send(botFrame({ text: "He revisado la carpeta: no hay archivos." }));
    send(botFrame({ messageType: "EndOfRequest" }));
  });
  const sandboxProse: string[] = [];
  try {
    const result = await loop(sandbox.port, (delta) => sandboxProse.push(delta));
    assert.equal(result.outcome, "done");
    assert.ok(result.summary.endsWith(t("turn.remoteSandbox")));
  } finally {
    sandbox.close();
  }
  assert.equal(sandbox.connections.length, 2, "un solo reintento por bucle");
  assert.ok(promptOf(sandbox.connections[1]).endsWith(t("protocol.force.sandbox")));
  assert.equal(
    sandboxProse.join(""),
    `He revisado la carpeta: no hay archivos.${t("turn.remoteSandbox")}`,
  );

  // Already on screen (long), or no tools to call: no retry.
  const long = `${"Explicación larga. ".repeat(Math.ceil(PROSE_HOLD_CHARS / 19) + 1)}No puedo acceder a tus archivos.`;
  const shown = await startProtocolServer((send) => reply(long)(send));
  try {
    assert.equal((await loop(shown.port, () => {})).summary, long.trim());
    assert.equal((await loop(shown.port, () => {}, [])).summary, long.trim());
  } finally {
    shown.close();
  }
  assert.equal(
    shown.connections.length,
    2,
    "ni la respuesta larga ni la que no tenía herramientas se repiten",
  );
  console.log(
    "  ✓ runToolLoop: una rendición o el sandbox remoto se reintentan una vez con una nota, sin que el usuario vea la primera",
  );
}

/** The output limit: a call cut off by it says so (and how to split), and the protocol tells the model beforehand. */
function testOutputLimitNotice() {
  const decode = (chunks: readonly string[]) => {
    const text: string[] = [];
    const calls: unknown[] = [];
    const decoder = new ToolCallDecoder(
      new Set([M365_TOOL_NAMES.applyWorkspaceEdits]),
      (chunk) => text.push(chunk),
      (decoded) => calls.push(decoded),
    );
    for (const chunk of chunks) decoder.push(chunk);
    decoder.finish();
    return { text: text.join(""), calls };
  };
  const big = "a".repeat(NEAR_OUTPUT_LIMIT_CHARS);
  const edit = `<m365_tool_call>{"name":"${M365_TOOL_NAMES.applyWorkspaceEdits}","input":{"edits":[{"op":"create","path":"big.ts","content":"@@block:1@@"}]}}</m365_tool_call>\n<m365_block id="1">\n`;
  const cut = decode([edit, big]);
  assert.deepEqual(cut.calls, []);
  assert.match(cut.text, /límite de salida/);
  assert.match(cut.text, /12\.000/, "el número en el formato del idioma");
  // The JSON itself cut off: no longer a blank turn.
  const json = decode([
    `<m365_tool_call>{"name":"${M365_TOOL_NAMES.applyWorkspaceEdits}","input":{"edits":[{"op":"create","path":"big.ts","content":"${big}`,
  ]);
  assert.match(
    json.text,
    new RegExp(`La llamada a \`${M365_TOOL_NAMES.applyWorkspaceEdits}\` se cortó`),
  );
  // A short cut-off keeps the usual notice; a short malformed call stays silent.
  const short = decode([`${edit}console`]);
  assert.match(short.text, /incompleta/);
  assert.doesNotMatch(short.text, /límite/);
  assert.equal(decode([`<m365_tool_call>{"name":"x","input":{`]).text, "");
  assert.equal(OUTPUT_LIMIT_CHARS, 12_000);
  // The rule, with any edit tool on offer.
  const catalog = buildToolCatalog(
    [{ name: M365_TOOL_NAMES.applyWorkspaceEdits }, { name: M365_TOOL_NAMES.readFile }],
    {
      includeEditorTools: false,
      duplicates: "both",
      maxTools: 10,
    },
  );
  assert.match(buildToolProtocolInstructions(catalog), /unos 12\.000 caracteres/);
  const readOnly = buildToolCatalog([{ name: M365_TOOL_NAMES.readFile }], {
    includeEditorTools: false,
    duplicates: "both",
    maxTools: 10,
  });
  assert.doesNotMatch(buildToolProtocolInstructions(readOnly), /12\.000/);
  console.log(
    "  ✓ límite de salida: aviso propio si una llamada se corta por él, y la regla de escribir por partes en el protocolo",
  );
}

/** Deep debug: one summary line per turn (origin, scores, metering, result) and the model's sandbox work. */
async function testTurnSummary() {
  const summary = new TurnSummary();
  summary.observe({
    throttling: {
      numUserMessagesInConversation: 1,
      maxNumUserMessagesInConversation: 600,
      metering: {
        ClaudeOpusQueryDaily: { remainingAllowance: 39 },
        ClaudeOpusQuery75: { remainingAllowance: 74 },
        Junk: "x",
      },
    },
  });
  summary.observe({
    messages: [
      { author: "user", contentOrigin: "officeweb" },
      {
        author: "bot",
        contentOrigin: "DeepLeo",
        offense: "None",
        scores: [
          { component: "dea_violation", score: 2.5e-7 },
          { component: "BotOffense", score: 1e-9 },
        ],
      },
    ],
  });
  summary.observe({
    messages: [
      {
        author: "bot",
        contentOrigin: "DeepLeo",
        scores: [{ component: "dea_violation", score: 2.5e-3 }],
      },
      { author: "bot", messageType: "Progress", contentOrigin: "ChainOfThoughtSummary" },
    ],
  });
  summary.observe({
    result: { value: "Success", serviceVersion: "1.0.03561.1" },
    turnState: "Completed",
  });
  summary.chars = 11_000;
  const line = summary.line();
  assert.match(
    line,
    /^origin=DeepLeo · /,
    "solo el origen del contenido, no el del mensaje de control",
  );
  assert.match(line, /dea_violation=2\.5e-3/, "el máximo del turno");
  assert.match(line, /BotOffense=1\.0e-9/);
  assert.match(line, /offense=None/);
  assert.match(line, /result=Success/);
  assert.match(line, /metering: ClaudeOpusQueryDaily=39, ClaudeOpusQuery75=74 ·/);
  assert.match(line, /messages=1\/600/);
  assert.match(line, /scenario=OfficeWebIncludedCopilot/);
  assert.match(line, /near the ~12k-char output limit/);
  assert.deepEqual(summary.toJSON().result, { value: "Success", serviceVersion: "1.0.03561.1" });
  assert.equal(summary.toJSON().turnState, "Completed");

  // In a real turn with the deep mode on: the line closes the turn's trace.
  initLogger({ appendLine: () => {} });
  clearLog();
  setDeepDebug(true);
  const server = await startProtocolServer((send) => {
    send(
      botFrame({
        messageType: "Progress",
        contentType: "Code",
        text: "Coding and executing",
        hiddenText: "bash -lc ls /mnt/data",
      }),
    );
    send({
      type: 1,
      target: "update",
      arguments: [
        {
          throttling: {
            numUserMessagesInConversation: 1,
            maxNumUserMessagesInConversation: 600,
            metering: { ClaudeOpusQueryDaily: { remainingAllowance: 12 } },
          },
        },
      ],
    });
    send(
      botFrame({
        text: "OK",
        contentOrigin: "DeepLeo",
        scores: [{ component: "dea_violation", score: 3e-6 }],
      }),
    );
    send({ type: 2, invocationId: "0", item: { result: { value: "Success" }, messages: [] } });
    send({ type: 3, invocationId: "0" });
  });
  const remote: string[] = [];
  try {
    await streamCopilotTurn({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: "Claude_Opus",
      signal: new AbortController().signal,
      callbacks: { onText: () => {}, onRemoteWork: (detail) => remote.push(detail) },
    });
  } finally {
    setDeepDebug(false);
    server.close();
  }
  assert.deepEqual(remote, ["bash -lc ls /mnt/data"]);
  const trace = renderLogText("test");
  assert.match(
    trace,
    /turn summary: origin=DeepLeo · dea_violation=3\.0e-6 · result=Success · metering: ClaudeOpusQueryDaily=12 · messages=1\/600 · scenario=OfficeWebPaidCopilot · chars=2 · remote sandbox: 1 step\(s\)/,
  );
  assert.match(trace, /the model is working in M365's own cloud sandbox: bash -lc ls \/mnt\/data/);
  clearLog();
  console.log(
    "  ✓ modo debug: resumen por turno (origen, dea_violation, metering, result, escenario) y trabajo en el sandbox remoto",
  );
}

// ---- i18n -------------------------------------------------------------------

function testI18nCatalogs() {
  // Every key has a non-empty text in every locale, with the same placeholders
  // as the English reference — a Spanish message that drops `{1}` would
  // silently print less information than its English twin.
  for (const key of messageKeys()) {
    const reference = placeholdersOf("en", key);
    for (const locale of LOCALES) {
      assert.ok(tIn(locale, key).trim(), `${locale}:${key} está vacío`);
      assert.deepEqual(
        placeholdersOf(locale, key),
        reference,
        `${locale}:${key} no usa los mismos marcadores {n}`,
      );
    }
  }

  assert.equal(resolveLocale("auto", "es"), "es");
  assert.equal(resolveLocale("auto", "es-419"), "es");
  assert.equal(resolveLocale("auto", "en-US"), "en");
  assert.equal(resolveLocale("auto", "de"), "en");
  assert.equal(resolveLocale("es", "en-US"), "es", "el ajuste explícito gana al idioma de VS Code");
  assert.equal(resolveLocale("en", "es-ES"), "en");
  assert.equal(resolveLocale(undefined, undefined), "en");

  // Placeholders are filled positionally; a missing argument stays visible.
  assert.equal(tIn("en", "edit.itemError", 3, "boom"), "Edit #3: boom");
  assert.equal(tIn("es", "edit.itemError", 3, "boom"), "Edición #3: boom");
  assert.equal(tIn("en", "edit.itemError", 3), "Edit #3: {1}");
  console.log("  ✓ catálogos en/es completos, con los mismos marcadores, y resolución del idioma");
}

/**
 * The BizChat layer's messages with the app's catalogs on top (core's i18n
 * engine): an app key, an app override of a layer key, a layer key the app
 * never mentions, a partial locale falling back to English, an unknown key.
 */
function testI18nLayers() {
  try {
    registerCatalogs({
      en: {
        "layers.appOnly": "app says {0}",
        "layers.englishOnly": "only in English",
        "client.error.401": "overridden by the app",
      },
      es: { "layers.appOnly": "la app dice {0}" },
      zh: {},
    });

    setCoreLocale("en");
    assert.equal(translate("layers.appOnly", ["hi"]), "app says hi");
    assert.equal(translate("client.error.401"), "overridden by the app", "the app wins");
    assert.notEqual(
      translate("client.error.idle"),
      "client.error.idle",
      "a layer key still resolves",
    );
    assert.equal(
      translate("nobody.defines.this"),
      "nobody.defines.this",
      "unknown: the key itself",
    );

    // The app overrode the layer's English only: Spanish keeps the layer's own Spanish text.
    setCoreLocale("es");
    assert.equal(translate("layers.appOnly", ["hola"]), "la app dice hola");
    assert.match(translate("client.error.401"), /rechaz/);
    assert.equal(translate("layers.englishOnly"), "only in English", "missing in es: English");

    // A partial locale (Chinese): what it has, then English, key by key.
    setCoreLocale("zh");
    assert.match(translate("client.error.idle"), /[一-鿿]/, "the layer's Chinese");
    assert.equal(
      translate("protocol.important"),
      translateIn("en", "protocol.important"),
      "the layer has no Chinese for the model prompts: English",
    );
    assert.equal(translate("layers.englishOnly"), "only in English");
  } finally {
    registerCatalogs({ en: appEn, es: appEs });
    setCoreLocale("es");
  }
  console.log("  ✓ i18n por capas: la app sobre la capa BizChat, con caída a inglés clave a clave");
}

/** Every `%key%` of package.json exists in both package.nls files, and they have the same keys. */
function testManifestLocalization() {
  const manifest = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const en = JSON.parse(
    readFileSync(new URL("../package.nls.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  const es = JSON.parse(
    readFileSync(new URL("../package.nls.es.json", import.meta.url), "utf8"),
  ) as Record<string, string>;
  const used = [...manifest.matchAll(/"%([^%"]+)%"/g)].map((match) => match[1]);
  assert.ok(used.length > 50, "(sanity) el manifiesto debería estar localizado");
  for (const key of used) {
    assert.ok(en[key], `package.nls.json no tiene ${key}`);
    assert.ok(es[key], `package.nls.es.json no tiene ${key}`);
  }
  assert.deepEqual(
    Object.keys(es).sort(),
    Object.keys(en).sort(),
    "package.nls.json y package.nls.es.json difieren",
  );
  for (const key of Object.keys(en))
    assert.ok(used.includes(key), `${key} no se usa en package.json`);
  console.log(`  ✓ package.json: ${used.length} cadenas %nls% presentes en inglés y español`);
}

function testPromptsFollowLocale() {
  // The catalog carries our tools' descriptions, so it is built per locale
  // too — exactly as the provider does on every request.
  const render = (locale: "en" | "es") => {
    setLocale(locale);
    return buildToolProtocolInstructions(buildToolCatalog([...M365_TOOLS, ...EDITOR_TOOLS]));
  };
  const english = render("en");
  const spanish = render("es");

  assert.match(english, /IMPORTANT: you DO have real access/);
  assert.match(english, /read_file \(native to VS Code\)/);
  assert.match(english, new RegExp(`${M365_TOOL_NAMES.readFile} \\(from this extension\\)`));
  assert.doesNotMatch(
    english,
    /herramienta|IMPORTANTE|de esta extensión/,
    "no debe quedar español en el prompt inglés",
  );
  assert.match(spanish, /IMPORTANTE: SÍ tienes acceso real/);
  assert.match(spanish, /read_file \(nativa de VS Code\)/);
  // The protocol markers themselves never change with the language.
  for (const prompt of [english, spanish]) {
    assert.match(prompt, /<m365_tool_call>/);
    assert.match(prompt, /@@block:1@@/);
  }
  console.log(
    "  ✓ el prompt de herramientas sale entero en el idioma activo; los marcadores no cambian",
  );
}

// ---- participantPrompts.ts -------------------------------------------------

function testParticipantPrompts() {
  assert.equal(asParticipantCommand("fix"), "fix");
  assert.equal(asParticipantCommand("commit"), undefined);
  assert.equal(asParticipantCommand(undefined), undefined);

  // /explain only reads; the rest may edit (with Keep/Undo), never delegate.
  assert.ok(!toolsForCommand("explain").includes(M365_TOOL_NAMES.applyWorkspaceEdits));
  assert.ok(toolsForCommand("fix").includes(M365_TOOL_NAMES.applyWorkspaceEdits));
  assert.ok(!toolsForCommand(undefined).includes(M365_TOOL_NAMES.spawnAgents));
  assert.ok(maxStepsForCommand("explain") < maxStepsForCommand("fix"));
  // The user's `maxToolCalls` sets the budget of everything but /explain and /terminal;
  // 0 lifts it (the loop's time ceiling still applies).
  assert.equal(maxStepsForCommand(undefined), DEFAULT_MAX_TOOL_CALLS);
  assert.equal(maxStepsForCommand(undefined, 12), 12);
  assert.equal(maxStepsForCommand("fix", 60), 60);
  assert.equal(maxStepsForCommand("tests", 0), Number.POSITIVE_INFINITY);
  assert.equal(maxStepsForCommand("explain", 60), 4);
  assert.equal(maxStepsForCommand("terminal", 0), 6);

  // A fence always outlasts any backtick run inside the code.
  assert.equal(fenceFor("const a = 1;"), "```");
  assert.equal(fenceFor('const md = "```ts";'), "````");

  const code = {
    relativePath: "src/a.ts",
    languageId: "typescript",
    startLine: 10,
    endLine: 12,
    text: 'function f() {\n  return "```";\n}',
    truncatedChars: 0,
    diagnostics: ["11:3 [error] (ts) Type mismatch"],
  };
  setLocale("en");
  const framing = buildParticipantFraming({
    command: "fix",
    request: "it crashes on empty input",
    code,
    history: [
      { role: "user", text: "/explain" },
      { role: "assistant", text: "It returns a fence." },
    ],
    attachedPaths: ["src/b.ts"],
  });
  assert.match(framing, /invoked from the chat as @m365/);
  assert.match(framing, /Find and fix the problems/);
  assert.match(framing, /Code context — src\/a\.ts, lines 10-12 \(typescript\):/);
  assert.match(framing, /````typescript\nfunction f\(\) \{/);
  assert.match(framing, /- 11:3 \[error\] \(ts\) Type mismatch/);
  assert.match(framing, /Assistant: It returns a fence\./);
  assert.match(framing, /Other files the user attached: src\/b\.ts/);
  assert.match(framing, /User request:\nit crashes on empty input$/);

  setLocale("es");
  const spanish = buildParticipantFraming({ command: undefined, request: "" });
  assert.match(spanish, /Responde a la petición del usuario/);
  assert.match(spanish, /Petición del usuario:\n\(sin instrucciones adicionales\)$/);
  console.log(
    "  ✓ prompts de @m365: herramientas por comando, contexto de código, historial y adjuntos",
  );
}

// ---- commit message generated with M365 (SCM) ------------------------------

function testCommitMessageGeneration() {
  setLocale("en");
  const prompt = buildCommitMessagePrompt({
    files: ["M\tsrc/a.ts", "A\tsrc/b.ts"],
    diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
    staged: true,
  });
  assert.match(prompt, /Conventional Commits/);
  assert.match(prompt, /feat, fix, docs/);
  assert.match(prompt, /Write the message in English, unless the recent commits/);
  assert.match(prompt, /BREAKING CHANGE: what breaks and how to migrate/);
  assert.match(prompt, /Never vague/);
  assert.match(prompt, /Changed files \(2\):\nM\tsrc\/a\.ts\nA\tsrc\/b\.ts/);
  assert.match(prompt, /\+const x = 1;/);
  assert.doesNotMatch(
    prompt,
    /Nothing is staged|Branch:|Latest commits|previous answer/,
    "sin datos no hay secciones vacías",
  );

  const unstaged = buildCommitMessagePrompt({ files: [], diff: "x".repeat(30_000), staged: false });
  assert.match(unstaged, /Nothing is staged/);
  assert.match(unstaged, /\[diff truncated: 6000 more characters\]/);

  // Repository conventions, branch and the retry after a rejected answer.
  const withContext = buildCommitMessagePrompt({
    files: ["M\tsrc/a.ts\t+1 -0"],
    diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
    staged: true,
    branch: "feature/ABC-7-login",
    recentSubjects: [
      "feat(vscode): add menu",
      "fix(vscode): align icons",
      "docs: typo",
      "feat(browser): add popup",
    ],
    rejected: { message: "Update stuff", problem: "not Conventional Commits" },
  });
  assert.match(
    withContext,
    /Branch: feature\/ABC-7-login\nLatest commits of this repository \(match their style, scopes and language\):\n- feat\(vscode\): add menu\n/,
  );
  assert.match(withContext, /Scopes already used here \(times\): vscode \(2\), browser \(1\)\n/);
  assert.match(
    withContext,
    /--- end of diff ---\n\nYour previous answer was:\nUpdate stuff\nIt cannot be used: not Conventional Commits\n/,
  );

  setLocale("es");
  assert.match(
    buildCommitMessagePrompt({ files: [], diff: "d", staged: true }),
    /Escribe el mensaje en español, salvo que/,
  );

  assert.equal(cleanGeneratedCommitMessage("feat(ui): add menu"), "feat(ui): add menu");
  assert.equal(
    cleanGeneratedCommitMessage("```\nfix: avoid crash\n\n- detail\n```"),
    "fix: avoid crash\n\n- detail",
  );
  assert.equal(
    cleanGeneratedCommitMessage("Commit message:\nchore: bump deps"),
    "chore: bump deps",
  );
  assert.equal(cleanGeneratedCommitMessage('"docs: update README"'), "docs: update README");
  assert.equal(cleanGeneratedCommitMessage("fix: a\r\n\r\n\r\n\r\n- b"), "fix: a\n\n- b");
  assert.equal(cleanGeneratedCommitMessage("   "), "");
  console.log(
    "  ✓ mensaje de commit con M365: prompt en el idioma activo, diff acotado y limpieza de la respuesta",
  );
}

function testCommitMessageNormalization() {
  setLocale("en");
  // Subject: type case and aliases, spaces, scope with spaces, trailing period.
  assert.equal(normalizeCommitMessage("Feat(UI) : Add menu."), "feat(UI): Add menu");
  assert.equal(normalizeCommitMessage("feature: add export"), "feat: add export");
  assert.equal(
    normalizeCommitMessage("bugfix(auth service)!:drop the old token"),
    "fix(auth-service)!: drop the old token",
  );
  assert.equal(normalizeCommitMessage("**docs: fix typo**"), "docs: fix typo");
  assert.equal(
    normalizeCommitMessage('Merge branch "dev"'),
    'Merge branch "dev"',
    "lo que no es un tipo no se toca",
  );
  assert.equal(normalizeCommitMessage("   "), "");

  // Body: blank line after the subject, bullets as "- ", reflow only when too long.
  assert.equal(normalizeCommitMessage("fix: a\n* one\n• two"), "fix: a\n\n- one\n- two");
  const long = normalizeCommitMessage(
    "fix(parser): handle empty input\n\n" +
      "- Return an empty tree instead of throwing when the file is empty, which is what\n" +
      "  happens every time a new file is created.\n" +
      "- Short point.",
  );
  assert.equal(
    long,
    "fix(parser): handle empty input\n\n" +
      "- Return an empty tree instead of throwing when the file is empty, which\n" +
      "  is what happens every time a new file is created.\n" +
      "- Short point.",
  );
  assert.ok(long.split("\n").every((line) => line.length <= 72));
  const fenced = `docs: show the command\n\n\`\`\`\n${"y".repeat(100)}\n\`\`\``;
  assert.equal(normalizeCommitMessage(fenced), fenced, "los bloques de código no se reflujan");

  // An assistant never signs the commit; a human co-author stays.
  assert.equal(
    normalizeCommitMessage("fix: a\n\n- b\n\nCo-authored-by: GitHub Copilot <copilot@github.com>"),
    "fix: a\n\n- b",
  );
  assert.equal(
    normalizeCommitMessage("fix: a\n\n- b\n\n🤖 Generated with M365 Copilot"),
    "fix: a\n\n- b",
  );
  assert.equal(
    normalizeCommitMessage("fix: a\n\n- b\n\nCo-authored-by: Ana <ana@example.com>"),
    "fix: a\n\n- b\n\nCo-authored-by: Ana <ana@example.com>",
  );

  // Ticket from the branch: a new trailer, or next to the existing ones; never twice.
  assert.equal(
    normalizeCommitMessage("fix: a\n\n- b", { ticket: "ABC-1" }),
    "fix: a\n\n- b\n\nRefs: ABC-1",
  );
  assert.equal(
    normalizeCommitMessage("feat!: x\n\nBREAKING CHANGE: y", { ticket: "#42" }),
    "feat!: x\n\nBREAKING CHANGE: y\nRefs: #42",
  );
  assert.equal(normalizeCommitMessage("fix: a (abc-1)", { ticket: "ABC-1" }), "fix: a (abc-1)");

  assert.equal(commitMessageProblem("fix(configuración): a"), undefined);
  assert.match(
    commitMessageProblem(normalizeCommitMessage("Update stuff")) ?? "",
    /Conventional Commits/,
  );
  assert.match(commitMessageProblem("") ?? "", /empty/);
  console.log(
    "  ✓ mensaje de commit: tipo, ámbito y punto corregidos, cuerpo a 72 columnas, sin firmas de IA, ticket como Refs",
  );
}

function testCommitContext() {
  setLocale("en");
  // Sections: the path of a rename, a deletion and a binary file; +/- counts
  // only after the header (an added "++x" line is an addition).
  const sections = splitDiff(
    "diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1,2 @@\n-a\n+b\n+++x\n" +
      "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y\n" +
      "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
  ).sections;
  assert.deepEqual(
    sections.map(({ path, added, removed }) => [path, added, removed]),
    [
      ["new.ts", 2, 1],
      ["gone.ts", 0, 2],
      ["logo.png", 0, 0],
    ],
  );
  assert.equal(
    diffStats("diff --git a/src/a.ts b/src/a.ts\n+const x = 1;").get("src/a.ts")?.added,
    1,
    "sin cabecera ---/+++ también cuenta",
  );

  for (const noisy of [
    "pnpm-lock.yaml",
    "packages/x/package-lock.json",
    "dist/app.js",
    "src/app.min.js",
    "go.sum",
  ]) {
    assert.ok(isNoisePath(noisy), noisy);
  }
  for (const real of ["src/distance.ts", "src/build.ts", "README.md", "lock.ts"])
    assert.ok(!isNoisePath(real), real);

  // Budget: the lock file shrinks to its counts even when everything fits…
  const lock = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n--- a/pnpm-lock.yaml\n+++ b/pnpm-lock.yaml\n@@ -1,3 +1,3 @@\n${"-old: 1\n".repeat(3)}${"+new: 2\n".repeat(3)}`;
  const small =
    "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b";
  assert.equal(
    budgetDiff(`${small}\n${lock}`, 24_000),
    `${small}\ndiff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n[lock or generated file: +3 -3 lines, content not shown]`,
  );
  // …and when it doesn't fit, a huge file no longer pushes the files after it out of the prompt.
  const huge = `diff --git a/src/huge.ts b/src/huge.ts\n--- a/src/huge.ts\n+++ b/src/huge.ts\n@@ -0,0 +1,3000 @@\n${'+const line = "some generated-looking but real code";\n'.repeat(3000)}`;
  const last =
    "diff --git a/src/last.ts b/src/last.ts\n--- a/src/last.ts\n+++ b/src/last.ts\n@@ -1 +1 @@\n-before\n+after";
  const budgeted = budgetDiff(`${small}\n${huge}\n${last}`, 24_000);
  assert.ok(budgeted.length <= 24_200, `cabe en el presupuesto (${budgeted.length})`);
  assert.ok(
    budgeted.includes(small) && budgeted.includes(last),
    "los archivos pequeños siguen enteros, también los del final",
  );
  assert.match(
    budgeted,
    /\+const line[^\n]*\n\[… \d+ more lines of this file not shown\]\ndiff --git a\/src\/last\.ts/,
  );

  // Repository conventions and the ticket of the branch.
  assert.deepEqual(historyContext([]), []);
  assert.deepEqual(
    historyContext([
      "feat(vscode): a",
      "fix(vscode)!: b",
      "docs: c",
      "feat(browser): d",
      "Merge branch x",
    ]),
    [
      "Latest commits of this repository (match their style, scopes and language):",
      "- feat(vscode): a",
      "- fix(vscode)!: b",
      "- docs: c",
      "- feat(browser): d",
      "- Merge branch x",
      "Scopes already used here (times): vscode (2), browser (1)",
    ],
  );
  assert.equal(ticketFromBranch("feature/ABC-123-login"), "ABC-123");
  assert.equal(ticketFromBranch("ABC-9"), "ABC-9");
  assert.equal(ticketFromBranch("fix/42-crash"), "#42");
  assert.equal(ticketFromBranch("fix/utf-8-names"), undefined, "claves en minúscula no cuentan");
  assert.equal(ticketFromBranch("main"), undefined);
  assert.equal(ticketFromBranch(undefined), undefined);
  console.log(
    "  ✓ contexto del commit: diff repartido entre archivos, lockfiles resumidos, ámbitos del historial y ticket de la rama",
  );
}

// ---- auto-commit -------------------------------------------------------------

function testAutoCommitPrompt() {
  const entries: StatusEntry[] = [
    { index: " ", worktree: "M", path: "src/a.ts" },
    { index: "?", worktree: "?", path: "src/new.ts" },
    { index: "R", worktree: " ", path: "docs/guide.md", origPath: "docs/old.md" },
    { index: " ", worktree: "D", path: "old.txt" },
  ];
  setLocale("en");
  const prompt = buildAutoCommitPrompt({
    entries,
    diff: "diff --git a/src/a.ts b/src/a.ts\n+const x = 1;",
    untracked: [
      { path: "src/new.ts", size: 12, content: "export {};\r\n", truncated: false },
      { path: "logo.png", size: 2048, truncated: false },
    ],
    branch: "main",
    lastCommit: { minutesAgo: 12, subject: "feat: add menu" },
    pendingMinutes: 25,
    lastWaitReason: "the parser is half written",
    recentSubjects: ["feat: add menu", "fix(ui): align icons"],
  });
  assert.match(prompt, /auto-commit assistant/);
  assert.match(prompt, /at most 3\)/);
  assert.match(prompt, /feat, fix, docs/);
  assert.match(
    prompt,
    /Write the "reason" in English\. Write the subject and the body in English too, unless the recent commits/,
  );
  assert.match(prompt, /- breaking: add it ONLY if the commit breaks compatibility/);
  assert.match(
    prompt,
    /- Branch: main\n- Last commit: 12 min ago — "feat: add menu"\n- These changes have been piling up for about 25 min\./,
  );
  assert.match(prompt, /Last time you decided to wait because: the parser is half written/);
  assert.match(
    prompt,
    /Latest commits of this repository[^\n]*\n- feat: add menu\n- fix\(ui\): align icons\nScopes already used here \(times\): ui \(1\)\n/,
  );
  assert.match(
    prompt,
    /Changed files \(4\):\n- src\/a\.ts \(modified, \+1 -0\)\n- src\/new\.ts \(new file, \+1 -0\)\n- docs\/guide\.md \(renamed from docs\/old\.md\)\n- old\.txt \(deleted\)/,
    "cada archivo con sus líneas añadidas y quitadas",
  );
  assert.match(prompt, /\+const x = 1;/);
  assert.match(
    prompt,
    /\+\+\+ b\/src\/new\.ts\n\+export \{\};\n/,
    "un archivo nuevo se ve como su diff, sin \\r",
  );
  assert.match(prompt, /\[binary file, 2048 bytes\]/);

  const big = buildAutoCommitPrompt({
    entries,
    diff: "x".repeat(30_000),
    untracked: [],
    branch: "main",
    recentSubjects: [],
  });
  assert.match(big, /\[diff truncated: 6000 more characters\]/);
  assert.doesNotMatch(big, /Latest commits|Last commit:/, "sin historial no hay secciones vacías");

  setLocale("es");
  assert.match(
    buildAutoCommitPrompt({ entries, diff: "", untracked: [], branch: "dev", recentSubjects: [] }),
    /Escribe el "reason" en español\.[\s\S]*- Rama: dev/,
  );
  assert.equal(describeEntry(entries[1]), "- src/new.ts (archivo nuevo)");

  // ---- decisions
  setLocale("en");
  // A raw line break inside a JSON string (invalid JSON, but models do it).
  const wait = parseAutoCommitDecision(
    '{"decision":"wait","reason":"the new\n function   has no callers yet"}',
    entries,
  );
  assert.deepEqual(wait, { kind: "wait", reason: "the new function has no callers yet" });

  const fenced = parseAutoCommitDecision(
    'Here you go:\n```json\n{"decision":"commit","commits":[{"files":["src/a.ts","./src/new.ts"],"subject":"feat(core): add the x constant.","body":["- Adds x so the parser can use a shared default value instead of repeating the literal in every caller of the module.","Exports an empty new module."]}]}\n```',
    entries,
  );
  assert.equal(fenced.kind, "commit");
  if (fenced.kind === "commit") {
    assert.deepEqual(fenced.commits[0].files, ["src/a.ts", "src/new.ts"]);
    assert.equal(
      fenced.commits[0].message,
      "feat(core): add the x constant\n\n" +
        "- Adds x so the parser can use a shared default value instead of\n" +
        "  repeating the literal in every caller of the module.\n" +
        "- Exports an empty new module.",
      "punto final del subject quitado y cuerpo en viñetas de 72 columnas",
    );
  }

  // Paths: backslashes, the copied "(modified)" note, the old side of a rename,
  // case; unknown files dropped; a file only in its first commit.
  const groups = parseAutoCommitDecision(
    JSON.stringify({
      decision: "commit",
      commits: [
        { files: ["SRC\\A.ts (modified)", "nope.ts"], subject: "fix: a" },
        {
          files: ["src/a.ts", "docs/old.md"],
          message: "docs: move the guide\n\n- Renamed for clarity.",
        },
        { files: ["old.txt"], subject: "not conventional" },
        { files: ["nope.ts"], subject: "chore: nothing real" },
      ],
    }),
    entries,
  );
  assert.equal(groups.kind, "commit");
  if (groups.kind === "commit") {
    assert.deepEqual(
      groups.commits.map((group) => [group.files, group.message]),
      [
        [["src/a.ts"], "fix: a"],
        [["docs/guide.md"], "docs: move the guide\n\n- Renamed for clarity."],
      ],
    );
  }

  const many = parseAutoCommitDecision(
    JSON.stringify({
      decision: "commit",
      commits: entries.map((entry, i) => ({ files: [entry.path], subject: `chore: change ${i}` })),
    }),
    entries,
  );
  assert.equal(
    many.kind === "commit" && many.commits.length,
    MAX_COMMITS_PER_ROUND,
    "nunca más de 3 commits por ronda",
  );

  // A breaking change: "!" in the subject and the trailer; the alias type fixed;
  // the branch's ticket next to the other trailers. "none" is not breaking.
  const breaking = parseAutoCommitDecision(
    JSON.stringify({
      decision: "commit",
      commits: [
        {
          files: ["src/a.ts"],
          subject: "Feature(api): rename the token setting",
          body: ["Settings now live under m365copilot.token."],
          breaking: "The old setting is ignored; move its value.",
        },
        { files: ["old.txt"], subject: "chore: drop old.txt", breaking: "none" },
      ],
    }),
    entries,
    { ticket: "ABC-7" },
  );
  assert.deepEqual(breaking.kind === "commit" && breaking.commits.map((group) => group.message), [
    "feat(api)!: rename the token setting\n\n" +
      "- Settings now live under m365copilot.token.\n\n" +
      "BREAKING CHANGE: The old setting is ignored; move its value.\nRefs: ABC-7",
    "chore: drop old.txt\n\nRefs: ABC-7",
  ]);

  assert.equal(parseAutoCommitDecision("I think you should commit.", entries).kind, "invalid");
  assert.equal(parseAutoCommitDecision('{"decision":"maybe"}', entries).kind, "invalid");
  const badMessage = parseAutoCommitDecision(
    '{"decision":"commit","commits":[{"files":["src/a.ts"],"subject":"Update stuff"}]}',
    entries,
  );
  assert.equal(badMessage.kind, "invalid", "sin mensaje válido no hay commit");
  assert.match(badMessage.kind === "invalid" ? badMessage.reason : "", /Conventional Commits/);
  assert.deepEqual(
    parseAutoCommitDecision(
      '{"decision":"commit","files":["old.txt"],"subject":"chore: drop old.txt",}',
      entries,
    ),
    { kind: "commit", commits: [{ files: ["old.txt"], message: "chore: drop old.txt" }] },
    'un único commit sin lista "commits", con coma colgante',
  );

  // ---- git status parsing and timing
  assert.deepEqual(
    parseStatus(
      " M a.txt\0R  new.txt\0old.txt\0?? nested/\0AD gone.txt\0?? dir with space ñ.txt\0UU c.txt\0",
    ),
    [
      { index: " ", worktree: "M", path: "a.txt" },
      { index: "R", worktree: " ", path: "new.txt", origPath: "old.txt" },
      { index: "?", worktree: "?", path: "dir with space ñ.txt" },
      { index: "U", worktree: "U", path: "c.txt" },
    ],
  );
  assert.ok(hasConflicts(parseStatus("UU c.txt\0")));
  assert.ok(!hasConflicts(entries));
  assert.deepEqual(
    pathsToCommit(
      [...entries, { index: "D", worktree: " ", path: "staged-gone.txt" }],
      ["docs/old.md", "staged-gone.txt", "old.txt"],
    ),
    {
      add: ["docs/guide.md", "old.txt"],
      commit: ["docs/guide.md", "docs/old.md", "old.txt", "staged-gone.txt"],
    },
  );
  assert.equal(cooldownRemaining(10_000, 4_000, 5_000), 0);
  assert.equal(cooldownRemaining(10_000, 8_000, 5_000), 3_000);
  assert.equal(cooldownRemaining(10_000, undefined, 5_000), 0);
  assert.equal(cooldownRemaining(10_000, 9_999, 0), 0);
  console.log(
    "  ✓ autocommit: prompt, decisiones del modelo (rutas, mensajes, límite de commits) y git status",
  );
}

function gitIn(root: string): GitRunner {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile("git", args, { cwd: root, windowsHide: true }, (error, stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
      );
    });
}

/** What the Source Control button describes, against a real repository. */
async function testScmChanges() {
  setLocale("en");
  const root = mkdtempSync(join(tmpdir(), "m365-scm-"));
  const git = gitIn(root);
  try {
    await git(["init", "-q", "-b", "main"]);
    for (const [key, value] of [
      ["user.name", "Test"],
      ["user.email", "t@example.com"],
      ["core.autocrlf", "false"],
      ["commit.gpgsign", "false"],
    ]) {
      await git(["config", key, value]);
    }
    writeFileSync(join(root, "a.txt"), "a\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: init"]);
    assert.equal(
      await readChangesToDescribe(git, root),
      undefined,
      "sin cambios no hay nada que describir",
    );

    // Nothing staged: the working tree, and a new file inside a new folder
    // with its content (git status alone would only say "?? src/").
    writeFileSync(join(root, "a.txt"), "a\nb\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "new.ts"), "export const n = 1;\n");
    const tree = await readChangesToDescribe(git, root);
    assert.equal(tree?.staged, false);
    assert.deepEqual(tree?.files, ["- a.txt (modified, +1 -0)", "- src/new.ts (new file, +1 -0)"]);
    assert.match(tree?.diff ?? "", /\+b\n[\s\S]*\+\+\+ b\/src\/new\.ts\n\+export const n = 1;/);

    // Something staged: only that.
    await git(["add", "a.txt"]);
    const staged = await readChangesToDescribe(git, root);
    assert.equal(staged?.staged, true);
    assert.deepEqual(staged?.files, ["M\ta.txt\t+1 -0"]);
    assert.doesNotMatch(staged?.diff ?? "", /new\.ts/);
    console.log(
      "  ✓ botón de Source Control contra git real: stage o árbol de trabajo, archivos nuevos con contenido y líneas por archivo",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** commitFiles / undoCommits against a real repository. */
async function testAutoCommitGit() {
  const root = mkdtempSync(join(tmpdir(), "m365-autocommit-"));
  const git = gitIn(root);
  const write = (file: string, text: string) => writeFileSync(join(root, file), text);
  try {
    await git(["init", "-q", "-b", "main"]);
    for (const [key, value] of [
      ["user.name", "Test"],
      ["user.email", "t@example.com"],
      ["core.autocrlf", "false"],
      ["commit.gpgsign", "false"],
    ]) {
      await git(["config", key, value]);
    }
    assert.equal((await readRepoState(git)).head, undefined, "repo sin commits: no hay HEAD");
    assert.deepEqual(await recentSubjects(git), [], "repo sin commits: sin historial");

    for (const file of ["a.txt", "b.txt", "c.txt", "d.txt", "[x].txt"]) write(file, `${file}\n`);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: init"]);
    const initial = await readRepoState(git);
    assert.equal(initial.branch, "main");
    assert.equal(initial.headSubject, "chore: init");
    assert.ok(
      initial.head && initial.headTime && Math.abs(initial.headTime - Date.now()) < 120_000,
    );
    assert.equal(initial.inProgress, undefined);
    assert.equal((await readChanges(git, root, initial.head!)).entries.length, 0);

    // Modified, deleted, new (in a folder, with spaces and ñ), a staged rename,
    // a glob-like name, and c.txt staged by the user for their own commit.
    write("a.txt", "a2\n");
    unlinkSync(join(root, "b.txt"));
    mkdirSync(join(root, "src"));
    write("src/new file ñ.ts", "export const n = 1;\n");
    write("c.txt", "c2\n");
    await git(["add", "c.txt"]);
    await git(["mv", "d.txt", "e.txt"]);
    write("[x].txt", "x2\n");
    write("x.txt", "not part of it\n");

    const snapshot = await readChanges(git, root, initial.head!);
    assert.deepEqual(
      snapshot.entries
        .map(
          (entry) =>
            `${entry.index}${entry.worktree} ${entry.path}${entry.origPath ? ` <- ${entry.origPath}` : ""}`,
        )
        .sort(),
      [
        " D b.txt",
        " M [x].txt",
        " M a.txt",
        "M  c.txt",
        "R  e.txt <- d.txt",
        "?? src/new file ñ.ts",
        "?? x.txt",
      ].sort(),
    );
    assert.match(snapshot.diff, /\+a2/);
    assert.equal(
      snapshot.untracked.find((file) => file.path === "src/new file ñ.ts")?.content,
      "export const n = 1;\n",
    );
    assert.equal(
      (await readChanges(git, root, initial.head!)).fingerprint,
      snapshot.fingerprint,
      "misma huella si nada cambia",
    );
    write("a.txt", "a3\n");
    const moved = await readChanges(git, root, initial.head!);
    assert.notEqual(moved.fingerprint, snapshot.fingerprint, "la huella cambia con el contenido");

    // First commit: a, b (deleted), the new file and the rename — with a
    // multi-line message, which must survive the argv on every platform.
    const message =
      "refactor(core): reorganise files\n\n- Rename d to e.\n- Drop b, it was unused.";
    const first = await commitFiles(
      git,
      moved.entries,
      ["a.txt", "b.txt", "src/new file ñ.ts", "d.txt"],
      message,
    );
    assert.deepEqual([...first.paths].sort(), [
      "a.txt",
      "b.txt",
      "d.txt",
      "e.txt",
      "src/new file ñ.ts",
    ]);
    assert.equal((await git(["log", "-1", "--format=%B"])).trim(), message);
    assert.deepEqual(
      (
        await git([
          "-c",
          "core.quotePath=false",
          "show",
          "-M",
          "--name-status",
          "--format=",
          "HEAD",
        ])
      )
        .trim()
        .split("\n")
        .sort(),
      ["A\tsrc/new file ñ.ts", "D\tb.txt", "M\ta.txt", "R100\td.txt\te.txt"],
    );
    const afterFirst = parseStatus(
      await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    );
    assert.deepEqual(
      afterFirst.map((entry) => `${entry.index}${entry.worktree} ${entry.path}`).sort(),
      [" M [x].txt", "M  c.txt", "?? x.txt"].sort(),
      "lo que el usuario tenía en stage (c.txt) sigue en stage, y lo demás sin tocar",
    );

    // Second commit: the glob-like name must be taken literally ([x] ≠ x).
    const second = await commitFiles(git, afterFirst, ["[x].txt"], "fix: update [x]");
    assert.equal((await git(["show", "--name-only", "--format=", "HEAD"])).trim(), "[x].txt");
    assert.deepEqual(
      await recentSubjects(git),
      ["fix: update [x]", "refactor(core): reorganise files", "chore: init"],
      "historial del más nuevo al más viejo, sólo el subject",
    );

    // Undo both: the changes come back, unstaged; new files untracked again.
    await undoCommits(git, {
      before: initial.head!,
      after: second.sha,
      subjects: [],
      paths: [...first.paths, ...second.paths],
    });
    assert.equal((await git(["rev-parse", "HEAD"])).trim(), initial.head);
    const restored = parseStatus(
      await git([
        "-c",
        "core.quotePath=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    );
    assert.deepEqual(
      restored.map((entry) => `${entry.index}${entry.worktree} ${entry.path}`).sort(),
      [
        " D b.txt",
        " D d.txt",
        " M [x].txt",
        " M a.txt",
        "M  c.txt",
        "?? e.txt",
        "?? src/new file ñ.ts",
        "?? x.txt",
      ].sort(),
    );

    // Undo refuses once someone committed on top.
    const again = await commitFiles(git, restored, ["a.txt"], "fix: a");
    await git(["commit", "-q", "-m", "chore: by hand"]);
    await assert.rejects(
      undoCommits(git, {
        before: initial.head!,
        after: again.sha,
        subjects: [],
        paths: again.paths,
      }),
      HeadMovedError,
    );

    // A failing pre-commit hook: no commit, and nothing left staged by us.
    const hooks = join(root, ".git", "hooks");
    writeFileSync(join(hooks, "pre-commit"), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', {
      mode: 0o755,
    });
    const head = (await git(["rev-parse", "HEAD"])).trim();
    const beforeHook = parseStatus(
      await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    );
    await assert.rejects(commitFiles(git, beforeHook, ["x.txt"], "chore: add x"), /lint failed/);
    assert.equal((await git(["rev-parse", "HEAD"])).trim(), head);
    assert.ok(
      parseStatus(await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])).some(
        (entry) => entry.path === "x.txt" && entry.index === "?",
      ),
      "x.txt vuelve a estar sin seguimiento",
    );
    unlinkSync(join(hooks, "pre-commit"));

    // An operation in progress is detected.
    writeFileSync(join(root, ".git", "MERGE_HEAD"), `${head}\n`);
    assert.equal((await readRepoState(git)).inProgress, "merge");
    unlinkSync(join(root, ".git", "MERGE_HEAD"));
    await git(["checkout", "-q", "--detach"]);
    assert.equal((await readRepoState(git)).branch, undefined, "HEAD desacoplado");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  console.log(
    "  ✓ autocommit contra git real: commit por grupo, renombrados, stage del usuario, hooks, deshacer",
  );
}

// ---- runToolLoop (shared by sub-agents and @m365) ---------------------------

async function testToolLoopStreamsProse() {
  const invocations: Record<string, unknown>[] = [];
  const sessionKeys: (string | string[] | undefined)[] = [];
  const server = await startScriptedServer(
    (index) =>
      index === 0
        ? `Voy a buscar.\n<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`
        : "Está en a.ts.",
    (frame) => invocations.push(frame.arguments[0] as unknown as Record<string, unknown>),
    (sessionKey) => sessionKeys.push(sessionKey),
  );
  const prose: string[] = [];
  const starts: number[] = [];
  const toolNames: string[] = [];
  const result = await runToolLoop({
    framing: "Busca foo.",
    profile: makeProfile(server.port),
    tone: null,
    maxSteps: 3,
    signal: new AbortController().signal,
    offeredTools: [{ name: M365_TOOL_NAMES.searchText }],
    endpointBase: mockBase(server.port),
    executeTool: async () => "a.ts:1: foo",
    onProse: (delta) => prose.push(delta),
    onStepStart: (step) => starts.push(step),
    onStep: (info) => {
      if (info.toolName) toolNames.push(info.toolName);
    },
  });
  server.close();

  assert.equal(result.outcome, "done");
  assert.equal(result.ok, true);
  assert.equal(result.summary, "Está en a.ts.");
  assert.deepEqual(starts, [1, 2]);
  assert.deepEqual(toolNames, [M365_TOOL_NAMES.searchText]);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[0]!.conversationId);
  assert.equal(invocations[0]!.conversationId, invocations[1]!.conversationId);
  assert.equal(invocations[0]!.isStartOfSession, true);
  assert.equal(invocations[1]!.isStartOfSession, false);
  assert.equal(sessionKeys.length, 2);
  assert.equal(typeof sessionKeys[0], "string");
  assert.ok(sessionKeys[0]);
  assert.equal(sessionKeys[0], sessionKeys[1]);
  const firstPrompt = String((invocations[0]!.message as Record<string, unknown>).text);
  const nextPrompt = String((invocations[1]!.message as Record<string, unknown>).text);
  assert.match(firstPrompt, /Busca foo\./);
  assert.match(nextPrompt, /a\.ts:1: foo/);
  assert.ok(!nextPrompt.includes("Busca foo."));
  assert.ok(nextPrompt.length < firstPrompt.length);
  // The preamble of the tool-call step streams too; the marker never does.
  assert.equal(prose.join(""), "Voy a buscar.\nEstá en a.ts.");
  console.log(
    "  ✓ runToolLoop retransmite la prosa en vivo (nunca el marcador) e informa de cada paso",
  );
}

/** BizChat's `message.locale` follows the extension language. */
async function testInvocationLocale() {
  const seen: unknown[] = [];
  const server = await startScriptedServer(
    () => "ok",
    (frame) => seen.push(frame.arguments[0].message.locale),
  );
  for (const locale of ["en", "es"] as const) {
    setLocale(locale);
    await streamCopilotTurn({
      profile: makeProfile(server.port),
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    });
  }
  server.close();
  assert.deepEqual(seen, ["en-US", "es-ES"]);
  console.log("  ✓ la invocación a BizChat envía locale en-US / es-ES según el idioma");
}

// ---- lineDiff.ts (per-hunk review) ------------------------------------------

/** Apply a line/character edit to a text, like VS Code would. */
function applyLineEdit(text: string, edit: LineEdit): string {
  const offsetOf = (line: number, character: number) => {
    let offset = 0;
    const pattern = /\r\n|\r|\n/g;
    for (let current = 0; current < line; current += 1) {
      const match = pattern.exec(text);
      if (!match) throw new Error(`line ${line} out of range`);
      offset = match.index + match[0].length;
    }
    return offset + character;
  };
  const start = offsetOf(edit.startLine, edit.startCharacter);
  const end = offsetOf(edit.endLine, edit.endCharacter);
  return text.slice(0, start) + edit.text + text.slice(end);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[b.length];
}

/** Small deterministic PRNG so failures are reproducible. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomEdit(random: () => number, lines: string[]): string[] {
  const out = [...lines];
  const operations = 1 + Math.floor(random() * 4);
  for (let i = 0; i < operations; i += 1) {
    const at = Math.floor(random() * (out.length + 1));
    const roll = random();
    if (roll < 0.33 && out.length > 0)
      out.splice(Math.min(at, out.length - 1), 1 + Math.floor(random() * 2));
    else if (roll < 0.66) out.splice(at, 0, `new ${Math.floor(random() * 5)}`);
    else if (out.length > 0)
      out[Math.min(at, out.length - 1)] = `changed ${Math.floor(random() * 5)}`;
  }
  return out;
}

function testLineDiff() {
  // Two far-apart changes are two hunks, not one region painting everything between.
  const before = ["a", "b", "c", "d", "e", "f", "g"].join("\n");
  const after = ["a", "B", "c", "d", "e", "f", "g", "h"].join("\n");
  assert.deepEqual(diffLines(before, after), [
    { oldStart: 1, oldLength: 1, newStart: 1, newLength: 1 },
    { oldStart: 7, oldLength: 0, newStart: 7, newLength: 1 },
  ]);
  assert.deepEqual(diffLines(before, before), []);
  // An EOL-only difference is not a change.
  assert.deepEqual(diffLines("a\nb\n", "a\r\nb\r\n"), []);

  // CRLF files: reverting restores CRLF line breaks, not LF.
  const crlfBase = "one\r\ntwo\r\nthree\r\n";
  const crlfNow = "one\r\nthree\r\n";
  const [removed] = diffLines(crlfBase, crlfNow);
  assert.equal(applyLineEdit(crlfNow, revertHunkEdit(crlfNow, crlfBase, removed)), crlfBase);

  const random = prng(365);
  for (let round = 0; round < 400; round += 1) {
    const size = Math.floor(random() * 12);
    const base = Array.from({ length: size }, () => `line ${Math.floor(random() * 6)}`);
    const edited = randomEdit(random, base);
    const trailing = random() < 0.5 ? "\n" : "";
    const baseText = base.join("\n") + (base.length > 0 ? trailing : "");
    const editedText = edited.join("\n") + (edited.length > 0 ? trailing : "");
    const hunks = diffLines(baseText, editedText);
    const label = `round ${round}: ${JSON.stringify(baseText)} → ${JSON.stringify(editedText)}`;

    // Sorted and non-overlapping on both sides.
    for (let i = 1; i < hunks.length; i += 1) {
      assert.ok(hunks[i].oldStart >= hunks[i - 1].oldStart + hunks[i - 1].oldLength, label);
      assert.ok(hunks[i].newStart > hunks[i - 1].newStart + hunks[i - 1].newLength - 1, label);
    }
    // Minimal: as many changed lines as an LCS says there must be.
    const oldLines = splitLines(baseText);
    const newLines = splitLines(editedText);
    const changed = hunks.reduce((total, hunk) => total + hunk.oldLength + hunk.newLength, 0);
    assert.equal(
      changed,
      oldLines.length + newLines.length - 2 * lcsLength(oldLines, newLines),
      label,
    );

    // Undo every hunk, last first (earlier coordinates stay valid) → the baseline.
    let reverted = editedText;
    for (const hunk of [...hunks].reverse())
      reverted = applyLineEdit(reverted, revertHunkEdit(reverted, baseText, hunk));
    assert.equal(reverted, baseText, `${label} (undo all)`);

    // Undo ONE hunk, re-diff: the other hunks are still a valid edit script,
    // so the minimal one costs at most that. (Not "exactly hunks - 1": a diff
    // is not unique, and re-aligning may merge or split the remaining hunks.)
    if (hunks.length > 1) {
      const pick = hunks[Math.floor(random() * hunks.length)];
      const partly = applyLineEdit(editedText, revertHunkEdit(editedText, baseText, pick));
      const left = diffLines(baseText, partly).reduce(
        (total, hunk) => total + hunk.oldLength + hunk.newLength,
        0,
      );
      assert.ok(left <= changed - pick.oldLength - pick.newLength, `${label} (undo one)`);
      assert.ok(left > 0, `${label} (undo one left something)`);
    }

    // Keep hunks one at a time, re-diffing like the review does → no change left.
    let baseline = baseText;
    for (let guard = 0; guard < 50; guard += 1) {
      const remaining: Hunk[] = diffLines(baseline, editedText);
      if (remaining.length === 0) break;
      baseline = acceptHunk(
        baseline,
        editedText,
        remaining[Math.floor(random() * remaining.length)],
      );
    }
    assert.deepEqual(diffLines(baseline, editedText), [], `${label} (keep all)`);
  }

  // A huge rewrite falls back to one hunk instead of an expensive diff.
  const big = Array.from({ length: 4_000 }, (_, i) => `a${i}`).join("\n");
  const rewritten = Array.from({ length: 4_000 }, (_, i) => `b${i}`).join("\n");
  assert.deepEqual(diffLines(big, rewritten), [
    { oldStart: 0, oldLength: 4_000, newStart: 0, newLength: 4_000 },
  ]);
  console.log(
    "  ✓ diff por bloques: mínimo, deshacer/aceptar por bloque converge, CRLF y caída a bloque único",
  );
}

// ---- inline edit / terminal / clipboard ------------------------------------

function testInlineEdit() {
  setLocale("en");
  const prompt = buildInlineEditPrompt({
    instruction: "  add a null check  ",
    relativePath: "src/a.ts",
    languageId: "typescript",
    startLine: 3,
    endLine: 5,
    code: "  function f(x) {\n    return x.y;\n  }",
    before: "class A {",
    after: "}",
    diagnostics: ["4:12 [error] (ts) Object is possibly null"],
  });
  assert.match(prompt, /You are a code editor inside VS Code/);
  assert.match(prompt, /File: src\/a\.ts \(typescript\)/);
  assert.match(prompt, /Instruction:\nadd a null check\n/);
  assert.match(prompt, /- 4:12 \[error\] \(ts\) Object is possibly null/);
  assert.match(prompt, /Context BEFORE[^\n]*\n```typescript\nclass A \{\n```/);
  assert.match(prompt, /CODE TO EDIT \(lines 3-5\):\n```typescript\n  function f\(x\) \{/);
  assert.match(prompt, /Context AFTER[^\n]*\n```typescript\n\}\n```/);
  setLocale("es");
  assert.match(
    buildInlineEditPrompt({
      instruction: "x",
      relativePath: "a",
      languageId: "js",
      startLine: 1,
      endLine: 1,
      code: "a",
      before: "",
      after: "",
    }),
    /CÓDIGO A EDITAR \(líneas 1-1\)/,
  );

  const original = "  function f(x) {\n    return x.y;\n  }";
  // The usual shape: one fenced block, maybe with prose around it.
  assert.equal(
    extractEditedCode(
      "Here it is:\n```ts\n  function f(x) {\n    return x?.y;\n  }\n```\nDone.",
      original,
    ),
    "  function f(x) {\n    return x?.y;\n  }",
  );
  // Flush-left answer for an indented block: re-indented by the block's base indent.
  assert.equal(
    extractEditedCode("```ts\nfunction f(x) {\n  return x?.y;\n}\n```", original),
    "  function f(x) {\n    return x?.y;\n  }",
  );
  // No fence at all, with a chatty first line.
  assert.equal(
    extractEditedCode("Updated code:\n  const a = 1;", "  const a = 0;"),
    "  const a = 1;",
  );
  // Cut-off answer (no closing fence) still yields the code.
  assert.equal(
    extractEditedCode("```js\nconst a = 2;\nconst b = 3;", "const a = 1;"),
    "const a = 2;\nconst b = 3;",
  );
  // CRLF answers are normalised; empty answers are rejected.
  assert.equal(extractEditedCode("```\r\nx();\r\n```", "y();"), "x();");
  assert.equal(extractEditedCode("```\n\n```", "y();"), null);
  assert.equal(extractEditedCode("   ", "y();"), null);
  // reindent leaves already-indented answers and flush-left originals alone.
  assert.equal(reindent("    a();", "  b();"), "    a();");
  assert.equal(reindent("a();\n\nb();", "c();"), "a();\n\nb();");
  assert.equal(reindent("a();\n\nb();", "\tc();"), "\ta();\n\n\tb();");
  console.log(
    "  ✓ edición en línea: prompt con contexto/diagnósticos y extracción robusta de la respuesta",
  );
}

function testTerminalPrompt() {
  setLocale("en");
  const framing = buildParticipantFraming({
    command: "terminal",
    request: "",
    terminal: {
      terminalName: "bash",
      commandLine: "npm test",
      cwd: "/repo",
      exitCode: 1,
      running: false,
      output: "FAIL src/a.test.ts\n  expected 1, got 2",
      truncatedChars: 120,
    },
  });
  assert.match(framing, /Explain why the terminal command below failed/);
  assert.match(
    framing,
    /Last command in the terminal “bash”:\n\$ npm test\nExit code: 1 · cwd: \/repo/,
  );
  assert.match(
    framing,
    /\[start of the output omitted: 120 characters\]\n```text\nFAIL src\/a\.test\.ts/,
  );
  assert.equal(maxStepsForCommand("terminal"), 6);
  assert.equal(asParticipantCommand("terminal"), "terminal");

  const running = buildParticipantFraming({
    command: "terminal",
    request: "why so slow?",
    terminal: {
      terminalName: "pwsh",
      commandLine: "build",
      cwd: undefined,
      exitCode: undefined,
      running: true,
      output: "",
      truncatedChars: 0,
    },
  });
  assert.match(running, /\$ build\nStill running\n\(no output\)/);
  setLocale("es");
  console.log("  ✓ prompt de @m365 /terminal: comando, código de salida, cwd y salida recortada");
}

function testClipboardDetection() {
  assert.equal(looksLikeProfile(fakeJwt()), true);
  assert.equal(looksLikeProfile(`  ${fakeJwt()}\n`), true);
  assert.equal(
    looksLikeProfile(JSON.stringify({ accessToken: fakeJwt(), endpoint: "wss://x" }, null, 2)),
    true,
  );
  assert.equal(looksLikeProfile(`Bearer ${fakeJwt()}`), true);
  assert.equal(
    looksLikeProfile(
      `wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=${fakeJwt()}`,
    ),
    true,
  );
  assert.equal(looksLikeProfile("https://m365.cloud.microsoft/chat/?auth=2"), false);
  assert.equal(looksLikeProfile("just some copied text"), false);
  assert.equal(looksLikeProfile('{"accessToken": 42}'), false);
  assert.equal(looksLikeProfile(""), false);
  console.log("  ✓ detecta un token o perfil en el portapapeles (y nada más)");
}

// ---- legacy.ts (coming from ms365-copilot-vscode) --------------------------

function testLegacyNames() {
  assert.equal(LEGACY_EXTENSION_ID, "ms365-copilot-vscode.ms365-copilot-vscode");
  assert.equal(legacySettingKey("m365copilot.editor.model"), "ms365copilot.editor.model");
  assert.equal(legacySettingKey("m365copilot.language"), "ms365copilot.language");
  assert.equal(legacySettingKey("editor.fontSize"), undefined, "sólo claves de esta extensión");

  // The model settings stored ids, renamed too; everything else is kept.
  assert.equal(migrateLegacyValue("ms365-copilot-gpt56"), "m365-copilot-gpt56");
  assert.equal(
    migrateLegacyValue("ms365-copilot-tone-gpt-5-7-chat"),
    "m365-copilot-tone-gpt-5-7-chat",
  );
  assert.equal(migrateLegacyValue("es"), "es");
  assert.equal(migrateLegacyValue(48), 48);
  assert.equal(migrateLegacyValue(false), false);
  assert.deepEqual(migrateLegacyValue(["scminput", "plaintext"]), ["scminput", "plaintext"]);
  assert.deepEqual(migrateLegacyValue([{ tone: "Gpt_5_7_Chat", name: "GPT 5.7" }]), [
    { tone: "Gpt_5_7_Chat", name: "GPT 5.7" },
  ]);

  // Only where the user set the old key and not yet the new one.
  assert.equal(shouldMigrate("es", undefined), true);
  assert.equal(shouldMigrate(false, undefined), true, "false también es un valor elegido");
  assert.equal(shouldMigrate(undefined, undefined), false);
  assert.equal(shouldMigrate("es", "en"), false, "lo elegido en esta versión gana");
  console.log("  ✓ migración desde ms365-copilot-vscode: claves, ids de modelo y cuándo copiar");
}

// ---- profile.ts accountOf (Accounts menu) ----------------------------------

function testAccountOf() {
  const account = accountOf(parsePastedProfile(fakeJwt()));
  assert.deepEqual(account, {
    sessionId: "tenant-tid/user-oid",
    accountId: "user-oid",
    label: "someone@contoso.com",
  });

  // A renewed token of the same user is the same session.
  const renewed = accountOf(
    parsePastedProfile(fakeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 })),
  );
  assert.equal(renewed?.sessionId, account?.sessionId);

  // Expired = signed out.
  assert.equal(
    accountOf(parsePastedProfile(fakeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }))),
    undefined,
  );
  assert.equal(accountOf(null), undefined);

  setLocale("en");
  assert.equal(
    accountOf(parsePastedProfile(fakeJwt({ upn: undefined })))?.label,
    "M365 Copilot user",
  );
  setLocale("es");
  assert.equal(
    accountOf(parsePastedProfile(fakeJwt({ upn: undefined })))?.label,
    "Usuario de M365 Copilot",
  );
  setLocale("en");
  console.log("  ✓ la cuenta del menú Cuentas sale del token (y desaparece al caducar)");
}

// ---- reviewPrompt.ts (code review as comments) ------------------------------

function testReviewPrompt() {
  setLocale("en");
  assert.equal(numberLines({ startLine: 9, text: "a\nb\r\nc" }), " 9 | a\n10 | b\n11 | c");
  assert.equal(
    formatRanges([
      { start: 10, end: 14 },
      { start: 30, end: 30 },
    ]),
    "10-14, 30",
  );

  const whole = buildReviewPrompt({
    relativePath: "src/a.ts",
    languageId: "typescript",
    segments: [{ startLine: 1, text: "const a = 1;\nconsole.log(a);" }],
  });
  assert.match(whole, /senior code reviewer/);
  assert.match(whole, /File: src\/a\.ts \(typescript\)/);
  assert.match(whole, /```typescript\n1 \| const a = 1;\n2 \| console\.log\(a\);\n```/);
  assert.doesNotMatch(whole, /were just changed/, "sin cambios no hay sección de cambios");

  const changes = buildReviewPrompt({
    relativePath: "src/a.ts",
    languageId: "typescript",
    segments: [
      { startLine: 1, text: "x" },
      { startLine: 40, text: "y" },
    ],
    changed: [{ start: 41, end: 42 }],
    diff: "@@ -41 +41,2 @@\n-old\n+new",
  });
  assert.match(changes, /These lines were just changed: 41-42\./);
  assert.match(changes, /```diff\n@@ -41 \+41,2 @@\n-old\n\+new\n```/);
  assert.match(
    changes,
    / 1 \| x\n⋮\n40 \| y/,
    "los trozos van separados con ⋮ y numerados con su línea real",
  );

  setLocale("es");
  assert.match(
    buildReviewPrompt({
      relativePath: "a.ts",
      languageId: "ts",
      segments: [{ startLine: 1, text: "x" }],
    }),
    /en español/,
  );
  setLocale("en");
  console.log("  ✓ prompt de revisión: líneas numeradas, cambios, diff e idioma");
}

function testReviewFindings() {
  const bounds = { start: 1, end: 50 };

  const fenced = parseReviewFindings(
    'Here is the review:\n```json\n[{"line": 12, "endLine": 14, "severity": "warning", "title": "Unhandled rejection", "message": "fetch() can reject.", "suggestion": "Wrap it in try/catch."}]\n```',
    bounds,
  );
  assert.deepEqual(fenced, [
    {
      startLine: 12,
      endLine: 14,
      severity: "warning",
      title: "Unhandled rejection",
      message: "fetch() can reject.",
      suggestion: "Wrap it in try/catch.",
    },
  ]);

  // Nothing to report is an empty list, not an unreadable answer.
  assert.deepEqual(parseReviewFindings("```json\n[]\n```", bounds), []);
  assert.deepEqual(parseReviewFindings("[]", bounds), []);
  assert.equal(parseReviewFindings("The code looks fine to me!", bounds), null);
  assert.equal(
    parseReviewFindings('```json\n[{"line": 1,\n```', bounds),
    null,
    "JSON cortado = ilegible",
  );

  // Shapes models like: wrapper object, trailing comma, lines as strings,
  // other field names and severity words.
  const loose = parseReviewFindings(
    '{"findings": [{"line": "L20-22", "level": "critical", "summary": "SQL injection", "description": "The query concatenates user input."},' +
      '{"startLine": 5, "type": "nit", "message": "Name could be clearer. It says x."},]}',
    bounds,
  );
  assert.deepEqual(
    loose?.map((f) => [f.startLine, f.endLine, f.severity, f.title]),
    [
      [5, 5, "info", "Name could be clearer."],
      [20, 22, "error", "SQL injection"],
    ],
    "ordenados por línea; el título sale de la primera frase si falta",
  );

  // Outside the reviewed lines: dropped, or clamped when it straddles them.
  const clamped = parseReviewFindings(
    '[{"line": 3, "message": "before"}, {"line": 9, "endLine": 30, "message": "straddles"}, {"line": 99, "message": "after"}, {"message": "no line"}]',
    { start: 10, end: 20 },
  );
  assert.deepEqual(
    clamped?.map((f) => [f.startLine, f.endLine, f.message]),
    [[10, 20, "straddles"]],
  );

  // Duplicates go, and there is a cap.
  const many = JSON.stringify(
    Array.from({ length: 40 }, (_, i) => ({
      line: (i % 30) + 1,
      title: `t${i % 30}`,
      message: "m",
    })),
  );
  const capped = parseReviewFindings(many, bounds);
  assert.equal(capped?.length, MAX_FINDINGS);
  assert.equal(new Set(capped?.map((f) => f.title)).size, MAX_FINDINGS, "sin duplicados");
  console.log(
    "  ✓ lectura de la revisión: JSON en vallas o suelto, campos alternativos, límites, duplicados",
  );
}

function testUnifiedDiff() {
  const patch = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -3 +3 @@ function a() {",
    "-  return 1;",
    "+  return 2;",
    "@@ -10,2 +10,4 @@",
    "+added",
    "+added",
    "@@ -20,3 +23,0 @@",
    "-gone",
    "-gone",
    "-gone",
    "diff --git a/new file.ts b/new file.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new file.ts\t",
    "@@ -0,0 +1,3 @@",
    "+a",
    "+b",
    "+c",
    "diff --git a/old.ts b/old.ts",
    "deleted file mode 100644",
    "--- a/old.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-x",
    "-y",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
    'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
    '--- "a/caf\\303\\251.ts"',
    '+++ "b/caf\\303\\251.ts"',
    "@@ -1 +1 @@",
    "-a",
    "+b",
    // The same file again (staged + unstaged diffs concatenated).
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -40 +44,2 @@",
    "+x",
    "+y",
  ].join("\n");
  const files = parseUnifiedDiff(patch);
  assert.deepEqual(
    files.map((file) => [file.path, file.ranges]),
    [
      [
        "src/a.ts",
        [
          { start: 3, end: 3 },
          { start: 10, end: 13 },
          { start: 23, end: 23 },
          { start: 44, end: 45 },
        ],
      ],
      ["new file.ts", [{ start: 1, end: 3 }]],
      ["café.ts", [{ start: 1, end: 1 }]],
    ],
    "borrados y binarios fuera; el borrado puro marca la línea donde estaba; mismo archivo fusionado",
  );
  assert.match(files[0].patch, /-  return 1;/, "el parche del archivo conserva lo eliminado");
  assert.match(files[0].patch, /\+y/);

  // 1-2 and 3 touch; 5-6 does not (line 4 is in between).
  assert.deepEqual(
    mergeRanges([
      { start: 5, end: 6 },
      { start: 1, end: 2 },
      { start: 3, end: 3 },
      { start: 9, end: 9 },
    ]),
    [
      { start: 1, end: 3 },
      { start: 5, end: 6 },
      { start: 9, end: 9 },
    ],
  );
  assert.deepEqual(
    windowsAround(
      [
        { start: 5, end: 5 },
        { start: 30, end: 31 },
      ],
      40,
      10,
    ),
    [
      { start: 1, end: 15 },
      { start: 20, end: 40 },
    ],
  );
  const finding = {
    startLine: 12,
    endLine: 12,
    severity: "info" as const,
    title: "t",
    message: "m",
  };
  assert.equal(touchesRanges(finding, [{ start: 10, end: 10 }]), true, "a 2 líneas cuenta");
  assert.equal(touchesRanges(finding, [{ start: 20, end: 25 }]), false);
  console.log(
    "  ✓ diff de git -U0: líneas cambiadas por archivo, rutas raras, ventanas y filtro de hallazgos",
  );
}

// ---- rag/text.ts -------------------------------------------------------------

function testRagText() {
  assert.deepEqual(splitIdentifier("getHTTPResponse_code"), ["get", "HTTP", "Response", "code"]);
  assert.deepEqual(splitIdentifier("my-kebab-name"), ["my", "kebab", "name"]);
  assert.equal(normalizeTerm("Tokens"), "token");
  assert.equal(normalizeTerm("Configuración"), "configuracion");
  assert.equal(normalizeTerm("class"), "class", "no quita la s de ss");
  assert.equal(normalizeTerm("libraries"), "library");
  assert.deepEqual(tokenize("const profileStore = new ProfileStore();"), [
    "profilestore",
    "profile",
    "store",
    "profilestore",
    "profile",
    "store",
  ]);
  assert.ok(
    !tokenize("the a de la que 42 x").length,
    "sin palabras vacías, números ni letras sueltas",
  );

  const terms = queryTerms("¿Dónde se guarda el token del usuario?");
  const byTerm = new Map(terms.map((term) => [term.term, term]));
  assert.equal(byTerm.get("token")?.weight, 1);
  assert.equal(byTerm.get("token")?.original, true);
  for (const english of ["save", "store", "storage", "user"])
    assert.ok(byTerm.has(english), `expande ${english}`);
  assert.equal(byTerm.get("store")?.original, false);
  assert.ok(!byTerm.has("donde") && !byTerm.has("se"), "palabras vacías fuera");
  assert.equal(
    queryTerms("ProfileStore").find((term) => term.term === "profilestore")?.weight,
    1.5,
    "el identificador entero pesa más",
  );
  assert.deepEqual(cognates("migracion"), ["migration", "migraction"]);
  assert.ok(cognates("funcion").includes("function"));
  assert.deepEqual(cognates("validar"), ["validate"]);
  assert.deepEqual(cognates("participante"), ["participant"]);
  assert.deepEqual(cognates("normalizar"), ["normalize"]);
  assert.deepEqual(cognates("casa"), []);

  assert.equal(isSkippedPath("node_modules/x/index.js"), true);
  assert.equal(isSkippedPath("src/app/node_modules/y.ts"), true);
  assert.equal(isSkippedPath("pnpm-lock.yaml"), true);
  assert.equal(isSkippedPath("dist/app.min.js"), true);
  assert.equal(isSkippedPath("assets/logo.png"), true);
  assert.equal(isSkippedPath("bin/cli.js"), false, "bin/ de Node se indexa");
  assert.equal(isSkippedPath("src/index.ts"), false);

  assert.equal(looksGenerated("// @generated by protoc\nexport const x = 1;"), true);
  assert.equal(
    looksGenerated(`!function(){${"a=1;".repeat(600)}}()`),
    true,
    "una línea enorme = minificado",
  );
  assert.equal(looksGenerated("export function add(a, b) {\n  return a + b;\n}\n"), false);

  const globs = excludeGlobs(
    [{ "**/fixtures": true, "**/keep": false }, undefined],
    ["docs/old/**", 42],
  );
  assert.equal(
    isExcluded("test/fixtures/a.json", globs),
    true,
    "una carpeta excluida excluye lo de dentro",
  );
  assert.equal(isExcluded("docs/old/a.md", globs), true);
  assert.equal(isExcluded("src/keep/a.ts", globs), false, "false = no excluir");
  assert.equal(globToRegExp("**/*.{js,ts}").test("a/b/c.ts"), true);
  assert.equal(globToRegExp("**/*.{js,ts}").test("c.ts"), true);
  assert.equal(globToRegExp("src/*.ts").test("src/a/b.ts"), false, "* no cruza carpetas");
  assert.equal(globToRegExp("file?.md").test("file1.md"), true);

  assert.equal(
    retrievalQuery("<context>lots</context><userRequest>where is the token stored</userRequest>"),
    "where is the token stored",
  );
  assert.equal(retrievalQuery("plain   question\nhere"), "plain question here");
  console.log(
    "  ✓ RAG texto: identificadores, normalización, expansión es→en, cognados, exclusiones y generados",
  );
}

// ---- rag/code.ts -------------------------------------------------------------

function testRagCode() {
  assert.deepEqual(languageOf("src/a.tsx"), { family: "js", label: "TypeScript" });
  assert.equal(languageOf("Dockerfile")?.label, "Dockerfile");
  assert.equal(languageOf("x.unknownext"), undefined);

  const ts = [
    'import { a } from "./a";',
    "/** Stores the profile. */",
    "export class ProfileStore {",
    "  private cache = 1;",
    "  constructor(private readonly secrets: Secrets) {",
    "    if (x) {",
    "      call(() => {",
    "      });",
    "    }",
    "  }",
    "  async get(): Promise<Profile | null> {",
    "    return null;",
    "  }",
    "}",
    "export const MAX_SIZE = 10;",
    "export const parse = (text: string): number => 1;",
    "export interface Profile { a: string }",
    "type Local = { b: number };",
    "export default function main() {}",
  ];
  assert.deepEqual(
    extractSymbols(ts, "js").map(
      (s) =>
        `${s.line}:${s.kind}:${s.container ? `${s.container}.` : ""}${s.name}${s.exported ? "*" : ""}`,
    ),
    [
      "3:class:ProfileStore*",
      "5:method:ProfileStore.constructor",
      "11:method:ProfileStore.get",
      "15:constant:MAX_SIZE*",
      "16:function:parse*",
      "17:interface:Profile*",
      "18:type:Local",
      "19:function:main*",
    ],
    "clases, métodos (sin las llamadas de dentro), constantes, flechas, interfaces y tipos",
  );
  assert.deepEqual(
    extractSymbols(
      [
        "class Store:",
        "    def save(self, token):",
        "        pass",
        "",
        "def _helper():",
        "    pass",
      ],
      "python",
    ).map((s) => `${s.kind}:${s.container ?? ""}:${s.name}`),
    ["class::Store", "method:Store:save", "function::_helper"],
  );
  assert.deepEqual(
    extractSymbols(
      ["type Server struct {", "}", "func (s *Server) Start() error {", "}", "func helper() {}"],
      "go",
    ).map((s) => `${s.kind}:${s.name}`),
    ["struct:Server", "method:Start", "function:helper"],
  );
  assert.deepEqual(
    extractSymbols(
      ["pub struct Cache;", "impl Cache {", "    pub fn get(&self) {}", "}", "fn main() {}"],
      "rust",
    ).map((s) => `${s.kind}:${s.container ?? ""}:${s.name}`),
    ["struct::Cache", "class::Cache", "method:Cache:get", "function::main"],
  );
  assert.deepEqual(
    extractSymbols(
      [
        "public class UserService {",
        "    public User find(String id) {",
        "        return repo.find(id);",
        "    }",
        "}",
      ],
      "jvm",
    ).map((s) => `${s.kind}:${s.name}`),
    ["class:UserService", "method:find"],
  );
  assert.deepEqual(
    extractSymbols(
      ["# Title", "text", "## Install", "```", "# not a heading? (yes in md)", "```"],
      "markdown",
    )
      .slice(0, 2)
      .map((s) => s.name),
    ["Title", "Install"],
  );

  assert.deepEqual(
    extractImports(
      [
        'import x from "./x";',
        "import type { Y } from '../y/index.js';",
        'export * from "./z";',
        'const w = require("w-lib");',
        'await import("./lazy")',
        "import {",
        "  a,",
        '} from "@scope/pkg/sub";',
      ].join("\n"),
      "js",
    ),
    ["./x", "../y/index.js", "./z", "@scope/pkg/sub", "w-lib", "./lazy"],
  );
  assert.deepEqual(
    extractImports("from .models import User\nfrom ..core.db import x\nimport os, sys\n", "python"),
    [".models", "..core.db", "os", "sys"],
  );
  assert.deepEqual(
    extractImports('import (\n  "fmt"\n  "github.com/acme/app/internal/store"\n)\n', "go"),
    ["fmt", "github.com/acme/app/internal/store"],
  );
  assert.deepEqual(extractImports("mod cache;\nuse crate::net::client;\n", "rust"), [
    "cache",
    "crate::net::client",
  ]);
  assert.deepEqual(extractImports('#include "util.h"\n#include <stdio.h>\n', "c"), ["util.h"]);

  // Chunks start at declarations (with their doc comment) and stay bounded.
  const long = Array.from({ length: 300 }, (_, i) => `  line ${i + 1};`);
  long[99] = "/** doc */";
  long[100] = "export function second() {";
  long[199] = "export function third() {";
  const symbols = extractSymbols(long, "js");
  const chunks = chunkLines(long, symbols);
  assert.ok(
    chunks.some((chunk) => chunk.startLine === 100),
    "el comentario va con su declaración",
  );
  assert.ok(chunks.some((chunk) => chunk.startLine === 200));
  assert.ok(
    chunks.every((chunk) => chunk.endLine - chunk.startLine + 1 <= 90),
    "ningún fragmento pasa de 90 líneas",
  );
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[chunks.length - 1].endLine, 300);
  for (let i = 1; i < chunks.length; i += 1)
    assert.equal(chunks[i].startLine, chunks[i - 1].endLine + 1, "sin huecos ni solapes");
  assert.deepEqual(
    chunkLines(["a", "b"], []),
    [{ startLine: 1, endLine: 2 }],
    "un archivo corto es un solo fragmento",
  );
  console.log(
    "  ✓ RAG código: lenguajes, símbolos (TS, Python, Go, Rust, Java, Markdown), imports y fragmentos",
  );
}

// ---- rag/searchIndex.ts + projectMap.ts ---------------------------------------

const RAG_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "acme-app",
    scripts: { build: "tsc", test: "node test" },
    dependencies: { "@acme/core": "workspace:*", express: "^4" },
  }),
  "packages/core/package.json": JSON.stringify({ name: "@acme/core", main: "dist/index.js" }),
  "packages/core/src/index.ts": "export { ProfileStore } from './secrets';\n",
  "packages/core/src/secrets.ts": [
    "/** Saves the access token in the secret storage. */",
    "export class ProfileStore {",
    "  async save(token: string): Promise<void> {",
    '    await this.storage.store("token", token);',
    "  }",
    "  async load(): Promise<string | undefined> {",
    '    return this.storage.get("token");',
    "  }",
    "}",
  ].join("\n"),
  "src/server.ts": [
    "import express from 'express';",
    "import { ProfileStore } from '@acme/core';",
    "import { route } from './routes';",
    "export function startServer(port: number) {",
    "  const store = new ProfileStore();",
    "  express().listen(port);",
    "}",
  ].join("\n"),
  "src/routes.ts":
    "import { formatDate } from './utils/date';\nexport function route(path: string) {\n  return formatDate(new Date()) + path;\n}\n",
  "src/utils/date.ts":
    "export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n",
  "test/secrets.test.ts":
    "import { ProfileStore } from '../packages/core/src/secrets';\ntest('saves the token', () => new ProfileStore());\n",
  "README.md": "# Acme\n\nThe token is saved by the core package. Run the server with npm start.\n",
  "CHANGELOG.md": "# Changelog\n\n## 1.0.0\n\n- Token storage.\n",
  "py/app/models.py": "class User:\n    def save(self):\n        pass\n",
  "py/app/views.py": "from .models import User\n\ndef show(user_id):\n    return User()\n",
};

function ragIndex(): SearchIndex {
  const index = new SearchIndex();
  for (const [path, text] of Object.entries(RAG_FILES)) {
    const file = analyzeFile(path, text);
    if (file) index.upsert(file);
  }
  return index;
}

function testRagSearch() {
  const index = ragIndex();
  assert.equal(index.size, Object.keys(RAG_FILES).length);

  assert.equal(
    index.search("ProfileStore")[0].path,
    "packages/core/src/secrets.ts",
    "el archivo que declara el símbolo primero",
  );
  assert.equal(
    index.search("¿dónde se guarda el token?")[0].path,
    "packages/core/src/secrets.ts",
    "pregunta en español → código en inglés",
  );
  assert.equal(index.search("format date")[0].path, "src/utils/date.ts");
  assert.equal(
    index
      .search("date", { pathPrefix: "src/utils" })
      .every((hit) => hit.path.startsWith("src/utils/")),
    true,
  );
  assert.notEqual(index.search("ProfileStore token test")[0]?.path, undefined);
  assert.ok(
    index.search("saves the token").findIndex((hit) => hit.path === "test/secrets.test.ts") >
      index
        .search("saves the token")
        .findIndex((hit) => hit.path === "packages/core/src/secrets.ts"),
    "los tests, por detrás del código (salvo que se pidan)",
  );
  assert.equal(
    index.search("token").find((hit) => hit.path === "CHANGELOG.md") === undefined ||
      index.search("token")[0].path !== "CHANGELOG.md",
    true,
    "el changelog no gana",
  );
  assert.deepEqual(
    index
      .search("date", { exclude: { path: "src/utils/date.ts", startLine: 1, endLine: 3 } })
      .filter((hit) => hit.path === "src/utils/date.ts"),
    [],
    "lo que ya está en el prompt no vuelve",
  );
  assert.ok(
    index.search("routes").some((hit) => hit.path === "src/routes.ts"),
    "el nombre del archivo cuenta aunque el texto no lo diga",
  );
  assert.deepEqual(index.search("zzzz qqqq"), []);
  assert.deepEqual(index.search(""), []);

  // The active file's neighbours rank higher.
  const plain = index.search("function");
  const fromRoutes = index.search("function", { activePath: "src/routes.ts" });
  assert.ok(
    fromRoutes.findIndex((hit) => hit.path === "src/utils/date.ts") <=
      plain.findIndex((hit) => hit.path === "src/utils/date.ts"),
  );

  // Dependency graph: relative, workspace package (→ sources), Python relative, externals.
  const graph = index.dependencyGraph();
  assert.deepEqual([...(graph.imports.get("src/server.ts") ?? [])].sort(), [
    "packages/core/src/index.ts",
    "src/routes.ts",
  ]);
  assert.deepEqual([...(graph.imports.get("py/app/views.py") ?? [])], ["py/app/models.py"]);
  assert.deepEqual([...(graph.importers.get("packages/core/src/secrets.ts") ?? [])].sort(), [
    "packages/core/src/index.ts",
    "test/secrets.test.ts",
  ]);
  assert.deepEqual([...(graph.external.get("express") ?? [])], ["src/server.ts"]);

  // Updates and removals.
  index.upsert(
    analyzeFile("src/utils/date.ts", "export function parseIsoDate(text: string) {}\n")!,
  );
  assert.equal(
    index
      .search("formatDate")
      .some((hit) => hit.path === "src/utils/date.ts" && hit.symbols.includes("formatDate")),
    false,
  );
  assert.equal(index.search("parseIsoDate")[0].path, "src/utils/date.ts");
  assert.equal(index.removePrefix("src"), 3);
  assert.equal(
    index.search("startServer").some((hit) => hit.path.startsWith("src/")),
    false,
    "nada de lo borrado",
  );
  assert.equal(index.has("packages/core/src/secrets.ts"), true);

  assert.deepEqual(
    bestWindow(["a", "b", "token here", "token token", "c", "d"], 10, ["token"], 2),
    { startLine: 12, endLine: 13 },
  );
  console.log(
    "  ✓ RAG búsqueda: ranking (símbolo, español→inglés, ruta, tests, changelog), alcance, exclusión, grafo e incremental",
  );
}

async function testRagRendering() {
  setLocale("en");
  const index = ragIndex();
  const map = renderProjectMap(index, { workspaceName: "acme", maxChars: 20_000 });
  assert.match(map, /Project map of “acme” — 12 files/);
  assert.match(map, /@acme\/core \(npm, packages\/core\/\)/);
  assert.match(map, /acme-app \(npm, \.\/\) — scripts: build, test/);
  assert.match(map, /packages\/core\/src\/secrets\.ts ← 2/, "módulos más importados");
  assert.match(map, /express \(1\)/, "dependencias externas");
  assert.match(
    map,
    /\n- src\/ \(2\): server\.ts \[startServer\], routes\.ts \[route\]\n- src\/utils\/ \(1\): date\.ts \[formatDate\]\n/,
  );
  assert.ok(
    renderProjectMap(index, { workspaceName: "acme", maxChars: 300 }).length <= 300,
    "respeta el presupuesto",
  );

  const detail = renderFileDetail(index, "packages/core/src/secrets.ts", 5_000)!;
  assert.match(detail, /2: class ProfileStore \(export\)/);
  assert.match(detail, /3: method ProfileStore\.save/);
  assert.match(detail, /Imported by: packages\/core\/src\/index\.ts, test\/secrets\.test\.ts/);
  assert.equal(renderFileDetail(index, "nope.ts", 100), undefined);
  assert.match(
    renderFolderDetail(index, "src/", 5_000)!,
    /Folder src\/ — 3 indexed files[\s\S]*utils\/date\.ts \[formatDate\]/,
  );
  assert.match(
    renderSummary(index, "acme", 2_000),
    /Workspace “acme”: 12 files indexed \(TypeScript 6/,
  );

  const hits = index.search("¿dónde se guarda el token?", { limit: 3 });
  const lines = (path: string, start: number, end: number) =>
    Promise.resolve(RAG_FILES[path]?.split("\n").slice(start - 1, end));
  const rendered = await renderHits(hits, lines, { maxLines: 30, maxChars: 4_000 });
  assert.equal(rendered[0].hit.path, "packages/core/src/secrets.ts");
  const result = formatSearchResults("token", rendered, [], () => "typescript");
  assert.match(
    result,
    /1\. packages\/core\/src\/secrets\.ts:1-9 — ProfileStore, save, load\n```typescript\n\/\*\* Saves the access token/,
  );
  assert.match(result, /m365_read_file/);
  assert.match(
    formatSearchResults("zzz", [], [], () => ""),
    /No results in the project index for “zzz”/,
  );
  const context = formatAutoContext("SUMMARY", rendered.slice(0, 1), hits.slice(1), () => "ts");
  assert.match(context, /^PROJECT CONTEXT — retrieved automatically/);
  assert.match(
    context,
    /SUMMARY[\s\S]*packages\/core\/src\/secrets\.ts:1-9[\s\S]*Also relevant: [^\n]+[\s\S]*END OF PROJECT CONTEXT/,
  );
  setLocale("es");
  assert.match(
    formatAutoContext("S", [], [], () => ""),
    /^CONTEXTO DEL PROYECTO/,
  );
  setLocale("en");
  console.log(
    "  ✓ RAG texto para el modelo: mapa, detalle de archivo/carpeta, resultados y contexto automático",
  );
}

// ---- web search ----------------------------------------------------------------

function testWebHelpers() {
  setLocale("en");
  const template = {
    source: "officeweb",
    tone: "Gpt_5_5_Chat",
    plugins: [{ Id: "BingWebSearch", Category: "FirstParty" }],
    optionsSets: ["enterprise_flux_web", "enable_web_grounding"],
    allowedMessageTypes: ["Chat", "InternalSearchQuery", "RenderCardRequest"],
    conversationId: "old-conversation",
    isStartOfSession: false,
    previousMessages: [{ text: "secret earlier turn" }],
    traceId: "abc",
    requestId: "old-request",
    message: {
      author: "user",
      text: "what the user typed on the web",
      locale: "fr-FR",
      market: "es-ES",
      requestId: "r1",
      messageId: "m1",
      timestamp: "2020-01-01",
      attachments: [{ x: 1 }],
    },
  };
  const args = buildWebInvocationArgs(template, "PROMPT", "Claude_Sonnet", "new-conversation");
  assert.deepEqual(args.plugins, template.plugins, "los plugins (búsqueda web) se conservan");
  assert.deepEqual(args.optionsSets, template.optionsSets);
  assert.equal(args.conversationId, "new-conversation");
  assert.equal(args.isStartOfSession, true);
  assert.equal(args.tone, "Claude_Sonnet");
  assert.equal("previousMessages" in args, false, "nada de la conversación de la web");
  assert.notEqual(args.requestId, "old-request");
  assert.notEqual(args.traceId, "abc");
  const message = args.message as Record<string, unknown>;
  assert.equal(message.text, "PROMPT");
  assert.equal(message.locale, "en-US");
  assert.equal(message.market, "es-ES", "el resto del mensaje capturado se queda");
  assert.notEqual(message.requestId, "r1");
  assert.equal("attachments" in message, false);
  assert.equal(template.message.text, "what the user typed on the web", "la plantilla no se toca");
  // Auto también es Auto en la web: no el último modelo elegido allí.
  assert.equal(buildWebInvocationArgs(template, "P", null, "c").tone, "magic", "sin tone, Auto");
  // Declara Disengaged para que un turno filtrado lo diga (el servicio solo manda los tipos declarados).
  assert.deepEqual(args.allowedMessageTypes, [
    "Chat",
    "InternalSearchQuery",
    "RenderCardRequest",
    "Disengaged",
  ]);
  assert.deepEqual(
    template.allowedMessageTypes,
    ["Chat", "InternalSearchQuery", "RenderCardRequest"],
    "la plantilla no se toca",
  );
  assert.deepEqual(
    buildWebInvocationArgs(
      { ...template, allowedMessageTypes: ["Chat", "Disengaged"] },
      "P",
      null,
      "c",
    ).allowedMessageTypes,
    ["Chat", "Disengaged"],
    "sin duplicarlo",
  );

  assert.equal(
    capturedVariants(
      "wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=x&variants=feature.a,feature.b&source=officeweb",
    ),
    "feature.a,feature.b",
  );
  assert.equal(capturedVariants("wss://x/y?access_token=x"), undefined);
  assert.equal(capturedVariants(null), undefined);
  assert.equal(capturedVariants("not a url"), undefined);

  assert.deepEqual(
    sourcesOf({
      sourceAttributions: [
        { providerDisplayName: "MDN", seeMoreUrl: "https://developer.mozilla.org/x" },
        { seeMoreUrl: "javascript:alert(1)" },
        { url: "https://example.com", title: " Example " },
        "junk",
      ],
    }),
    [
      { title: "MDN", url: "https://developer.mozilla.org/x" },
      { title: "Example", url: "https://example.com" },
    ],
    "sólo enlaces http(s)",
  );
  assert.deepEqual(sourcesOf({}), []);

  assert.match(
    buildWebSearchPrompt("  latest Node LTS  "),
    /web search[\s\S]*Query:\nlatest Node LTS$/,
  );
  const result = formatWebResult("node", "Node 24 is LTS [^1^].\n\n\n\nIt was released [^2^].", [
    { title: "Node.js", url: "https://nodejs.org" },
    { title: "Node.js again", url: "https://nodejs.org" },
    { title: "Blog", url: "https://blog.example" },
  ]);
  assert.match(
    result,
    /^Web search: “node”\n\nNode 24 is LTS \[1\]\.\n\nIt was released \[2\]\.\n\nSources:\n1\. Node\.js — https:\/\/nodejs\.org\n2\. Blog — https:\/\/blog\.example$/,
  );
  assert.match(formatWebResult("x", "  ", []), /returned nothing/);
  assert.equal(sourcesMarkdown([]), "");
  assert.match(
    sourcesMarkdown([{ title: "A [b]", url: "https://a" }]),
    /\n\nSources:\n1\. \[A b\]\(https:\/\/a\)/,
  );
  setLocale("es");
  assert.match(buildWebSearchPrompt("x"), /Responde en español/);
  setLocale("en");
  console.log(
    "  ✓ búsqueda web: petición desde la plantilla capturada, variants, fuentes y resultado",
  );
}

/** A web turn: the captured plugins and variants go out; cards mid-answer do not end it; sources come back. */
async function testWebTurn() {
  let sawUrl = "";
  let sawArgs: Record<string, unknown> | undefined;
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const port = (wss.address() as { port: number }).port;
  wss.on("connection", (socket, request) => {
    sawUrl = request.url ?? "";
    let handshaken = false;
    socket.on("message", (data) => {
      for (const chunk of data.toString().split(RS)) {
        if (!chunk) continue;
        const frame = JSON.parse(chunk);
        if (!handshaken) {
          handshaken = true;
          socket.send("{}" + RS);
          continue;
        }
        if (frame.target !== "chat") continue;
        sawArgs = frame.arguments[0];
        const update = (messages: unknown[]) =>
          socket.send(
            JSON.stringify({ type: 1, target: "update", arguments: [{ messages }] }) + RS,
          );
        setTimeout(() => {
          update([{ author: "bot", messageType: "InternalSearchQuery", text: "node lts" }]);
          update([{ author: "bot", text: "Node 24", messageId: "a" }]);
          update([{ author: "bot", messageType: "RenderCardRequest" }]);
          update([
            {
              author: "bot",
              text: "Node 24 is the LTS [^1^].",
              messageId: "a",
              sourceAttributions: [
                { providerDisplayName: "Node.js", seeMoreUrl: "https://nodejs.org" },
              ],
            },
          ]);
          update([{ author: "bot", messageType: "EndOfRequest" }]);
        }, 5);
      }
    });
  });
  const profile = {
    ...makeProfile(port),
    endpoint: `wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=old&variants=feat.web&source=officeweb`,
    invocationTemplate: {
      tone: "Gpt_5_5_Chat",
      plugins: [{ Id: "BingWebSearch" }],
      previousMessages: [1],
      message: { author: "user", text: "old" },
    },
  };
  let text = "";
  const sources: unknown[] = [];
  // Through the retry wrapper, as the extension calls it: the sources must survive it.
  await streamCopilotTurnWithRetry({
    profile,
    endpointBase: mockBase(port),
    prompt: "PROMPT",
    tone: null,
    mode: "web",
    signal: new AbortController().signal,
    callbacks: { onText: (delta) => (text += delta), onSources: (found) => sources.push(...found) },
  });
  wss.close();
  assert.equal(
    text,
    "Node 24 is the LTS [^1^].",
    "una tarjeta a mitad de respuesta no corta el turno",
  );
  assert.deepEqual(sources, [{ title: "Node.js", url: "https://nodejs.org" }]);
  assert.match(sawUrl, /[?&]variants=feat\.web(?:&|$)/);
  assert.deepEqual(sawArgs?.plugins, [{ Id: "BingWebSearch" }]);
  assert.equal("previousMessages" in (sawArgs ?? {}), false);
  assert.equal(
    new URL(`http://x${sawUrl}`).searchParams.get("ConversationId"),
    sawArgs?.conversationId,
    "el id de la URL y el del mensaje coinciden",
  );

  console.log(
    "  ✓ turno con web: plugins y variants capturados, tarjetas a mitad, fuentes, id de conversación",
  );
}

// ---- modelCatalog.ts (dynamic models) ---------------------------------------

function testModelCatalog() {
  // The web app's labels for the mode, whatever the model.
  assert.equal(prettyTone("Gpt_5_6_Reasoning"), "GPT 5.6 Think deeper");
  assert.equal(prettyTone("Gpt_5_7_Chat"), "GPT 5.7 Quick response");
  assert.equal(prettyTone("Gpt_Quick"), "GPT Quick response");
  assert.equal(prettyTone("Gpt_6_1_Sol"), "GPT 6.1 Sol");
  assert.equal(prettyTone("Claude_Sonnet_5_5_Reasoning"), "Claude Sonnet 5.5 Think deeper");
  assert.equal(prettyTone("Claude_Opus_4_1"), "Claude Opus 4.1");
  assert.equal(prettyTone("Claude_Sonnet"), "Claude Sonnet");
  assert.equal(prettyTone("Reasoning"), "Think deeper");
  assert.equal(prettyTone("magic"), "Auto");
  assert.equal(modelIdForTone("Gpt_5_7_Chat"), "m365-copilot-tone-gpt-5-7-chat");

  // models.json: shape validated, junk dropped, detail as text or {en, es}.
  assert.equal(parseModelCatalog({ nope: [] }), null);
  assert.equal(parseModelCatalog(null), null);
  assert.deepEqual(
    parseModelCatalog({
      models: [
        { tone: "Gpt_5_7_Chat", name: "  GPT 5.7  ", detail: { en: "New", es: "Nuevo" } },
        { tone: "bad tone with spaces" },
        { tone: "<script>" },
        "Claude_Opus",
        { tone: "Gpt_5_5_Chat", hidden: true },
        { tone: "Phi_5", detail: "Only text" },
      ],
    }),
    [
      { tone: "Gpt_5_7_Chat", name: "GPT 5.7", detail: { en: "New", es: "Nuevo" }, hidden: false },
      { tone: "Claude_Opus" },
      { tone: "Gpt_5_5_Chat", name: undefined, detail: undefined, hidden: true },
      {
        tone: "Phi_5",
        name: undefined,
        detail: { en: "Only text", es: "Only text" },
        hidden: false,
      },
    ],
  );
  assert.deepEqual(
    parseCustomModels(["Gpt_5_8_Chat", { tone: "X_1", name: "X" }, 42, { name: "no tone" }]),
    [
      { tone: "Gpt_5_8_Chat", hidden: false },
      { tone: "X_1", name: "X", detail: undefined, hidden: false },
    ],
  );
  assert.deepEqual(parseCustomModels("nope"), []);

  // Only built-ins: exactly the shipped list, Auto first.
  const builtinOnly = mergeModels({ catalog: [], observed: [], custom: [] });
  assert.deepEqual(
    builtinOnly.map((model) => model.id),
    BUILTIN_MODELS.map((model) => model.id),
  );
  assert.equal(builtinOnly[0].tone, null);

  const merged = mergeModels({
    catalog: [
      { tone: "Gpt_5_7_Chat", name: "GPT 5.7", detail: { en: "Newest", es: "El más nuevo" } },
      { tone: "Gpt_5_5_Chat", hidden: true },
      { tone: "Claude_Sonnet", name: "Claude Sonnet 5" },
    ],
    observed: ["Gpt_5_6_Reasoning", "Claude_Opus_4_1", "Gpt_5_7_Chat", "not valid!"],
    custom: [{ tone: "Gpt_5_5_Chat", name: "GPT 5.5 (mine)" }, { tone: "Exp_Model" }],
  });
  const byTone = new Map(merged.map((model) => [model.tone, model]));
  assert.equal(merged[0].id, "m365-copilot-auto", "Auto stays first");
  // A catalog rename keeps the built-in id (settings that point to it keep working).
  assert.equal(byTone.get("Claude_Sonnet")?.name, "M365 Copilot · Claude Sonnet 5");
  assert.equal(byTone.get("Claude_Sonnet")?.id, "m365-copilot-claude");
  // New from the catalog, with its own description.
  assert.equal(byTone.get("Gpt_5_7_Chat")?.source, "catalog");
  assert.deepEqual(byTone.get("Gpt_5_7_Chat")?.detail, { en: "Newest", es: "El más nuevo" });
  // Detected in the web app: readable name; already-known tones are not duplicated.
  assert.equal(byTone.get("Claude_Opus_4_1")?.name, "M365 Copilot · Claude Opus 4.1");
  assert.equal(byTone.get("Claude_Opus_4_1")?.source, "observed");
  assert.equal(merged.filter((model) => model.tone === "Gpt_5_6_Reasoning").length, 1);
  assert.equal(byTone.get("Gpt_5_6_Reasoning")?.source, "builtin");
  assert.equal(byTone.has("not valid!"), false);
  // Hidden by the catalog, but the user listed it: custom wins, with its name.
  assert.equal(byTone.get("Gpt_5_5_Chat")?.name, "M365 Copilot · GPT 5.5 (mine)");
  assert.equal(byTone.get("Exp_Model")?.source, "custom");
  // Hidden by the catalog and nobody asked for it back: gone.
  assert.equal(
    mergeModels({
      catalog: [{ tone: "Gpt_5_5_Reasoning", hidden: true }],
      observed: [],
      custom: [],
    }).some((model) => model.tone === "Gpt_5_5_Reasoning"),
    false,
  );
  // Bounded, whatever the sources say.
  const flood = Array.from({ length: 80 }, (_, i) => `Model_${i}`);
  assert.ok(mergeModels({ catalog: [], observed: flood, custom: [] }).length <= 30);

  // Announced once: built-ins never, new ones until they are known.
  assert.deepEqual(
    unannounced(merged, new Set()).map((model) => model.tone),
    ["Gpt_5_7_Chat", "Claude_Opus_4_1", "Exp_Model"],
  );
  assert.deepEqual(
    unannounced(merged, new Set(["Gpt_5_7_Chat", "Claude_Opus_4_1", "Exp_Model"])),
    [],
  );

  // The catalog published in the repository parses and only lists valid tones.
  const published = parseModelCatalog(
    JSON.parse(readFileSync(new URL("../../../models.json", import.meta.url), "utf8")),
  );
  assert.ok(published && published.length > 0, "models.json must parse");
  for (const entry of published!)
    if (!entry.hidden) assert.ok(entry.name, `${entry.tone} needs a name`);
  // Installed versions take names and retirements from it: it lists every
  // built-in model (so they read the same everywhere), and the models that
  // came after the built-ins — GPT 6.0 and 6.1 Sol, and GPT 5.6 Quick
  // response, which the catalog had retired and serves again.
  const visible = new Map(
    published!.filter((entry) => !entry.hidden).map((entry) => [entry.tone, entry.name]),
  );
  for (const model of BUILTIN_MODELS)
    if (model.tone) assert.ok(visible.has(model.tone), `models.json lists ${model.tone}`);
  assert.equal(visible.get("Gpt_5_6_Chat"), "GPT 5.6 Quick response");
  assert.equal(visible.get("Gpt_6_Sol_Reasoning"), "GPT 6.0 Sol");
  assert.equal(visible.get("Gpt_61_Sol_Reasoning"), "GPT-6.1 Sol");
  assert.deepEqual(
    mergeModels({ catalog: published!, observed: [], custom: [] })
      .filter((model) => model.source === "catalog")
      .map((model) => model.name),
    [
      "M365 Copilot · GPT-6.1 Sol",
      "M365 Copilot · GPT 6.0 Sol",
      "M365 Copilot · GPT 5.6 Quick response",
      "M365 Copilot · Claude Opus 5.5",
      "M365 Copilot · Claude Sonnet 5.5",
      "M365 Copilot · Claude Sonnet 5",
      "M365 Copilot · GPT-6 Think deeper",
    ],
  );
  // The licence's models: their own ids, next to the built-in Claude Sonnet (4.6, on Copilot Chat).
  const fromRepo = new Map(
    mergeModels({ catalog: published!, observed: ["Claude_Opus"], custom: [] }).map((model) => [
      model.tone,
      model,
    ]),
  );
  assert.equal(fromRepo.get("Claude_Sonnet")?.id, "m365-copilot-claude");
  assert.equal(fromRepo.get("Claude_Sonnet@paid")?.id, "m365-copilot-tone-claude-sonnet-paid");
  assert.equal(
    fromRepo.get("Claude_Opus")?.source,
    "catalog",
    "el tone que usó la web y la entrada del catálogo son el mismo modelo",
  );
  assert.equal(fromRepo.get("Gpt_6_Reasoning")?.name, "M365 Copilot · GPT-6 Think deeper");
  assert.deepEqual(
    parseCustomModels([
      "Claude_Sonnet@paid",
      "x@paid",
      { tone: "Claude_Opus@paid", name: "Opus" },
    ]).map((entry) => entry.tone),
    ["Claude_Sonnet@paid", "Claude_Opus"],
  );
  // The built-ins follow the web app's menu: its three modes, then the models.
  assert.deepEqual(
    BUILTIN_MODELS.slice(0, 3).map((model) => model.tone),
    [null, "Chat", "Reasoning"],
  );
  assert.equal(
    BUILTIN_MODELS.some((model) => model.tone === "Gpt_5_6_Chat"),
    false,
  );

  // The profile the browser side sends keeps the observed tones (and only valid ones).
  const profile = parsePastedProfile(
    JSON.stringify({
      accessToken: fakeJwt(),
      observedTones: ["Gpt_5_7_Chat", "bad tone", 7, "Claude_Opus"],
    }),
  );
  assert.deepEqual(profile.observedTones, ["Gpt_5_7_Chat", "Claude_Opus"]);
  assert.equal(parsePastedProfile(fakeJwt()).observedTones, undefined);
  console.log(
    "  ✓ modelos dinámicos: catálogo validado, detectados en la web, propios, ocultar retirados y anuncio único",
  );
}

// ---- logger.ts (deep debug mode) ---------------------------------------------

function testLoggerRedaction() {
  const jwt = fakeJwt();
  const redacted = redactSecrets(
    [
      `wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=${jwt}&X-SessionId=abc`,
      `Authorization: Bearer ${jwt}`,
      `{"accessToken":"${jwt}","refresh_token":"opaque-refresh-value","user":"someone@contoso.com"}`,
      `bare ${jwt} token`,
      "Cookie: session=abc123",
    ].join("\n"),
  );
  assert.ok(!redacted.includes(jwt), "a JWT survived the redaction");
  assert.ok(!redacted.includes("opaque-refresh-value"), "an opaque token in JSON survived");
  assert.ok(!redacted.includes("session=abc123"), "a cookie survived");
  assert.match(redacted, /access_token=<REDACTED>&X-SessionId=abc/);
  assert.match(redacted, /Authorization: <REDACTED>/);
  assert.match(redacted, /<JWT \d+ chars>/, "a bare JWT is shown as its length");
  assert.match(redacted, /someone@contoso\.com/, "what is not a secret stays readable");

  // What a log may say about a profile never includes the token itself.
  const summary = JSON.stringify(describeProfile(makeProfile(1234)));
  assert.ok(
    !summary.includes(makeProfile(1).accessToken.slice(0, 20)),
    "describeProfile leaked the token",
  );
  assert.match(summary, /"user":"someone@contoso\.com"|"tenant":"t"/);
  assert.equal(describeProfile(null), null);
  console.log(
    "  ✓ redactSecrets oculta JWT, access_token=, Bearer, JSON y cabeceras; describeProfile no lleva el token",
  );
}

function testDeepDebugGate() {
  const lines: string[] = [];
  initLogger({ appendLine: (line) => lines.push(line), clear: () => void (lines.length = 0) });
  clearLog();
  setDeepDebug(false);
  assert.equal(isDeepDebug(), false);

  // Off: the data is never even built.
  let built = 0;
  debug("x", "off", () => {
    built++;
    return "never";
  });
  assert.equal(built, 0, "con el modo apagado no se construye nada");
  assert.equal(logEntryCount(), 0);

  // The standard log is always written.
  log("always");
  assert.equal(logEntryCount(), 1);

  setDeepDebug(true);
  debug("ws#1", "on", () => {
    built++;
    return { a: 1 };
  });
  assert.equal(built, 1);
  assert.equal(logEntryCount(), 2);
  assert.match(
    lines.at(-1) ?? "",
    /^\[\d\d:\d\d:\d\d\.\d{3}\] \[ws#1\] on\n {4}\{\n {6}"a": 1\n {4}\}$/,
  );
  // A throwing builder never takes the caller down.
  debug("x", "boom", () => {
    throw new Error("builder failed");
  });
  assert.match(lines.at(-1) ?? "", /could not format the data: Error: builder failed/);

  // Strings stay readable (a prompt is not JSON-escaped); secrets inside are still hidden.
  debug("chat#1", "prompt", `line one\nline two ${fakeJwt()}`);
  const prompt = lines.at(-1) ?? "";
  assert.match(prompt, /\n {4}line one\n {4}line two <JWT \d+ chars>$/);

  setDeepDebug(false);
  clearLog();
  assert.equal(logEntryCount(), 0);
  assert.equal(lines.length, 0, "clearLog also clears the Output channel");
  console.log("  ✓ debug() no hace nada con el modo apagado, aplica la redacción y nunca lanza");
}

function testDebugDataFormatting() {
  const cyclic: Record<string, unknown> = { name: "a" };
  cyclic.self = cyclic;
  const text = formatDebugData({
    cyclic,
    error: new Error("boom"),
    map: new Map([["k", 1]]),
    set: new Set([1, 2]),
    big: 10n,
    bytes: Buffer.from("abc"),
    fn: () => 1,
  });
  assert.match(text, /\[Circular\]/);
  assert.match(text, /"message": "boom"/);
  assert.match(text, /"k": 1/);
  assert.match(text, /"big": "10"/);
  assert.match(text, /"bytes": "<3 bytes>"/);
  assert.doesNotMatch(text, /"fn"/);
  assert.equal(formatDebugData("plain"), "plain");
  assert.match(formatDebugData(new Error("x")), /Error: x/);
  console.log("  ✓ formatDebugData sobrevive a ciclos, errores, Map/Set, bigint y binarios");
}

function testLogBufferAndExport() {
  initLogger({ appendLine: () => {} });
  setDeepDebug(false);
  clearLog();
  for (let i = 0; i < 40_500; i++) log(`line ${i}`);
  assert.ok(logEntryCount() <= 40_000, "the buffer is bounded");
  log("x".repeat(250_000));

  const text = renderLogText("HEADER https://x/y?access_token=sekret");
  assert.match(
    text,
    /^HEADER https:\/\/x\/y\?access_token=<REDACTED>\n/,
    "the header is redacted too",
  );
  assert.match(text, /# \d+ older entries were dropped/);
  assert.match(
    text,
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z line 40499$/m,
    "entries carry a full UTC timestamp",
  );
  assert.doesNotMatch(text, /^\S+ line 0$/m, "the oldest entries are the ones dropped");
  assert.match(text, /chars not kept\)/, "one huge entry is cut");
  assert.ok(text.length < 8_500_000, "the whole export stays within the memory bound");
  clearLog();
  console.log(
    "  ✓ el búfer es circular (entradas y tamaño acotados) y la exportación lleva cabecera y hora completa",
  );
}

async function testDeepDebugTraceOfATurn() {
  initLogger({ appendLine: () => {} });
  clearLog();
  setDeepDebug(true);
  const server = await startMockServer("snapshot");
  const profile = makeProfile(server.port);
  let text = "";
  try {
    await streamCopilotTurn({
      profile,
      endpointBase: mockBase(server.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: (d) => (text += d) },
    });
    await new Promise((resolve) => setTimeout(resolve, 80)); // the socket's close event
  } finally {
    setDeepDebug(false);
    server.close();
  }
  assert.equal(text, "Hola, mundo");

  const trace = renderLogText("test");
  assert.match(
    trace,
    /\[ws#[0-9a-f]{8}\] turn start \(mode=tools, tone=magic, scenario=OfficeWebIncludedCopilot\)/,
  );
  assert.match(trace, /→ SignalR handshake \(\d+ chars\) \+\d+ms/);
  assert.match(trace, /← socket open/);
  assert.match(trace, /← upgrade 101/);
  assert.match(trace, /← frame #\d+ Invocation target=update message\(bot\/text 4 chars\)/);
  assert.match(trace, /← frame #\d+ Invocation target=update message\(bot\/EndOfRequest\)/);
  assert.match(trace, /→ chat invocation \+ metrics/);
  assert.match(trace, /turn ended: completed/);
  assert.match(trace, /← socket closed: code \d+/);
  // The request URL is traced, with the token hidden.
  assert.match(
    trace,
    /"endpoint": "ws:\/\/127\.0\.0\.1:\d+\/m365Copilot\/Chathub\/o@t\?access_token=<REDACTED>/,
  );
  assert.ok(!trace.includes(profile.accessToken), "the token reached the trace");
  assert.doesNotMatch(trace, /access_token=ey/);

  // Mode off: a whole turn leaves no deep trace at all.
  clearLog();
  const quiet = await startMockServer("snapshot");
  try {
    await streamCopilotTurn({
      profile: makeProfile(quiet.port),
      endpointBase: mockBase(quiet.port),
      prompt: "PROMPT",
      tone: null,
      signal: new AbortController().signal,
      callbacks: { onText: () => {} },
    });
  } finally {
    quiet.close();
  }
  assert.equal(logEntryCount(), 0, "with the mode off, the client (given no log) writes nothing");
  console.log(
    "  ✓ con el modo profundo, un turno deja su traza (URL, tramas, tiempos) sin el token; apagado no deja nada",
  );
}

async function main() {
  // The assertions below were written against the Spanish catalog (the
  // extension's original language); the i18n tests switch locale themselves
  // and put it back.
  setLocale("es");
  console.log("i18n");
  testI18nCatalogs();
  testI18nLayers();
  testManifestLocalization();
  testPromptsFollowLocale();
  console.log("profile.ts");
  testProfileParsing();
  console.log("markdown.ts");
  testMarkdownFormatting();
  console.log("toolProtocol.ts");
  testToolProtocol();
  testHostToolDecoding();
  console.log("toolCatalog.ts");
  testToolCatalog();
  testSpawnAgentsNeverTrimmed();
  testToolPromptRendering();
  console.log("transcript.ts / environment.ts");
  testTranscript();
  testEnvironment();
  testSkills();
  console.log("commitMessage.ts");
  testCommitMessageValidation();
  console.log("client.ts");
  await runRing("snapshot");
  await runRing("delta");
  await testCancellation();
  await test401FastFail();
  await testEndpointRotation();
  await testMultiMessageToolCall();
  await test429Retry();
  await testAuthErrorNotRetried();
  await testModelAvailability();
  testAccountLevelErrors();
  testThrottleState();
  await testTemporaryChat();
  await testCancelSendsStop();
  await testEarlyStopAfterToolCall();
  await testThrottledTurn();
  await testQuotaAndLicense();
  await testDisengaged();
  await testPaidScenario();
  await testImageUpload();
  await testWebSearchWithoutTemplate();
  testGiveUpDetection();
  testOutputLimitNotice();
  console.log("subagents.ts");
  await testConcurrencyLimiter();
  await testSubagentLoop();
  await testSubagentConversationIsolation();
  await testSubagentLoopStepLimit();
  await testSubagentLoopWallClock();
  testClipClosesDanglingFence();
  await testToolLoopStreamsProse();
  await testToolLoopStopsAfterCall();
  await testToolLoopForcedRetry();
  console.log("lineDiff.ts");
  testLineDiff();
  console.log("participant / editor");
  testParticipantPrompts();
  testCommitMessageGeneration();
  testCommitMessageNormalization();
  testCommitContext();
  testAutoCommitPrompt();
  await testAutoCommitGit();
  await testScmChanges();
  testInlineEdit();
  testTerminalPrompt();
  testClipboardDetection();
  testModelCatalog();
  testLegacyNames();
  testAccountOf();
  testReviewPrompt();
  testReviewFindings();
  testUnifiedDiff();
  testRagText();
  testRagCode();
  testRagSearch();
  await testRagRendering();
  testWebHelpers();
  await testWebTurn();
  await testInvocationLocale();
  console.log("logger / deep debug");
  testLoggerRedaction();
  testDeepDebugGate();
  testDebugDataFormatting();
  testLogBufferAndExport();
  await testDeepDebugTraceOfATurn();
  await testTurnSummary();
  setLocale("es");
  console.log("\nAll tests passed.");
}

main().catch((err) => {
  console.error("\nTEST FAILURE:", err);
  process.exit(1);
});

/**
 * Tool calls written as Markdown code blocks: the block's language is the tool
 * name, scalar arguments are `key: value` lines, one free-form argument is the
 * body, and an old/new pair is a SEARCH/REPLACE section. Nothing to escape.
 *
 * M365's chat models will not "call a tool", but they write a code block as a
 * reflex: the same setup scored 0/5 with JSON calls and ran real multi-turn loops
 * with blocks. Measured by github.com/cramt/m365-copilot-proxy (MIT, © 2026
 * Alexandra Østermark; packages/core/src/fenced.ts, docs/prompt-engineering.md).
 *
 * Kept free of the `vscode` import, like the rest of the protocol.
 */
import type { ToolParameter } from "./toolCatalog";

export interface FencedSpec {
  readonly name: string;
  readonly types: Readonly<Record<string, string>>;
  /** Arguments written as `key: value` lines. */
  readonly header: readonly string[];
  /** The free-form argument, written as the body of the block. */
  readonly body?: string;
  /** An old/new pair, written as a SEARCH/REPLACE section. */
  readonly editPair?: { readonly search: string; readonly replace: string };
  /** `m365_apply_edits`: `path:` lines with SEARCH/REPLACE sections or a whole new file. */
  readonly batchEdits?: boolean;
}

/** What the decoder needs from the catalog to read blocks. */
export interface FencedCalls {
  /** Every tool on offer, described in the prompt or not. */
  readonly specs: ReadonlyMap<string, FencedSpec>;
  /** Where a ```bash block goes: the model writes those as a reflex. */
  readonly shell?: FencedShell;
}

export interface FencedShell {
  readonly name: string;
  readonly commandParam: string;
  /** The tool's other required arguments, which a shell block cannot carry. */
  readonly defaults: Readonly<Record<string, unknown>>;
  /** Required text arguments: they get a short form of the command. */
  readonly describedBy: readonly string[];
}

/** Languages of a block that means "run this". */
const SHELL_LANGUAGES: ReadonlySet<string> = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "powershell",
  "pwsh",
  "ps1",
  "cmd",
  "bat",
  "batch",
]);

const BODY_NAMES = new Set([
  "command",
  "cmd",
  "script",
  "content",
  "contents",
  "code",
  "newcode",
  "body",
  "text",
  "input",
  "patch",
  "data",
]);
const SEARCH_NAMES = new Set(["old", "search", "find", "oldstr", "oldstring", "oldtext", "target"]);
const REPLACE_NAMES = new Set(["new", "replace", "replacement", "newstr", "newstring", "newtext"]);

const SEARCH_MARK = /^[ \t]*<{5,}[ \t]*SEARCH[ \t]*$/;
const DIVIDER_MARK = /^[ \t]*={5,}[ \t]*$/;
const REPLACE_MARK = /^[ \t]*>{5,}[ \t]*REPLACE[ \t]*$/;
const HEADER_LINE = /^[ \t]*([A-Za-z_][\w.-]*)[ \t]*:[ \t]?(.*)$/;
/** What a model used to native function calling sometimes ends a block with (Claude Opus). */
const NATIVE_CLOSER = /(?:\n<\/?(?:parameter|invoke|function_calls|antml:[a-z_]+)\b[^\n]*)+\s*$/;

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function deriveFencedSpec(name: string, parameters: readonly ToolParameter[]): FencedSpec {
  const types = Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.type]));
  const names = parameters.map((parameter) => parameter.name);
  const search = names.find((param) => SEARCH_NAMES.has(normalized(param)));
  const replace = names.find((param) => REPLACE_NAMES.has(normalized(param)));
  if (search && replace) {
    return {
      name,
      types,
      header: names.filter((param) => param !== search && param !== replace),
      editPair: { search, replace },
    };
  }
  const body = names.find(
    (param, _index, all) =>
      (BODY_NAMES.has(normalized(param)) && types[param] === "string") ||
      (all.length === 1 && types[param] === "string" && !/path|file|uri|dir/i.test(param)),
  );
  return { name, types, header: names.filter((param) => param !== body), body };
}

/** The tool a block in `language` runs, when it is a shell block and there is one. */
export function isShellLanguage(language: string): boolean {
  return SHELL_LANGUAGES.has(language.toLowerCase());
}

/** The arguments of a shell block: its text as the command, and the rest filled in. */
export function shellInput(shell: FencedShell, body: string): Record<string, unknown> | null {
  const command = stripNativeCloser(body).trim();
  if (!command) return null;
  const summary = command.split("\n", 1)[0]!.slice(0, 80);
  return {
    ...shell.defaults,
    ...Object.fromEntries(shell.describedBy.map((param) => [param, summary])),
    [shell.commandParam]: command,
  };
}

function stripNativeCloser(body: string): string {
  return body.replace(NATIVE_CLOSER, "");
}

/** The arguments in a block's body, or null when it does not hold a usable call. */
export function parseFencedBody(spec: FencedSpec, rawBody: string): Record<string, unknown> | null {
  const body = stripNativeCloser(rawBody);
  const asJson = jsonArguments(spec, body);
  if (asJson) return asJson;
  if (spec.batchEdits) return parseBatchEdits(body);

  const lines = body.split(/\r?\n/);
  const input: Record<string, unknown> = {};
  let index = 0;
  let headers = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      if (headers === 0) continue; // blank lines before anything
      index += 1;
      break;
    }
    if (SEARCH_MARK.test(line)) break;
    const header = HEADER_LINE.exec(line);
    const key = header?.[1];
    if (!header || !key || !(key in spec.types)) break;
    headers += 1;
    let value = header[2] ?? "";
    // A structured value may start on the next line.
    if (!value.trim() && /^(array|object)/.test(spec.types[key] ?? "")) {
      const block: string[] = [];
      while (index + 1 < lines.length && lines[index + 1]!.trim()) {
        index += 1;
        block.push(lines[index]!);
      }
      value = block.join("\n");
    }
    input[key] = coerce(value, spec.types[key]);
  }
  const rest = lines.slice(index).join("\n");

  if (spec.editPair) {
    if (spec.editPair.search in input && spec.editPair.replace in input) return input;
    const [section] = searchReplaceSections(rest.split("\n"));
    if (!section) return null;
    input[spec.editPair.search] = section.search;
    input[spec.editPair.replace] = section.replace;
    return input;
  }

  if (spec.body) {
    if (spec.body in input) return input;
    if (rest.trim()) input[spec.body] = rest.replace(/\s+$/, "");
    return input;
  }
  // The only argument, written bare instead of as `key: value`.
  const only = spec.header.length === 1 ? spec.header[0] : undefined;
  if (only && !(only in input) && rest.trim()) input[only] = coerce(rest.trim(), spec.types[only]);
  return input;
}

/**
 * The arguments as a JSON object, from a model used to native function calling.
 * Only if every key is an argument of the tool: a file's text can be JSON too.
 */
function jsonArguments(spec: FencedSpec, body: string): Record<string, unknown> | null {
  const text = body.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const known = (key: string) => key in spec.types || (spec.batchEdits && key === "edits");
    return parsed && typeof parsed === "object" && Object.keys(parsed).every(known) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Header values are text until the tool's schema says otherwise. A value that
 * does not parse stays as written: the tool then rejects it loudly and the model
 * can correct it, which beats acting on a plausible wrong value.
 */
function coerce(value: string, type: string | undefined): unknown {
  const text = value.trim();
  if (type === "boolean") {
    if (/^(true|yes|on)$/i.test(text)) return true;
    if (/^(false|no|off)$/i.test(text)) return false;
    return text;
  }
  if (type === "integer" || type === "number") {
    const number = Number(text);
    return text && Number.isFinite(number) ? number : text;
  }
  if (type?.startsWith("array") || type === "object") {
    try {
      const parsed: unknown = JSON.parse(text);
      if (type === "object" || Array.isArray(parsed)) return parsed;
    } catch {
      /* not JSON */
    }
    return type === "object" ? text : text ? [text] : [];
  }
  return text;
}

interface SearchReplace {
  readonly search: string;
  readonly replace: string;
}

function searchReplaceSections(lines: readonly string[]): SearchReplace[] {
  const sections: SearchReplace[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!SEARCH_MARK.test(lines[index]!.replace(/\r$/, ""))) {
      index += 1;
      continue;
    }
    const section = readSection(lines, index);
    if (!section) break;
    sections.push(section);
    index = section.end;
  }
  return sections;
}

function readSection(
  lines: readonly string[],
  start: number,
): (SearchReplace & { readonly end: number }) | null {
  const search: string[] = [];
  const replace: string[] = [];
  let target = search;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!.replace(/\r$/, "");
    if (target === search && DIVIDER_MARK.test(line)) {
      target = replace;
    } else if (target === replace && REPLACE_MARK.test(line)) {
      return { search: search.join("\n"), replace: replace.join("\n"), end: index + 1 };
    } else {
      target.push(line);
    }
  }
  return null;
}

/** `m365_apply_edits`: see {@link FencedSpec.batchEdits}. A new file's text runs to the end of the block. */
function parseBatchEdits(body: string): Record<string, unknown> | null {
  const lines = body.split(/\r?\n/);
  const edits: Record<string, unknown>[] = [];
  let path: string | undefined;
  let operation: string | undefined;
  let workspaceFolder: string | undefined;
  const edit = (fields: Record<string, unknown>) =>
    edits.push({ path, ...fields, ...(workspaceFolder ? { workspaceFolder } : {}) });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    if (SEARCH_MARK.test(line)) {
      if (!path) return null;
      const section = readSection(lines, index);
      if (!section) return null;
      edit({ operation: "replace", oldText: section.search, newText: section.replace });
      index = section.end - 1;
      continue;
    }
    const header = HEADER_LINE.exec(line);
    if (header?.[1] === "path") {
      path = (header[2] ?? "").trim();
      operation = undefined;
      continue;
    }
    if (header?.[1] === "operation") {
      operation = (header[2] ?? "").trim();
      if (operation === "delete" && path) edit({ operation });
      continue;
    }
    if (header?.[1] === "workspaceFolder") {
      workspaceFolder = (header[2] ?? "").trim();
      continue;
    }
    // Anything else is the text of a new file.
    if (!path) return null;
    edit({
      operation: "create",
      content: lines.slice(index).join("\n").replace(/\s+$/, "") + "\n",
    });
    break;
  }
  return edits.length > 0 ? { edits } : null;
}

// ----------------------------------------------------------------- rendering

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`{3,}/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** One call as a block: how the transcript shows the calls already made. */
export function renderFencedCall(spec: FencedSpec, input: Record<string, unknown>): string {
  const lines: string[] = [];
  if (spec.batchEdits && Array.isArray(input.edits)) {
    for (const raw of input.edits as Record<string, unknown>[]) {
      lines.push(`path: ${asText(raw.path)}`);
      if (raw.operation === "delete") lines.push("operation: delete");
      else if (raw.operation === "create") lines.push("", asText(raw.content));
      else lines.push(...searchReplaceLines(asText(raw.oldText), asText(raw.newText)));
    }
  } else {
    for (const key of spec.header) {
      if (input[key] !== undefined) lines.push(`${key}: ${asText(input[key])}`);
    }
    if (spec.editPair) {
      lines.push(
        ...searchReplaceLines(
          asText(input[spec.editPair.search]),
          asText(input[spec.editPair.replace]),
        ),
      );
    } else if (spec.body && input[spec.body] !== undefined) {
      if (lines.length > 0) lines.push("");
      lines.push(asText(input[spec.body]));
    }
  }
  const text = lines.join("\n");
  const fence = fenceFor(text);
  return `${fence}${spec.name}\n${text}\n${fence}`;
}

function searchReplaceLines(search: string, replace: string): string[] {
  return ["<<<<<<< SEARCH", search, "=======", replace, ">>>>>>> REPLACE"];
}

/** A block the model can fill in: the prompt's description of a tool's arguments. */
export function renderFencedTemplate(
  spec: FencedSpec,
  parameters: readonly ToolParameter[],
  optionalLabel: string,
): string {
  const placeholder = (name: string) => {
    const parameter = parameters.find((candidate) => candidate.name === name);
    const about = parameter?.enumValues.length
      ? parameter.enumValues.join("|")
      : parameter?.description || parameter?.type || name;
    return `<${about}${parameter?.required === false ? `, ${optionalLabel}` : ""}>`;
  };
  const lines = spec.header.map((name) => `${name}: ${placeholder(name)}`);
  if (spec.editPair) {
    lines.push(
      ...searchReplaceLines(placeholder(spec.editPair.search), placeholder(spec.editPair.replace)),
    );
  } else if (spec.body) {
    if (lines.length > 0) lines.push("");
    lines.push(placeholder(spec.body));
  }
  return `\`\`\`${spec.name}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}\`\`\``;
}

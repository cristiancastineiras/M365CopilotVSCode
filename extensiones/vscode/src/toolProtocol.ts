/**
 * Protocolo de llamada a herramientas sobre texto plano.
 *
 * BizChat no expone function-calling nativo, así que las herramientas se
 * describen en el prompt y el modelo las invoca escribiendo un marcador. Lo
 * importante es QUÉ herramientas se describen: no sólo las nuestras, sino todas
 * las que VS Code ofrece en el turno (nativas del editor, del modo agente, de
 * servidores MCP y de otras extensiones), que llegan en `options.tools` y se
 * normalizan en {@link ./toolCatalog}. Cuando el modelo emite el marcador con
 * el nombre de una de ellas, `provider.ts` reporta un
 * `LanguageModelToolCallPart` y es VS Code quien la ejecuta — igual que con un
 * modelo con function-calling nativo.
 */
import {
	M365_TOOL_NAMES,
	type CatalogEntry,
	type ToolCatalog,
	type ToolParameter,
} from './toolCatalog';
import { t } from './i18n';

export {
	M365_TOOL_NAMES,
	M365_WORKSPACE_TOOL_NAMES,
	buildToolCatalog,
	isM365Tool,
	type M365ToolName,
	type ToolCatalog,
	type OfferedTool,
	type DuplicatePolicy,
} from './toolCatalog';

const TOOL_CALL_OPEN = '<ms365_tool_call>';
const TOOL_CALL_CLOSE = '</ms365_tool_call>';
const MAX_TOOL_CALL_CHARS = 60_000;

/**
 * Opening marker, tolerant of the ways non-GPT rings mangle it: a stray extra
 * `<` (`<<ms365_tool_call>`) and incidental spaces around the tag name. The
 * closing marker is treated as OPTIONAL — Claude and the reasoning ring often
 * emit the JSON and stop without it, so we detect the end of the call by
 * balancing the JSON braces instead of requiring `</ms365_tool_call>`.
 */
const TOOL_CALL_OPEN_RE = /<{1,3}[ \t]*ms365_tool_call[ \t]*>/i;

/** Whitespace and an optional opening code fence between the marker and the JSON. */
const JSON_LEADING_RE = /^\s*(?:(?:`{3,}|~{3,})[A-Za-z0-9_-]*[ \t]*\r?\n\s*)?/;

/**
 * Cualquier campo de texto de cualquier herramienta puede llegar como este
 * marcador en vez de como literal JSON, con el texto real en un
 * `<ms365_block>` posterior. Existe porque pedirle a un modelo de chat (BizChat
 * no es un tool-caller nativo) que escape código arbitrario dentro de una
 * cadena JSON es frágil: una sola `"` sin escapar dentro del código desincroniza
 * el balanceador de llaves de abajo y corrompe la llamada entera — observado en
 * la práctica con código que contiene comillas dobles normales. Los bloques
 * crudos no necesitan escapado: su final se localiza buscando literalmente la
 * etiqueta de cierre, así que comillas, backslashes y llaves dentro del código
 * no pueden romper nada.
 *
 * Es OBLIGATORIO en `ms365_apply_edits` y recomendado para las herramientas de
 * edición nativas de VS Code, que tienen exactamente el mismo problema.
 */
const BLOCK_REF_RE = /@@block:([A-Za-z0-9_-]{1,64})@@/g;
const BLOCK_OPEN_RE = /<ms365_block[ \t]+id=["']?([A-Za-z0-9_-]+)["']?[ \t]*>/i;
const BLOCK_CLOSE_RE = /<\/ms365_block[ \t]*>/i;
const BLOCK_CLOSE_LITERAL = '</ms365_block>';
/** Generous cap on a single block's raw text while still streaming in. */
const MAX_BLOCK_CHARS = 600_000;

/** Profundidad y nodos máximos al recorrer el `input` buscando bloques. */
const MAX_INPUT_DEPTH = 8;
const MAX_INPUT_NODES = 5_000;

export interface DecodedToolCall {
	/** Nombre exacto tal y como lo ofreció el host (nuestro o nativo). */
	readonly name: string;
	readonly input: Record<string, unknown>;
}

// ------------------------------------------------------------------ prompt

export function buildToolProtocolInstructions(catalog: ToolCatalog): string {
	if (catalog.entries.length === 0) return '';

	const descriptions = catalog.entries.map(renderCatalogEntry).join('\n');
	const hasMs365Edits = catalog.entries.some(
		(entry) => entry.name === M365_TOOL_NAMES.applyWorkspaceEdits,
	);
	const hasDiagnostics = catalog.entries.some((entry) => entry.capability === 'diagnostics');
	const hasEditors = catalog.entries.filter((entry) => entry.capability === 'edit');
	const hasEditorTools = catalog.entries.some((entry) => entry.origin === 'editor');
	const hasSpawnAgents = catalog.entries.some((entry) => entry.name === M365_TOOL_NAMES.spawnAgents);
	const hasGitCommit = catalog.entries.some((entry) => entry.name === M365_TOOL_NAMES.gitCommit);

	const rules = [
		t('protocol.rule.oneCall'),
		t('protocol.rule.marker'),
		t('protocol.rule.params'),
		t('protocol.rule.readFirst'),
		...(hasSpawnAgents ? [t('protocol.rule.spawn', M365_TOOL_NAMES.spawnAgents)] : []),
		...(hasGitCommit
			? [t('protocol.rule.commit', M365_TOOL_NAMES.gitCommit, M365_TOOL_NAMES.generateCommitMessage)]
			: []),
		...(hasEditors.length > 1 ? [t('protocol.rule.sameEditor', hasEditors[0].name)] : []),
		...(hasMs365Edits
			? [t('protocol.rule.editFields', M365_TOOL_NAMES.applyWorkspaceEdits), t('protocol.rule.batches')]
			: []),
		...(catalog.hasEditTools && hasDiagnostics ? [t('protocol.rule.diagnostics')] : []),
		...(hasEditorTools ? [t('protocol.rule.native')] : []),
		t('protocol.rule.errors'),
		t('protocol.rule.answer'),
		t('protocol.rule.proseIsNotAction'),
		t('protocol.rule.noFakeCompletion'),
		t('protocol.rule.noSilentOptional'),
	].join('\n');

	// A concrete worked example outperforms an abstract rule for models that
	// otherwise default to answering entirely in prose (observed with the
	// Claude and reasoning tones) — showing the exact shape they must imitate
	// is far more reliable than only describing it.
	const example = workedExample(catalog.entries);
	const worked = example
		? [
				t('protocol.example.header'),
				t('protocol.example.user'),
				`${t('protocol.example.assistant')}\n${TOOL_CALL_OPEN}${JSON.stringify(example)}${TOOL_CALL_CLOSE}`,
			].join('\n')
		: '';

	// Dedicated, very explicit walkthrough for the block format: the failure
	// mode it prevents (unescaped quotes inside a JSON string) is by far the
	// most common one, and it hits any tool whose input carries source code —
	// la nuestra y las de edición nativas por igual. The example deliberately
	// embeds a literal double-quote to make "no need to escape anything here"
	// concrete instead of abstract.
	const blockExample = renderBlockExample(catalog.entries);
	const blocksSection = catalog.hasEditTools
		? [
				t('protocol.blocks.header'),
				t('protocol.blocks.body', TOOL_CALL_CLOSE),
				...(hasMs365Edits ? [t('protocol.blocks.mandatory', M365_TOOL_NAMES.applyWorkspaceEdits)] : []),
				...(blockExample ? [t('protocol.blocks.example'), blockExample] : []),
			].join('\n')
		: '';

	return [
		// Some rings (notably the GPT chat tone) default to answering "no puedo
		// acceder a tus archivos" and never emit the marker at all, because a
		// capability asserted in prose is not the native function-calling they
		// are used to. Stating up front that this is real, wired-up execution —
		// and naming the refusal so it can be recognized and skipped — gets far
		// better compliance than only describing the format.
		t('protocol.important'),
		t('protocol.untrusted'),
		t('protocol.howTo'),
		`${TOOL_CALL_OPEN}{"name":"${t('protocol.namePlaceholder')}","input":{ ... }}${TOOL_CALL_CLOSE}`,
		blocksSection,
		worked,
		`${t('protocol.rulesHeader')}\n${rules}`,
		`${t('protocol.toolsHeader')}\n${descriptions}`,
	]
		.filter(Boolean)
		.join('\n\n');
}

/**
 * Ejemplo del formato de bloques con una herramienta que existe de verdad y con
 * SU forma de entrada. Un ejemplo con el nombre de una herramienta y los campos
 * de otra enseña una llamada que fallaría, así que cuando la de edición es
 * nativa el ejemplo se sintetiza a partir de sus propios parámetros.
 */
function renderBlockExample(entries: readonly CatalogEntry[]): string | null {
	const ours = entries.find((entry) => entry.name === M365_TOOL_NAMES.applyWorkspaceEdits);
	if (ours) {
		const input = {
			edits: [
				{ operation: 'replace', path: t('protocol.blockExample.path'), oldText: '@@block:1@@', newText: '@@block:2@@' },
			],
		};
		return (
			`${TOOL_CALL_OPEN}${JSON.stringify({ name: M365_TOOL_NAMES.applyWorkspaceEdits, input })}${TOOL_CALL_CLOSE}\n` +
			`<ms365_block id="1">\n${t('protocol.blockExample.before')}\n</ms365_block>\n` +
			`<ms365_block id="2">\n${t('protocol.blockExample.after')}\n</ms365_block>`
		);
	}

	const editor =
		entries.find((entry) => entry.capability === 'edit') ??
		entries.find((entry) => entry.capability === 'create');
	if (!editor) return null;

	const input: Record<string, unknown> = {};
	const blocks: string[] = [];
	for (const parameter of editor.parameters) {
		if (!parameter.required) continue;
		const isFreeText = parameter.type === 'string' && !/path|file|uri|name/i.test(parameter.name);
		if (!isFreeText) {
			input[parameter.name] = placeholderFor(parameter);
			continue;
		}
		const id = blocks.length + 1;
		input[parameter.name] = `@@block:${id}@@`;
		const sample = t(id > 1 ? 'protocol.blockExample.after' : 'protocol.blockExample.before');
		blocks.push(`<ms365_block id="${id}">\n${sample}\n</ms365_block>`);
	}
	if (blocks.length === 0) return null;

	return `${TOOL_CALL_OPEN}${JSON.stringify({ name: editor.name, input })}${TOOL_CALL_CLOSE}\n${blocks.join('\n')}`;
}

/** Una entrada del catálogo, en el formato compacto que ve el modelo. */
function renderCatalogEntry(entry: CatalogEntry): string {
	const origin = t(entry.origin === 'ms365' ? 'protocol.origin.ms365' : 'protocol.origin.editor');
	const lines = [`- ${entry.name} (${origin}): ${entry.description || t('protocol.noDescription')}`];

	if (entry.parameters.length > 0) {
		lines.push(t('protocol.entry.input', entry.parameters.map(renderParameter).join('; ')));
	}
	if (entry.example) {
		lines.push(t('protocol.entry.example', JSON.stringify(entry.example)));
	}
	if (entry.preferInstead) {
		lines.push(t('protocol.entry.duplicate', entry.preferInstead));
	}
	return lines.join('\n');
}

function renderParameter(parameter: ToolParameter): string {
	const values = parameter.enumValues.length > 0 ? ` [${parameter.enumValues.join('|')}]` : '';
	const description = parameter.description ? ` — ${parameter.description}` : '';
	return `${parameter.name}${parameter.required ? '*' : ''}: ${parameter.type}${values}${description}`;
}

/**
 * Un ejemplo de llamada real con una herramienta que de verdad está disponible.
 * Se prefiere una de lectura (inofensiva y con entrada evidente); si sólo hay
 * herramientas nativas, se sintetiza a partir de sus parámetros obligatorios,
 * porque lo que enseña el ejemplo es el FORMATO, no el contenido.
 */
function workedExample(entries: readonly CatalogEntry[]): { name: string; input: unknown } | null {
	const preferred =
		entries.find((entry) => entry.capability === 'read' && entry.example) ??
		entries.find((entry) => entry.example) ??
		entries.find((entry) => entry.capability === 'read') ??
		entries[0];
	if (!preferred) return null;
	return { name: preferred.name, input: preferred.example ?? synthesizeInput(preferred) };
}

function synthesizeInput(entry: CatalogEntry): Record<string, unknown> {
	const input: Record<string, unknown> = {};
	for (const parameter of entry.parameters) {
		if (!parameter.required) continue;
		input[parameter.name] = placeholderFor(parameter);
	}
	return input;
}

function placeholderFor(parameter: ToolParameter): unknown {
	if (parameter.enumValues.length > 0) return parameter.enumValues[0];
	if (parameter.type.startsWith('array')) return [];
	switch (parameter.type) {
		case 'integer':
		case 'number':
			return 1;
		case 'boolean':
			return true;
		case 'object':
			return {};
		default:
			if (!/path|file|uri/i.test(parameter.name)) return '…';
			// Una ruta relativa en el ejemplo de una herramienta que pide rutas
			// absolutas contradice la regla que acaba de leer.
			return /absolut/i.test(parameter.description) ? '/workspace/src/extension.ts' : 'src/extension.ts';
	}
}

/**
 * A short, high-salience reminder meant for the END of the prompt (right
 * before the model answers) — recency beats a rule stated far above a long
 * transcript, which is exactly where models that default to prose-only
 * answers (Claude, the reasoning tone) tend to drop it.
 */
export function buildToolProtocolReminder(catalog: ToolCatalog, toolsRequired = false): string {
	if (catalog.entries.length === 0) return '';
	const hasMs365Edits = catalog.entries.some(
		(entry) => entry.name === M365_TOOL_NAMES.applyWorkspaceEdits,
	);
	const bareShape = `${TOOL_CALL_OPEN}{"name":"...","input":{...}}${TOOL_CALL_CLOSE}`;
	const shape = catalog.hasEditTools ? t('protocol.reminder.shapeWithBlocks', bareShape) : bareShape;
	return (
		t('protocol.reminder.start', shape) +
		(hasMs365Edits ? t('protocol.reminder.blocks', M365_TOOL_NAMES.applyWorkspaceEdits) : '') +
		t(toolsRequired ? 'protocol.reminder.required' : 'protocol.reminder.optional') +
		t('protocol.reminder.end')
	);
}

/**
 * Streaming decoder that splits a plain-text model reply into user-visible text
 * and tool calls. BizChat is a chat model, not a native tool-caller, so the
 * "tool call" is just the marker `<ms365_tool_call>{json}</ms365_tool_call>`
 * that we asked it to emit, optionally followed by `<ms365_block>` sections
 * for `ms365_apply_edits` (see the module docs above `BLOCK_REF_RE`). The
 * decoder is deliberately forgiving because each ring formats it differently:
 *
 *  - the marker can appear anywhere, not only at the very start (models like to
 *    say "I'll read the file first" before calling a tool);
 *  - a code fence the model may wrap the marker in is stripped;
 *  - the opening marker tolerates a stray extra `<` and spaces;
 *  - the CLOSING marker is optional — the end of the call is found by balancing
 *    the JSON braces, so Claude/reasoning replies that omit `</ms365_tool_call>`
 *    still execute instead of leaking the raw marker into the chat;
 *  - if a fresh `<ms365_tool_call>` appears again before the previous one
 *    finished, the earlier (abandoned) attempt is dropped silently and only
 *    the later one is parsed — observed in practice: BizChat occasionally
 *    restarts a message mid-call, and blindly concatenating the restart onto
 *    the abandoned attempt corrupts the JSON;
 *  - the first valid call ends decoding for the turn (VS Code re-invokes us with
 *    the tool result), and any trailing prose is dropped so it can't leak as a
 *    second, contradictory answer.
 */
export class ToolCallDecoder {
	private mode: 'scan' | 'collecting-blocks' | 'passthrough' | 'done';
	private buffer = '';
	private readonly allowedNames: ReadonlySet<string>;
	private readonly onText: (text: string) => void;
	private readonly onToolCall: (call: DecodedToolCall) => void;

	// State while collecting <ms365_block> sections for a call whose text
	// fields were "@@block:ID@@" placeholders (ms365_apply_edits).
	private pendingCall: DecodedToolCall | null = null;
	private neededBlockIds = new Set<string>();
	private collectedBlocks = new Map<string, string>();
	private currentBlockId: string | null = null;
	private blockBuffer = '';

	constructor(
		allowedNames: ReadonlySet<string>,
		onText: (text: string) => void,
		onToolCall: (call: DecodedToolCall) => void,
	) {
		this.allowedNames = allowedNames;
		this.onText = onText;
		this.onToolCall = onToolCall;
		this.mode = allowedNames.size === 0 ? 'passthrough' : 'scan';
	}

	push(delta: string): void {
		if (!delta) return;
		if (this.mode === 'passthrough') {
			this.onText(delta);
			return;
		}
		if (this.mode === 'done') return;
		this.buffer += delta;
		this.drain();
	}

	finish(): void {
		if (this.mode === 'scan' && this.buffer) {
			// We were mid tool-call but the JSON never completed. Drop the marker
			// and its partial JSON instead of leaking it into the chat; keep only
			// any prose that preceded it (normally none — drain already flushed it).
			const open = findOpenMarker(this.buffer);
			if (open) {
				const preamble = stripTrailingOpenFence(this.buffer.slice(0, open.index));
				if (preamble) this.onText(preamble);
			} else {
				this.onText(stripTrailingPartialOpen(this.buffer));
			}
		}
		// A call whose <ms365_block> sections never fully arrived. The marker,
		// JSON and half-written blocks must not leak into the chat, but dropping
		// everything silently leaves the turn blank and the user with no idea
		// why nothing happened — so say it in one line instead.
		if (this.mode === 'collecting-blocks' && this.pendingCall) {
			this.onText(this.incompleteCallNotice(this.pendingCall.name));
		}
		this.buffer = '';
		this.blockBuffer = '';
		this.pendingCall = null;
		this.neededBlockIds.clear();
		this.collectedBlocks.clear();
		this.currentBlockId = null;
		if (this.mode === 'scan' || this.mode === 'collecting-blocks') this.mode = 'passthrough';
	}

	private drain(): void {
		for (;;) {
			if (this.mode === 'scan') {
				if (!this.drainScan()) return;
				continue;
			}
			if (this.mode === 'collecting-blocks') {
				if (!this.drainBlocks()) return;
				continue;
			}
			return;
		}
	}

	/** One scanning step. Returns true to keep looping now, false to wait for more data. */
	private drainScan(): boolean {
		if (!this.buffer) return false;

		const open = findOpenMarker(this.buffer);
		if (!open) {
			// No opening marker yet: emit everything except a trailing fragment
			// that could still grow into a marker on the next chunk — a partial
			// marker prefix, or an opening code fence the model might wrap the
			// marker in. Held text is never dropped, only deferred to finish().
			const hold = holdBackLength(this.buffer);
			const safe = this.buffer.length - hold;
			if (safe > 0) {
				this.onText(this.buffer.slice(0, safe));
				this.buffer = this.buffer.slice(safe);
				return true;
			}
			return false;
		}

		if (open.index > 0) {
			const preamble = stripTrailingOpenFence(this.buffer.slice(0, open.index));
			if (preamble) this.onText(preamble);
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
		if (start.kind === 'wait') {
			this.spillIfRunaway();
			return false; // JSON hasn't started yet; wait for more text
		}
		if (start.kind === 'reject') {
			// A literal marker in prose, not an actual call (no JSON follows it).
			// Surface it verbatim and keep scanning the rest of the stream.
			this.onText(this.buffer.slice(0, afterOpen));
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
		this.onText(rawSpan);
		return true;
	}

	/** A JSON call was parsed. Fire it immediately, or start collecting its raw blocks. */
	private beginCall(call: DecodedToolCall): void {
		const needed = collectBlockRefs(call);
		if (needed.length === 0) {
			this.mode = 'done';
			this.buffer = '';
			this.onToolCall(call);
			return;
		}
		this.pendingCall = call;
		this.neededBlockIds = new Set(needed);
		this.collectedBlocks = new Map();
		this.currentBlockId = null;
		this.blockBuffer = '';
		this.mode = 'collecting-blocks';
	}

	/** One block-collecting step. Returns true to keep looping now, false to wait for more data. */
	private drainBlocks(): boolean {
		if (this.currentBlockId === null) {
			const open = findBlockOpen(this.buffer);
			if (!open) {
				// Boilerplate/whitespace between blocks — never shown to the user.
				// Hold back from the last unmatched `<` onward: it could be the
				// start of the next `<ms365_block …>` still streaming in.
				const lastLt = this.buffer.lastIndexOf('<');
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
		this.blockBuffer = '';

		if (this.neededBlockIds.size === 0 && this.pendingCall) {
			const call = this.pendingCall;
			substituteBlockRefs(call, this.collectedBlocks);
			this.pendingCall = null;
			this.mode = 'done';
			this.buffer = '';
			this.onToolCall(call);
			return false;
		}
		return true;
	}

	/** Give up if the blocks never close, so a huge/garbled stream can't get stuck. */
	private spillBlocksIfRunaway(): boolean {
		if (this.blockBuffer.length + this.buffer.length <= MAX_BLOCK_CHARS) return false;
		if (this.pendingCall) this.onText(this.incompleteCallNotice(this.pendingCall.name));
		this.mode = 'passthrough';
		this.buffer = '';
		this.blockBuffer = '';
		this.pendingCall = null;
		this.neededBlockIds.clear();
		this.collectedBlocks.clear();
		this.currentBlockId = null;
		return false;
	}

	private incompleteCallNotice(name: string): string {
		return t('protocol.incompleteCall', name);
	}

	/** Give up buffering if a marker never closes, so a huge stream can't get stuck. */
	private spillIfRunaway(): void {
		if (this.buffer.length > MAX_TOOL_CALL_CHARS) {
			this.onText(this.buffer);
			this.buffer = '';
			this.mode = 'passthrough';
		}
	}
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
		(value): value is string => typeof value === 'string' && value.trim().length > 0,
	);
	if (!rawName) return null;
	const name = resolveToolName(rawName, allowed);
	if (!name) return null;

	const input = resolveInput(record);
	return input ? { name, input } : null;
}

const NAME_KEYS = ['name', 'tool', 'tool_name', 'toolName', 'function'] as const;
const INPUT_KEYS = ['input', 'arguments', 'args', 'parameters', 'params', 'tool_input', 'toolInput'] as const;

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
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
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
		if (typeof value === 'string') {
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
		for (const match of text.matchAll(BLOCK_REF_RE)) ids.add(match[1]);
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
 * herramienta, no sólo para `ms365_apply_edits`, y las de edición nativas de
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
				if (typeof item === 'string') {
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
			if (typeof item === 'string') {
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

/** Locate a `<ms365_block id="...">` opening tag. */
function findBlockOpen(buffer: string): { index: number; length: number; id: string } | null {
	const match = BLOCK_OPEN_RE.exec(buffer);
	return match ? { index: match.index, length: match[0].length, id: match[1] } : null;
}

/** Strip exactly one newline immediately inside each edge, if present — lets the
 * model put a block's content on its own line(s) without that formatting
 * becoming part of the captured text. */
function stripOneEdgeNewline(text: string): string {
	let out = text;
	if (out.startsWith('\r\n')) out = out.slice(2);
	else if (out.startsWith('\n')) out = out.slice(1);
	if (out.endsWith('\r\n')) out = out.slice(0, -2);
	else if (out.endsWith('\n')) out = out.slice(0, -1);
	return out;
}

type JsonStart = { kind: 'found'; index: number } | { kind: 'wait' } | { kind: 'reject' };

/**
 * Find where the tool-call JSON begins after an opening marker. Only whitespace
 * and an optional opening code fence may sit between the marker and the `{`, so
 * a marker the model merely mentioned in prose (followed by words, not JSON) is
 * rejected instead of swallowing unrelated text.
 */
function locateJsonStart(buffer: string, afterOpen: number): JsonStart {
	const lead = JSON_LEADING_RE.exec(buffer.slice(afterOpen));
	const index = afterOpen + (lead ? lead[0].length : 0);
	if (index >= buffer.length) return { kind: 'wait' }; // only whitespace/fence so far
	return buffer[index] === '{' ? { kind: 'found', index } : { kind: 'reject' };
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
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === '{') depth += 1;
		else if (ch === '}' && (depth -= 1) === 0) return i + 1;
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
		const fenceStart = fence.index + (fence[0].startsWith('\n') ? 1 : 0);
		hold = Math.max(hold, buffer.length - fenceStart);
	}
	return hold;
}

/** Drop a trailing opening code fence (```json etc.) the model wrapped the call in. */
function stripTrailingOpenFence(text: string): string {
	return text.replace(/\r?\n?[ \t]*(?:`{3,}|~{3,})[A-Za-z0-9_-]*[ \t]*\r?\n?$/, '');
}

/** Drop a trailing partial opening marker so a half-written marker never leaks. */
function stripTrailingPartialOpen(text: string): string {
	const n = partialOpenSuffixLength(text);
	return n > 0 ? text.slice(0, text.length - n) : text;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

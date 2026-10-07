/**
 * Runtime smoke tests — no VS Code host required.
 *  - profile.ts: parse a bare JWT and a full JSON profile.
 *  - client.ts:  run streamCopilotTurn against a mock SignalR server that
 *                speaks the real BizChat handshake + frame protocol, in both
 *                snapshot mode and delta mode.
 *
 * Run: node --experimental-strip-types test/e2e.mts
 */
import { WebSocketServer } from 'ws';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
	streamCopilotTurn,
	streamCopilotTurnWithRetry,
	CopilotAuthError,
	buildWebInvocationArgs,
	capturedVariants,
	sourcesOf,
} from '../src/client.ts';
import { buildWebSearchPrompt, formatWebResult, sourcesMarkdown } from '../src/webSearchPrompt.ts';
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
} from '../src/rag/text.ts';
import { chunkLines, extractImports, extractSymbols, languageOf } from '../src/rag/code.ts';
import { analyzeFile, bestWindow, SearchIndex } from '../src/rag/searchIndex.ts';
import { formatAutoContext, formatSearchResults, renderFileDetail, renderFolderDetail, renderHits, renderProjectMap, renderSummary } from '../src/rag/projectMap.ts';

import { MarkdownStreamFormatter } from '../src/markdown.ts';
import { accountOf, looksLikeProfile, parsePastedProfile } from '../src/profile.ts';
import { LEGACY_EXTENSION_ID, legacySettingKey, migrateLegacyValue, shouldMigrate } from '../src/legacy.ts';
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
} from '../src/reviewPrompt.ts';
import { buildInlineEditPrompt, extractEditedCode, reindent } from '../src/inlineEditPrompt.ts';
import {
	M365_TOOL_NAMES,
	ToolCallDecoder,
	buildToolCatalog,
	buildToolProtocolInstructions,
	type OfferedTool,
	type ToolCatalog,
} from '../src/toolProtocol.ts';
import { ConcurrencyLimiter, clip, runSubagentTask, runToolLoop } from '../src/subagentCore.ts';
import { replaceTextOnce } from '../tools/replaceText.ts';
import {
	buildCommitMessagePrompt,
	cleanGeneratedCommitMessage,
	validateConventionalCommitMessage,
} from '../tools/commitMessage.ts';
import { LOCALES, messageKeys, placeholdersOf, resolveLocale, setLocale, t, tIn } from '../src/i18n.ts';
import {
	asParticipantCommand,
	buildParticipantFraming,
	fenceFor,
	maxStepsForCommand,
	toolsForCommand,
} from '../src/participantPrompts.ts';
import { readFileSync } from 'node:fs';
import {
	BUILTIN_MODELS,
	mergeModels,
	modelIdForTone,
	parseCustomModels,
	parseModelCatalog,
	prettyTone,
	unannounced,
} from '../src/modelCatalog.ts';
import { acceptHunk, diffLines, revertHunkEdit, splitLines, type Hunk, type LineEdit } from '../tools/lineDiff.ts';
import type { CopilotProfile } from '../src/profile.ts';

const RS = String.fromCharCode(0x1e);
const b64url = (o: unknown) =>
	Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeJwt(extra: Record<string, unknown> = {}): string {
	const payload = {
		aud: 'https://substrate.office.com/sydney',
		oid: 'user-oid',
		tid: 'tenant-tid',
		upn: 'someone@contoso.com',
		exp: Math.floor(Date.now() / 1000) + 3600,
		...extra,
	};
	return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

// ---- profile.ts ------------------------------------------------------------

function testProfileParsing() {
	const bare = parsePastedProfile(fakeJwt());
	assert.equal(bare.claims?.upn, 'someone@contoso.com');
	assert.equal(bare.claims?.oid, 'user-oid');
	assert.equal(bare.invocationType, 4);

	const full = parsePastedProfile(
		JSON.stringify({
			accessToken: fakeJwt(),
			endpoint: 'wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=old&source=officeweb',
			invocationTemplate: { tone: 'magic', message: { author: 'user' } },
			invocationType: 4,
			origin: 'https://m365.cloud.microsoft',
		}),
	);
	assert.equal(full.endpoint?.includes('Chathub'), true);
	assert.equal((full.invocationTemplate as Record<string, unknown>).tone, 'magic');

	assert.throws(() => parsePastedProfile('not a token'));
	console.log('  ✓ profile parsing (bare JWT, full JSON, rejects garbage)');
}

// ---- markdown.ts ----------------------------------------------------------

function formatMarkdown(...chunks: string[]): string {
	const formatter = new MarkdownStreamFormatter();
	return chunks.map((chunk) => formatter.push(chunk)).join('') + formatter.finish();
}

function testMarkdownFormatting() {
	// The model is asked to fence its own code. When it complies, its fences
	// pass through completely untouched (never re-wrapped, never double-fenced).
	assert.equal(
		formatMarkdown('```ts\nconst value = 1;\n```\n'),
		'```ts\nconst value = 1;\n```\n',
	);
	// CRLF is normalised to LF so streamed fences stay intact.
	assert.equal(formatMarkdown('a\r\nb\r\n'), 'a\nb\n');

	// Plain prose, even multi-line, is never mistaken for code.
	assert.equal(
		formatMarkdown('Esto aplica el cambio propuesto.\nRevisa el resultado antes de continuar.\n'),
		'Esto aplica el cambio propuesto.\nRevisa el resultado antes de continuar.\n',
	);
	// Lists and headings are never mistaken for code either, despite short,
	// punctuation-heavy lines.
	assert.equal(
		formatMarkdown('## Pasos\n\n- Abre el archivo\n- Guarda los cambios\n- Ejecuta las pruebas\n'),
		'## Pasos\n\n- Abre el archivo\n- Guarda los cambios\n- Ejecuta las pruebas\n',
	);

	// SAFETY NET: a ring that ignores the "always fence code" instruction and
	// answers in unfenced multi-line code (observed on the GPT and reasoning
	// tones) gets auto-fenced, because Markdown otherwise collapses each line
	// break into a space and the code renders as one broken run-on line.
	assert.equal(
		formatMarkdown(
			'Aplica estas ediciones:\n\n',
			'const edit = new vscode.WorkspaceEdit();\n',
			'vscode.workspace.applyEdit(edit);\n',
		),
		'Aplica estas ediciones:\n\n```\nconst edit = new vscode.WorkspaceEdit();\nvscode.workspace.applyEdit(edit);\n```\n',
	);

	// The blank line separating two paragraphs can itself arrive split across
	// two deltas (one push ending in a single \n, the next starting with the
	// second \n) — the boundary must still resolve without waiting for finish().
	assert.equal(
		formatMarkdown('function f() {\n  return 1;\n}\n', '\nMás detalles arriba.\n'),
		'```\nfunction f() {\n  return 1;\n}\n```\n\nMás detalles arriba.\n',
	);

	// A single unfenced code-like line is left alone — one line renders fine
	// inline, nothing collapses, so wrapping it would just be noise.
	assert.equal(formatMarkdown('const x = 1;\n'), 'const x = 1;\n');

	// Mixed prose + unfenced code + more prose: only the code paragraph is
	// wrapped, each part streamed independently and in order.
	assert.equal(
		formatMarkdown(
			'Primero define la función:\n\n' +
				'function suma(a, b) {\n  return a + b;\n}\n\n' +
				'Luego llámala con dos números.\n',
		),
		'Primero define la función:\n\n' +
			'```\nfunction suma(a, b) {\n  return a + b;\n}\n```\n\n' +
			'Luego llámala con dos números.\n',
	);

	// An unfenced code paragraph split across arbitrary chunk boundaries (mid
	// line, mid keyword) still resolves to one correctly fenced block — the
	// decision is only ever made once the whole paragraph has arrived.
	assert.equal(
		formatMarkdown('func', 'tion f() {\n', '  return 1;\n', '}', '\n'),
		'```\nfunction f() {\n  return 1;\n}\n```\n',
	);

	// A fence opened but never closed by the time the stream ends is passed
	// through as-is at finish() — we never guess at unterminated fences.
	assert.equal(formatMarkdown('```ts\nconst x = 1;\n'), '```ts\nconst x = 1;\n');

	console.log('  ✓ markdown formatter fences unfenced code, leaves prose/lists/existing fences untouched');
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
		{ name: M365_TOOL_NAMES.readFile, input: { path: 'src/extension.ts', startLine: 1 } },
	]);
	assert.deepEqual(text, []);

	const prose: string[] = [];
	const proseDecoder = new ToolCallDecoder(
		new Set([M365_TOOL_NAMES.readFile]),
		(chunk) => prose.push(chunk),
		() => assert.fail('No debe llamar una herramienta para texto normal.'),
	);
	proseDecoder.push('Explico el cambio antes de proponerlo.');
	proseDecoder.finish();
	assert.deepEqual(prose, ['Explico el cambio antes de proponerlo.']);

	// A short preamble before the marker must NOT hide the tool call, and any
	// prose after the call is dropped (the model was told to stop).
	const pre = { text: [] as string[], calls: [] as unknown[] };
	const preDecoder = new ToolCallDecoder(
		new Set([M365_TOOL_NAMES.readFile]),
		(chunk) => pre.text.push(chunk),
		(call) => pre.calls.push(call),
	);
	preDecoder.push('Voy a leer el archivo primero.\n');
	preDecoder.push(`<m365_tool_call>{"name":"${M365_TOOL_NAMES.readFile}","input":{"path":"a.ts"}}</m365_tool_call>`);
	preDecoder.push('texto que se descarta tras la llamada');
	preDecoder.finish();
	assert.deepEqual(pre.calls, [{ name: M365_TOOL_NAMES.readFile, input: { path: 'a.ts' } }]);
	assert.equal(pre.text.join(''), 'Voy a leer el archivo primero.\n');

	// A marker the model wrapped in a ```json fence, split across chunks, is
	// still decoded cleanly and the fence never leaks as text.
	const fenced = { text: [] as string[], calls: [] as unknown[] };
	const fencedDecoder = new ToolCallDecoder(
		new Set([M365_TOOL_NAMES.listFiles]),
		(chunk) => fenced.text.push(chunk),
		(call) => fenced.calls.push(call),
	);
	fencedDecoder.push('```json\n');
	fencedDecoder.push(`<m365_tool_call>{"name":"${M365_TOOL_NAMES.listFiles}","input":{}}</m365_tool_call>\n`);
	fencedDecoder.push('```');
	fencedDecoder.finish();
	assert.deepEqual(fenced.calls, [{ name: M365_TOOL_NAMES.listFiles, input: {} }]);
	assert.equal(fenced.text.join('').trim(), '');

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
					{ operation: 'replace', path: 'a.ts', oldText: 'function f() {}', newText: 'const f = () => {}' },
				],
			},
		},
	]);
	assert.equal(noClose.text.join(''), '');

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
		{ name: M365_TOOL_NAMES.readFile, input: { path: 'test.js', startLine: 1, endLine: 30 } },
	]);
	assert.equal(doubled.text.join('').trim(), '');

	// A marker merely mentioned in prose (no JSON after it) must be treated as
	// text, never as a call.
	const mention = { text: [] as string[], calls: [] as unknown[] };
	const mentionDecoder = new ToolCallDecoder(
		new Set([M365_TOOL_NAMES.readFile]),
		(chunk) => mention.text.push(chunk),
		(call) => mention.calls.push(call),
	);
	mentionDecoder.push('Para llamar una herramienta escribe <m365_tool_call> seguido del JSON.');
	mentionDecoder.finish();
	assert.deepEqual(mention.calls, []);
	assert.equal(mention.text.join(''), 'Para llamar una herramienta escribe <m365_tool_call> seguido del JSON.');

	// With tools enabled, a plain answer that contains a fenced code block must
	// stream through byte-for-byte (holding fences must never corrupt output).
	const codeChunks = ['Aquí tienes:\n', '```ts\n', 'const x = 1;\n', '```\n'];
	const streamed: string[] = [];
	const codeDecoder = new ToolCallDecoder(
		new Set([M365_TOOL_NAMES.readFile]),
		(chunk) => streamed.push(chunk),
		() => assert.fail('No hay marcador: no debe emitir una llamada.'),
	);
	for (const chunk of codeChunks) codeDecoder.push(chunk);
	codeDecoder.finish();
	assert.equal(streamed.join(''), codeChunks.join(''));

	assert.equal(replaceTextOnce('uno\ndos\n', 'dos', 'tres', 'demo.txt'), 'uno\ntres\n');
	assert.throws(() => replaceTextOnce('uno uno', 'uno', 'dos', 'demo.txt'), /más de una vez/);
	console.log('  ✓ tool protocol decodes calls (preamble, fenced) and guards replacements');
}

// ---- toolCatalog.ts --------------------------------------------------------

/** Herramientas con la forma de las que ofrece VS Code en modo agente. */
const EDITOR_TOOLS = [
	{
		name: 'read_file',
		description: 'Read the contents of a file in the workspace.',
		inputSchema: {
			type: 'object',
			required: ['filePath'],
			properties: {
				filePath: { type: 'string', description: 'The absolute path of the file to read.' },
				startLine: { type: 'integer', description: 'First line to read.' },
			},
		},
	},
	{
		name: 'replace_string_in_file',
		description: 'Replace an exact string in a file.',
		inputSchema: {
			type: 'object',
			required: ['filePath', 'oldString', 'newString'],
			properties: {
				filePath: { type: 'string' },
				oldString: { type: 'string' },
				newString: { type: 'string' },
			},
		},
	},
	{
		name: 'run_in_terminal',
		description: 'Run a shell command in the integrated terminal.',
		inputSchema: {
			type: 'object',
			required: ['command'],
			properties: {
				command: { type: 'string' },
				isBackground: { type: 'boolean' },
			},
		},
	},
	{
		name: 'mcp_postgres_query',
		description: 'Run a read-only SQL query.',
		inputSchema: { type: 'object', required: ['sql'], properties: { sql: { type: 'string' } } },
	},
	{
		name: 'mcp_github_create_issue',
		description: 'Create an issue on GitHub.',
		inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
	},
];

const M365_TOOLS = Object.values(M365_TOOL_NAMES).map((name) => ({
	name,
	description: `Descripción de package.json para ${name}.`,
	inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
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
	assert.equal(entry(catalog, 'read_file').capability, 'read');
	assert.equal(entry(catalog, 'replace_string_in_file').capability, 'edit');
	assert.equal(entry(catalog, 'run_in_terminal').capability, 'terminal');
	assert.equal(entry(catalog, M365_TOOL_NAMES.searchText).capability, 'search');
	assert.equal(entry(catalog, M365_TOOL_NAMES.gitInfo).capability, 'git');
	assert.equal(entry(catalog, 'mcp_postgres_query').capability, 'other');
	// «github» no es «git»: si no, la herramienta MCP competiría con la nuestra.
	assert.notEqual(entry(catalog, 'mcp_github_create_issue').capability, 'git');

	// Duplicados: por defecto gana la nativa, pero la nuestra sigue disponible.
	assert.equal(entry(catalog, M365_TOOL_NAMES.readFile).preferInstead, 'read_file');
	assert.equal(entry(catalog, M365_TOOL_NAMES.applyWorkspaceEdits).preferInstead, 'replace_string_in_file');
	assert.equal(entry(catalog, M365_TOOL_NAMES.runCommand).preferInstead, 'run_in_terminal');
	assert.equal(entry(catalog, 'read_file').preferInstead, null);
	// Sin equivalente nativo, la nuestra no se marca como secundaria.
	assert.equal(entry(catalog, M365_TOOL_NAMES.gitInfo).preferInstead, null);

	const reversed = buildToolCatalog(offered, { duplicates: 'preferM365' });
	assert.equal(entry(reversed, 'read_file').preferInstead, M365_TOOL_NAMES.readFile);
	assert.equal(entry(reversed, M365_TOOL_NAMES.readFile).preferInstead, null);

	const neutral = buildToolCatalog(offered, { duplicates: 'both' });
	assert.equal(
		neutral.entries.every((candidate) => candidate.preferInstead === null),
		true,
	);

	// El interruptor de escape: volver a describir sólo las nuestras.
	const onlyOurs = buildToolCatalog(offered, { includeEditorTools: false });
	assert.equal(onlyOurs.entries.length, M365_TOOLS.length);
	assert.equal(onlyOurs.callable.has('read_file'), true, 'sigue siendo ejecutable aunque no se describa');

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

	console.log('  ✓ el catálogo describe las herramientas nativas/MCP, las clasifica y marca duplicados');
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
		description: 'x'.repeat(280),
	}));
	const offered = [...filler, ...M365_TOOLS];

	// Sólo los 6 "filler" ya superan este presupuesto, así que en el orden
	// antiguo (agrupado por capacidad) se comían todo el presupuesto antes de
	// llegar siquiera a la única herramienta de capacidad 'agent'.
	const tight = buildToolCatalog(offered, { maxChars: 1200 });
	assert.ok(tight.omitted.length > 0, '(sanity) el presupuesto ajustado sí debería recortar algo');
	assert.ok(
		tight.entries.some((e) => e.name === M365_TOOL_NAMES.spawnAgents),
		'm365_spawn_agents no debería quedar fuera del catálogo aunque el presupuesto sea ajustado',
	);
	assert.ok(
		!tight.omitted.includes(M365_TOOL_NAMES.spawnAgents),
		'm365_spawn_agents no debería aparecer en la lista de herramientas omitidas',
	);

	console.log('  ✓ m365_spawn_agents nunca se recorta del catálogo por presupuesto/nº de herramientas');
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
	assert.match(prompt, /duplicada: usa read_file/);
	assert.match(prompt, /<m365_tool_call>/);

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
	assert.equal(buildToolProtocolInstructions(buildToolCatalog([])), '');

	console.log('  ✓ el prompt describe cada herramienta con su origen, firma y preferencia');
}

// ---- commitMessage.ts -------------------------------------------------------

function testCommitMessageValidation() {
	assert.equal(
		validateConventionalCommitMessage('fix(auth): evitar token nulo en refresh'),
		'fix(auth): evitar token nulo en refresh',
	);
	// Cuerpo opcional tras la primera línea: sólo la primera se valida.
	assert.equal(
		validateConventionalCommitMessage('feat!: soporte multi-repo\n\nBREAKING CHANGE: cambia la firma pública.'),
		'feat!: soporte multi-repo\n\nBREAKING CHANGE: cambia la firma pública.',
	);
	// Espacio sobrante en los bordes y CRLF se normalizan.
	assert.equal(validateConventionalCommitMessage('  chore: limpiar deps\r\n'), 'chore: limpiar deps');

	assert.throws(() => validateConventionalCommitMessage(''), /no puede estar vacío/);
	assert.throws(() => validateConventionalCommitMessage('   '), /no puede estar vacío/);
	assert.throws(() => validateConventionalCommitMessage(undefined), /no puede estar vacío/);
	// Sin tipo válido de Conventional Commits.
	assert.throws(() => validateConventionalCommitMessage('arreglado el bug del login'), /Conventional Commits/);
	// Tipo inventado.
	assert.throws(() => validateConventionalCommitMessage('feature: algo nuevo'), /Conventional Commits/);
	// Punto final en la primera línea.
	assert.throws(() => validateConventionalCommitMessage('fix: arregla el bug.'), /no debe terminar en punto/);

	console.log('  ✓ valida (sin reescribir) que la primera línea siga Conventional Commits');
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
		'replace_string_in_file',
		'get_changed_files',
	]);

	// Una herramienta nativa de VS Code se decodifica igual que las nuestras:
	// el nombre viaja tal cual y es VS Code quien la ejecuta.
	assert.deepEqual(
		decodeTurn(allowed, [
			'<m365_tool_call>{"name":"replace_string_in_file","input":{"filePath":"/a.ts","oldString":"a","newString":"b"}}</m365_tool_call>',
		]).calls,
		[
			{
				name: 'replace_string_in_file',
				input: { filePath: '/a.ts', oldString: 'a', newString: 'b' },
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
		[{ name: 'replace_string_in_file', input: { filePath: '/a.ts' } }],
	);
	assert.deepEqual(
		decodeTurn(allowed, [
			'<m365_tool_call>{"tool":"m365ReadFile","input":{"path":"a.ts"}}</m365_tool_call>',
		]).calls,
		[{ name: M365_TOOL_NAMES.readFile, input: { path: 'a.ts' } }],
	);
	assert.deepEqual(
		decodeTurn(allowed, ['<m365_tool_call>{"name":"get_changed_files"}</m365_tool_call>']).calls,
		[{ name: 'get_changed_files', input: {} }],
	);
	assert.deepEqual(
		decodeTurn(allowed, [
			'<m365_tool_call>{"name":"m365_read_file","path":"a.ts"}</m365_tool_call>',
		]).calls,
		[{ name: M365_TOOL_NAMES.readFile, input: { path: 'a.ts' } }],
	);

	// Una herramienta que el host NO ofreció nunca se ejecuta.
	const unknown = decodeTurn(allowed, [
		'<m365_tool_call>{"name":"borrar_el_disco","input":{}}</m365_tool_call>',
	]);
	assert.deepEqual(unknown.calls, []);
	assert.match(unknown.text.join(''), /borrar_el_disco/);

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
				name: 'replace_string_in_file',
				input: {
					filePath: '/a.ts',
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
	assert.match(truncated.text.join(''), /incompleta/);

	console.log('  ✓ decodifica herramientas nativas/MCP, tolera formatos ajenos y bloques genéricos');
}

// ---- mock SignalR server ---------------------------------------------------

type Ring = 'snapshot' | 'delta';

function startMockServer(ring: Ring): Promise<{ port: number; close: () => void; sawMetrics: () => boolean }> {
	return new Promise((resolve) => {
		let metricsSeen = false;
		const wss = new WebSocketServer({ port: 0 }, () => {
			const addr = wss.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => wss.close(), sawMetrics: () => metricsSeen });
		});

		wss.on('connection', (socket) => {
			let handshaken = false;
			socket.on('message', (data) => {
				for (const chunk of data.toString().split(RS)) {
					if (!chunk) continue;
					const frame = JSON.parse(chunk);

					if (!handshaken) {
						// handshake request {protocol,version}
						handshaken = true;
						socket.send('{}' + RS); // ack
						continue;
					}

					if (frame.target === 'Metrics') {
						metricsSeen = true;
						continue;
					}

					if (frame.target === 'chat') {
						// Verify the prompt we sent round-tripped.
						assert.equal(frame.arguments[0].message.text, 'PROMPT');
						setTimeout(() => streamReply(socket, ring), 5);
					}
				}
			});
		});
	});
}

function botUpdate(messages: unknown[]) {
	return JSON.stringify({ type: 1, target: 'update', arguments: [{ messages }] }) + RS;
}

function streamReply(socket: import('ws').WebSocket, ring: Ring) {
	if (ring === 'snapshot') {
		socket.send(botUpdate([{ author: 'bot', text: 'Hola' }]));
		socket.send(botUpdate([{ author: 'bot', text: 'Hola, mundo' }]));
		socket.send(botUpdate([{ author: 'bot', messageType: 'EndOfRequest' }]));
	} else {
		// delta mode: writeAtCursor increments, plus a control snapshot that
		// must NOT double-count, then completion frame type 3.
		socket.send(JSON.stringify({ type: 1, target: 'update', arguments: [{ writeAtCursor: 'Hola' }] }) + RS);
		socket.send(JSON.stringify({ type: 1, target: 'update', arguments: [{ writeAtCursor: ', mundo' }] }) + RS);
		socket.send(botUpdate([{ author: 'bot', text: 'Hola, mundo' }])); // snapshot ignored in delta mode
		socket.send(JSON.stringify({ type: 3, invocationId: '0' }) + RS); // completion
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
		origin: 'https://m365.cloud.microsoft',
		userAgent: 'Mozilla/5.0 test',
		invocationTemplate: { tone: 'magic', message: { author: 'user', messageType: 'Chat' } },
		invocationType: 4,
		claims: { oid: 'o', tid: 't', exp: Math.floor(Date.now() / 1000) + 3600 },
		capturedAt: new Date().toISOString(),
	};
}

async function runRing(ring: Ring) {
	const server = await startMockServer(ring);
	let text = '';
	await streamCopilotTurn({
		profile: makeProfile(server.port),
		endpointBase: mockBase(server.port),
		prompt: 'PROMPT',
		tone: null,
		signal: new AbortController().signal,
		callbacks: { onText: (d) => (text += d) },
	});
	assert.equal(text, 'Hola, mundo', `[${ring}] expected "Hola, mundo", got "${text}"`);
	assert.equal(server.sawMetrics(), true, `[${ring}] server never received Metrics frame`);
	server.close();
	console.log(`  ✓ streamCopilotTurn (${ring} ring) → "${text}", Metrics frame sent`);
}

async function testCancellation() {
	const server = await startMockServer('snapshot');
	const controller = new AbortController();
	const profile = makeProfile(server.port);
	const p = streamCopilotTurn({
		profile,
		endpointBase: mockBase(server.port),
		prompt: 'PROMPT',
		tone: null,
		signal: controller.signal,
		callbacks: { onText: () => controller.abort() }, // abort on first token
	});
	await assert.rejects(p, /__CANCELLED__/);
	server.close();
	console.log('  ✓ cancellation aborts the turn');
}

/** HTTP server that rejects any WS upgrade with a 401, like a stale token. */
function start401Server(): Promise<{ port: number; close: () => void; attempts: () => number }> {
	return new Promise((resolve) => {
		let attempts = 0;
		const server = http.createServer((_req, res) => {
			res.writeHead(401);
			res.end();
		});
		server.on('upgrade', (_req, socket) => {
			attempts += 1;
			socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
			socket.destroy();
		});
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => server.close(), attempts: () => attempts });
		});
	});
}

/** HTTP server that rejects only the FIRST WS upgrade with a 429, then serves
 * every later attempt normally through the mock BizChat protocol — proves
 * {@link streamCopilotTurnWithRetry} recovers from one transient failure. */
function start429ThenOkServer(ring: Ring): Promise<{ port: number; close: () => void; attempts: () => number }> {
	return new Promise((resolve) => {
		let attempts = 0;
		const wss = new WebSocketServer({ noServer: true });
		wss.on('connection', (socket) => {
			let handshaken = false;
			socket.on('message', (data) => {
				for (const chunk of data.toString().split(RS)) {
					if (!chunk) continue;
					const frame = JSON.parse(chunk);
					if (!handshaken) {
						handshaken = true;
						socket.send('{}' + RS);
						continue;
					}
					if (frame.target === 'chat') setTimeout(() => streamReply(socket, ring), 5);
				}
			});
		});

		const server = http.createServer((_req, res) => {
			res.writeHead(429);
			res.end();
		});
		server.on('upgrade', (req, socket, head) => {
			attempts += 1;
			if (attempts === 1) {
				socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
				socket.destroy();
				return;
			}
			wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
		});
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => { wss.close(); server.close(); }, attempts: () => attempts });
		});
	});
}

async function test429Retry() {
	const server = await start429ThenOkServer('snapshot');
	let text = '';
	await streamCopilotTurnWithRetry({
		profile: makeProfile(server.port),
		endpointBase: mockBase(server.port),
		prompt: 'PROMPT',
		tone: null,
		signal: new AbortController().signal,
		callbacks: { onText: (d) => (text += d) },
	});
	assert.equal(text, 'Hola, mundo');
	assert.equal(server.attempts(), 2, 'esperaba un primer intento rechazado (429) y un reintento que sí conecta');
	server.close();
	console.log('  ✓ streamCopilotTurnWithRetry reintenta una vez tras un 429 y recupera el turno');
}

async function testAuthErrorNotRetried() {
	// Un 401/403 no se reintenta: el mismo token caducado fallaría igual, y el
	// usuario necesita el aviso de "vuelve a capturar el token" cuanto antes.
	const server = await start401Server();
	await assert.rejects(
		streamCopilotTurnWithRetry({
			profile: makeProfile(server.port),
			endpointBase: mockBase(server.port),
			prompt: 'PROMPT',
			tone: null,
			signal: new AbortController().signal,
			callbacks: { onText: () => {} },
		}),
		(err: unknown) => err instanceof CopilotAuthError,
	);
	assert.equal(server.attempts(), 1, 'un CopilotAuthError no debe disparar un reintento');
	server.close();
	console.log('  ✓ streamCopilotTurnWithRetry NO reintenta un error de autenticación');
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
	assert.ok(maxActive <= 2, `esperaba como mucho 2 ejecuciones simultáneas, se vieron ${maxActive}`);
	console.log('  ✓ ConcurrencyLimiter respeta el máximo de ejecuciones simultáneas');
}

/** Servidor mock cuya respuesta depende de qué conexión (= qué paso del
 * sub-agente) es: cada turno de `runSubagentTask` abre un WebSocket nuevo. */
function startScriptedServer(
	getReply: (connectionIndex: number) => string,
	onChatFrame?: (frame: { arguments: [{ message: Record<string, unknown> }] }) => void,
): Promise<{ port: number; close: () => void }> {
	return new Promise((resolve) => {
		let connectionIndex = 0;
		const wss = new WebSocketServer({ port: 0 }, () => {
			const addr = wss.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => wss.close() });
		});
		wss.on('connection', (socket) => {
			const index = connectionIndex++;
			let handshaken = false;
			socket.on('message', (data) => {
				for (const chunk of data.toString().split(RS)) {
					if (!chunk) continue;
					const frame = JSON.parse(chunk);
					if (!handshaken) {
						handshaken = true;
						socket.send('{}' + RS);
						continue;
					}
					if (frame.target !== 'chat') continue;
					onChatFrame?.(frame);
					setTimeout(() => {
						socket.send(botUpdate([{ author: 'bot', text: getReply(index) }]));
						socket.send(botUpdate([{ author: 'bot', messageType: 'EndOfRequest' }]));
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
			: 'Resumen: encontré 2 coincidencias de foo.',
	);
	const calls: { name: string; input: Record<string, unknown> }[] = [];
	const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

	const result = await runSubagentTask({
		label: 'buscar foo',
		task: 'Busca foo en el repo y resume dónde aparece.',
		profile: makeProfile(server.port),
		tone: null,
		maxSteps: 4,
		signal: new AbortController().signal,
		offeredTools,
		endpointBase: mockBase(server.port),
		executeTool: async (name, input) => {
			calls.push({ name, input });
			return 'Coincidencias: a.ts:1, b.ts:4';
		},
	});
	server.close();

	assert.equal(result.ok, true);
	assert.equal(result.steps, 2);
	assert.match(result.summary, /Resumen: encontré 2 coincidencias/);
	assert.deepEqual(calls, [{ name: M365_TOOL_NAMES.searchText, input: { query: 'foo' } }]);
	console.log('  ✓ runSubagentTask ejecuta un paso de herramienta, reinyecta el resultado y devuelve el resumen final');
}

async function testSubagentLoopStepLimit() {
	const server = await startScriptedServer(
		() => `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`,
	);
	const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

	const result = await runSubagentTask({
		label: 'bucle sin fin',
		task: 'Una tarea que el modelo simulado nunca da por terminada.',
		profile: makeProfile(server.port),
		tone: null,
		maxSteps: 1,
		signal: new AbortController().signal,
		offeredTools,
		endpointBase: mockBase(server.port),
		executeTool: async () => 'resultado parcial',
	});
	server.close();

	assert.equal(result.ok, false);
	assert.equal(result.steps, 1);
	assert.match(result.summary, /límite de 1 paso/);
	console.log('  ✓ runSubagentTask corta en maxSteps y devuelve un aviso de límite alcanzado');
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
		() => `<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`,
	);
	const offeredTools: OfferedTool[] = [{ name: M365_TOOL_NAMES.searchText }];

	const result = await runSubagentTask({
		label: 'nunca termina',
		task: 'Una tarea que iría bien de pasos pero se le acaba el tiempo total antes.',
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
		executeTool: async () => new Promise((resolve) => setTimeout(() => resolve('resultado parcial'), 40)),
	});
	server.close();

	assert.equal(result.ok, false);
	assert.ok(result.steps >= 1, 'debería haber completado al menos un paso antes de cortar por tiempo');
	assert.match(result.summary, /tiempo máximo/);
	console.log('  ✓ runSubagentTask corta por tiempo máximo total aunque queden pasos disponibles');
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
		'Texto después de la valla, que el agente principal también necesita leer sin que se lo trague el bloque.';

	const cutInsideFence = text.indexOf('console.log') + 5;
	const clippedInsideFence = clip(text, cutInsideFence);
	assert.equal(
		(clippedInsideFence.match(/```/g) ?? []).length % 2,
		0,
		'un recorte a media valla de código debe cerrarla, si no el resto del informe queda dentro del bloque',
	);

	const cutAfterFence = text.indexOf('Texto después') + 5;
	const clippedAfterFence = clip(text, cutAfterFence);
	assert.equal(
		(clippedAfterFence.match(/```/g) ?? []).length % 2,
		0,
		'un recorte que cae tras una valla ya cerrada no debe añadir una de cierre de más',
	);

	console.log('  ✓ clip() cierra una valla ``` que el recorte deja abierta, sin tocar las que ya cerraban');
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
			prompt: 'PROMPT',
			tone: null,
			signal: new AbortController().signal,
			callbacks: { onText: () => {} },
		}),
		(err: unknown) => {
			assert.ok(err instanceof CopilotAuthError, 'expected CopilotAuthError');
			assert.equal(err.statusCode, 401);
			assert.match(err.message, /401/);
			assert.doesNotMatch(err.message, /handshake/i);
			return true;
		},
	);
	const elapsed = Date.now() - startedAt;
	assert.ok(elapsed < 5000, `expected a fast fail, took ${elapsed}ms`);
	server.close();
	console.log(`  ✓ streamCopilotTurn falla rápido con 401 (${elapsed}ms, sin esperar al timeout)`);
}

async function testEndpointRotation() {
	// The captured browser endpoint is deliberately NOT replayed: its `variants`
	// query string turns on the web app's native plugin/rich-message features,
	// which break the text tool-call protocol. Pointing it at a dead port proves
	// the URL is built from the token claims instead.
	const server = await startMockServer('snapshot');
	const profile = makeProfile(server.port);
	profile.endpoint = 'ws://127.0.0.1:1/m365Copilot/ChatHubV2/o@t?variants=feature.x&access_token=old';
	let text = '';
	await streamCopilotTurn({
		profile,
		endpointBase: mockBase(server.port),
		prompt: 'PROMPT',
		tone: null,
		signal: new AbortController().signal,
		callbacks: { onText: (d) => (text += d) },
	});
	assert.equal(text, 'Hola, mundo', `captured endpoint must be ignored, got "${text}"`);
	server.close();
	console.log('  ✓ streamCopilotTurn ignora el endpoint capturado (con variants) y usa el de los claims');
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
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => wss.close() });
		});
		wss.on('connection', (socket) => {
			let handshaken = false;
			socket.on('message', (data) => {
				for (const chunk of data.toString().split(RS)) {
					if (!chunk) continue;
					const frame = JSON.parse(chunk);
					if (!handshaken) {
						handshaken = true;
						socket.send('{}' + RS);
						continue;
					}
					if (frame.target !== 'chat') continue;

					const send = (obj: unknown) => socket.send(JSON.stringify(obj) + RS);
					const snapshot = (messages: unknown[]) =>
						send({ type: 1, target: 'update', arguments: [{ messages }] });
					const delta = (writeAtCursor: string) =>
						send({ type: 1, target: 'update', arguments: [{ writeAtCursor }] });

					setTimeout(() => {
						// Message 1: prose, snapshot then delta-continued (like the real log).
						snapshot([{ author: 'bot', text: 'Voy a bus', messageId: 'm1' }]);
						delta('car el archivo.');
						snapshot([{ author: 'bot', text: 'Voy a buscar el archivo.', messageId: 'm1' }]);
						// Message 2: the tool call — its first chunk is a SNAPSHOT (not a
						// delta) for a brand-new messageId, right after message 1 used
						// deltas. This exact shape used to lose the opening `<m`.
						snapshot([{ author: 'bot', text: '<m', messageId: 'm2' }]);
						delta('365_tool_call>{"name":"m365_read_file","');
						delta('input":{"path":"a.ts"}}</m365_tool_call>');
						snapshot([
							{
								author: 'bot',
								text: '<m365_tool_call>{"name":"m365_read_file","input":{"path":"a.ts"}}</m365_tool_call>',
								messageId: 'm2',
							},
						]);
						snapshot([{ author: 'bot', messageType: 'EndOfRequest' }]);
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
		prompt: 'PROMPT',
		tone: null,
		signal: new AbortController().signal,
		callbacks: { onText: (d) => decoder.push(d) },
	});
	decoder.finish();
	server.close();

	assert.equal(text.join(''), 'Voy a buscar el archivo.');
	assert.deepEqual(calls, [{ name: M365_TOOL_NAMES.readFile, input: { path: 'a.ts' } }]);
	console.log('  ✓ streamCopilotTurn reconciles a tool call split across two bot messages (no leaked marker)');
}


// ---- i18n -------------------------------------------------------------------

function testI18nCatalogs() {
	// Every key has a non-empty text in every locale, with the same placeholders
	// as the English reference — a Spanish message that drops `{1}` would
	// silently print less information than its English twin.
	for (const key of messageKeys()) {
		const reference = placeholdersOf('en', key);
		for (const locale of LOCALES) {
			assert.ok(tIn(locale, key).trim(), `${locale}:${key} está vacío`);
			assert.deepEqual(placeholdersOf(locale, key), reference, `${locale}:${key} no usa los mismos marcadores {n}`);
		}
	}

	assert.equal(resolveLocale('auto', 'es'), 'es');
	assert.equal(resolveLocale('auto', 'es-419'), 'es');
	assert.equal(resolveLocale('auto', 'en-US'), 'en');
	assert.equal(resolveLocale('auto', 'de'), 'en');
	assert.equal(resolveLocale('es', 'en-US'), 'es', 'el ajuste explícito gana al idioma de VS Code');
	assert.equal(resolveLocale('en', 'es-ES'), 'en');
	assert.equal(resolveLocale(undefined, undefined), 'en');

	// Placeholders are filled positionally; a missing argument stays visible.
	assert.equal(tIn('en', 'edit.itemError', 3, 'boom'), 'Edit #3: boom');
	assert.equal(tIn('es', 'edit.itemError', 3, 'boom'), 'Edición #3: boom');
	assert.equal(tIn('en', 'edit.itemError', 3), 'Edit #3: {1}');
	console.log('  ✓ catálogos en/es completos, con los mismos marcadores, y resolución del idioma');
}

/** Every `%key%` of package.json exists in both package.nls files, and they have the same keys. */
function testManifestLocalization() {
	const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
	const en = JSON.parse(readFileSync(new URL('../package.nls.json', import.meta.url), 'utf8')) as Record<string, string>;
	const es = JSON.parse(readFileSync(new URL('../package.nls.es.json', import.meta.url), 'utf8')) as Record<string, string>;
	const used = [...manifest.matchAll(/"%([^%"]+)%"/g)].map((match) => match[1]);
	assert.ok(used.length > 50, '(sanity) el manifiesto debería estar localizado');
	for (const key of used) {
		assert.ok(en[key], `package.nls.json no tiene ${key}`);
		assert.ok(es[key], `package.nls.es.json no tiene ${key}`);
	}
	assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort(), 'package.nls.json y package.nls.es.json difieren');
	for (const key of Object.keys(en)) assert.ok(used.includes(key), `${key} no se usa en package.json`);
	console.log(`  ✓ package.json: ${used.length} cadenas %nls% presentes en inglés y español`);
}

function testPromptsFollowLocale() {
	// The catalog carries our tools' descriptions, so it is built per locale
	// too — exactly as the provider does on every request.
	const render = (locale: 'en' | 'es') => {
		setLocale(locale);
		return buildToolProtocolInstructions(buildToolCatalog([...M365_TOOLS, ...EDITOR_TOOLS]));
	};
	const english = render('en');
	const spanish = render('es');

	assert.match(english, /IMPORTANT: you DO have real access/);
	assert.match(english, /read_file \(native to VS Code\)/);
	assert.match(english, new RegExp(`${M365_TOOL_NAMES.readFile} \\(from this extension\\)`));
	assert.doesNotMatch(english, /herramienta|IMPORTANTE|de esta extensión/, 'no debe quedar español en el prompt inglés');
	assert.match(spanish, /IMPORTANTE: SÍ tienes acceso real/);
	assert.match(spanish, /read_file \(nativa de VS Code\)/);
	// The protocol markers themselves never change with the language.
	for (const prompt of [english, spanish]) {
		assert.match(prompt, /<m365_tool_call>/);
		assert.match(prompt, /@@block:1@@/);
	}
	console.log('  ✓ el prompt de herramientas sale entero en el idioma activo; los marcadores no cambian');
}

// ---- participantPrompts.ts -------------------------------------------------

function testParticipantPrompts() {
	assert.equal(asParticipantCommand('fix'), 'fix');
	assert.equal(asParticipantCommand('commit'), undefined);
	assert.equal(asParticipantCommand(undefined), undefined);

	// /explain only reads; the rest may edit (with Keep/Undo), never delegate.
	assert.ok(!toolsForCommand('explain').includes(M365_TOOL_NAMES.applyWorkspaceEdits));
	assert.ok(toolsForCommand('fix').includes(M365_TOOL_NAMES.applyWorkspaceEdits));
	assert.ok(!toolsForCommand(undefined).includes(M365_TOOL_NAMES.spawnAgents));
	assert.ok(maxStepsForCommand('explain') < maxStepsForCommand('fix'));

	// A fence always outlasts any backtick run inside the code.
	assert.equal(fenceFor('const a = 1;'), '```');
	assert.equal(fenceFor('const md = "```ts";'), '````');

	const code = {
		relativePath: 'src/a.ts',
		languageId: 'typescript',
		startLine: 10,
		endLine: 12,
		text: 'function f() {\n  return "```";\n}',
		truncatedChars: 0,
		diagnostics: ['11:3 [error] (ts) Type mismatch'],
	};
	setLocale('en');
	const framing = buildParticipantFraming({
		command: 'fix',
		request: 'it crashes on empty input',
		code,
		history: [
			{ role: 'user', text: '/explain' },
			{ role: 'assistant', text: 'It returns a fence.' },
		],
		attachedPaths: ['src/b.ts'],
	});
	assert.match(framing, /invoked from the chat as @m365/);
	assert.match(framing, /Find and fix the problems/);
	assert.match(framing, /Code context — src\/a\.ts, lines 10-12 \(typescript\):/);
	assert.match(framing, /````typescript\nfunction f\(\) \{/);
	assert.match(framing, /- 11:3 \[error\] \(ts\) Type mismatch/);
	assert.match(framing, /Assistant: It returns a fence\./);
	assert.match(framing, /Other files the user attached: src\/b\.ts/);
	assert.match(framing, /User request:\nit crashes on empty input$/);

	setLocale('es');
	const spanish = buildParticipantFraming({ command: undefined, request: '' });
	assert.match(spanish, /Responde a la petición del usuario/);
	assert.match(spanish, /Petición del usuario:\n\(sin instrucciones adicionales\)$/);
	console.log('  ✓ prompts de @m365: herramientas por comando, contexto de código, historial y adjuntos');
}

// ---- commit message generated with M365 (SCM) ------------------------------

function testCommitMessageGeneration() {
	setLocale('en');
	const prompt = buildCommitMessagePrompt({
		files: ['M\tsrc/a.ts', 'A\tsrc/b.ts'],
		diff: 'diff --git a/src/a.ts b/src/a.ts\n+const x = 1;',
		staged: true,
	});
	assert.match(prompt, /Conventional Commits/);
	assert.match(prompt, /feat, fix, docs/);
	assert.match(prompt, /Write the message in English\./);
	assert.match(prompt, /Changed files \(2\):\nM\tsrc\/a\.ts\nA\tsrc\/b\.ts/);
	assert.match(prompt, /\+const x = 1;/);
	assert.doesNotMatch(prompt, /Nothing is staged/);

	const unstaged = buildCommitMessagePrompt({ files: [], diff: 'x'.repeat(30_000), staged: false });
	assert.match(unstaged, /Nothing is staged/);
	assert.match(unstaged, /\[diff truncated: 6000 more characters\]/);

	setLocale('es');
	assert.match(buildCommitMessagePrompt({ files: [], diff: 'd', staged: true }), /Escribe el mensaje en español\./);

	assert.equal(cleanGeneratedCommitMessage('feat(ui): add menu'), 'feat(ui): add menu');
	assert.equal(cleanGeneratedCommitMessage('```\nfix: avoid crash\n\n- detail\n```'), 'fix: avoid crash\n\n- detail');
	assert.equal(cleanGeneratedCommitMessage('Commit message:\nchore: bump deps'), 'chore: bump deps');
	assert.equal(cleanGeneratedCommitMessage('"docs: update README"'), 'docs: update README');
	assert.equal(cleanGeneratedCommitMessage('fix: a\r\n\r\n\r\n\r\n- b'), 'fix: a\n\n- b');
	assert.equal(cleanGeneratedCommitMessage('   '), '');
	console.log('  ✓ mensaje de commit con M365: prompt en el idioma activo, diff acotado y limpieza de la respuesta');
}

// ---- runToolLoop (shared by sub-agents and @m365) ---------------------------

async function testToolLoopStreamsProse() {
	const server = await startScriptedServer((index) =>
		index === 0
			? `Voy a buscar.\n<m365_tool_call>{"name":"${M365_TOOL_NAMES.searchText}","input":{"query":"foo"}}</m365_tool_call>`
			: 'Está en a.ts.',
	);
	const prose: string[] = [];
	const starts: number[] = [];
	const toolNames: string[] = [];
	const result = await runToolLoop({
		framing: 'Busca foo.',
		profile: makeProfile(server.port),
		tone: null,
		maxSteps: 3,
		signal: new AbortController().signal,
		offeredTools: [{ name: M365_TOOL_NAMES.searchText }],
		endpointBase: mockBase(server.port),
		executeTool: async () => 'a.ts:1: foo',
		onProse: (delta) => prose.push(delta),
		onStepStart: (step) => starts.push(step),
		onStep: (info) => {
			if (info.toolName) toolNames.push(info.toolName);
		},
	});
	server.close();

	assert.equal(result.outcome, 'done');
	assert.equal(result.ok, true);
	assert.equal(result.summary, 'Está en a.ts.');
	assert.deepEqual(starts, [1, 2]);
	assert.deepEqual(toolNames, [M365_TOOL_NAMES.searchText]);
	// The preamble of the tool-call step streams too; the marker never does.
	assert.equal(prose.join(''), 'Voy a buscar.\nEstá en a.ts.');
	console.log('  ✓ runToolLoop retransmite la prosa en vivo (nunca el marcador) e informa de cada paso');
}

/** BizChat's `message.locale` follows the extension language. */
async function testInvocationLocale() {
	const seen: unknown[] = [];
	const server = await startScriptedServer(
		() => 'ok',
		(frame) => seen.push(frame.arguments[0].message.locale),
	);
	for (const locale of ['en', 'es'] as const) {
		setLocale(locale);
		await streamCopilotTurn({
			profile: makeProfile(server.port),
			endpointBase: mockBase(server.port),
			prompt: 'PROMPT',
			tone: null,
			signal: new AbortController().signal,
			callbacks: { onText: () => {} },
		});
	}
	server.close();
	assert.deepEqual(seen, ['en-US', 'es-ES']);
	console.log('  ✓ la invocación a BizChat envía locale en-US / es-ES según el idioma');
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
		if (roll < 0.33 && out.length > 0) out.splice(Math.min(at, out.length - 1), 1 + Math.floor(random() * 2));
		else if (roll < 0.66) out.splice(at, 0, `new ${Math.floor(random() * 5)}`);
		else if (out.length > 0) out[Math.min(at, out.length - 1)] = `changed ${Math.floor(random() * 5)}`;
	}
	return out;
}

function testLineDiff() {
	// Two far-apart changes are two hunks, not one region painting everything between.
	const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
	const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
	assert.deepEqual(diffLines(before, after), [
		{ oldStart: 1, oldLength: 1, newStart: 1, newLength: 1 },
		{ oldStart: 7, oldLength: 0, newStart: 7, newLength: 1 },
	]);
	assert.deepEqual(diffLines(before, before), []);
	// An EOL-only difference is not a change.
	assert.deepEqual(diffLines('a\nb\n', 'a\r\nb\r\n'), []);

	// CRLF files: reverting restores CRLF line breaks, not LF.
	const crlfBase = 'one\r\ntwo\r\nthree\r\n';
	const crlfNow = 'one\r\nthree\r\n';
	const [removed] = diffLines(crlfBase, crlfNow);
	assert.equal(applyLineEdit(crlfNow, revertHunkEdit(crlfNow, crlfBase, removed)), crlfBase);

	const random = prng(365);
	for (let round = 0; round < 400; round += 1) {
		const size = Math.floor(random() * 12);
		const base = Array.from({ length: size }, () => `line ${Math.floor(random() * 6)}`);
		const edited = randomEdit(random, base);
		const trailing = random() < 0.5 ? '\n' : '';
		const baseText = base.join('\n') + (base.length > 0 ? trailing : '');
		const editedText = edited.join('\n') + (edited.length > 0 ? trailing : '');
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
		assert.equal(changed, oldLines.length + newLines.length - 2 * lcsLength(oldLines, newLines), label);

		// Undo every hunk, last first (earlier coordinates stay valid) → the baseline.
		let reverted = editedText;
		for (const hunk of [...hunks].reverse()) reverted = applyLineEdit(reverted, revertHunkEdit(reverted, baseText, hunk));
		assert.equal(reverted, baseText, `${label} (undo all)`);

		// Undo ONE hunk, re-diff: the other hunks are still a valid edit script,
		// so the minimal one costs at most that. (Not "exactly hunks - 1": a diff
		// is not unique, and re-aligning may merge or split the remaining hunks.)
		if (hunks.length > 1) {
			const pick = hunks[Math.floor(random() * hunks.length)];
			const partly = applyLineEdit(editedText, revertHunkEdit(editedText, baseText, pick));
			const left = diffLines(baseText, partly).reduce((total, hunk) => total + hunk.oldLength + hunk.newLength, 0);
			assert.ok(left <= changed - pick.oldLength - pick.newLength, `${label} (undo one)`);
			assert.ok(left > 0, `${label} (undo one left something)`);
		}

		// Keep hunks one at a time, re-diffing like the review does → no change left.
		let baseline = baseText;
		for (let guard = 0; guard < 50; guard += 1) {
			const remaining: Hunk[] = diffLines(baseline, editedText);
			if (remaining.length === 0) break;
			baseline = acceptHunk(baseline, editedText, remaining[Math.floor(random() * remaining.length)]);
		}
		assert.deepEqual(diffLines(baseline, editedText), [], `${label} (keep all)`);
	}

	// A huge rewrite falls back to one hunk instead of an expensive diff.
	const big = Array.from({ length: 4_000 }, (_, i) => `a${i}`).join('\n');
	const rewritten = Array.from({ length: 4_000 }, (_, i) => `b${i}`).join('\n');
	assert.deepEqual(diffLines(big, rewritten), [{ oldStart: 0, oldLength: 4_000, newStart: 0, newLength: 4_000 }]);
	console.log('  ✓ diff por bloques: mínimo, deshacer/aceptar por bloque converge, CRLF y caída a bloque único');
}


// ---- inline edit / terminal / clipboard ------------------------------------

function testInlineEdit() {
	setLocale('en');
	const prompt = buildInlineEditPrompt({
		instruction: '  add a null check  ',
		relativePath: 'src/a.ts',
		languageId: 'typescript',
		startLine: 3,
		endLine: 5,
		code: '  function f(x) {\n    return x.y;\n  }',
		before: 'class A {',
		after: '}',
		diagnostics: ['4:12 [error] (ts) Object is possibly null'],
	});
	assert.match(prompt, /You are a code editor inside VS Code/);
	assert.match(prompt, /File: src\/a\.ts \(typescript\)/);
	assert.match(prompt, /Instruction:\nadd a null check\n/);
	assert.match(prompt, /- 4:12 \[error\] \(ts\) Object is possibly null/);
	assert.match(prompt, /Context BEFORE[^\n]*\n```typescript\nclass A \{\n```/);
	assert.match(prompt, /CODE TO EDIT \(lines 3-5\):\n```typescript\n  function f\(x\) \{/);
	assert.match(prompt, /Context AFTER[^\n]*\n```typescript\n\}\n```/);
	setLocale('es');
	assert.match(buildInlineEditPrompt({ instruction: 'x', relativePath: 'a', languageId: 'js', startLine: 1, endLine: 1, code: 'a', before: '', after: '' }), /CÓDIGO A EDITAR \(líneas 1-1\)/);

	const original = '  function f(x) {\n    return x.y;\n  }';
	// The usual shape: one fenced block, maybe with prose around it.
	assert.equal(
		extractEditedCode('Here it is:\n```ts\n  function f(x) {\n    return x?.y;\n  }\n```\nDone.', original),
		'  function f(x) {\n    return x?.y;\n  }',
	);
	// Flush-left answer for an indented block: re-indented by the block's base indent.
	assert.equal(
		extractEditedCode('```ts\nfunction f(x) {\n  return x?.y;\n}\n```', original),
		'  function f(x) {\n    return x?.y;\n  }',
	);
	// No fence at all, with a chatty first line.
	assert.equal(extractEditedCode('Updated code:\n  const a = 1;', '  const a = 0;'), '  const a = 1;');
	// Cut-off answer (no closing fence) still yields the code.
	assert.equal(extractEditedCode('```js\nconst a = 2;\nconst b = 3;', 'const a = 1;'), 'const a = 2;\nconst b = 3;');
	// CRLF answers are normalised; empty answers are rejected.
	assert.equal(extractEditedCode('```\r\nx();\r\n```', 'y();'), 'x();');
	assert.equal(extractEditedCode('```\n\n```', 'y();'), null);
	assert.equal(extractEditedCode('   ', 'y();'), null);
	// reindent leaves already-indented answers and flush-left originals alone.
	assert.equal(reindent('    a();', '  b();'), '    a();');
	assert.equal(reindent('a();\n\nb();', 'c();'), 'a();\n\nb();');
	assert.equal(reindent('a();\n\nb();', '\tc();'), '\ta();\n\n\tb();');
	console.log('  ✓ edición en línea: prompt con contexto/diagnósticos y extracción robusta de la respuesta');
}

function testTerminalPrompt() {
	setLocale('en');
	const framing = buildParticipantFraming({
		command: 'terminal',
		request: '',
		terminal: {
			terminalName: 'bash',
			commandLine: 'npm test',
			cwd: '/repo',
			exitCode: 1,
			running: false,
			output: 'FAIL src/a.test.ts\n  expected 1, got 2',
			truncatedChars: 120,
		},
	});
	assert.match(framing, /Explain why the terminal command below failed/);
	assert.match(framing, /Last command in the terminal “bash”:\n\$ npm test\nExit code: 1 · cwd: \/repo/);
	assert.match(framing, /\[start of the output omitted: 120 characters\]\n```text\nFAIL src\/a\.test\.ts/);
	assert.equal(maxStepsForCommand('terminal'), 6);
	assert.equal(asParticipantCommand('terminal'), 'terminal');

	const running = buildParticipantFraming({
		command: 'terminal',
		request: 'why so slow?',
		terminal: { terminalName: 'pwsh', commandLine: 'build', cwd: undefined, exitCode: undefined, running: true, output: '', truncatedChars: 0 },
	});
	assert.match(running, /\$ build\nStill running\n\(no output\)/);
	setLocale('es');
	console.log('  ✓ prompt de @m365 /terminal: comando, código de salida, cwd y salida recortada');
}

function testClipboardDetection() {
	assert.equal(looksLikeProfile(fakeJwt()), true);
	assert.equal(looksLikeProfile(`  ${fakeJwt()}\n`), true);
	assert.equal(looksLikeProfile(JSON.stringify({ accessToken: fakeJwt(), endpoint: 'wss://x' }, null, 2)), true);
	assert.equal(looksLikeProfile('just some copied text'), false);
	assert.equal(looksLikeProfile('{"accessToken": 42}'), false);
	assert.equal(looksLikeProfile(''), false);
	console.log('  ✓ detecta un token o perfil en el portapapeles (y nada más)');
}

// ---- legacy.ts (coming from ms365-copilot-vscode) --------------------------

function testLegacyNames() {
	assert.equal(LEGACY_EXTENSION_ID, 'ms365-copilot-vscode.ms365-copilot-vscode');
	assert.equal(legacySettingKey('m365copilot.editor.model'), 'ms365copilot.editor.model');
	assert.equal(legacySettingKey('m365copilot.language'), 'ms365copilot.language');
	assert.equal(legacySettingKey('editor.fontSize'), undefined, 'sólo claves de esta extensión');

	// The model settings stored ids, renamed too; everything else is kept.
	assert.equal(migrateLegacyValue('ms365-copilot-gpt56'), 'm365-copilot-gpt56');
	assert.equal(migrateLegacyValue('ms365-copilot-tone-gpt-5-7-chat'), 'm365-copilot-tone-gpt-5-7-chat');
	assert.equal(migrateLegacyValue('es'), 'es');
	assert.equal(migrateLegacyValue(48), 48);
	assert.equal(migrateLegacyValue(false), false);
	assert.deepEqual(migrateLegacyValue(['scminput', 'plaintext']), ['scminput', 'plaintext']);
	assert.deepEqual(migrateLegacyValue([{ tone: 'Gpt_5_7_Chat', name: 'GPT 5.7' }]), [{ tone: 'Gpt_5_7_Chat', name: 'GPT 5.7' }]);

	// Only where the user set the old key and not yet the new one.
	assert.equal(shouldMigrate('es', undefined), true);
	assert.equal(shouldMigrate(false, undefined), true, 'false también es un valor elegido');
	assert.equal(shouldMigrate(undefined, undefined), false);
	assert.equal(shouldMigrate('es', 'en'), false, 'lo elegido en esta versión gana');
	console.log('  ✓ migración desde ms365-copilot-vscode: claves, ids de modelo y cuándo copiar');
}

// ---- profile.ts accountOf (Accounts menu) ----------------------------------

function testAccountOf() {
	const account = accountOf(parsePastedProfile(fakeJwt()));
	assert.deepEqual(account, { sessionId: 'tenant-tid/user-oid', accountId: 'user-oid', label: 'someone@contoso.com' });

	// A renewed token of the same user is the same session.
	const renewed = accountOf(parsePastedProfile(fakeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 })));
	assert.equal(renewed?.sessionId, account?.sessionId);

	// Expired = signed out.
	assert.equal(accountOf(parsePastedProfile(fakeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }))), undefined);
	assert.equal(accountOf(null), undefined);

	setLocale('en');
	assert.equal(accountOf(parsePastedProfile(fakeJwt({ upn: undefined })))?.label, 'M365 Copilot user');
	setLocale('es');
	assert.equal(accountOf(parsePastedProfile(fakeJwt({ upn: undefined })))?.label, 'Usuario de M365 Copilot');
	setLocale('en');
	console.log('  ✓ la cuenta del menú Cuentas sale del token (y desaparece al caducar)');
}

// ---- reviewPrompt.ts (code review as comments) ------------------------------

function testReviewPrompt() {
	setLocale('en');
	assert.equal(numberLines({ startLine: 9, text: 'a\nb\r\nc' }), ' 9 | a\n10 | b\n11 | c');
	assert.equal(formatRanges([{ start: 10, end: 14 }, { start: 30, end: 30 }]), '10-14, 30');

	const whole = buildReviewPrompt({
		relativePath: 'src/a.ts',
		languageId: 'typescript',
		segments: [{ startLine: 1, text: 'const a = 1;\nconsole.log(a);' }],
	});
	assert.match(whole, /senior code reviewer/);
	assert.match(whole, /File: src\/a\.ts \(typescript\)/);
	assert.match(whole, /```typescript\n1 \| const a = 1;\n2 \| console\.log\(a\);\n```/);
	assert.doesNotMatch(whole, /were just changed/, 'sin cambios no hay sección de cambios');

	const changes = buildReviewPrompt({
		relativePath: 'src/a.ts',
		languageId: 'typescript',
		segments: [{ startLine: 1, text: 'x' }, { startLine: 40, text: 'y' }],
		changed: [{ start: 41, end: 42 }],
		diff: '@@ -41 +41,2 @@\n-old\n+new',
	});
	assert.match(changes, /These lines were just changed: 41-42\./);
	assert.match(changes, /```diff\n@@ -41 \+41,2 @@\n-old\n\+new\n```/);
	assert.match(changes, / 1 \| x\n⋮\n40 \| y/, 'los trozos van separados con ⋮ y numerados con su línea real');

	setLocale('es');
	assert.match(buildReviewPrompt({ relativePath: 'a.ts', languageId: 'ts', segments: [{ startLine: 1, text: 'x' }] }), /en español/);
	setLocale('en');
	console.log('  ✓ prompt de revisión: líneas numeradas, cambios, diff e idioma');
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
			severity: 'warning',
			title: 'Unhandled rejection',
			message: 'fetch() can reject.',
			suggestion: 'Wrap it in try/catch.',
		},
	]);

	// Nothing to report is an empty list, not an unreadable answer.
	assert.deepEqual(parseReviewFindings('```json\n[]\n```', bounds), []);
	assert.deepEqual(parseReviewFindings('[]', bounds), []);
	assert.equal(parseReviewFindings('The code looks fine to me!', bounds), null);
	assert.equal(parseReviewFindings('```json\n[{"line": 1,\n```', bounds), null, 'JSON cortado = ilegible');

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
			[5, 5, 'info', 'Name could be clearer.'],
			[20, 22, 'error', 'SQL injection'],
		],
		'ordenados por línea; el título sale de la primera frase si falta',
	);

	// Outside the reviewed lines: dropped, or clamped when it straddles them.
	const clamped = parseReviewFindings(
		'[{"line": 3, "message": "before"}, {"line": 9, "endLine": 30, "message": "straddles"}, {"line": 99, "message": "after"}, {"message": "no line"}]',
		{ start: 10, end: 20 },
	);
	assert.deepEqual(clamped?.map((f) => [f.startLine, f.endLine, f.message]), [[10, 20, 'straddles']]);

	// Duplicates go, and there is a cap.
	const many = JSON.stringify(
		Array.from({ length: 40 }, (_, i) => ({ line: (i % 30) + 1, title: `t${i % 30}`, message: 'm' })),
	);
	const capped = parseReviewFindings(many, bounds);
	assert.equal(capped?.length, MAX_FINDINGS);
	assert.equal(new Set(capped?.map((f) => f.title)).size, MAX_FINDINGS, 'sin duplicados');
	console.log('  ✓ lectura de la revisión: JSON en vallas o suelto, campos alternativos, límites, duplicados');
}

function testUnifiedDiff() {
	const patch = [
		'diff --git a/src/a.ts b/src/a.ts',
		'index 1111111..2222222 100644',
		'--- a/src/a.ts',
		'+++ b/src/a.ts',
		'@@ -3 +3 @@ function a() {',
		'-  return 1;',
		'+  return 2;',
		'@@ -10,2 +10,4 @@',
		'+added',
		'+added',
		'@@ -20,3 +23,0 @@',
		'-gone',
		'-gone',
		'-gone',
		'diff --git a/new file.ts b/new file.ts',
		'new file mode 100644',
		'--- /dev/null',
		'+++ b/new file.ts\t',
		'@@ -0,0 +1,3 @@',
		'+a',
		'+b',
		'+c',
		'diff --git a/old.ts b/old.ts',
		'deleted file mode 100644',
		'--- a/old.ts',
		'+++ /dev/null',
		'@@ -1,2 +0,0 @@',
		'-x',
		'-y',
		'diff --git a/logo.png b/logo.png',
		'Binary files a/logo.png and b/logo.png differ',
		'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
		'--- "a/caf\\303\\251.ts"',
		'+++ "b/caf\\303\\251.ts"',
		'@@ -1 +1 @@',
		'-a',
		'+b',
		// The same file again (staged + unstaged diffs concatenated).
		'diff --git a/src/a.ts b/src/a.ts',
		'--- a/src/a.ts',
		'+++ b/src/a.ts',
		'@@ -40 +44,2 @@',
		'+x',
		'+y',
	].join('\n');
	const files = parseUnifiedDiff(patch);
	assert.deepEqual(
		files.map((file) => [file.path, file.ranges]),
		[
			['src/a.ts', [{ start: 3, end: 3 }, { start: 10, end: 13 }, { start: 23, end: 23 }, { start: 44, end: 45 }]],
			['new file.ts', [{ start: 1, end: 3 }]],
			['café.ts', [{ start: 1, end: 1 }]],
		],
		'borrados y binarios fuera; el borrado puro marca la línea donde estaba; mismo archivo fusionado',
	);
	assert.match(files[0].patch, /-  return 1;/, 'el parche del archivo conserva lo eliminado');
	assert.match(files[0].patch, /\+y/);

	// 1-2 and 3 touch; 5-6 does not (line 4 is in between).
	assert.deepEqual(mergeRanges([{ start: 5, end: 6 }, { start: 1, end: 2 }, { start: 3, end: 3 }, { start: 9, end: 9 }]), [
		{ start: 1, end: 3 },
		{ start: 5, end: 6 },
		{ start: 9, end: 9 },
	]);
	assert.deepEqual(windowsAround([{ start: 5, end: 5 }, { start: 30, end: 31 }], 40, 10), [
		{ start: 1, end: 15 },
		{ start: 20, end: 40 },
	]);
	const finding = { startLine: 12, endLine: 12, severity: 'info' as const, title: 't', message: 'm' };
	assert.equal(touchesRanges(finding, [{ start: 10, end: 10 }]), true, 'a 2 líneas cuenta');
	assert.equal(touchesRanges(finding, [{ start: 20, end: 25 }]), false);
	console.log('  ✓ diff de git -U0: líneas cambiadas por archivo, rutas raras, ventanas y filtro de hallazgos');
}

// ---- rag/text.ts -------------------------------------------------------------

function testRagText() {
	assert.deepEqual(splitIdentifier('getHTTPResponse_code'), ['get', 'HTTP', 'Response', 'code']);
	assert.deepEqual(splitIdentifier('my-kebab-name'), ['my', 'kebab', 'name']);
	assert.equal(normalizeTerm('Tokens'), 'token');
	assert.equal(normalizeTerm('Configuración'), 'configuracion');
	assert.equal(normalizeTerm('class'), 'class', 'no quita la s de ss');
	assert.equal(normalizeTerm('libraries'), 'library');
	assert.deepEqual(tokenize('const profileStore = new ProfileStore();'), ['profilestore', 'profile', 'store', 'profilestore', 'profile', 'store']);
	assert.ok(!tokenize('the a de la que 42 x').length, 'sin palabras vacías, números ni letras sueltas');

	const terms = queryTerms('¿Dónde se guarda el token del usuario?');
	const byTerm = new Map(terms.map((term) => [term.term, term]));
	assert.equal(byTerm.get('token')?.weight, 1);
	assert.equal(byTerm.get('token')?.original, true);
	for (const english of ['save', 'store', 'storage', 'user']) assert.ok(byTerm.has(english), `expande ${english}`);
	assert.equal(byTerm.get('store')?.original, false);
	assert.ok(!byTerm.has('donde') && !byTerm.has('se'), 'palabras vacías fuera');
	assert.equal(queryTerms('ProfileStore').find((term) => term.term === 'profilestore')?.weight, 1.5, 'el identificador entero pesa más');
	assert.deepEqual(cognates('migracion'), ['migration', 'migraction']);
	assert.ok(cognates('funcion').includes('function'));
	assert.deepEqual(cognates('validar'), ['validate']);
	assert.deepEqual(cognates('participante'), ['participant']);
	assert.deepEqual(cognates('normalizar'), ['normalize']);
	assert.deepEqual(cognates('casa'), []);

	assert.equal(isSkippedPath('node_modules/x/index.js'), true);
	assert.equal(isSkippedPath('src/app/node_modules/y.ts'), true);
	assert.equal(isSkippedPath('pnpm-lock.yaml'), true);
	assert.equal(isSkippedPath('dist/app.min.js'), true);
	assert.equal(isSkippedPath('assets/logo.png'), true);
	assert.equal(isSkippedPath('bin/cli.js'), false, 'bin/ de Node se indexa');
	assert.equal(isSkippedPath('src/index.ts'), false);

	assert.equal(looksGenerated('// @generated by protoc\nexport const x = 1;'), true);
	assert.equal(looksGenerated(`!function(){${'a=1;'.repeat(600)}}()`), true, 'una línea enorme = minificado');
	assert.equal(looksGenerated('export function add(a, b) {\n  return a + b;\n}\n'), false);

	const globs = excludeGlobs([{ '**/fixtures': true, '**/keep': false }, undefined], ['docs/old/**', 42]);
	assert.equal(isExcluded('test/fixtures/a.json', globs), true, 'una carpeta excluida excluye lo de dentro');
	assert.equal(isExcluded('docs/old/a.md', globs), true);
	assert.equal(isExcluded('src/keep/a.ts', globs), false, 'false = no excluir');
	assert.equal(globToRegExp('**/*.{js,ts}').test('a/b/c.ts'), true);
	assert.equal(globToRegExp('**/*.{js,ts}').test('c.ts'), true);
	assert.equal(globToRegExp('src/*.ts').test('src/a/b.ts'), false, '* no cruza carpetas');
	assert.equal(globToRegExp('file?.md').test('file1.md'), true);

	assert.equal(retrievalQuery('<context>lots</context><userRequest>where is the token stored</userRequest>'), 'where is the token stored');
	assert.equal(retrievalQuery('plain   question\nhere'), 'plain question here');
	console.log('  ✓ RAG texto: identificadores, normalización, expansión es→en, cognados, exclusiones y generados');
}

// ---- rag/code.ts -------------------------------------------------------------

function testRagCode() {
	assert.deepEqual(languageOf('src/a.tsx'), { family: 'js', label: 'TypeScript' });
	assert.equal(languageOf('Dockerfile')?.label, 'Dockerfile');
	assert.equal(languageOf('x.unknownext'), undefined);

	const ts = [
		'import { a } from "./a";',
		'/** Stores the profile. */',
		'export class ProfileStore {',
		'  private cache = 1;',
		'  constructor(private readonly secrets: Secrets) {',
		'    if (x) {',
		'      call(() => {',
		'      });',
		'    }',
		'  }',
		'  async get(): Promise<Profile | null> {',
		'    return null;',
		'  }',
		'}',
		'export const MAX_SIZE = 10;',
		'export const parse = (text: string): number => 1;',
		'export interface Profile { a: string }',
		'type Local = { b: number };',
		'export default function main() {}',
	];
	assert.deepEqual(
		extractSymbols(ts, 'js').map((s) => `${s.line}:${s.kind}:${s.container ? `${s.container}.` : ''}${s.name}${s.exported ? '*' : ''}`),
		['3:class:ProfileStore*', '5:method:ProfileStore.constructor', '11:method:ProfileStore.get', '15:constant:MAX_SIZE*', '16:function:parse*', '17:interface:Profile*', '18:type:Local', '19:function:main*'],
		'clases, métodos (sin las llamadas de dentro), constantes, flechas, interfaces y tipos',
	);
	assert.deepEqual(
		extractSymbols(['class Store:', '    def save(self, token):', '        pass', '', 'def _helper():', '    pass'], 'python').map((s) => `${s.kind}:${s.container ?? ''}:${s.name}`),
		['class::Store', 'method:Store:save', 'function::_helper'],
	);
	assert.deepEqual(
		extractSymbols(['type Server struct {', '}', 'func (s *Server) Start() error {', '}', 'func helper() {}'], 'go').map((s) => `${s.kind}:${s.name}`),
		['struct:Server', 'method:Start', 'function:helper'],
	);
	assert.deepEqual(
		extractSymbols(['pub struct Cache;', 'impl Cache {', '    pub fn get(&self) {}', '}', 'fn main() {}'], 'rust').map((s) => `${s.kind}:${s.container ?? ''}:${s.name}`),
		['struct::Cache', 'class::Cache', 'method:Cache:get', 'function::main'],
	);
	assert.deepEqual(
		extractSymbols(['public class UserService {', '    public User find(String id) {', '        return repo.find(id);', '    }', '}'], 'jvm').map((s) => `${s.kind}:${s.name}`),
		['class:UserService', 'method:find'],
	);
	assert.deepEqual(extractSymbols(['# Title', 'text', '## Install', '```', '# not a heading? (yes in md)', '```'], 'markdown').slice(0, 2).map((s) => s.name), ['Title', 'Install']);

	assert.deepEqual(
		extractImports(['import x from "./x";', "import type { Y } from '../y/index.js';", 'export * from "./z";', 'const w = require("w-lib");', 'await import("./lazy")', 'import {', '  a,', '} from "@scope/pkg/sub";'].join('\n'), 'js'),
		['./x', '../y/index.js', './z', '@scope/pkg/sub', 'w-lib', './lazy'],
	);
	assert.deepEqual(extractImports('from .models import User\nfrom ..core.db import x\nimport os, sys\n', 'python'), ['.models', '..core.db', 'os', 'sys']);
	assert.deepEqual(extractImports('import (\n  "fmt"\n  "github.com/acme/app/internal/store"\n)\n', 'go'), ['fmt', 'github.com/acme/app/internal/store']);
	assert.deepEqual(extractImports('mod cache;\nuse crate::net::client;\n', 'rust'), ['cache', 'crate::net::client']);
	assert.deepEqual(extractImports('#include "util.h"\n#include <stdio.h>\n', 'c'), ['util.h']);

	// Chunks start at declarations (with their doc comment) and stay bounded.
	const long = Array.from({ length: 300 }, (_, i) => `  line ${i + 1};`);
	long[99] = '/** doc */';
	long[100] = 'export function second() {';
	long[199] = 'export function third() {';
	const symbols = extractSymbols(long, 'js');
	const chunks = chunkLines(long, symbols);
	assert.ok(chunks.some((chunk) => chunk.startLine === 100), 'el comentario va con su declaración');
	assert.ok(chunks.some((chunk) => chunk.startLine === 200));
	assert.ok(chunks.every((chunk) => chunk.endLine - chunk.startLine + 1 <= 90), 'ningún fragmento pasa de 90 líneas');
	assert.equal(chunks[0].startLine, 1);
	assert.equal(chunks[chunks.length - 1].endLine, 300);
	for (let i = 1; i < chunks.length; i += 1) assert.equal(chunks[i].startLine, chunks[i - 1].endLine + 1, 'sin huecos ni solapes');
	assert.deepEqual(chunkLines(['a', 'b'], []), [{ startLine: 1, endLine: 2 }], 'un archivo corto es un solo fragmento');
	console.log('  ✓ RAG código: lenguajes, símbolos (TS, Python, Go, Rust, Java, Markdown), imports y fragmentos');
}

// ---- rag/searchIndex.ts + projectMap.ts ---------------------------------------

const RAG_FILES: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'acme-app', scripts: { build: 'tsc', test: 'node test' }, dependencies: { '@acme/core': 'workspace:*', express: '^4' } }),
	'packages/core/package.json': JSON.stringify({ name: '@acme/core', main: 'dist/index.js' }),
	'packages/core/src/index.ts': "export { ProfileStore } from './secrets';\n",
	'packages/core/src/secrets.ts': [
		'/** Saves the access token in the secret storage. */',
		'export class ProfileStore {',
		'  async save(token: string): Promise<void> {',
		'    await this.storage.store("token", token);',
		'  }',
		'  async load(): Promise<string | undefined> {',
		'    return this.storage.get("token");',
		'  }',
		'}',
	].join('\n'),
	'src/server.ts': [
		"import express from 'express';",
		"import { ProfileStore } from '@acme/core';",
		"import { route } from './routes';",
		'export function startServer(port: number) {',
		'  const store = new ProfileStore();',
		'  express().listen(port);',
		'}',
	].join('\n'),
	'src/routes.ts': "import { formatDate } from './utils/date';\nexport function route(path: string) {\n  return formatDate(new Date()) + path;\n}\n",
	'src/utils/date.ts': 'export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n',
	'test/secrets.test.ts': "import { ProfileStore } from '../packages/core/src/secrets';\ntest('saves the token', () => new ProfileStore());\n",
	'README.md': '# Acme\n\nThe token is saved by the core package. Run the server with npm start.\n',
	'CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- Token storage.\n',
	'py/app/models.py': 'class User:\n    def save(self):\n        pass\n',
	'py/app/views.py': 'from .models import User\n\ndef show(user_id):\n    return User()\n',
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

	assert.equal(index.search('ProfileStore')[0].path, 'packages/core/src/secrets.ts', 'el archivo que declara el símbolo primero');
	assert.equal(index.search('¿dónde se guarda el token?')[0].path, 'packages/core/src/secrets.ts', 'pregunta en español → código en inglés');
	assert.equal(index.search('format date')[0].path, 'src/utils/date.ts');
	assert.equal(index.search('date', { pathPrefix: 'src/utils' }).every((hit) => hit.path.startsWith('src/utils/')), true);
	assert.notEqual(index.search('ProfileStore token test')[0]?.path, undefined);
	assert.ok(
		index.search('saves the token').findIndex((hit) => hit.path === 'test/secrets.test.ts') > index.search('saves the token').findIndex((hit) => hit.path === 'packages/core/src/secrets.ts'),
		'los tests, por detrás del código (salvo que se pidan)',
	);
	assert.equal(index.search('token').find((hit) => hit.path === 'CHANGELOG.md') === undefined || index.search('token')[0].path !== 'CHANGELOG.md', true, 'el changelog no gana');
	assert.deepEqual(index.search('date', { exclude: { path: 'src/utils/date.ts', startLine: 1, endLine: 3 } }).filter((hit) => hit.path === 'src/utils/date.ts'), [], 'lo que ya está en el prompt no vuelve');
	assert.ok(index.search('routes').some((hit) => hit.path === 'src/routes.ts'), 'el nombre del archivo cuenta aunque el texto no lo diga');
	assert.deepEqual(index.search('zzzz qqqq'), []);
	assert.deepEqual(index.search(''), []);

	// The active file's neighbours rank higher.
	const plain = index.search('function');
	const fromRoutes = index.search('function', { activePath: 'src/routes.ts' });
	assert.ok(fromRoutes.findIndex((hit) => hit.path === 'src/utils/date.ts') <= plain.findIndex((hit) => hit.path === 'src/utils/date.ts'));

	// Dependency graph: relative, workspace package (→ sources), Python relative, externals.
	const graph = index.dependencyGraph();
	assert.deepEqual([...(graph.imports.get('src/server.ts') ?? [])].sort(), ['packages/core/src/index.ts', 'src/routes.ts']);
	assert.deepEqual([...(graph.imports.get('py/app/views.py') ?? [])], ['py/app/models.py']);
	assert.deepEqual([...(graph.importers.get('packages/core/src/secrets.ts') ?? [])].sort(), ['packages/core/src/index.ts', 'test/secrets.test.ts']);
	assert.deepEqual([...(graph.external.get('express') ?? [])], ['src/server.ts']);

	// Updates and removals.
	index.upsert(analyzeFile('src/utils/date.ts', 'export function parseIsoDate(text: string) {}\n')!);
	assert.equal(index.search('formatDate').some((hit) => hit.path === 'src/utils/date.ts' && hit.symbols.includes('formatDate')), false);
	assert.equal(index.search('parseIsoDate')[0].path, 'src/utils/date.ts');
	assert.equal(index.removePrefix('src'), 3);
	assert.equal(index.search('startServer').some((hit) => hit.path.startsWith('src/')), false, 'nada de lo borrado');
	assert.equal(index.has('packages/core/src/secrets.ts'), true);

	assert.deepEqual(bestWindow(['a', 'b', 'token here', 'token token', 'c', 'd'], 10, ['token'], 2), { startLine: 12, endLine: 13 });
	console.log('  ✓ RAG búsqueda: ranking (símbolo, español→inglés, ruta, tests, changelog), alcance, exclusión, grafo e incremental');
}

async function testRagRendering() {
	setLocale('en');
	const index = ragIndex();
	const map = renderProjectMap(index, { workspaceName: 'acme', maxChars: 20_000 });
	assert.match(map, /Project map of “acme” — 12 files/);
	assert.match(map, /@acme\/core \(npm, packages\/core\/\)/);
	assert.match(map, /acme-app \(npm, \.\/\) — scripts: build, test/);
	assert.match(map, /packages\/core\/src\/secrets\.ts ← 2/, 'módulos más importados');
	assert.match(map, /express \(1\)/, 'dependencias externas');
	assert.match(map, /\n- src\/ \(2\): server\.ts \[startServer\], routes\.ts \[route\]\n- src\/utils\/ \(1\): date\.ts \[formatDate\]\n/);
	assert.ok(renderProjectMap(index, { workspaceName: 'acme', maxChars: 300 }).length <= 300, 'respeta el presupuesto');

	const detail = renderFileDetail(index, 'packages/core/src/secrets.ts', 5_000)!;
	assert.match(detail, /2: class ProfileStore \(export\)/);
	assert.match(detail, /3: method ProfileStore\.save/);
	assert.match(detail, /Imported by: packages\/core\/src\/index\.ts, test\/secrets\.test\.ts/);
	assert.equal(renderFileDetail(index, 'nope.ts', 100), undefined);
	assert.match(renderFolderDetail(index, 'src/', 5_000)!, /Folder src\/ — 3 indexed files[\s\S]*utils\/date\.ts \[formatDate\]/);
	assert.match(renderSummary(index, 'acme', 2_000), /Workspace “acme”: 12 files indexed \(TypeScript 6/);

	const hits = index.search('¿dónde se guarda el token?', { limit: 3 });
	const lines = (path: string, start: number, end: number) =>
		Promise.resolve(RAG_FILES[path]?.split('\n').slice(start - 1, end));
	const rendered = await renderHits(hits, lines, { maxLines: 30, maxChars: 4_000 });
	assert.equal(rendered[0].hit.path, 'packages/core/src/secrets.ts');
	const result = formatSearchResults('token', rendered, [], () => 'typescript');
	assert.match(result, /1\. packages\/core\/src\/secrets\.ts:1-9 — ProfileStore, save, load\n```typescript\n\/\*\* Saves the access token/);
	assert.match(result, /m365_read_file/);
	assert.match(formatSearchResults('zzz', [], [], () => ''), /No results in the project index for “zzz”/);
	const context = formatAutoContext('SUMMARY', rendered.slice(0, 1), hits.slice(1), () => 'ts');
	assert.match(context, /^PROJECT CONTEXT — retrieved automatically/);
	assert.match(context, /SUMMARY[\s\S]*packages\/core\/src\/secrets\.ts:1-9[\s\S]*Also relevant: [^\n]+[\s\S]*END OF PROJECT CONTEXT/);
	setLocale('es');
	assert.match(formatAutoContext('S', [], [], () => ''), /^CONTEXTO DEL PROYECTO/);
	setLocale('en');
	console.log('  ✓ RAG texto para el modelo: mapa, detalle de archivo/carpeta, resultados y contexto automático');
}

// ---- web search ----------------------------------------------------------------

function testWebHelpers() {
	setLocale('en');
	const template = {
		source: 'officeweb',
		tone: 'Gpt_5_5_Chat',
		plugins: [{ Id: 'BingWebSearch', Category: 'FirstParty' }],
		optionsSets: ['enterprise_flux_web', 'enable_web_grounding'],
		allowedMessageTypes: ['Chat', 'InternalSearchQuery', 'RenderCardRequest'],
		conversationId: 'old-conversation',
		isStartOfSession: false,
		previousMessages: [{ text: 'secret earlier turn' }],
		traceId: 'abc',
		requestId: 'old-request',
		message: { author: 'user', text: 'what the user typed on the web', locale: 'fr-FR', market: 'es-ES', requestId: 'r1', messageId: 'm1', timestamp: '2020-01-01', attachments: [{ x: 1 }] },
	};
	const args = buildWebInvocationArgs(template, 'PROMPT', 'Claude_Sonnet', 'new-conversation');
	assert.deepEqual(args.plugins, template.plugins, 'los plugins (búsqueda web) se conservan');
	assert.deepEqual(args.optionsSets, template.optionsSets);
	assert.equal(args.conversationId, 'new-conversation');
	assert.equal(args.isStartOfSession, true);
	assert.equal(args.tone, 'Claude_Sonnet');
	assert.equal('previousMessages' in args, false, 'nada de la conversación de la web');
	assert.notEqual(args.requestId, 'old-request');
	assert.notEqual(args.traceId, 'abc');
	const message = args.message as Record<string, unknown>;
	assert.equal(message.text, 'PROMPT');
	assert.equal(message.locale, 'en-US');
	assert.equal(message.market, 'es-ES', 'el resto del mensaje capturado se queda');
	assert.notEqual(message.requestId, 'r1');
	assert.equal('attachments' in message, false);
	assert.equal(template.message.text, 'what the user typed on the web', 'la plantilla no se toca');
	assert.equal(buildWebInvocationArgs(template, 'P', null, 'c').tone, 'Gpt_5_5_Chat', 'sin tone, el capturado');

	assert.equal(capturedVariants('wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=x&variants=feature.a,feature.b&source=officeweb'), 'feature.a,feature.b');
	assert.equal(capturedVariants('wss://x/y?access_token=x'), undefined);
	assert.equal(capturedVariants(null), undefined);
	assert.equal(capturedVariants('not a url'), undefined);

	assert.deepEqual(
		sourcesOf({ sourceAttributions: [{ providerDisplayName: 'MDN', seeMoreUrl: 'https://developer.mozilla.org/x' }, { seeMoreUrl: 'javascript:alert(1)' }, { url: 'https://example.com', title: ' Example ' }, 'junk'] }),
		[{ title: 'MDN', url: 'https://developer.mozilla.org/x' }, { title: 'Example', url: 'https://example.com' }],
		'sólo enlaces http(s)',
	);
	assert.deepEqual(sourcesOf({}), []);

	assert.match(buildWebSearchPrompt('  latest Node LTS  '), /web search[\s\S]*Query:\nlatest Node LTS$/);
	const result = formatWebResult('node', 'Node 24 is LTS [^1^].\n\n\n\nIt was released [^2^].', [
		{ title: 'Node.js', url: 'https://nodejs.org' },
		{ title: 'Node.js again', url: 'https://nodejs.org' },
		{ title: 'Blog', url: 'https://blog.example' },
	]);
	assert.match(result, /^Web search: “node”\n\nNode 24 is LTS \[1\]\.\n\nIt was released \[2\]\.\n\nSources:\n1\. Node\.js — https:\/\/nodejs\.org\n2\. Blog — https:\/\/blog\.example$/);
	assert.match(formatWebResult('x', '  ', []), /returned nothing/);
	assert.equal(sourcesMarkdown([]), '');
	assert.match(sourcesMarkdown([{ title: 'A [b]', url: 'https://a' }]), /\n\nSources:\n1\. \[A b\]\(https:\/\/a\)/);
	setLocale('es');
	assert.match(buildWebSearchPrompt('x'), /Responde en español/);
	setLocale('en');
	console.log('  ✓ búsqueda web: petición desde la plantilla capturada, variants, fuentes y resultado');
}

/** A web turn: the captured plugins and variants go out; cards mid-answer do not end it; sources come back. */
async function testWebTurn() {
	let sawUrl = '';
	let sawArgs: Record<string, unknown> | undefined;
	const wss = new WebSocketServer({ port: 0 });
	await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
	const port = (wss.address() as { port: number }).port;
	wss.on('connection', (socket, request) => {
		sawUrl = request.url ?? '';
		let handshaken = false;
		socket.on('message', (data) => {
			for (const chunk of data.toString().split(RS)) {
				if (!chunk) continue;
				const frame = JSON.parse(chunk);
				if (!handshaken) {
					handshaken = true;
					socket.send('{}' + RS);
					continue;
				}
				if (frame.target !== 'chat') continue;
				sawArgs = frame.arguments[0];
				const update = (messages: unknown[]) => socket.send(JSON.stringify({ type: 1, target: 'update', arguments: [{ messages }] }) + RS);
				setTimeout(() => {
					update([{ author: 'bot', messageType: 'InternalSearchQuery', text: 'node lts' }]);
					update([{ author: 'bot', text: 'Node 24', messageId: 'a' }]);
					update([{ author: 'bot', messageType: 'RenderCardRequest' }]);
					update([{ author: 'bot', text: 'Node 24 is the LTS [^1^].', messageId: 'a', sourceAttributions: [{ providerDisplayName: 'Node.js', seeMoreUrl: 'https://nodejs.org' }] }]);
					update([{ author: 'bot', messageType: 'EndOfRequest' }]);
				}, 5);
			}
		});
	});
	const profile = {
		...makeProfile(port),
		endpoint: `wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=old&variants=feat.web&source=officeweb`,
		invocationTemplate: { tone: 'Gpt_5_5_Chat', plugins: [{ Id: 'BingWebSearch' }], previousMessages: [1], message: { author: 'user', text: 'old' } },
	};
	let text = '';
	const sources: unknown[] = [];
	// Through the retry wrapper, as the extension calls it: the sources must survive it.
	await streamCopilotTurnWithRetry({
		profile,
		endpointBase: mockBase(port),
		prompt: 'PROMPT',
		tone: null,
		mode: 'web',
		signal: new AbortController().signal,
		callbacks: { onText: (delta) => (text += delta), onSources: (found) => sources.push(...found) },
	});
	wss.close();
	assert.equal(text, 'Node 24 is the LTS [^1^].', 'una tarjeta a mitad de respuesta no corta el turno');
	assert.deepEqual(sources, [{ title: 'Node.js', url: 'https://nodejs.org' }]);
	assert.match(sawUrl, /[?&]variants=feat\.web(?:&|$)/);
	assert.deepEqual(sawArgs?.plugins, [{ Id: 'BingWebSearch' }]);
	assert.equal('previousMessages' in (sawArgs ?? {}), false);
	assert.equal(new URL(`http://x${sawUrl}`).searchParams.get('ConversationId'), sawArgs?.conversationId, 'el id de la URL y el del mensaje coinciden');

	// Without a captured invocation a web turn is refused up front.
	await assert.rejects(
		streamCopilotTurn({
			profile: { ...makeProfile(port), invocationTemplate: null },
			endpointBase: mockBase(port),
			prompt: 'P',
			tone: null,
			mode: 'web',
			signal: new AbortController().signal,
			callbacks: { onText: () => {} },
		}),
		/browser extension or the userscript/,
	);
	console.log('  ✓ turno con web: plugins y variants capturados, tarjetas a mitad, fuentes, id de conversación');
}


// ---- modelCatalog.ts (dynamic models) ---------------------------------------

function testModelCatalog() {
	assert.equal(prettyTone('Gpt_5_6_Reasoning'), 'GPT 5.6 Reasoning');
	assert.equal(prettyTone('Gpt_5_7_Chat'), 'GPT 5.7');
	assert.equal(prettyTone('Claude_Opus_4_1'), 'Claude Opus 4.1');
	assert.equal(prettyTone('Claude_Sonnet'), 'Claude Sonnet');
	assert.equal(prettyTone('magic'), 'Magic');
	assert.equal(modelIdForTone('Gpt_5_7_Chat'), 'm365-copilot-tone-gpt-5-7-chat');

	// models.json: shape validated, junk dropped, detail as text or {en, es}.
	assert.equal(parseModelCatalog({ nope: [] }), null);
	assert.equal(parseModelCatalog(null), null);
	assert.deepEqual(
		parseModelCatalog({
			models: [
				{ tone: 'Gpt_5_7_Chat', name: '  GPT 5.7  ', detail: { en: 'New', es: 'Nuevo' } },
				{ tone: 'bad tone with spaces' },
				{ tone: '<script>' },
				'Claude_Opus',
				{ tone: 'Gpt_5_5_Chat', hidden: true },
				{ tone: 'Phi_5', detail: 'Only text' },
			],
		}),
		[
			{ tone: 'Gpt_5_7_Chat', name: 'GPT 5.7', detail: { en: 'New', es: 'Nuevo' }, hidden: false },
			{ tone: 'Claude_Opus' },
			{ tone: 'Gpt_5_5_Chat', name: undefined, detail: undefined, hidden: true },
			{ tone: 'Phi_5', name: undefined, detail: { en: 'Only text', es: 'Only text' }, hidden: false },
		],
	);
	assert.deepEqual(parseCustomModels(['Gpt_5_8_Chat', { tone: 'X_1', name: 'X' }, 42, { name: 'no tone' }]), [
		{ tone: 'Gpt_5_8_Chat', hidden: false },
		{ tone: 'X_1', name: 'X', detail: undefined, hidden: false },
	]);
	assert.deepEqual(parseCustomModels('nope'), []);

	// Only built-ins: exactly the shipped list, Auto first.
	const builtinOnly = mergeModels({ catalog: [], observed: [], custom: [] });
	assert.deepEqual(builtinOnly.map((model) => model.id), BUILTIN_MODELS.map((model) => model.id));
	assert.equal(builtinOnly[0].tone, null);

	const merged = mergeModels({
		catalog: [
			{ tone: 'Gpt_5_7_Chat', name: 'GPT 5.7', detail: { en: 'Newest', es: 'El más nuevo' } },
			{ tone: 'Gpt_5_5_Chat', hidden: true },
			{ tone: 'Claude_Sonnet', name: 'Claude Sonnet 5' },
		],
		observed: ['Gpt_5_6_Chat', 'Claude_Opus_4_1', 'Gpt_5_7_Chat', 'not valid!'],
		custom: [{ tone: 'Gpt_5_5_Chat', name: 'GPT 5.5 (mine)' }, { tone: 'Exp_Model' }],
	});
	const byTone = new Map(merged.map((model) => [model.tone, model]));
	assert.equal(merged[0].id, 'm365-copilot-auto', 'Auto stays first');
	// A catalog rename keeps the built-in id (settings that point to it keep working).
	assert.equal(byTone.get('Claude_Sonnet')?.name, 'M365 Copilot · Claude Sonnet 5');
	assert.equal(byTone.get('Claude_Sonnet')?.id, 'm365-copilot-claude');
	// New from the catalog, with its own description.
	assert.equal(byTone.get('Gpt_5_7_Chat')?.source, 'catalog');
	assert.deepEqual(byTone.get('Gpt_5_7_Chat')?.detail, { en: 'Newest', es: 'El más nuevo' });
	// Detected in the web app: readable name; already-known tones are not duplicated.
	assert.equal(byTone.get('Claude_Opus_4_1')?.name, 'M365 Copilot · Claude Opus 4.1');
	assert.equal(byTone.get('Claude_Opus_4_1')?.source, 'observed');
	assert.equal(merged.filter((model) => model.tone === 'Gpt_5_6_Chat').length, 1);
	assert.equal(byTone.has('not valid!'), false);
	// Hidden by the catalog, but the user listed it: custom wins, with its name.
	assert.equal(byTone.get('Gpt_5_5_Chat')?.name, 'M365 Copilot · GPT 5.5 (mine)');
	assert.equal(byTone.get('Exp_Model')?.source, 'custom');
	// Hidden by the catalog and nobody asked for it back: gone.
	assert.equal(
		mergeModels({ catalog: [{ tone: 'Gpt_5_5_Reasoning', hidden: true }], observed: [], custom: [] }).some(
			(model) => model.tone === 'Gpt_5_5_Reasoning',
		),
		false,
	);
	// Bounded, whatever the sources say.
	const flood = Array.from({ length: 80 }, (_, i) => `Model_${i}`);
	assert.ok(mergeModels({ catalog: [], observed: flood, custom: [] }).length <= 30);

	// Announced once: built-ins never, new ones until they are known.
	assert.deepEqual(unannounced(merged, new Set()).map((model) => model.tone), ['Gpt_5_7_Chat', 'Claude_Opus_4_1', 'Exp_Model']);
	assert.deepEqual(unannounced(merged, new Set(['Gpt_5_7_Chat', 'Claude_Opus_4_1', 'Exp_Model'])), []);

	// The catalog published in the repository parses and only lists valid tones.
	const published = parseModelCatalog(JSON.parse(readFileSync(new URL('../../../models.json', import.meta.url), 'utf8')));
	assert.ok(published && published.length > 0, 'models.json must parse');
	for (const entry of published!) assert.ok(entry.name, `${entry.tone} needs a name`);

	// The profile the browser side sends keeps the observed tones (and only valid ones).
	const profile = parsePastedProfile(
		JSON.stringify({ accessToken: fakeJwt(), observedTones: ['Gpt_5_7_Chat', 'bad tone', 7, 'Claude_Opus'] }),
	);
	assert.deepEqual(profile.observedTones, ['Gpt_5_7_Chat', 'Claude_Opus']);
	assert.equal(parsePastedProfile(fakeJwt()).observedTones, undefined);
	console.log('  ✓ modelos dinámicos: catálogo validado, detectados en la web, propios, ocultar retirados y anuncio único');
}

async function main() {
	// The assertions below were written against the Spanish catalog (the
	// extension's original language); the i18n tests switch locale themselves
	// and put it back.
	setLocale('es');
	console.log('i18n');
	testI18nCatalogs();
	testManifestLocalization();
	testPromptsFollowLocale();
	console.log('profile.ts');
	testProfileParsing();
	console.log('markdown.ts');
	testMarkdownFormatting();
	console.log('toolProtocol.ts');
	testToolProtocol();
	testHostToolDecoding();
	console.log('toolCatalog.ts');
	testToolCatalog();
	testSpawnAgentsNeverTrimmed();
	testToolPromptRendering();
	console.log('commitMessage.ts');
	testCommitMessageValidation();
	console.log('client.ts');
	await runRing('snapshot');
	await runRing('delta');
	await testCancellation();
	await test401FastFail();
	await testEndpointRotation();
	await testMultiMessageToolCall();
	await test429Retry();
	await testAuthErrorNotRetried();
	console.log('subagents.ts');
	await testConcurrencyLimiter();
	await testSubagentLoop();
	await testSubagentLoopStepLimit();
	await testSubagentLoopWallClock();
	testClipClosesDanglingFence();
	await testToolLoopStreamsProse();
	console.log('lineDiff.ts');
	testLineDiff();
	console.log('participant / editor');
	testParticipantPrompts();
	testCommitMessageGeneration();
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
	setLocale('es');
	console.log('\nAll tests passed.');
}

main().catch((err) => {
	console.error('\nTEST FAILURE:', err);
	process.exit(1);
});

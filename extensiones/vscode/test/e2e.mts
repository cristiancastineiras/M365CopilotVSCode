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
import { streamCopilotTurn, CopilotAuthError } from '../src/client.ts';

import { MarkdownStreamFormatter } from '../src/markdown.ts';
import { parsePastedProfile } from '../src/profile.ts';
import {
	M365_TOOL_NAMES,
	ToolCallDecoder,
	buildToolCatalog,
	buildToolProtocolInstructions,
	type ToolCatalog,
} from '../src/toolProtocol.ts';
import { replaceTextOnce } from '../tools/replaceText.ts';
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
function start401Server(): Promise<{ port: number; close: () => void }> {
	return new Promise((resolve) => {
		const server = http.createServer((_req, res) => {
			res.writeHead(401);
			res.end();
		});
		server.on('upgrade', (_req, socket) => {
			socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
			socket.destroy();
		});
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			resolve({ port, close: () => server.close() });
		});
	});
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
 * dropped that first chunk (the opening `<m3` of `<m365_tool_call>`), so the
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
						// deltas. This exact shape used to lose the opening `<m3`.
						snapshot([{ author: 'bot', text: '<m3', messageId: 'm2' }]);
						delta('65_tool_call>{"name":"m365_read_file","');
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

async function main() {
	console.log('profile.ts');
	testProfileParsing();
	console.log('markdown.ts');
	testMarkdownFormatting();
	console.log('toolProtocol.ts');
	testToolProtocol();
	testHostToolDecoding();
	console.log('toolCatalog.ts');
	testToolCatalog();
	testToolPromptRendering();
	console.log('client.ts');
	await runRing('snapshot');
	await runRing('delta');
	await testCancellation();
	await test401FastFail();
	await testEndpointRotation();
	await testMultiMessageToolCall();
	console.log('\nAll tests passed.');
}

main().catch((err) => {
	console.error('\nTEST FAILURE:', err);
	process.exit(1);
});

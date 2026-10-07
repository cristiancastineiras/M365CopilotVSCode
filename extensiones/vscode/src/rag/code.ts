/**
 * What the project index (RAG) knows about one file without a language
 * server: its language, its symbols (functions, classes, methods…), what it
 * imports, and how it splits into chunks for search.
 *
 * Regular expressions, line by line — deliberately: it works the same for a
 * dozen languages, needs no extension or process per language, and is fast
 * enough to index thousands of files in the background. It misses exotic
 * syntax, which only costs a bit of ranking, never correctness: the model
 * still reads the real file before editing it.
 *
 * Kept free of the `vscode` import so the tests can exercise all of it.
 */

export type LanguageFamily =
	| 'js'
	| 'python'
	| 'go'
	| 'rust'
	| 'jvm'
	| 'csharp'
	| 'swift'
	| 'c'
	| 'php'
	| 'ruby'
	| 'shell'
	| 'sql'
	| 'markdown'
	| 'style'
	| 'markup'
	| 'data'
	| 'text';

export interface FileLanguage {
	readonly family: LanguageFamily;
	/** For people: `TypeScript`, `Python`… */
	readonly label: string;
}

const LANGUAGES: Readonly<Record<string, FileLanguage>> = (() => {
	const table: Record<string, FileLanguage> = {};
	const add = (family: LanguageFamily, label: string, extensions: string) => {
		for (const extension of extensions.split(' ')) table[extension] = { family, label };
	};
	add('js', 'TypeScript', 'ts tsx mts cts');
	add('js', 'JavaScript', 'js jsx mjs cjs');
	add('js', 'Vue', 'vue');
	add('js', 'Svelte', 'svelte');
	add('python', 'Python', 'py pyi');
	add('go', 'Go', 'go');
	add('rust', 'Rust', 'rs');
	add('jvm', 'Java', 'java');
	add('jvm', 'Kotlin', 'kt kts');
	add('jvm', 'Scala', 'scala sc');
	add('jvm', 'Groovy', 'groovy gradle');
	add('jvm', 'Dart', 'dart');
	add('csharp', 'C#', 'cs');
	add('csharp', 'F#', 'fs fsx');
	add('swift', 'Swift', 'swift');
	add('c', 'C', 'c h');
	add('c', 'C++', 'cc cpp cxx hpp hh hxx ino');
	add('c', 'Objective-C', 'm mm');
	add('php', 'PHP', 'php');
	add('ruby', 'Ruby', 'rb rake gemspec');
	add('shell', 'Shell', 'sh bash zsh fish');
	add('shell', 'PowerShell', 'ps1 psm1 psd1');
	add('shell', 'Batch', 'bat cmd');
	add('sql', 'SQL', 'sql');
	add('markdown', 'Markdown', 'md mdx markdown');
	add('text', 'Text', 'txt rst adoc');
	add('style', 'CSS', 'css scss sass less styl');
	add('markup', 'HTML', 'html htm xhtml');
	add('markup', 'XML', 'xml xaml csproj fsproj vbproj props targets plist');
	add('data', 'JSON', 'json jsonc json5');
	add('data', 'YAML', 'yml yaml');
	add('data', 'TOML', 'toml');
	add('data', 'INI', 'ini cfg conf properties env');
	add('data', 'GraphQL', 'graphql gql');
	add('data', 'Protobuf', 'proto');
	add('data', 'Terraform', 'tf tfvars hcl');
	add('shell', 'Make', 'mk');
	add('jvm', 'Lua', 'lua');
	add('python', 'R', 'r');
	add('ruby', 'Elixir', 'ex exs');
	return table;
})();

/** Files known by name rather than extension. */
const NAMED_FILES: Readonly<Record<string, FileLanguage>> = {
	dockerfile: { family: 'shell', label: 'Dockerfile' },
	makefile: { family: 'shell', label: 'Make' },
	jenkinsfile: { family: 'jvm', label: 'Groovy' },
	gemfile: { family: 'ruby', label: 'Ruby' },
	rakefile: { family: 'ruby', label: 'Ruby' },
	'.gitignore': { family: 'data', label: 'Ignore file' },
	'.env': { family: 'data', label: 'INI' },
};

/** The language of a path, or undefined for a file not worth indexing (unknown extension). */
export function languageOf(path: string): FileLanguage | undefined {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const named = NAMED_FILES[name] ?? (name.startsWith('dockerfile') ? NAMED_FILES.dockerfile : undefined);
	if (named) return named;
	const dot = name.lastIndexOf('.');
	return dot > 0 ? LANGUAGES[name.slice(dot + 1)] : undefined;
}

export type SymbolKind =
	| 'function'
	| 'method'
	| 'class'
	| 'interface'
	| 'type'
	| 'enum'
	| 'struct'
	| 'trait'
	| 'module'
	| 'constant'
	| 'section'
	| 'table';

export interface CodeSymbol {
	readonly name: string;
	readonly kind: SymbolKind;
	/** 1-based. */
	readonly line: number;
	/** The class/impl/type it is declared in, for methods. */
	readonly container?: string;
	readonly exported?: boolean;
}

type Rule = readonly [RegExp, (match: RegExpExecArray, indent: number) => Omit<CodeSymbol, 'line' | 'container'> | null];

/** Words that look like a call or a statement, never a method name. */
const NOT_A_NAME: ReadonlySet<string> = new Set(
	'if for while switch catch return function new else do try with await typeof delete throw yield super this import export case elif except lambda print'.split(
		' ',
	),
);

const named = (name: string | undefined, kind: SymbolKind, exported?: boolean) =>
	name && !NOT_A_NAME.has(name) ? { name, kind, ...(exported ? { exported } : {}) } : null;

const JS_RULES: readonly Rule[] = [
	[/^\s*(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, (m) => named(m[2], 'function', !!m[1])],
	[/^\s*(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, (m) => named(m[2], 'class', !!m[1])],
	[/^\s*(export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, (m) => named(m[2], 'interface', !!m[1])],
	[/^\s*(export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, (m) => named(m[2], 'type', !!m[1])],
	[/^\s*(export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, (m) => named(m[2], 'enum', !!m[1])],
	[/^\s*(export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$.]*)/, (m) => named(m[2], 'module', !!m[1])],
	[
		/^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
		(m) => named(m[2], 'function', !!m[1]),
	],
	[/^(export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=/, (m) => named(m[2], 'constant', !!m[1])],
];

/** A method declaration inside a class body: name(params) { … with no nested parens in the params. */
const JS_METHOD_RE =
	/^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|declare|get|set)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\([^()]*\)\s*(?::\s*[^={}()]+)?\s*\{\s*$/;

const PYTHON_RULES: readonly Rule[] = [
	[/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, (m, indent) => named(m[2], indent > 0 ? 'method' : 'function', !m[2].startsWith('_'))],
	[/^(\s*)class\s+([A-Za-z_]\w*)/, (m) => named(m[2], 'class', !m[2].startsWith('_'))],
];

const GO_RULES: readonly Rule[] = [
	[/^func\s+\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)[^)]*\)\s*([A-Za-z_]\w*)\s*[[(]/, (m) => named(m[2], 'method', /^[A-Z]/.test(m[2]))],
	[/^func\s+([A-Za-z_]\w*)\s*[[(]/, (m) => named(m[1], 'function', /^[A-Z]/.test(m[1]))],
	[/^type\s+([A-Za-z_]\w*)\s+struct\b/, (m) => named(m[1], 'struct', /^[A-Z]/.test(m[1]))],
	[/^type\s+([A-Za-z_]\w*)\s+interface\b/, (m) => named(m[1], 'interface', /^[A-Z]/.test(m[1]))],
	[/^type\s+([A-Za-z_]\w*)\s/, (m) => named(m[1], 'type', /^[A-Z]/.test(m[1]))],
];

const RUST_RULES: readonly Rule[] = [
	[
		/^(\s*)(pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern\s+"[^"]*")\s+)*fn\s+([A-Za-z_]\w*)/,
		(m, indent) => named(m[3], indent > 0 ? 'method' : 'function', !!m[2]),
	],
	[/^\s*(pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, (m) => named(m[2], 'struct', !!m[1])],
	[/^\s*(pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, (m) => named(m[2], 'enum', !!m[1])],
	[/^\s*(pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)/, (m) => named(m[2], 'trait', !!m[1])],
	[/^\s*(pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, (m) => named(m[2], 'type', !!m[1])],
	[/^\s*(pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*\{/, (m) => named(m[2], 'module', !!m[1])],
	[/^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_][\w:]*)/, (m) => named(m[1], 'class')],
];

const TYPE_DECL_RE =
	/^\s*(?:@\w+(?:\([^)]*\))?\s+)*((?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|override|export|inline|value|annotation|enum|readonly|file|fileprivate)\s+)*)(class|interface|enum|record|struct|object|trait|protocol|extension)\s+([A-Za-z_]\w*)/;
const FUN_DECL_RE =
	/^(\s*)(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|internal|override|open|static|final|suspend|inline|mutating|operator|infix|tailrec|class|async|private\(set\))\s+)*(?:fun|func|def)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/;
const METHOD_DECL_RE =
	/^(\s+)(?:\[[^\]]*\]\s*)?(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|virtual|override|async|sealed|extern|unsafe|new|partial|default)\s+)+(?:<[^>]+>\s+)?[\w<>[\],.?]+(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)\s*\(/;

const JVM_RULES: readonly Rule[] = [
	[TYPE_DECL_RE, (m) => named(m[3], declKind(m[2]), !/private|internal|fileprivate/.test(m[1]))],
	[FUN_DECL_RE, (m, indent) => named(m[2], indent > 0 ? 'method' : 'function', true)],
	[METHOD_DECL_RE, (m) => named(m[2], 'method', true)],
];

const C_RULES: readonly Rule[] = [
	[/^\s*(?:typedef\s+)?(class|struct|union|enum(?:\s+class)?|namespace)\s+([A-Za-z_]\w*)\s*(?:[:{]|$)/, (m) => named(m[2], declKind(m[1]))],
	[
		/^(?!\s)(?:[\w:*&<>,~]+\s+)+\**&?([A-Za-z_~][\w:~]*)\s*\([^;]*$/,
		(m) => named(m[1].split('::').pop(), m[1].includes('::') ? 'method' : 'function'),
	],
	[/^#define\s+([A-Z_][A-Z0-9_]{2,})\b/, (m) => named(m[1], 'constant')],
];

const PHP_RULES: readonly Rule[] = [
	[/^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?([A-Za-z_]\w*)/, (m, indent) => named(m[2], indent > 0 ? 'method' : 'function', true)],
	[/^\s*(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/, (m) => named(m[2], declKind(m[1]), true)],
];

const RUBY_RULES: readonly Rule[] = [
	[/^(\s*)def\s+(?:self\.)?([A-Za-z_][\w?!=]*)/, (m, indent) => named(m[2], indent > 0 ? 'method' : 'function', true)],
	[/^\s*(class|module)\s+([A-Z][\w:]*)/, (m) => named(m[2], m[1] === 'class' ? 'class' : 'module', true)],
	[/^\s*defmodule\s+([A-Z][\w.]*)/, (m) => named(m[1], 'module', true)],
	[/^\s*defp?\s+([a-z_][\w?!]*)/, (m) => named(m[1], 'function', true)],
];

const SHELL_RULES: readonly Rule[] = [
	[/^\s*function\s+([A-Za-z_][\w-]*)/, (m) => named(m[1], 'function')],
	[/^\s*([A-Za-z_][\w-]*)\s*\(\)\s*\{?/, (m) => named(m[1], 'function')],
	[/^([A-Za-z_][\w-]*)\s*:(?!=)/, (m) => named(m[1], 'function')], // make targets
];

const SQL_RULES: readonly Rule[] = [
	[
		/^\s*create\s+(?:or\s+replace\s+)?(table|view|function|procedure|trigger|index|type)\s+(?:if\s+not\s+exists\s+)?([\w."[\]]+)/i,
		(m) => named(m[2].replace(/["[\]]/g, ''), /table|view|index/i.test(m[1]) ? 'table' : 'function'),
	],
];

const MARKDOWN_RULES: readonly Rule[] = [[/^(#{1,4})\s+(.+?)\s*#*\s*$/, (m) => ({ name: m[2].slice(0, 80), kind: 'section' })]];

function declKind(keyword: string): SymbolKind {
	if (/interface|protocol/.test(keyword)) return 'interface';
	if (/enum/.test(keyword)) return 'enum';
	if (/struct|record|union/.test(keyword)) return 'struct';
	if (/trait/.test(keyword)) return 'trait';
	if (/namespace|object|module|extension/.test(keyword)) return 'module';
	return 'class';
}

const RULES: Partial<Record<LanguageFamily, readonly Rule[]>> = {
	js: JS_RULES,
	python: PYTHON_RULES,
	go: GO_RULES,
	rust: RUST_RULES,
	jvm: JVM_RULES,
	csharp: JVM_RULES,
	swift: JVM_RULES,
	c: C_RULES,
	php: PHP_RULES,
	ruby: RUBY_RULES,
	shell: SHELL_RULES,
	sql: SQL_RULES,
	markdown: MARKDOWN_RULES,
};

/** Kinds that open a scope whose indented declarations are its methods. */
const CONTAINER_KINDS: ReadonlySet<SymbolKind> = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'module']);
const MAX_SYMBOLS = 400;

/** The symbols declared in a file, in order. */
export function extractSymbols(lines: readonly string[], family: LanguageFamily): CodeSymbol[] {
	const rules = RULES[family];
	if (!rules) return [];
	const symbols: CodeSymbol[] = [];
	// Open containers (classes…), innermost last, with their indentation.
	const containers: { name: string; indent: number }[] = [];
	let inBlockComment = false;

	for (let index = 0; index < lines.length && symbols.length < MAX_SYMBOLS; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (family !== 'markdown' && family !== 'python' && family !== 'ruby' && family !== 'shell') {
			if (inBlockComment) {
				if (trimmed.includes('*/')) inBlockComment = false;
				continue;
			}
			if (trimmed.startsWith('/*')) {
				inBlockComment = !trimmed.includes('*/');
				continue;
			}
			if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
		} else if (family !== 'markdown' && trimmed.startsWith('#')) {
			continue;
		}

		const indent = line.length - line.trimStart().length;
		while (containers.length > 0 && indent <= containers[containers.length - 1].indent && !trimmed.startsWith('{')) {
			containers.pop();
		}

		let symbol: Omit<CodeSymbol, 'line' | 'container'> | null = null;
		for (const [pattern, build] of rules) {
			const match = pattern.exec(line);
			if (match && (symbol = build(match, indent))) break;
		}
		if (!symbol && family === 'js' && containers.length > 0) {
			const method = JS_METHOD_RE.exec(line);
			if (method && !NOT_A_NAME.has(method[1])) symbol = { name: method[1], kind: 'method' };
		}
		if (!symbol) continue;

		const container = containers[containers.length - 1]?.name;
		const kind = symbol.kind === 'function' && container && family !== 'markdown' ? 'method' : symbol.kind;
		symbols.push({ ...symbol, kind, line: index + 1, ...(container && kind === 'method' ? { container } : {}) });
		if (CONTAINER_KINDS.has(symbol.kind)) containers.push({ name: symbol.name, indent });
	}
	return symbols;
}

const MAX_IMPORTS = 200;

/** What a file imports, as written (`./foo`, `@scope/pkg`, `os.path`, `"x.h"`…). */
export function extractImports(text: string, family: LanguageFamily): string[] {
	const found = new Set<string>();
	const collect = (pattern: RegExp, group = 1) => {
		for (const match of text.matchAll(pattern)) {
			const value = match[group]?.trim();
			if (value && found.size < MAX_IMPORTS) found.add(value);
		}
	};
	switch (family) {
		case 'js':
			collect(/^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"\n]+)['"]/gm);
			collect(/\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g);
			collect(/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g);
			break;
		case 'python':
			collect(/^\s*from\s+(\.*[\w.]*)\s+import\b/gm);
			for (const match of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
				for (const name of match[1].split(',')) if (found.size < MAX_IMPORTS) found.add(name.trim());
			}
			break;
		case 'go':
			collect(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm);
			for (const block of text.matchAll(/^\s*import\s*\(([\s\S]*?)\)/gm)) {
				for (const match of block[1].matchAll(/"([^"]+)"/g)) if (found.size < MAX_IMPORTS) found.add(match[1]);
			}
			break;
		case 'rust':
			collect(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm);
			collect(/^\s*(?:pub\s+)?use\s+((?:crate|super|self)(?:::\w+)+)/gm);
			break;
		case 'jvm':
			collect(/^\s*import\s+(?:static\s+)?([\w.]+)/gm);
			break;
		case 'csharp':
			collect(/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm);
			break;
		case 'swift':
			collect(/^\s*import\s+(\w+)/gm);
			break;
		case 'c':
			collect(/^\s*#\s*include\s+"([^"]+)"/gm);
			break;
		case 'php':
			collect(/\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g);
			collect(/^\s*use\s+([\w\\]+)\s*;/gm);
			break;
		case 'ruby':
			collect(/^\s*require_relative\s+['"]([^'"]+)['"]/gm);
			collect(/^\s*require\s+['"]([^'"]+)['"]/gm);
			break;
		case 'style':
			collect(/@(?:import|use|forward)\s+(?:url\()?['"]([^'"]+)['"]/g);
			break;
		case 'markup':
			collect(/<script[^>]+src=["']([^"']+)["']/gi);
			collect(/<link[^>]+href=["']([^"']+\.css)["']/gi);
			break;
		default:
			break;
	}
	return [...found];
}

export interface ChunkRange {
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
}

const SINGLE_CHUNK_LINES = 90;
const MIN_CHUNK_LINES = 12;
const MAX_CHUNK_LINES = 90;
const TARGET_CHUNK_LINES = 60;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#(?!#)|@|"""|''')/;

/**
 * Splits a file into chunks for search: whole when short; otherwise at
 * declarations (pulling their doc comments and decorators along), with long
 * stretches cut near blank lines.
 */
export function chunkLines(lines: readonly string[], symbols: readonly CodeSymbol[]): ChunkRange[] {
	const total = lines.length;
	if (total === 0) return [];
	if (total <= SINGLE_CHUNK_LINES) return [{ startLine: 1, endLine: total }];

	const starts = new Set<number>();
	for (const symbol of symbols) {
		let line = symbol.line;
		// Doc comments and decorators belong to the declaration below them.
		for (let steps = 0; steps < 15 && line > 1 && COMMENT_LINE_RE.test(lines[line - 2]); steps += 1) line -= 1;
		if (line > 1) starts.add(line);
	}

	const coarse: ChunkRange[] = [];
	let start = 1;
	for (const boundary of [...starts].sort((a, b) => a - b)) {
		if (boundary - start >= MIN_CHUNK_LINES) {
			coarse.push({ startLine: start, endLine: boundary - 1 });
			start = boundary;
		}
	}
	coarse.push({ startLine: start, endLine: total });

	const chunks: ChunkRange[] = [];
	for (const chunk of coarse) {
		let from = chunk.startLine;
		while (chunk.endLine - from + 1 > MAX_CHUNK_LINES) {
			let cut = from + TARGET_CHUNK_LINES - 1;
			for (let line = cut; line > cut - 15; line -= 1) {
				if (!lines[line - 1]?.trim()) {
					cut = line;
					break;
				}
			}
			chunks.push({ startLine: from, endLine: cut });
			from = cut + 1;
		}
		chunks.push({ startLine: from, endLine: chunk.endLine });
	}
	// A sliver at the end reads better attached to the chunk before it.
	const last = chunks[chunks.length - 1];
	if (chunks.length > 1 && last.endLine - last.startLine < 5) {
		chunks.pop();
		chunks[chunks.length - 1] = { startLine: chunks[chunks.length - 1].startLine, endLine: last.endLine };
	}
	return chunks;
}

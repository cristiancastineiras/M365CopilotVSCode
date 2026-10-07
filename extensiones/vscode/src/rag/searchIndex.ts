/**
 * The project index (RAG) itself: every indexed file's symbols, imports and
 * chunks, a BM25 inverted index over the chunks, and the dependency graph
 * between files (who imports whom).
 *
 * Ranking is lexical — BM25 over identifier-aware terms (see text.ts) — with
 * boosts for what tends to matter in code: the query naming the file or a
 * symbol declared in the chunk, the chunk covering more of the query's words,
 * and closeness to the file the user is working in. No embeddings: nothing
 * leaves the machine, nothing to download, and it is exact on identifiers,
 * which is what people ask about in code.
 *
 * Kept free of the `vscode` import so the tests can exercise all of it.
 */
import { chunkLines, extractImports, extractSymbols, languageOf, type CodeSymbol, type LanguageFamily } from './code';
import { foldCase, queryTerms, splitIdentifier, termFrequencies, tokenize } from './text';

export interface IndexedChunk {
	/** 1-based, inclusive. */
	readonly startLine: number;
	readonly endLine: number;
	/** Names of the symbols declared in it. */
	readonly symbols: readonly string[];
	readonly terms: ReadonlyMap<string, number>;
	readonly length: number;
}

export interface IndexedFile {
	/** Workspace-relative, `/`-separated: the same paths the workspace tools take. */
	readonly path: string;
	readonly family: LanguageFamily;
	readonly language: string;
	readonly size: number;
	readonly lineCount: number;
	readonly symbols: readonly CodeSymbol[];
	readonly imports: readonly string[];
	readonly chunks: readonly IndexedChunk[];
	/** For a package manifest: the package's name and what it declares. */
	readonly manifest?: PackageManifest;
}

export interface PackageManifest {
	readonly kind: 'npm' | 'python' | 'rust' | 'go' | 'maven' | 'gradle' | 'dotnet' | 'php' | 'ruby';
	readonly name?: string;
	/** npm: `main`/`module`/`types`/`bin`/`exports` targets. */
	readonly entries: readonly string[];
	/** npm: script names. */
	readonly scripts: readonly string[];
	/** Dependency names declared in it. */
	readonly dependencies: readonly string[];
}

/** One file's analysis: language, symbols, imports, chunks with their terms. */
export function analyzeFile(path: string, text: string): IndexedFile | undefined {
	const language = languageOf(path);
	if (!language) return undefined;
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const symbols = extractSymbols(lines, language.family);
	const chunks = chunkLines(lines, symbols).map((range): IndexedChunk => {
		const chunkText = lines.slice(range.startLine - 1, range.endLine).join('\n');
		const declared = symbols.filter((symbol) => symbol.line >= range.startLine && symbol.line <= range.endLine);
		const terms = termFrequencies(chunkText);
		let length = 0;
		for (const count of terms.values()) length += count;
		return { ...range, symbols: declared.map((symbol) => symbol.name), terms, length: Math.max(length, 1) };
	});
	const manifest = manifestOf(path, text);
	return {
		path,
		family: language.family,
		language: language.label,
		size: text.length,
		lineCount: lines.length,
		symbols,
		imports: extractImports(text, language.family),
		chunks,
		...(manifest ? { manifest } : {}),
	};
}

/** What a package manifest declares; undefined for any other file. */
export function manifestOf(path: string, text: string): PackageManifest | undefined {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	if (name === 'package.json') {
		try {
			const json = JSON.parse(text) as Record<string, unknown>;
			const entries = new Set<string>();
			for (const key of ['main', 'module', 'types', 'typings', 'browser']) {
				if (typeof json[key] === 'string') entries.add(json[key] as string);
			}
			const collect = (value: unknown) => {
				if (typeof value === 'string') entries.add(value);
				else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
			};
			collect(json.bin);
			collect(json.exports);
			const dependencies = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) =>
				json[key] && typeof json[key] === 'object' ? Object.keys(json[key] as object) : [],
			);
			return {
				kind: 'npm',
				...(typeof json.name === 'string' ? { name: json.name } : {}),
				entries: [...entries].slice(0, 12),
				scripts: json.scripts && typeof json.scripts === 'object' ? Object.keys(json.scripts as object).slice(0, 30) : [],
				dependencies: dependencies.slice(0, 80),
			};
		} catch {
			return { kind: 'npm', entries: [], scripts: [], dependencies: [] };
		}
	}
	const tomlName = (section: string) => new RegExp(`\\[${section}\\][^[]*?\\bname\\s*=\\s*["']([^"']+)["']`).exec(text)?.[1];
	if (name === 'pyproject.toml') return { kind: 'python', name: tomlName('project') ?? tomlName('tool\\.poetry'), entries: [], scripts: [], dependencies: [] };
	if (name === 'cargo.toml') return { kind: 'rust', name: tomlName('package'), entries: [], scripts: [], dependencies: [] };
	if (name === 'go.mod') return { kind: 'go', name: /^module\s+(\S+)/m.exec(text)?.[1], entries: [], scripts: [], dependencies: [] };
	if (name === 'pom.xml') return { kind: 'maven', name: /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1], entries: [], scripts: [], dependencies: [] };
	if (name === 'build.gradle' || name === 'build.gradle.kts') return { kind: 'gradle', entries: [], scripts: [], dependencies: [] };
	if (name.endsWith('.csproj')) return { kind: 'dotnet', name: name.slice(0, -'.csproj'.length), entries: [], scripts: [], dependencies: [] };
	if (name === 'composer.json') return { kind: 'php', name: /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1], entries: [], scripts: [], dependencies: [] };
	if (name === 'gemfile') return { kind: 'ruby', entries: [], scripts: [], dependencies: [] };
	return undefined;
}

export interface SearchOptions {
	readonly limit?: number;
	/** Only files under this folder (workspace-relative). */
	readonly pathPrefix?: string;
	/** The file the user is in: it and its neighbours rank a little higher. */
	readonly activePath?: string;
	/** Files open in editors. */
	readonly openPaths?: readonly string[];
	/** Lines already in the prompt, so not worth returning again. */
	readonly exclude?: { readonly path: string; readonly startLine: number; readonly endLine: number };
	/** At most this many chunks per file. */
	readonly perFile?: number;
}

export interface SearchHit {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly score: number;
	readonly symbols: readonly string[];
	/** The query terms found in the chunk (for picking the lines to show). */
	readonly matched: readonly string[];
}

interface Posting {
	readonly path: string;
	readonly chunk: number;
	readonly tf: number;
}

const K1 = 1.2;
const B = 0.75;
const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|spec|e2e)(?:\/|$)|[._-](?:test|spec)\.[^/]+$/i;
const CHANGELOG_PATH_RE = /(?:^|\/)(?:changelog|changes|history)(?:\.[a-z]+)?$|(?:^|\/)\.changeset\//i;
const DOC_FAMILIES: ReadonlySet<LanguageFamily> = new Set(['markdown', 'text']);
/** Query words that ask for documentation, release notes or tests rather than code. */
const DOC_WORDS_RE = /^(?:readme|doc|docs|documentation|documentacion|guide|guia|manual|tutorial|explain)$/;
const CHANGELOG_WORDS_RE = /^(?:changelog|release|version|cambio|novedade|historial)$/;

/** File the JS/TS resolution tries for `./x` (and `./x.js` written for a `.ts` file). */
const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json'];

export class SearchIndex {
	private readonly files = new Map<string, IndexedFile>();
	private readonly postings = new Map<string, Posting[]>();
	private readonly pathTerms = new Map<string, ReadonlySet<string>>();
	private totalLength = 0;
	private chunkCount = 0;
	private graph: DependencyGraph | undefined;
	/** Bumped on every change: lets callers cache what they computed from it. */
	version = 0;

	get size(): number {
		return this.files.size;
	}

	get chunks(): number {
		return this.chunkCount;
	}

	has(path: string): boolean {
		return this.files.has(path);
	}

	get(path: string): IndexedFile | undefined {
		return this.files.get(path);
	}

	paths(): string[] {
		return [...this.files.keys()];
	}

	all(): IterableIterator<IndexedFile> {
		return this.files.values();
	}

	upsert(file: IndexedFile): void {
		this.remove(file.path);
		this.files.set(file.path, file);
		this.pathTerms.set(file.path, new Set(tokenize(file.path.replace(/[./\\-]/g, ' '))));
		for (const [index, chunk] of file.chunks.entries()) {
			this.totalLength += chunk.length;
			this.chunkCount += 1;
			for (const [term, tf] of chunk.terms) {
				let list = this.postings.get(term);
				if (!list) this.postings.set(term, (list = []));
				list.push({ path: file.path, chunk: index, tf });
			}
		}
		this.changed();
	}

	remove(path: string): boolean {
		const file = this.files.get(path);
		if (!file) return false;
		const terms = new Set<string>();
		for (const chunk of file.chunks) {
			this.totalLength -= chunk.length;
			this.chunkCount -= 1;
			for (const term of chunk.terms.keys()) terms.add(term);
		}
		for (const term of terms) {
			const list = this.postings.get(term);
			if (!list) continue;
			const kept = list.filter((posting) => posting.path !== path);
			if (kept.length > 0) this.postings.set(term, kept);
			else this.postings.delete(term);
		}
		this.files.delete(path);
		this.pathTerms.delete(path);
		this.changed();
		return true;
	}

	/** Removes a file, or everything under a folder. */
	removePrefix(path: string): number {
		let removed = this.remove(path) ? 1 : 0;
		const prefix = `${path.replace(/\/+$/, '')}/`;
		for (const candidate of this.files.keys()) if (candidate.startsWith(prefix) && this.remove(candidate)) removed += 1;
		return removed;
	}

	clear(): void {
		this.files.clear();
		this.postings.clear();
		this.pathTerms.clear();
		this.totalLength = 0;
		this.chunkCount = 0;
		this.changed();
	}

	private changed(): void {
		this.graph = undefined;
		this.version += 1;
	}

	/** The chunks that best answer `query`, best first. */
	search(query: string, options: SearchOptions = {}): SearchHit[] {
		const terms = queryTerms(query);
		if (terms.length === 0 || this.chunkCount === 0) return [];
		const limit = options.limit ?? 10;
		const perFile = options.perFile ?? 3;
		const prefix = options.pathPrefix ? `${options.pathPrefix.replace(/^\.?\/+|\/+$/g, '')}/` : '';
		const inScope = (path: string) => !prefix || path.startsWith(prefix) || path === prefix.slice(0, -1);
		const averageLength = this.totalLength / this.chunkCount;
		const originals = terms.filter((term) => term.original).length || terms.length;

		const scores = new Map<string, { path: string; chunk: number; score: number; matched: Set<string>; covered: number }>();
		for (const { term, weight, original } of terms) {
			const list = this.postings.get(term);
			if (!list) continue;
			const idf = Math.log(1 + (this.chunkCount - list.length + 0.5) / (list.length + 0.5));
			for (const posting of list) {
				if (!inScope(posting.path)) continue;
				const chunk = this.files.get(posting.path)!.chunks[posting.chunk];
				const saturation = (posting.tf * (K1 + 1)) / (posting.tf + K1 * (1 - B + (B * chunk.length) / averageLength));
				const key = `${posting.path}#${posting.chunk}`;
				let entry = scores.get(key);
				if (!entry) scores.set(key, (entry = { path: posting.path, chunk: posting.chunk, score: 0, matched: new Set(), covered: 0 }));
				entry.score += idf * saturation * weight;
				if (!entry.matched.has(term)) {
					entry.matched.add(term);
					if (original) entry.covered += 1;
				}
			}
		}

		// Files the query names but whose text never matched still deserve a
		// mention ("where is the secrets file?").
		const meanIdf = Math.log(1 + this.chunkCount / 2);
		for (const [path, pathTerms] of this.pathTerms) {
			if (!inScope(path)) continue;
			const hits = terms.filter((term) => pathTerms.has(term.term));
			if (hits.length === 0 || scores.has(`${path}#0`)) continue;
			const entry = { path, chunk: 0, score: hits.length * meanIdf * 0.5, matched: new Set(hits.map((term) => term.term)), covered: hits.filter((term) => term.original).length };
			scores.set(`${path}#0`, entry);
		}

		const wantsTests = terms.some((term) => /^(?:test|spec|prueba)/.test(term.term));
		const wantsDocs = terms.some((term) => DOC_WORDS_RE.test(term.term));
		const wantsChangelog = terms.some((term) => CHANGELOG_WORDS_RE.test(term.term));
		const neighbours = options.activePath ? this.neighbours(options.activePath) : new Set<string>();
		const open = new Set(options.openPaths ?? []);
		const fullQuery = new Set(terms.filter((term) => term.weight >= 1.5).map((term) => term.term));

		const ranked: SearchHit[] = [];
		for (const entry of scores.values()) {
			const file = this.files.get(entry.path)!;
			const chunk = file.chunks[entry.chunk];
			if (options.exclude && options.exclude.path === file.path && chunk.startLine <= options.exclude.endLine && chunk.endLine >= options.exclude.startLine) {
				continue;
			}
			let score = entry.score;
			const pathTerms = this.pathTerms.get(file.path)!;
			const pathMatches = terms.filter((term) => pathTerms.has(term.term)).length;
			score *= Math.min(2, 1 + 0.35 * pathMatches);
			const isDoc = DOC_FAMILIES.has(file.family);
			const symbolTerms = new Set(chunk.symbols.flatMap(symbolTermsOf));
			const symbolMatches = terms.filter((term) => symbolTerms.has(term.term)).length;
			// Code declarations matter more than headings of a document.
			score *= Math.min(isDoc ? 1.3 : 2.5, 1 + (isDoc ? 0.15 : 0.5) * symbolMatches);
			if (!isDoc && chunk.symbols.some((name) => fullQuery.has(foldCase(name)))) score *= 1.5;
			score *= 0.5 + entry.covered / originals;
			if (options.activePath === file.path) score *= 1.3;
			else if (neighbours.has(file.path)) score *= 1.15;
			if (open.has(file.path)) score *= 1.1;
			if (!wantsTests && TEST_PATH_RE.test(file.path)) score *= 0.75;
			if (CHANGELOG_PATH_RE.test(file.path)) score *= wantsChangelog ? 1 : 0.5;
			else if (isDoc && !wantsDocs) score *= 0.75;
			if (file.family === 'data' && pathMatches === 0) score *= 0.8;
			ranked.push({
				path: file.path,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
				score,
				symbols: chunk.symbols,
				matched: [...entry.matched],
			});
		}
		ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine);

		const perFileCount = new Map<string, number>();
		const hits: SearchHit[] = [];
		for (const hit of ranked) {
			const count = perFileCount.get(hit.path) ?? 0;
			if (count >= perFile) continue;
			perFileCount.set(hit.path, count + 1);
			hits.push(hit);
			if (hits.length >= limit) break;
		}
		return hits;
	}

	/** Files the given one imports and files that import it. */
	neighbours(path: string): Set<string> {
		const graph = this.dependencyGraph();
		return new Set([...(graph.imports.get(path) ?? []), ...(graph.importers.get(path) ?? [])]);
	}

	/** Who imports whom, resolved to indexed files; plus the external packages each file uses. */
	dependencyGraph(): DependencyGraph {
		if (this.graph) return this.graph;
		const resolver = new ImportResolver(this.files.values());
		const imports = new Map<string, Set<string>>();
		const importers = new Map<string, Set<string>>();
		const external = new Map<string, Set<string>>();
		for (const file of this.files.values()) {
			for (const specifier of file.imports) {
				const resolved = resolver.resolve(file, specifier);
				if (resolved.kind === 'files') {
					for (const target of resolved.paths) {
						if (target === file.path) continue;
						addTo(imports, file.path, target);
						addTo(importers, target, file.path);
					}
				} else if (resolved.kind === 'external') {
					addTo(external, resolved.name, file.path);
				}
			}
		}
		this.graph = { imports, importers, external };
		return this.graph;
	}
}

export interface DependencyGraph {
	/** file → files it imports. */
	readonly imports: ReadonlyMap<string, ReadonlySet<string>>;
	/** file → files that import it. */
	readonly importers: ReadonlyMap<string, ReadonlySet<string>>;
	/** external package → files that use it. */
	readonly external: ReadonlyMap<string, ReadonlySet<string>>;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
	let set = map.get(key);
	if (!set) map.set(key, (set = new Set()));
	set.add(value);
}

/** `ProfileStore` → `profilestore`, `profile`, `store`. */
function symbolTermsOf(name: string): string[] {
	return tokenize(name);
}

type Resolution =
	| { readonly kind: 'files'; readonly paths: readonly string[] }
	| { readonly kind: 'external'; readonly name: string }
	| { readonly kind: 'unknown' };

/**
 * Turns an import as written into the indexed files it refers to, per
 * language. Workspace packages (`@scope/core` in a monorepo) resolve to their
 * sources; anything else bare is an external dependency.
 */
export class ImportResolver {
	private readonly paths = new Set<string>();
	private readonly byName = new Map<string, string[]>();
	private readonly byDir = new Map<string, string[]>();
	/** Workspace npm packages: name → folder. */
	private readonly packages = new Map<string, { dir: string; entries: readonly string[] }>();
	/** Folders holding a package.json, deepest first. */
	private readonly packageDirs: string[] = [];

	constructor(files: Iterable<IndexedFile>) {
		for (const file of files) {
			this.paths.add(file.path);
			const slash = file.path.lastIndexOf('/');
			const name = file.path.slice(slash + 1);
			const dir = slash === -1 ? '' : file.path.slice(0, slash);
			push(this.byName, name.toLowerCase(), file.path);
			push(this.byDir, dir, file.path);
			if (file.manifest?.kind === 'npm') {
				this.packageDirs.push(dir);
				if (file.manifest.name) this.packages.set(file.manifest.name, { dir, entries: file.manifest.entries });
			}
		}
		this.packageDirs.sort((a, b) => b.length - a.length);
	}

	/** The folder of the package a file belongs to (nearest package.json). */
	private packageRootOf(dir: string): string {
		return this.packageDirs.find((root) => !root || dir === root || dir.startsWith(`${root}/`)) ?? '';
	}

	resolve(from: IndexedFile, specifier: string): Resolution {
		const dir = dirname(from.path);
		switch (from.family) {
			case 'js':
			case 'style':
			case 'markup':
				return this.resolveJs(dir, specifier);
			case 'python':
				return this.resolvePython(dir, specifier);
			case 'go':
				return this.resolveGo(specifier);
			case 'rust':
				return this.resolveRust(from.path, specifier);
			case 'jvm':
			case 'csharp':
				return this.resolveQualified(specifier, ['.java', '.kt', '.scala', '.groovy', '.cs']);
			case 'php':
				return specifier.includes('\\')
					? this.resolveQualified(specifier.replace(/\\/g, '.'), ['.php'])
					: this.files([this.firstExisting([join(dir, specifier)])]);
			case 'c':
				return this.files([this.firstExisting([join(dir, specifier)]) ?? this.uniqueBySuffix(specifier)]);
			case 'ruby':
				return this.files([this.firstExisting([join(dir, specifier), `${join(dir, specifier)}.rb`, `lib/${specifier}.rb`])]);
			default:
				return { kind: 'unknown' };
		}
	}

	private files(paths: readonly (string | undefined)[]): Resolution {
		const found = paths.filter((path): path is string => Boolean(path));
		return found.length > 0 ? { kind: 'files', paths: found } : { kind: 'unknown' };
	}

	private firstExisting(candidates: readonly string[]): string | undefined {
		return candidates.find((candidate) => this.paths.has(candidate));
	}

	private uniqueBySuffix(specifier: string): string | undefined {
		const name = specifier.slice(specifier.lastIndexOf('/') + 1).toLowerCase();
		const matches = (this.byName.get(name) ?? []).filter((path) => path.endsWith(specifier) || path.endsWith(`/${specifier}`));
		return matches.length === 1 ? matches[0] : undefined;
	}

	private withExtensions(base: string): string | undefined {
		const stripped = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
		const candidates = [base];
		for (const root of stripped === base ? [base] : [stripped, base]) {
			for (const extension of JS_EXTENSIONS) candidates.push(`${root}${extension}`);
			for (const extension of JS_EXTENSIONS) candidates.push(`${root}/index${extension}`);
		}
		// Sass partials: `@use 'colors'` → `_colors.scss`.
		const slash = base.lastIndexOf('/');
		candidates.push(`${base.slice(0, slash + 1)}_${base.slice(slash + 1)}.scss`);
		return this.firstExisting(candidates);
	}

	private resolveJs(dir: string, specifier: string): Resolution {
		const clean = specifier.split(/[?#]/)[0];
		if (clean.startsWith('.') || clean.startsWith('/')) {
			const base = clean.startsWith('/') ? normalize(clean.slice(1)) : join(dir, clean);
			return this.files([this.withExtensions(base)]);
		}
		if (/^(?:https?:|data:|node:)/.test(clean)) return clean.startsWith('node:') ? { kind: 'external', name: clean } : { kind: 'unknown' };
		// Path aliases (`@/utils`, `~/components`, as in Vite/WXT/Nuxt/Next):
		// the package's root or its src/.
		const alias = /^[@~]\/(.*)$/.exec(clean);
		if (alias) {
			const root = this.packageRootOf(dir);
			const prefix = root ? `${root}/` : '';
			const found = this.withExtensions(`${prefix}${alias[1]}`) ?? this.withExtensions(`${prefix}src/${alias[1]}`);
			return found ? this.files([found]) : { kind: 'unknown' };
		}
		const packageName = clean.startsWith('@') ? clean.split('/').slice(0, 2).join('/') : clean.split('/')[0];
		const workspacePackage = this.packages.get(packageName);
		if (workspacePackage) {
			const subpath = clean.slice(packageName.length).replace(/^\//, '');
			const root = workspacePackage.dir ? `${workspacePackage.dir}/` : '';
			if (subpath) return this.files([this.withExtensions(`${root}${subpath}`) ?? this.withExtensions(`${root}src/${subpath}`)]);
			// Prefer the sources over the build output the manifest points at.
			const fromEntries = workspacePackage.entries
				.map((entry) => entry.replace(/^\.\//, ''))
				.map((entry) => this.withExtensions(`${root}${entry.replace(/^(?:dist|lib|out|build)\//, 'src/').replace(/\.d\.ts$/, '')}`) ?? this.withExtensions(`${root}${entry}`));
			return this.files([this.withExtensions(`${root}src/index`) ?? fromEntries.find(Boolean) ?? this.withExtensions(`${root}index`)]);
		}
		return { kind: 'external', name: packageName };
	}

	private resolvePython(dir: string, specifier: string): Resolution {
		const dots = /^\.*/.exec(specifier)![0].length;
		const module = specifier.slice(dots).replace(/\./g, '/');
		if (dots > 0) {
			let base = dir;
			for (let level = 1; level < dots; level += 1) base = dirname(base);
			const target = module ? join(base, module) : base;
			return this.files([this.firstExisting([`${target}.py`, `${target}/__init__.py`])]);
		}
		const found = this.firstExisting([`${module}.py`, `${module}/__init__.py`, `src/${module}.py`, `src/${module}/__init__.py`]);
		if (found) return this.files([found]);
		const suffix = this.uniqueBySuffix(`${module}.py`) ?? this.uniqueBySuffix(`${module}/__init__.py`);
		return suffix ? this.files([suffix]) : { kind: 'external', name: specifier.split('.')[0] };
	}

	private resolveGo(specifier: string): Resolution {
		// A package path ends with the folder that holds it: match the longest folder suffix.
		const parts = specifier.split('/');
		for (let start = 0; start < parts.length; start += 1) {
			const suffix = parts.slice(start).join('/');
			const dirs = [...this.byDir.keys()].filter((dir) => dir === suffix || dir.endsWith(`/${suffix}`));
			if (dirs.length === 1) {
				const files = (this.byDir.get(dirs[0]) ?? []).filter((path) => path.endsWith('.go') && !path.endsWith('_test.go'));
				if (files.length > 0) return { kind: 'files', paths: files.slice(0, 5) };
			}
			if (dirs.length > 1) break;
		}
		return { kind: 'external', name: parts.slice(0, 3).join('/') };
	}

	private resolveRust(fromPath: string, specifier: string): Resolution {
		const dir = dirname(fromPath);
		const name = fromPath.slice(fromPath.lastIndexOf('/') + 1);
		if (!specifier.includes('::')) {
			// `mod x;` next to lib.rs/main.rs/mod.rs, or in a folder named after this file.
			const base = /^(?:lib|main|mod)\.rs$/.test(name) ? dir : join(dir, name.replace(/\.rs$/, ''));
			return this.files([this.firstExisting([join(base, `${specifier}.rs`), join(base, `${specifier}/mod.rs`)])]);
		}
		const segments = specifier.split('::');
		const head = segments.shift()!;
		const root = head === 'crate' ? this.crateRoot(fromPath) : head === 'super' ? dirname(dir) : dir;
		for (let length = segments.length; length > 0; length -= 1) {
			const target = join(root, segments.slice(0, length).join('/'));
			const found = this.firstExisting([`${target}.rs`, `${target}/mod.rs`]);
			if (found) return this.files([found]);
		}
		return { kind: 'unknown' };
	}

	private crateRoot(fromPath: string): string {
		const index = fromPath.lastIndexOf('/src/');
		return index === -1 ? (fromPath.startsWith('src/') ? 'src' : dirname(fromPath)) : fromPath.slice(0, index + 4);
	}

	/** `com.acme.Foo` → `…/com/acme/Foo.java`, or the only `Foo.*` in the project. */
	private resolveQualified(specifier: string, extensions: readonly string[]): Resolution {
		const path = specifier.replace(/\.\*$/, '').replace(/\./g, '/');
		for (const extension of extensions) {
			const found = this.uniqueBySuffix(`${path}${extension}`);
			if (found) return this.files([found]);
		}
		const last = specifier.split('.').pop() ?? '';
		if (/^[A-Z]/.test(last)) {
			for (const extension of extensions) {
				const matches = this.byName.get(`${last}${extension}`.toLowerCase()) ?? [];
				if (matches.length === 1) return this.files(matches);
			}
		}
		return { kind: 'external', name: specifier.split('.').slice(0, 2).join('.') };
	}
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

export function dirname(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** Joins and normalizes `.`/`..` segments of `/`-separated relative paths. */
export function join(base: string, relative: string): string {
	return normalize(base ? `${base}/${relative}` : relative);
}

function normalize(path: string): string {
	const out: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') out.pop();
		else out.push(segment);
	}
	return out.join('/');
}

/** Picks the densest window of `maxLines` lines for the matched terms (1-based, within the range). */
export function bestWindow(
	lines: readonly string[],
	startLine: number,
	matched: readonly string[],
	maxLines: number,
): { startLine: number; endLine: number } {
	const endLine = startLine + lines.length - 1;
	if (lines.length <= maxLines) return { startLine, endLine };
	const wanted = new Set(matched);
	const hits = lines.map((line) => tokenize(line).filter((term) => wanted.has(term)).length);
	let best = 0;
	let bestStart = 0;
	let sum = hits.slice(0, maxLines).reduce((total, count) => total + count, 0);
	best = sum;
	for (let start = 1; start + maxLines <= lines.length; start += 1) {
		sum += hits[start + maxLines - 1] - hits[start - 1];
		if (sum > best) {
			best = sum;
			bestStart = start;
		}
	}
	return { startLine: startLine + bestStart, endLine: startLine + bestStart + maxLines - 1 };
}

/** Words of a symbol name for display/matching: `ProfileStore` → `Profile Store`. */
export function humanizeSymbol(name: string): string {
	return splitIdentifier(name).join(' ');
}

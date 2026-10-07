/**
 * The project index (RAG) as text for the model:
 *
 *  - the project map: languages, packages, the folder structure with what each
 *    area holds, entry points and the most imported modules — what a new team
 *    member would want before touching anything;
 *  - the detail of one file (outline, imports, who uses it) or one folder;
 *  - search results and the automatic context added to chat requests, with
 *    the best lines of each chunk, within a character budget.
 *
 * Kept free of the `vscode` import: file text comes in through `readLines`.
 */
import type { CodeSymbol } from './code';
import { bestWindow, dirname, type IndexedFile, type SearchHit, type SearchIndex } from './searchIndex';
import { fenceFor } from '../participantPrompts';
import { t } from '../i18n';

/** Names that usually explain or configure a project. */
const KEY_FILE_RE =
	/^(?:readme(?:\.[a-z]+)?|package\.json|tsconfig(?:\.[\w-]+)?\.json|pyproject\.toml|setup\.py|requirements[\w-]*\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|[\w.-]+\.csproj|[\w.-]+\.sln|composer\.json|gemfile|makefile|dockerfile|docker-compose\.ya?ml|compose\.ya?ml|\.env\.example|turbo\.json|pnpm-workspace\.yaml|vite\.config\.\w+|webpack\.config\.\w+|angular\.json|next\.config\.\w+)$/i;
/** File names that usually start a program. */
const ENTRY_NAME_RE = /^(?:main|index|app|server|cli|extension|program|startup|manage|wsgi|asgi|__main__|lib|mod)\.[a-z]+$/i;

export interface MapOptions {
	readonly workspaceName: string;
	readonly maxChars: number;
}

/** The project map. */
export function renderProjectMap(index: SearchIndex, options: MapOptions): string {
	const files = [...index.all()];
	if (files.length === 0) return t('rag.map.empty');
	const sections: string[] = [];

	const languages = countBy(files, (file) => file.language);
	sections.push(
		t('rag.map.header', options.workspaceName, files.length, index.chunks) +
			`\n${t('rag.map.languages')} ${top(languages, 8).map(([label, count]) => `${label} ${count}`).join(' · ')}`,
	);

	const manifests = files.filter((file) => file.manifest);
	if (manifests.length > 0) {
		const lines = manifests.slice(0, 15).map((file) => {
			const manifest = file.manifest!;
			const where = dirname(file.path) || '.';
			const scripts = manifest.scripts.length > 0 ? ` — scripts: ${manifest.scripts.slice(0, 8).join(', ')}` : '';
			return `- ${manifest.name ?? file.path} (${manifest.kind}, ${where}/)${scripts}`;
		});
		sections.push(`${t('rag.map.packages')}\n${lines.join('\n')}`);
	}

	sections.push(`${t('rag.map.structure')}\n${renderAreas(files, 40).join('\n')}`);

	const keyFiles = files.filter((file) => KEY_FILE_RE.test(baseName(file.path))).map((file) => file.path);
	if (keyFiles.length > 0) sections.push(`${t('rag.map.keyFiles')} ${keyFiles.slice(0, 20).join(', ')}`);

	const entries = entryPoints(index, files);
	if (entries.length > 0) sections.push(`${t('rag.map.entries')} ${entries.slice(0, 12).join(', ')}`);

	const graph = index.dependencyGraph();
	const central = [...graph.importers.entries()]
		.map(([path, importers]) => [path, importers.size] as const)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 10);
	if (central.length > 0) {
		sections.push(`${t('rag.map.central')}\n${central.map(([path, count]) => `- ${path} ← ${count}`).join('\n')}`);
	}
	const external = [...graph.external.entries()]
		.map(([name, users]) => [name, users.size] as const)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 15);
	if (external.length > 0) sections.push(`${t('rag.map.external')} ${external.map(([name, count]) => `${name} (${count})`).join(', ')}`);

	return clipText(sections.join('\n\n'), options.maxChars);
}

/**
 * One line per area (a folder at depth ≤ 2 holding files): how many files,
 * its subfolders, and its most telling files with their main symbols.
 */
function renderAreas(files: readonly IndexedFile[], maxLines: number): string[] {
	const areas = new Map<string, IndexedFile[]>();
	for (const file of files) {
		const parts = file.path.split('/');
		const area = parts.slice(0, Math.min(parts.length - 1, 2)).join('/');
		push(areas, area, file);
	}
	const lines: string[] = [];
	for (const [area, members] of [...areas.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		if (lines.length >= maxLines) {
			lines.push(t('rag.map.moreAreas', areas.size - lines.length));
			break;
		}
		const subfolders = countBy(
			members.filter((file) => dirname(file.path) !== area),
			(file) => file.path.slice(area ? area.length + 1 : 0).split('/')[0],
		);
		const direct = members.filter((file) => dirname(file.path) === area);
		const shown = [...direct]
			.sort((a, b) => fileWeight(b) - fileWeight(a))
			.slice(0, 6)
			.map((file) => `${baseName(file.path)}${mainSymbols(file.symbols, 2)}`);
		const folders = top(subfolders, 8).map(([name, count]) => `${name}/ (${count})`);
		const parts = [...folders, ...shown];
		lines.push(`- ${area || '.'}/ (${members.length})${parts.length > 0 ? `: ${parts.join(', ')}` : ''}`);
	}
	return lines;
}

/** Files that look like where a program starts: manifest entries and conventional names near the top. */
function entryPoints(index: SearchIndex, files: readonly IndexedFile[]): string[] {
	const found = new Set<string>();
	for (const file of files) {
		if (file.manifest?.kind !== 'npm') continue;
		const root = dirname(file.path);
		for (const entry of file.manifest.entries) {
			const clean = entry.replace(/^\.\//, '');
			const candidates = [clean, clean.replace(/^(?:dist|lib|out|build)\//, 'src/')].flatMap((candidate) => {
				const base = candidate.replace(/\.(?:c|m)?js$|\.d\.ts$/, '');
				return [candidate, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mts`];
			});
			const hit = candidates.map((candidate) => (root ? `${root}/${candidate}` : candidate)).find((path) => index.has(path));
			if (hit) found.add(hit);
		}
	}
	for (const file of files) {
		if (file.path.split('/').length <= 4 && ENTRY_NAME_RE.test(baseName(file.path)) && file.family !== 'data') found.add(file.path);
	}
	return [...found];
}

/** The detail of a file: outline, imports, who imports it. */
export function renderFileDetail(index: SearchIndex, path: string, maxChars: number): string | undefined {
	const file = index.get(path);
	if (!file) return undefined;
	const graph = index.dependencyGraph();
	const lines = [t('rag.file.header', file.path, file.language, file.lineCount)];
	if (file.symbols.length > 0) {
		lines.push(t('rag.file.symbols'));
		for (const symbol of file.symbols.slice(0, 120)) {
			const container = symbol.container ? `${symbol.container}.` : '';
			lines.push(`  ${symbol.line}: ${symbol.kind} ${container}${symbol.name}${symbol.exported ? ' (export)' : ''}`);
		}
		if (file.symbols.length > 120) lines.push(`  … ${file.symbols.length - 120}`);
	}
	const imports = [...(graph.imports.get(path) ?? [])];
	const external = [...graph.external.entries()].filter(([, users]) => users.has(path)).map(([name]) => name);
	if (imports.length > 0 || external.length > 0) {
		lines.push(`${t('rag.file.imports')} ${[...imports, ...external.map((name) => `${name} (${t('rag.file.external')})`)].join(', ')}`);
	}
	const importers = [...(graph.importers.get(path) ?? [])].sort();
	if (importers.length > 0) lines.push(`${t('rag.file.importedBy')} ${importers.slice(0, 40).join(', ')}${importers.length > 40 ? ` … +${importers.length - 40}` : ''}`);
	else lines.push(t('rag.file.notImported'));
	return clipText(lines.join('\n'), maxChars);
}

/** The detail of a folder: each file with its main symbols. */
export function renderFolderDetail(index: SearchIndex, folder: string, maxChars: number): string | undefined {
	const prefix = `${folder.replace(/^\.?\/+|\/+$/g, '')}/`;
	const files = [...index.all()].filter((file) => file.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
	if (files.length === 0) return undefined;
	const lines = [t('rag.folder.header', prefix, files.length)];
	for (const file of files.slice(0, 200)) lines.push(`- ${file.path.slice(prefix.length)}${mainSymbols(file.symbols, 6)}`);
	if (files.length > 200) lines.push(`… +${files.length - 200}`);
	return clipText(lines.join('\n'), maxChars);
}

export type ReadLines = (path: string, startLine: number, endLine: number) => Promise<string[] | undefined>;

export interface RenderedHit {
	readonly hit: SearchHit;
	/** 1-based range actually shown. */
	readonly startLine: number;
	readonly endLine: number;
	readonly code: string;
}

/** The lines to show for each hit (the densest window of each chunk), read fresh. */
export async function renderHits(
	hits: readonly SearchHit[],
	readLines: ReadLines,
	options: { readonly maxLines: number; readonly maxChars: number },
): Promise<RenderedHit[]> {
	const rendered: RenderedHit[] = [];
	let budget = options.maxChars;
	for (const hit of hits) {
		if (budget <= 200) break;
		const lines = await readLines(hit.path, hit.startLine, hit.endLine);
		if (!lines || lines.length === 0) continue;
		const window = bestWindow(lines, hit.startLine, hit.matched, options.maxLines);
		let code = lines.slice(window.startLine - hit.startLine, window.endLine - hit.startLine + 1).join('\n');
		if (code.length > budget) code = `${code.slice(0, budget)}\n…`;
		budget -= code.length + 80;
		rendered.push({ hit, startLine: window.startLine, endLine: window.endLine, code });
	}
	return rendered;
}

/** Search results for the `m365_search_project` tool. */
export function formatSearchResults(query: string, rendered: readonly RenderedHit[], more: readonly SearchHit[], languageOf: (path: string) => string): string {
	if (rendered.length === 0 && more.length === 0) return t('rag.search.none', query);
	const parts = [t('rag.search.header', query, rendered.length + more.length)];
	for (const [index, { hit, startLine, endLine, code }] of rendered.entries()) {
		const symbols = hit.symbols.length > 0 ? ` — ${hit.symbols.slice(0, 6).join(', ')}` : '';
		const fence = fenceFor(code);
		parts.push(`${index + 1}. ${hit.path}:${startLine}-${endLine}${symbols}\n${fence}${languageOf(hit.path)}\n${code}\n${fence}`);
	}
	if (more.length > 0) {
		parts.push(`${t('rag.search.more')}\n${more.map((hit) => `- ${hit.path}:${hit.startLine}-${hit.endLine}${hit.symbols.length > 0 ? ` (${hit.symbols.slice(0, 4).join(', ')})` : ''}`).join('\n')}`);
	}
	parts.push(t('rag.search.footer'));
	return parts.join('\n\n');
}

/** The block added to a chat request: a short map plus the most relevant code. */
export function formatAutoContext(summary: string, rendered: readonly RenderedHit[], more: readonly SearchHit[], languageOf: (path: string) => string): string {
	const parts = [t('rag.context.header'), summary];
	if (rendered.length > 0) {
		parts.push(t('rag.context.snippets'));
		for (const { hit, startLine, endLine, code } of rendered) {
			const fence = fenceFor(code);
			const symbols = hit.symbols.length > 0 ? ` (${hit.symbols.slice(0, 4).join(', ')})` : '';
			parts.push(`${hit.path}:${startLine}-${endLine}${symbols}\n${fence}${languageOf(hit.path)}\n${code}\n${fence}`);
		}
	}
	if (more.length > 0) parts.push(`${t('rag.context.more')} ${more.map((hit) => `${hit.path}:${hit.startLine}`).join(', ')}`);
	parts.push(t('rag.context.footer'));
	return parts.join('\n\n');
}

/** A compact map for every request: languages and the areas of the project. */
export function renderSummary(index: SearchIndex, workspaceName: string, maxChars: number): string {
	const files = [...index.all()];
	const languages = top(countBy(files, (file) => file.language), 6).map(([label, count]) => `${label} ${count}`).join(', ');
	const lines = [t('rag.summary.header', workspaceName, files.length, languages), ...renderAreas(files, 18)];
	return clipText(lines.join('\n'), maxChars);
}

function mainSymbols(symbols: readonly CodeSymbol[], max: number): string {
	const picked = symbols.filter((symbol) => symbol.kind !== 'method' && symbol.kind !== 'section' && symbol.kind !== 'constant').slice(0, max);
	return picked.length > 0 ? ` [${picked.map((symbol) => symbol.name).join(', ')}${symbols.length > picked.length ? ', …' : ''}]` : '';
}

/** Manifests, key files and declaration-rich files first. */
function fileWeight(file: IndexedFile): number {
	return (file.manifest ? 100 : 0) + (KEY_FILE_RE.test(baseName(file.path)) ? 50 : 0) + (ENTRY_NAME_RE.test(baseName(file.path)) ? 30 : 0) + Math.min(file.symbols.length, 20);
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) {
		const name = key(item);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return counts;
}

function top(counts: ReadonlyMap<string, number>, max: number): [string, number][] {
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

function clipText(text: string, maxChars: number): string {
	return text.length > maxChars ? `${text.slice(0, maxChars - 2)}\n…` : text;
}

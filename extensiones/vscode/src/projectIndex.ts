/**
 * The project index (RAG) in VS Code: which files it covers, keeping it up to
 * date, and what it offers on top of the index in ./rag.
 *
 *  - Files: what git tracks plus untracked files it does not ignore (`git
 *    ls-files`, so `.gitignore` is honoured); without git, VS Code's own file
 *    search. Then `files.exclude`, `search.exclude`, `m365copilot.index.exclude`,
 *    and anything binary, generated, minified or too large is left out.
 *  - Built in the background a few seconds after start (a spinner in the
 *    status bar), in small batches so the editor never stalls, and updated
 *    file by file as files are created, changed or deleted.
 *  - Offers: the automatic project context added to chat requests
 *    (`contextFor`), the `m365_search_project` and `m365_project_map` tools,
 *    and the "Search the project", "Project map" and "Rebuild project index"
 *    commands.
 *
 * Only in a trusted workspace: like the workspace tools, the index reads files
 * to send parts of them to Microsoft 365 Copilot.
 */
import * as vscode from 'vscode';
import { languageOf } from './rag/code';
import {
	formatAutoContext,
	formatSearchResults,
	renderFileDetail,
	renderFolderDetail,
	renderHits,
	renderProjectMap,
	renderSummary,
	type RenderedHit,
} from './rag/projectMap';
import { analyzeFile, SearchIndex, type IndexedFile, type SearchHit } from './rag/searchIndex';
import { excludeGlobs, isExcluded, isSkippedPath, looksBinary, looksGenerated, retrievalQuery } from './rag/text';
import { toolResult } from './agentTools';
import { M365_TOOL_NAMES } from './toolProtocol';
import { execGit } from '../tools/git';
import { buildExcludeGlob } from '../tools/excludes';
import { boundedInteger, errorMessage } from '../tools/common';
import { t } from './i18n';

const START_DELAY_MS = 3_000;
const BATCH_SIZE = 24;
const WATCH_DEBOUNCE_MS = 1_000;
/** More pending changes than this (a checkout, an install…) means rebuilding. */
const MAX_PENDING = 2_000;
const MAX_TOTAL_CHARS = 80 * 1024 * 1024;
const MAX_DISCOVERED = 60_000;
/** How long a chat request waits for the first build before going without context. */
const CONTEXT_READY_WAIT_MS = 4_000;
const TOOL_READY_WAIT_MS = 30_000;
const GIT_PATHS_PER_CALL = 200;

export type IndexState = 'idle' | 'indexing' | 'ready' | 'disabled' | 'untrusted';

export interface IndexStatus {
	readonly state: IndexState;
	readonly files: number;
	readonly chunks: number;
	readonly durationMs: number | undefined;
	/** Some files were left out by `m365copilot.index.maxFiles` (or the size cap). */
	readonly truncated: boolean;
}

interface IndexSettings {
	readonly enabled: boolean;
	readonly maxFiles: number;
	readonly maxFileBytes: number;
	readonly extraExcludes: readonly unknown[];
}

interface Candidate {
	readonly path: string;
	readonly uri: vscode.Uri;
}

export interface ContextOptions {
	/** The file the user works in: it and its neighbours rank a little higher. */
	readonly activeUri?: vscode.Uri;
	/** Lines already in the prompt (the code a command is about). */
	readonly exclude?: { readonly uri: vscode.Uri; readonly startLine: number; readonly endLine: number };
}

interface SearchProjectInput {
	readonly query?: unknown;
	readonly path?: unknown;
	readonly maxResults?: unknown;
}

interface ProjectMapInput {
	readonly path?: unknown;
}

function readSettings(): IndexSettings {
	const config = vscode.workspace.getConfiguration('m365copilot.index');
	return {
		enabled: config.get<boolean>('enabled', true),
		maxFiles: boundedInteger(config.get('maxFiles'), 5_000, 50, 50_000),
		maxFileBytes: boundedInteger(config.get('maxFileKB'), 256, 8, 4_096) * 1024,
		extraExcludes: config.get<unknown[]>('exclude', []),
	};
}

function userExcludes(): (Record<string, unknown> | undefined)[] {
	return [
		vscode.workspace.getConfiguration('files').get<Record<string, unknown>>('exclude'),
		vscode.workspace.getConfiguration('search').get<Record<string, unknown>>('exclude'),
	];
}

export class ProjectIndexService implements vscode.Disposable {
	private current = new SearchIndex();
	private readonly uris = new Map<string, vscode.Uri>();
	private readonly gitFolders = new Set<string>();
	private state: IndexState = 'idle';
	private durationMs: number | undefined;
	private truncated = false;
	private generation = 0;
	private building: Promise<void> | undefined;
	private readonly pending = new Map<string, { uri: vscode.Uri; deleted: boolean }>();
	private pendingTimer: NodeJS.Timeout | undefined;
	private startTimer: NodeJS.Timeout | undefined;
	private contextCache: { key: string; value: string } | undefined;
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;
	private readonly subscriptions: vscode.Disposable[] = [];

	constructor(
		private readonly log: (message: string) => void,
		startDelayMs = START_DELAY_MS,
	) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		this.subscriptions.push(
			this.changeEmitter,
			watcher,
			watcher.onDidCreate((uri) => this.queue(uri, false)),
			watcher.onDidChange((uri) => this.queue(uri, false)),
			watcher.onDidDelete((uri) => this.queue(uri, true)),
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.rebuild()),
			vscode.workspace.onDidGrantWorkspaceTrust(() => void this.rebuild()),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (
					event.affectsConfiguration('m365copilot.index') ||
					event.affectsConfiguration('files.exclude') ||
					event.affectsConfiguration('search.exclude')
				) {
					void this.rebuild();
				}
			}),
		);
		this.startTimer = setTimeout(() => void this.rebuild(), startDelayMs);
	}

	/** The index as it stands (read-only use). */
	get index(): SearchIndex {
		return this.current;
	}

	status(): IndexStatus {
		return {
			state: this.state,
			files: this.current.size,
			chunks: this.current.chunks,
			durationMs: this.durationMs,
			truncated: this.truncated,
		};
	}

	/** Indexes everything again (a build already running is superseded). */
	rebuild(): Promise<void> {
		if (this.startTimer) clearTimeout(this.startTimer);
		this.startTimer = undefined;
		const generation = ++this.generation;
		const run = this.build(generation).catch((error) => {
			this.log(t('log.indexFailed', errorMessage(error)));
			if (generation === this.generation) this.setState(this.current.size > 0 ? 'ready' : 'idle');
		});
		this.building = run;
		return run;
	}

	/**
	 * Waits (up to `timeoutMs`) for a build in progress — starting the first
	 * one now if it has not started yet. Whether there is anything indexed.
	 */
	async whenReady(timeoutMs: number): Promise<boolean> {
		if (this.state === 'idle' && this.startTimer) void this.rebuild();
		if (this.state === 'indexing' && this.building) {
			let timer: NodeJS.Timeout | undefined;
			await Promise.race([this.building, new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
			clearTimeout(timer);
		}
		return this.current.size > 0;
	}

	private setState(state: IndexState): void {
		this.state = state;
		this.changeEmitter.fire();
	}

	private async build(generation: number): Promise<void> {
		const settings = readSettings();
		const reset = (state: IndexState) => {
			this.current = new SearchIndex();
			this.uris.clear();
			this.truncated = false;
			this.setState(state);
		};
		if (!settings.enabled) return reset('disabled');
		if (!vscode.workspace.isTrusted) return reset('untrusted');
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (folders.length === 0) return reset('ready');

		this.setState('indexing');
		const started = Date.now();
		const next = new SearchIndex();
		const uris = new Map<string, vscode.Uri>();
		let truncated = false;
		const tokenSource = new vscode.CancellationTokenSource();
		try {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: t('index.progress') },
				async (progress) => {
					this.gitFolders.clear();
					const discovered: vscode.Uri[] = [];
					for (const folder of folders) discovered.push(...(await this.discover(folder, tokenSource.token)));
					const selection = this.select(discovered, settings);
					truncated = selection.truncated;
					let chars = 0;
					for (let start = 0; start < selection.files.length; start += BATCH_SIZE) {
						if (generation !== this.generation) return;
						const batch = selection.files.slice(start, start + BATCH_SIZE);
						const analyzed = await Promise.all(batch.map((item) => this.analyze(item, settings.maxFileBytes)));
						for (const [index, file] of analyzed.entries()) {
							if (!file) continue;
							next.upsert(file);
							uris.set(file.path, batch[index].uri);
							chars += file.size;
						}
						progress.report({ message: `${Math.min(start + BATCH_SIZE, selection.files.length)}/${selection.files.length}` });
						if (chars > MAX_TOTAL_CHARS) {
							truncated = true;
							break;
						}
						await new Promise<void>((resolve) => setImmediate(resolve));
					}
				},
			);
		} finally {
			tokenSource.dispose();
		}
		if (generation !== this.generation) return;
		this.current = next;
		this.uris.clear();
		for (const [path, uri] of uris) this.uris.set(path, uri);
		this.truncated = truncated;
		this.durationMs = Date.now() - started;
		this.contextCache = undefined;
		this.log(t('log.indexBuilt', next.size, next.chunks, this.durationMs, truncated ? ' (truncated)' : ''));
		this.setState('ready');
		if (this.pending.size > 0) this.schedulePending();
	}

	/** Files git knows (tracked + untracked, not ignored), or VS Code's file search without git. */
	private async discover(folder: vscode.WorkspaceFolder, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
		if (folder.uri.scheme === 'file') {
			try {
				const output = await execGit(
					['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
					folder.uri.fsPath,
					token,
				);
				this.gitFolders.add(folder.uri.toString());
				return output
					.split('\0')
					.filter(Boolean)
					.slice(0, MAX_DISCOVERED)
					.map((path) => vscode.Uri.joinPath(folder.uri, ...path.split('/')));
			} catch {
				/* not a repository, or no git: VS Code's own file search below */
			}
		}
		return vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, '**/*'),
			buildExcludeGlob(...userExcludes()),
			MAX_DISCOVERED,
		);
	}

	/** What gets indexed: filtered, source code first, capped. */
	private select(uris: readonly vscode.Uri[], settings: IndexSettings): { files: Candidate[]; truncated: boolean } {
		const globs = excludeGlobs(userExcludes(), settings.extraExcludes);
		const seen = new Set<string>();
		const files: Candidate[] = [];
		for (const uri of uris) {
			const path = this.pathOf(uri);
			if (!path || seen.has(path)) continue;
			seen.add(path);
			if (isSkippedPath(path) || isExcluded(path, globs) || !languageOf(path)) continue;
			files.push({ path, uri });
		}
		files.sort((a, b) => priorityOf(a.path) - priorityOf(b.path) || depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path));
		return files.length > settings.maxFiles
			? { files: files.slice(0, settings.maxFiles), truncated: true }
			: { files, truncated: false };
	}

	private async analyze(candidate: Candidate, maxBytes: number): Promise<IndexedFile | undefined> {
		const text = await this.readText(candidate.uri, maxBytes);
		if (text === undefined || text.length > maxBytes || looksGenerated(text)) return undefined;
		return analyzeFile(candidate.path, text);
	}

	/** The file's text: the open editor's (unsaved changes included), or from disk. */
	private async readText(uri: vscode.Uri, maxBytes: number): Promise<string | undefined> {
		const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
		if (open) return open.getText();
		try {
			const stat = await vscode.workspace.fs.stat(uri);
			if (!(stat.type & vscode.FileType.File) || stat.size > maxBytes) return undefined;
			const bytes = await vscode.workspace.fs.readFile(uri);
			return looksBinary(bytes) ? undefined : new TextDecoder('utf-8').decode(bytes);
		} catch {
			return undefined; // gone, or unreadable
		}
	}

	private readonly readLines = async (path: string, startLine: number, endLine: number): Promise<string[] | undefined> => {
		const uri = this.uris.get(path);
		if (!uri) return undefined;
		const text = await this.readText(uri, Number.MAX_SAFE_INTEGER);
		return text?.replace(/\r\n?/g, '\n').split('\n').slice(startLine - 1, endLine);
	};

	/** The path the index (and the workspace tools) use for a file; undefined outside the workspace. */
	private pathOf(uri: vscode.Uri): string | undefined {
		if (!vscode.workspace.getWorkspaceFolder(uri)) return undefined;
		const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
		return vscode.workspace.asRelativePath(uri, multiRoot).replace(/\\/g, '/');
	}

	private queue(uri: vscode.Uri, deleted: boolean): void {
		if (this.state === 'disabled' || this.state === 'untrusted' || this.state === 'idle') return;
		const path = this.pathOf(uri);
		if (!path || isSkippedPath(path)) return;
		// A deleted folder has no extension; a changed file without a known language is never indexed.
		if (!deleted && !languageOf(path)) return;
		this.pending.set(path, { uri, deleted });
		if (this.pending.size > MAX_PENDING) {
			this.pending.clear();
			void this.rebuild();
			return;
		}
		this.schedulePending();
	}

	private schedulePending(): void {
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.pendingTimer = setTimeout(() => void this.flushPending(), WATCH_DEBOUNCE_MS);
	}

	/** Applies the changes seen by the file watcher. */
	private async flushPending(): Promise<void> {
		if (this.state === 'indexing') return; // applied when the build ends
		const batch = [...this.pending.entries()];
		this.pending.clear();
		if (batch.length === 0) return;
		const settings = readSettings();
		const globs = excludeGlobs(userExcludes(), settings.extraExcludes);
		const index = this.current;
		const known: Candidate[] = [];
		const newcomers: Candidate[] = [];
		for (const [path, { uri, deleted }] of batch) {
			if (deleted) {
				index.removePrefix(path);
				for (const candidate of this.uris.keys()) if (candidate === path || candidate.startsWith(`${path}/`)) this.uris.delete(candidate);
				continue;
			}
			if (isExcluded(path, globs)) {
				index.remove(path);
				continue;
			}
			(index.has(path) ? known : newcomers).push({ path, uri });
		}
		const accepted = await this.notIgnored(newcomers);
		for (const candidate of [...known, ...accepted]) {
			const file = await this.analyze(candidate, settings.maxFileBytes);
			if (file && (index.has(file.path) || index.size < settings.maxFiles)) {
				index.upsert(file);
				this.uris.set(file.path, candidate.uri);
			} else {
				index.remove(candidate.path);
			}
		}
		this.contextCache = undefined;
		this.changeEmitter.fire();
	}

	/** The new files git does not ignore (in folders that are git repositories; all of them elsewhere). */
	private async notIgnored(candidates: readonly Candidate[]): Promise<Candidate[]> {
		const accepted: Candidate[] = [];
		const byFolder = new Map<vscode.WorkspaceFolder, Candidate[]>();
		for (const candidate of candidates) {
			const folder = vscode.workspace.getWorkspaceFolder(candidate.uri);
			if (!folder) continue;
			if (!this.gitFolders.has(folder.uri.toString())) {
				accepted.push(candidate);
				continue;
			}
			const list = byFolder.get(folder) ?? [];
			list.push(candidate);
			byFolder.set(folder, list);
		}
		const token = new vscode.CancellationTokenSource();
		try {
			for (const [folder, list] of byFolder) {
				for (let start = 0; start < list.length; start += GIT_PATHS_PER_CALL) {
					const slice = list.slice(start, start + GIT_PATHS_PER_CALL);
					const relative = slice.map((candidate) => vscode.workspace.asRelativePath(candidate.uri, false).replace(/\\/g, '/'));
					try {
						const output = await execGit(
							['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...relative],
							folder.uri.fsPath,
							token.token,
						);
						const kept = new Set(output.split('\0').filter(Boolean));
						for (const [index, path] of relative.entries()) if (kept.has(path)) accepted.push(slice[index]);
					} catch {
						accepted.push(...slice);
					}
				}
			}
		} finally {
			token.dispose();
		}
		return accepted;
	}

	/**
	 * The project context for a chat request: a short map of the project and
	 * the code most relevant to `message`. Undefined when turned off or there
	 * is nothing indexed.
	 */
	async contextFor(message: string, options: ContextOptions = {}): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('m365copilot.context');
		if (!config.get<boolean>('autoRetrieve', true)) return undefined;
		if (!(await this.whenReady(CONTEXT_READY_WAIT_MS))) return undefined;
		const index = this.current;
		const query = retrievalQuery(message);
		const maxChars = boundedInteger(config.get('maxChars'), 8_000, 1_000, 40_000);
		const activePath = options.activeUri ? this.pathOf(options.activeUri) : undefined;
		const excludePath = options.exclude ? this.pathOf(options.exclude.uri) : undefined;
		const exclude = options.exclude && excludePath ? { path: excludePath, startLine: options.exclude.startLine, endLine: options.exclude.endLine } : undefined;
		const key = [index.version, maxChars, activePath, exclude?.path, exclude?.startLine, exclude?.endLine, query].join('|');
		if (this.contextCache?.key === key) return this.contextCache.value;

		const summary = renderSummary(index, vscode.workspace.name ?? '', Math.min(2_000, Math.floor(maxChars / 3)));
		const hits = query ? index.search(query, { limit: 10, perFile: 2, activePath, openPaths: this.openPaths(), exclude }) : [];
		const rendered = await renderHits(hits.slice(0, 6), this.readLines, {
			maxLines: 40,
			maxChars: Math.max(500, maxChars - summary.length - 600),
		});
		const value = formatAutoContext(summary, rendered, notRendered(hits, rendered), (path) => this.fenceLanguage(path));
		this.contextCache = { key, value };
		this.log(t('log.indexContext', hits.length, rendered.length, value.length));
		return value;
	}

	registerTools(): vscode.Disposable[] {
		return [
			vscode.lm.registerTool<SearchProjectInput>(M365_TOOL_NAMES.searchProject, {
				prepareInvocation: (options) => ({
					invocationMessage: t('tool.searchingProject', typeof options.input.query === 'string' ? options.input.query : ''),
				}),
				invoke: (options) => toolResult(() => this.searchTool(options.input)),
			}),
			vscode.lm.registerTool<ProjectMapInput>(M365_TOOL_NAMES.projectMap, {
				prepareInvocation: (options) => ({
					invocationMessage:
						typeof options.input.path === 'string' && options.input.path
							? t('tool.projectMap.path', options.input.path)
							: t('tool.projectMap'),
				}),
				invoke: (options) => toolResult(() => this.mapTool(options.input)),
			}),
		];
	}

	private async searchTool(input: SearchProjectInput): Promise<string> {
		const query = typeof input.query === 'string' ? input.query.trim() : '';
		if (!query) throw new Error(t('rag.search.noQuery'));
		if (!(await this.whenReady(TOOL_READY_WAIT_MS))) return this.unavailable();
		const pathPrefix = typeof input.path === 'string' && input.path.trim() ? input.path.trim().replace(/\\/g, '/') : undefined;
		const hits = this.current.search(query, {
			limit: boundedInteger(input.maxResults, 8, 1, 20),
			perFile: 3,
			pathPrefix,
			activePath: this.activePath(),
			openPaths: this.openPaths(),
		});
		const rendered = await renderHits(hits, this.readLines, { maxLines: 30, maxChars: 10_000 });
		const result = formatSearchResults(query, rendered, notRendered(hits, rendered), (path) => this.fenceLanguage(path));
		return this.truncated ? `${result}\n\n${t('rag.truncated')}` : result;
	}

	private async mapTool(input: ProjectMapInput): Promise<string> {
		if (!(await this.whenReady(TOOL_READY_WAIT_MS))) return this.unavailable();
		const path = typeof input.path === 'string' ? input.path.trim().replace(/\\/g, '/').replace(/^\.\/|\/$/g, '') : '';
		if (!path || path === '.') return renderProjectMap(this.current, { workspaceName: vscode.workspace.name ?? '', maxChars: 10_000 });
		return (
			renderFileDetail(this.current, path, 10_000) ??
			renderFolderDetail(this.current, path, 10_000) ??
			t('rag.map.notFound', path)
		);
	}

	private unavailable(): string {
		if (this.state === 'disabled') return t('rag.disabled');
		if (this.state === 'untrusted') return t('ws.untrusted');
		return t('rag.notReady');
	}

	registerCommands(): vscode.Disposable[] {
		return [
			vscode.commands.registerCommand('m365copilot.searchProject', () => this.searchQuickPick()),
			vscode.commands.registerCommand('m365copilot.showProjectMap', () => this.showMap()),
			vscode.commands.registerCommand('m365copilot.rebuildIndex', () => this.rebuildWithFeedback()),
		];
	}

	/** "Search the project": ranked results as you type; Enter opens the code. */
	private searchQuickPick(): void {
		interface HitItem extends vscode.QuickPickItem {
			readonly hit?: SearchHit;
		}
		const picker = vscode.window.createQuickPick<HitItem>();
		picker.title = t('index.search.title', this.current.size);
		picker.placeholder = t('index.search.placeholder');
		picker.matchOnDescription = true;
		picker.busy = this.state === 'indexing';
		let timer: NodeJS.Timeout | undefined;
		const update = (value: string) => {
			const hits = value.trim()
				? this.current.search(value, { limit: 40, perFile: 3, activePath: this.activePath(), openPaths: this.openPaths() })
				: [];
			picker.items = hits.map((hit) => ({
				label: `$(${hit.symbols.length > 0 ? 'symbol-method' : 'file-code'}) ${hit.symbols[0] ?? hit.path.slice(hit.path.lastIndexOf('/') + 1)}`,
				description: `${hit.path}:${hit.startLine}`,
				detail: hit.symbols.length > 1 ? hit.symbols.slice(1, 8).join(' · ') : undefined,
				alwaysShow: true,
				hit,
			}));
		};
		picker.onDidChangeValue((value) => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => update(value), 120);
		});
		const statusListener = this.onDidChange(() => {
			picker.busy = this.state === 'indexing';
			picker.title = t('index.search.title', this.current.size);
			if (picker.value) update(picker.value);
		});
		picker.onDidAccept(async () => {
			const hit = picker.selectedItems[0]?.hit;
			const uri = hit && this.uris.get(hit.path);
			if (!hit || !uri) return;
			picker.hide();
			const position = new vscode.Position(hit.startLine - 1, 0);
			await vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position), preview: false });
		});
		picker.onDidHide(() => {
			if (timer) clearTimeout(timer);
			statusListener.dispose();
			picker.dispose();
		});
		picker.show();
		if (this.state === 'idle') void this.whenReady(0);
	}

	private async showMap(): Promise<void> {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('index.progress') }, () =>
			this.whenReady(TOOL_READY_WAIT_MS),
		);
		if (this.current.size === 0) {
			void vscode.window.showWarningMessage(this.unavailable());
			return;
		}
		const map = renderProjectMap(this.current, { workspaceName: vscode.workspace.name ?? '', maxChars: 60_000 });
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: `# ${t('index.map.title', vscode.workspace.name ?? '')}\n\n${map}\n`,
		});
		await vscode.window.showTextDocument(document, { preview: true });
	}

	private async rebuildWithFeedback(): Promise<void> {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t('index.rebuilding') }, () =>
			this.rebuild(),
		);
		const status = this.status();
		if (status.state === 'ready') {
			void vscode.window.showInformationMessage(
				t('index.rebuilt', status.files, ((status.durationMs ?? 0) / 1000).toFixed(1)) + (status.truncated ? ` ${t('rag.truncated')}` : ''),
			);
		} else {
			void vscode.window.showWarningMessage(this.unavailable());
		}
	}

	private activePath(): string | undefined {
		const uri = vscode.window.activeTextEditor?.document.uri;
		return uri ? this.pathOf(uri) : undefined;
	}

	private openPaths(): string[] {
		return vscode.window.visibleTextEditors
			.map((editor) => this.pathOf(editor.document.uri))
			.filter((path): path is string => Boolean(path));
	}

	/** The fence language for a file's code: `typescript`, `python`… */
	private fenceLanguage(path: string): string {
		const label = this.current.get(path)?.language ?? '';
		return FENCE_LANGUAGES[label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '');
	}

	dispose(): void {
		if (this.startTimer) clearTimeout(this.startTimer);
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.generation += 1;
		for (const subscription of this.subscriptions) subscription.dispose();
	}
}

const FENCE_LANGUAGES: Readonly<Record<string, string>> = {
	'C#': 'csharp',
	'C++': 'cpp',
	'F#': 'fsharp',
	'Objective-C': 'objectivec',
	Shell: 'bash',
	Make: 'makefile',
	'Ignore file': 'text',
};

function notRendered(hits: readonly SearchHit[], rendered: readonly RenderedHit[]): SearchHit[] {
	const shown = new Set(rendered.map((item) => item.hit));
	return hits.filter((hit) => !shown.has(hit));
}

/** Source code first, then markup/styles, then docs, then data files. */
function priorityOf(path: string): number {
	const family = languageOf(path)?.family;
	if (family === 'data') return 3;
	if (family === 'markdown' || family === 'text') return 2;
	if (family === 'markup' || family === 'style') return 1;
	return 0;
}

function depthOf(path: string): number {
	return path.split('/').length;
}

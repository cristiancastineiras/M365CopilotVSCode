/**
 * Auto-commit with M365 Copilot. While it is on — per workspace, with
 * `m365copilot.toggleAutoCommit` — it watches every git repository of the
 * workspace and, once the developer pauses, asks M365 Copilot whether the
 * uncommitted changes are a finished unit worth a commit. If they are, it
 * commits them (as a few separate commits when they are unrelated) with a
 * documented Conventional Commits message; if not, it waits for more work.
 * It never pushes, and the last auto-commit can be undone (soft reset).
 *
 * Restraint is the point — no flood of tiny commits:
 *  - it only looks after `idleSeconds` without edits, saves or git changes;
 *  - not before `minIntervalMinutes` since the last commit (anyone's);
 *  - never with unsaved files, agent edits waiting for Keep/Undo, errors in
 *    the changed files, conflicts, a detached HEAD or a merge/rebase going on;
 *  - once the model said "wait", it is not asked again until something changes.
 *
 * The git work is in autoCommitGit.ts and the prompt in autoCommitPrompt.ts,
 * both free of `vscode` so the tests can cover them.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	commitFiles,
	cooldownRemaining,
	hasConflicts,
	HeadMovedError,
	isSubmodule,
	readChanges,
	readRepoState,
	undoCommits,
	type ChangeSnapshot,
	type CommitRound,
	type GitRunner,
} from './autoCommitGit';
import {
	buildAutoCommitPrompt,
	MAX_CHANGED_FILES,
	parseAutoCommitDecision,
	type AutoCommitDecision,
	type AutoCommitGroup,
} from './autoCommitPrompt';
import { streamCopilotTurnWithRetry } from './client';
import { showLog, truncate } from './logger';
import { editorTone } from './models';
import { isTokenUsable, type CopilotProfile } from './profile';
import type { ProfileStore } from './secrets';
import { execGit } from '../tools/git';
import { getGitApi, type GitApi, type GitRepository } from '../tools/gitExtension';
import { errorMessage } from '../tools/common';
import { t } from './i18n';

const SECTION = 'm365copilot.autoCommit';
/** In workspaceState: turning it on in one project must not start committing in every other one. */
const ENABLED_KEY = 'm365copilot.autoCommit.enabled';
/** Not contributed in package.json: only the status bar item opens it. */
const MENU_COMMAND = 'm365copilot.autoCommitMenu';
/** An unanswered "Commit / Not now" counts as "not now" after this long. */
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

interface Settings {
	readonly mode: 'auto' | 'confirm';
	readonly idleMs: number;
	readonly minIntervalMs: number;
	readonly waitForErrors: boolean;
}

function readSettings(): Settings {
	const config = vscode.workspace.getConfiguration(SECTION);
	return {
		mode: config.get<string>('mode') === 'confirm' ? 'confirm' : 'auto',
		idleMs: clamp(config.get<number>('idleSeconds', 120), 20, 3600) * 1000,
		minIntervalMs: clamp(config.get<number>('minIntervalMinutes', 5), 0, 240) * 60_000,
		waitForErrors: config.get<boolean>('waitForErrors', true),
	};
}

export interface AutoCommitDeps {
	readonly store: ProfileStore;
	/** Agent edits still waiting for Keep/Undo are never committed behind the user's back. */
	readonly edits: { readonly pendingCount: number; readonly onDidChangePending: vscode.Event<number> };
	/** workspaceState. */
	readonly memento: vscode.Memento;
	readonly log: (message: string) => void;
}

type Phase = 'clean' | 'watching' | 'evaluating' | 'waiting';

/** What one look at a repository ended in. */
export type AutoCommitOutcome =
	| { readonly kind: 'clean' }
	/** The same changes the model already judged: nothing to ask. */
	| { readonly kind: 'unchanged' }
	| { readonly kind: 'wait'; readonly reason: string; readonly retryInMs?: number }
	| { readonly kind: 'committed'; readonly round: CommitRound; readonly remaining: number }
	| { readonly kind: 'busy' };

export class AutoCommitter implements vscode.Disposable {
	private readonly watches = new Map<string, RepositoryWatch>();
	private readonly item: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];
	/** Listeners that only live while auto-commit is on. */
	private session: vscode.Disposable[] = [];
	private lastRound: { readonly root: string; readonly round: CommitRound; readonly at: number } | undefined;

	constructor(readonly deps: AutoCommitDeps) {
		this.item = vscode.window.createStatusBarItem('m365copilot.autoCommit', vscode.StatusBarAlignment.Right, 89);
		this.item.name = t('autoCommit.status.title');
		this.item.command = MENU_COMMAND;
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(SECTION)) this.render();
			}),
		);
		if (this.enabled) void this.start();
	}

	get enabled(): boolean {
		return this.deps.memento.get<boolean>(ENABLED_KEY, false) === true;
	}

	registerCommands(): vscode.Disposable[] {
		return [
			vscode.commands.registerCommand('m365copilot.toggleAutoCommit', () => this.toggle()),
			vscode.commands.registerCommand('m365copilot.autoCommitNow', (source?: unknown) => this.checkNow(source)),
			vscode.commands.registerCommand('m365copilot.undoAutoCommit', () => this.undo()),
			vscode.commands.registerCommand(MENU_COMMAND, () => this.showMenu()),
		];
	}

	async toggle(): Promise<void> {
		if (this.enabled) {
			await this.deps.memento.update(ENABLED_KEY, false);
			this.stop();
			void vscode.window.showInformationMessage(t('autoCommit.disabled'));
		} else {
			await this.deps.memento.update(ENABLED_KEY, true);
			await this.start();
			const mode = t(readSettings().mode === 'confirm' ? 'autoCommit.mode.confirm' : 'autoCommit.mode.auto');
			void vscode.window.showInformationMessage(t('autoCommit.enabled', mode));
		}
		this.render();
	}

	/** Looks at a repository right away — no idle wait, no minimum interval — and says what came of it. */
	async checkNow(source?: unknown): Promise<AutoCommitOutcome | undefined> {
		if (!this.enabled) {
			const turnOn = t('autoCommit.turnOn');
			if ((await vscode.window.showInformationMessage(t('autoCommit.disabled'), turnOn)) !== turnOn) return undefined;
			await this.toggle();
		}
		const watch = await this.pickWatch(source);
		if (!watch) return undefined;
		const outcome = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: t('autoCommit.checking') },
			() => watch.evaluate(true),
		);
		if (outcome.kind === 'busy') void vscode.window.showInformationMessage(t('autoCommit.busy', watch.name));
		else if (outcome.kind === 'clean') void vscode.window.showInformationMessage(t('autoCommit.nothing', watch.name));
		else if (outcome.kind === 'wait')
			void vscode.window.showInformationMessage(t('autoCommit.waitNotice', watch.name, outcome.reason));
		return outcome;
	}

	/** Undoes the last auto-commit round (or `round`, from its notification) if nothing was committed on top. */
	async undo(round = this.lastRound?.round): Promise<void> {
		const last = this.lastRound;
		if (!last || !round || last.round !== round) {
			// An older round's notification: a newer auto-commit sits on top of it.
			void vscode.window.showInformationMessage(
				t(last && round ? 'autoCommit.undoMoved' : 'autoCommit.undoNothing'),
			);
			return;
		}
		try {
			await undoCommits(runner(last.root), round);
		} catch (error) {
			if (error instanceof HeadMovedError) void vscode.window.showWarningMessage(t('autoCommit.undoMoved'));
			else void vscode.window.showErrorMessage(t('autoCommit.failed', errorMessage(error)));
			return;
		}
		this.lastRound = undefined;
		await this.watches.get(rootKey(last.root))?.markUndone();
		void vscode.window.showInformationMessage(t('autoCommit.undone'));
		this.render();
	}

	/** A watch just committed: say so, with Undo at hand. */
	announce(watch: RepositoryWatch, round: CommitRound): void {
		this.lastRound = { root: watch.root, round, at: Date.now() };
		const text =
			round.subjects.length === 1
				? t('autoCommit.committed', watch.name, round.subjects[0])
				: t('autoCommit.committedMany', round.subjects.length, watch.name, round.subjects.join(' · '));
		const show = t('autoCommit.show');
		const undo = t('autoCommit.undo');
		void vscode.window.setStatusBarMessage(`$(git-commit) ${text}`, 8000);
		void vscode.window.showInformationMessage(text, show, undo).then(async (picked) => {
			if (picked === undo) await this.undo(round);
			else if (picked === show) await this.showRound(watch.root, round);
		});
	}

	render(): void {
		if (!this.enabled) {
			this.item.hide();
			return;
		}
		const watches = [...this.watches.values()];
		const settings = readSettings();
		this.item.text = watches.some((watch) => watch.phase === 'evaluating') ? '$(loading~spin) Auto' : '$(git-commit) Auto';

		const tooltip = new vscode.MarkdownString('', true);
		tooltip.appendMarkdown(`**${t('autoCommit.status.title')}**\n\n`);
		tooltip.appendText(
			t(
				'autoCommit.status.mode',
				t(settings.mode === 'confirm' ? 'autoCommit.mode.confirm' : 'autoCommit.mode.auto'),
				settings.idleMs / 1000,
				settings.minIntervalMs / 60_000,
			),
		);
		tooltip.appendMarkdown('\n\n');
		if (watches.length === 0) tooltip.appendText(t('autoCommit.noWatchedRepo'));
		for (const watch of watches) {
			tooltip.appendMarkdown('$(repo) ');
			tooltip.appendText(`${watch.name} — ${watch.describe()}`);
			tooltip.appendMarkdown('  \n');
		}
		if (this.lastRound) {
			tooltip.appendMarkdown('$(history) ');
			tooltip.appendText(
				t('autoCommit.status.lastCommit', minutesSince(this.lastRound.at), this.lastRound.round.subjects.join(' · ')),
			);
			tooltip.appendMarkdown('  \n');
		}
		tooltip.appendMarkdown('\n');
		tooltip.appendText(t('autoCommit.status.click'));
		this.item.tooltip = tooltip;
		this.item.show();
	}

	dispose(): void {
		this.stop();
		this.item.dispose();
		for (const disposable of this.disposables) disposable.dispose();
	}

	private async start(): Promise<void> {
		if (this.session.length > 0) return;
		let api: GitApi;
		try {
			api = await getGitApi();
		} catch (error) {
			void vscode.window.showErrorMessage(t('autoCommit.failed', errorMessage(error)));
			return;
		}
		// Turned off (or started twice) while the Git extension was activating.
		if (!this.enabled || this.session.length > 0) return;
		this.session.push(
			api.onDidOpenRepository((repository) => void this.attach(repository)),
			api.onDidCloseRepository((repository) => this.detach(repository)),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length > 0) this.activity(event.document.uri);
			}),
			vscode.workspace.onDidSaveTextDocument((document) => this.activity(document.uri)),
			vscode.languages.onDidChangeDiagnostics(() => {
				for (const watch of this.watches.values()) if (watch.waitingForErrors) watch.poke();
			}),
			this.deps.edits.onDidChangePending(() => this.pokeAll()),
			this.deps.store.onDidChange(() => this.pokeAll()),
		);
		await Promise.all(api.repositories.map((repository) => this.attach(repository)));
		this.render();
	}

	private stop(): void {
		for (const disposable of this.session) disposable.dispose();
		this.session = [];
		for (const watch of this.watches.values()) watch.dispose();
		this.watches.clear();
	}

	private async attach(repository: GitRepository): Promise<void> {
		const root = repository.rootUri.fsPath;
		const key = rootKey(root);
		if (this.watches.has(key) || !inWorkspace(root)) return;
		// A submodule belongs to its parent's history, not to the developer's flow.
		if (await isSubmodule(runner(root))) return;
		if (!this.enabled || this.watches.has(key)) return;
		const watch = new RepositoryWatch(repository, this);
		this.watches.set(key, watch);
		watch.poke();
		this.render();
	}

	private detach(repository: GitRepository): void {
		const key = rootKey(repository.rootUri.fsPath);
		this.watches.get(key)?.dispose();
		this.watches.delete(key);
		this.render();
	}

	private activity(uri: vscode.Uri): void {
		if (uri.scheme !== 'file' || /[\\/]\.git[\\/]/.test(uri.fsPath)) return;
		for (const watch of this.watches.values()) if (watch.contains(uri.fsPath)) watch.poke();
	}

	private pokeAll(): void {
		for (const watch of this.watches.values()) watch.poke();
	}

	private async pickWatch(source: unknown): Promise<RepositoryWatch | undefined> {
		const watches = [...this.watches.values()];
		const rootUri = (source as { rootUri?: unknown } | undefined)?.rootUri;
		const fromSource = rootUri instanceof vscode.Uri ? this.watches.get(rootKey(rootUri.fsPath)) : undefined;
		if (fromSource) return fromSource;
		if (watches.length === 0) {
			void vscode.window.showWarningMessage(t('autoCommit.noWatchedRepo'));
			return undefined;
		}
		if (watches.length === 1) return watches[0];
		const picked = await vscode.window.showQuickPick(
			watches.map((watch) => ({ label: watch.name, description: watch.root, watch })),
			{ placeHolder: t('scm.pickRepository') },
		);
		return picked?.watch;
	}

	private async showMenu(): Promise<void> {
		interface Item extends vscode.QuickPickItem {
			readonly run: () => unknown;
		}
		const items: Item[] = [
			{
				label: `$(play) ${t('autoCommit.menu.checkNow')}`,
				detail: t('autoCommit.menu.checkNow.detail'),
				run: () => this.checkNow(),
			},
			...(this.lastRound
				? [
						{
							label: `$(discard) ${t('autoCommit.menu.undo')}`,
							description: this.lastRound.round.subjects.join(' · '),
							run: () => this.undo(),
						},
					]
				: []),
			{
				label: `$(gear) ${t('autoCommit.menu.settings')}`,
				run: () => vscode.commands.executeCommand('workbench.action.openSettings', SECTION),
			},
			{ label: `$(circle-slash) ${t('autoCommit.menu.off')}`, run: () => this.toggle() },
		];
		const picked = await vscode.window.showQuickPick(items, { title: t('autoCommit.menu.title') });
		await picked?.run();
	}

	/** The round's commits, with their full messages and stats, in the log. */
	private async showRound(root: string, round: CommitRound): Promise<void> {
		try {
			const output = await runner(root)(['log', '--stat', '--format=commit %H%n%n%B', `${round.before}..${round.after}`]);
			for (const line of output.trimEnd().split('\n')) this.deps.log(line);
		} catch (error) {
			this.deps.log(t('log.autoCommit', path.basename(root), errorMessage(error)));
		}
		showLog();
	}
}

/** Watches one repository: pokes restart the idle timer, and the timer runs a look. */
class RepositoryWatch implements vscode.Disposable {
	phase: Phase = 'watching';
	/** Why it is waiting, for the tooltip. */
	reason: string | undefined;
	/** Waiting because of errors: a diagnostics change is worth another look. */
	waitingForErrors = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: vscode.CancellationTokenSource | undefined;
	/** Fingerprint of the changes the model last judged — not asked again until they move. */
	private judged: string | undefined;
	private lastWaitReason: string | undefined;
	private pendingSince: number | undefined;
	private readonly listener: vscode.Disposable;
	private disposed = false;

	constructor(
		readonly repository: GitRepository,
		private readonly owner: AutoCommitter,
	) {
		this.listener = repository.state.onDidChange(() => this.poke());
	}

	get root(): string {
		return this.repository.rootUri.fsPath;
	}

	get name(): string {
		return path.basename(this.root);
	}

	contains(fsPath: string): boolean {
		const relative = path.relative(this.root, fsPath);
		return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	}

	describe(): string {
		if (this.phase === 'clean') return t('autoCommit.status.clean');
		if (this.phase === 'evaluating') return t('autoCommit.status.evaluating');
		if (this.phase === 'waiting' && this.reason) return t('autoCommit.status.waiting', this.reason);
		return t('autoCommit.status.watching');
	}

	/** Something changed: look again once the developer has paused. */
	poke(): void {
		if (!this.disposed) this.schedule(readSettings().idleMs);
	}

	async evaluate(force: boolean): Promise<AutoCommitOutcome> {
		if (this.running) {
			// Whatever made the timer fire must still get its look.
			if (!force) this.poke();
			return { kind: 'busy' };
		}
		clearTimeout(this.timer);
		const source = new vscode.CancellationTokenSource();
		this.running = source;
		const before = { phase: this.phase, reason: this.reason };
		this.phase = 'evaluating';
		this.owner.render();
		try {
			const outcome = await this.look(force, source.token);
			if (outcome.kind === 'unchanged') {
				this.phase = before.phase;
				this.reason = before.reason;
			} else if (outcome.kind === 'wait') {
				this.phase = 'waiting';
				this.reason = outcome.reason;
				this.owner.deps.log(t('log.autoCommit', this.name, outcome.reason));
				if (outcome.retryInMs !== undefined && !this.disposed) this.schedule(outcome.retryInMs);
			} else if (outcome.kind === 'committed') {
				this.phase = outcome.remaining > 0 ? 'watching' : 'clean';
				this.reason = undefined;
				this.owner.announce(this, outcome.round);
			} else {
				this.phase = 'clean';
				this.reason = undefined;
			}
			return outcome;
		} catch (error) {
			const reason = source.token.isCancellationRequested
				? t('autoCommit.status.watching')
				: t('autoCommit.reason.failed', errorMessage(error));
			this.owner.deps.log(t('log.autoCommit', this.name, reason));
			this.phase = 'waiting';
			this.reason = reason;
			return { kind: 'wait', reason };
		} finally {
			this.running = undefined;
			source.dispose();
			this.owner.render();
		}
	}

	/** After an undo, these exact changes are the developer's call: wait until they move. */
	async markUndone(): Promise<void> {
		try {
			const git = runner(this.root);
			const head = (await git(['rev-parse', 'HEAD'])).trim();
			this.judged = (await readChanges(git, this.root, head)).fingerprint;
		} catch {
			/* the next look will tell */
		}
		this.phase = 'waiting';
		this.reason = t('autoCommit.reason.undone');
		this.lastWaitReason = t('autoCommit.reason.undone');
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
		this.running?.cancel();
		this.listener.dispose();
	}

	private schedule(ms: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.evaluate(false), ms);
	}

	private async look(force: boolean, token: vscode.CancellationToken): Promise<AutoCommitOutcome> {
		const settings = readSettings();
		this.waitingForErrors = false;
		const wait = (reason: string, retryInMs?: number): AutoCommitOutcome => ({ kind: 'wait', reason, retryInMs });

		const profile = await this.owner.deps.store.get();
		if (!profile || !isTokenUsable(profile)) return wait(t('autoCommit.reason.noToken'));
		const pendingEdits = this.owner.deps.edits.pendingCount;
		if (pendingEdits > 0) return wait(t('autoCommit.reason.pendingEdits', pendingEdits));
		const unsaved = vscode.workspace.textDocuments.filter(
			(document) => document.isDirty && document.uri.scheme === 'file' && this.contains(document.uri.fsPath),
		);
		if (unsaved.length > 0) {
			return wait(t('autoCommit.reason.unsaved', unsaved.map((document) => path.basename(document.uri.fsPath)).join(', ')));
		}

		const git: GitRunner = (args, options) => execGit(args, this.root, token, options);
		const state = await readRepoState(git);
		if (!state.head) return wait(t('autoCommit.reason.noHead'));
		if (!state.branch) return wait(t('autoCommit.reason.detached'));
		if (state.inProgress) return wait(t('autoCommit.reason.inProgress', state.inProgress));

		const snapshot = await readChanges(git, this.root, state.head);
		if (snapshot.entries.length === 0) {
			this.pendingSince = undefined;
			this.lastWaitReason = undefined;
			return { kind: 'clean' };
		}
		this.pendingSince ??= Date.now();
		if (!force && snapshot.fingerprint === this.judged) return { kind: 'unchanged' };
		if (hasConflicts(snapshot.entries)) return wait(t('autoCommit.reason.conflicts'));
		if (snapshot.entries.length > MAX_CHANGED_FILES) {
			return wait(t('autoCommit.reason.tooMany', snapshot.entries.length));
		}
		if (!force) {
			const remaining = cooldownRemaining(Date.now(), state.headTime, settings.minIntervalMs);
			if (remaining > 0) {
				return wait(
					t('autoCommit.reason.interval', minutesSince(state.headTime), Math.ceil(remaining / 60_000)),
					remaining + 1000,
				);
			}
		}
		if (settings.waitForErrors) {
			const errors = this.errorsIn(snapshot);
			if (errors > 0) {
				this.waitingForErrors = true;
				return wait(t('autoCommit.reason.errors', errors));
			}
		}

		const recent = (await git(['log', '-6', '--format=%s']).catch(() => ''))
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		const prompt = buildAutoCommitPrompt({
			entries: snapshot.entries,
			diff: snapshot.diff,
			untracked: snapshot.untracked,
			branch: state.branch,
			lastCommit:
				state.headTime !== undefined
					? { minutesAgo: minutesSince(state.headTime), subject: state.headSubject ?? '' }
					: undefined,
			pendingMinutes: minutesSince(this.pendingSince),
			lastWaitReason: this.lastWaitReason,
			recentSubjects: recent,
		});
		const answer = await this.ask(profile, prompt, token);
		const decision = parseAutoCommitDecision(answer, snapshot.entries);
		this.owner.deps.log(t('log.autoCommit', this.name, describeDecision(decision)));
		if (decision.kind === 'invalid') this.owner.deps.log(truncate(answer, 600));

		// The answer is about these exact changes: if the developer moved on meanwhile, look again later.
		if (!(await this.unchangedSince(git, snapshot))) {
			this.poke();
			return wait(t('autoCommit.reason.changedMeanwhile'));
		}
		if (decision.kind !== 'commit') {
			this.judged = snapshot.fingerprint;
			if (decision.kind === 'invalid') return wait(t('autoCommit.reason.invalid', decision.reason));
			this.lastWaitReason = decision.reason || undefined;
			return wait(decision.reason || t('autoCommit.reason.unfinished'));
		}

		let commits = decision.commits;
		if (settings.mode === 'confirm') {
			commits = await this.confirm(commits, token);
			if (commits.length === 0) {
				this.judged = snapshot.fingerprint;
				this.lastWaitReason = t('autoCommit.reason.skipped');
				return wait(t('autoCommit.reason.skipped'));
			}
			if (!(await this.unchangedSince(git, snapshot))) {
				this.poke();
				return wait(t('autoCommit.reason.changedMeanwhile'));
			}
		}

		const round = await this.commit(git, snapshot, state.head, commits);
		const left = await readChanges(git, this.root, round.after);
		// What is left is what the model kept out: in progress, until it changes.
		this.judged = left.fingerprint;
		this.lastWaitReason = undefined;
		if (left.entries.length === 0) this.pendingSince = undefined;
		return { kind: 'committed', round, remaining: left.entries.length };
	}

	private async ask(profile: CopilotProfile, prompt: string, token: vscode.CancellationToken): Promise<string> {
		const controller = new AbortController();
		const cancel = token.onCancellationRequested(() => controller.abort());
		let answer = '';
		try {
			await streamCopilotTurnWithRetry({
				profile,
				prompt,
				tone: editorTone(),
				signal: controller.signal,
				log: this.owner.deps.log,
				callbacks: { onText: (delta) => (answer += delta) },
			});
		} finally {
			cancel.dispose();
		}
		return answer;
	}

	private async unchangedSince(git: GitRunner, snapshot: ChangeSnapshot): Promise<boolean> {
		const head = (await git(['rev-parse', 'HEAD'])).trim();
		return (await readChanges(git, this.root, head)).fingerprint === snapshot.fingerprint;
	}

	/** Commits the groups in order; a later failure keeps what was already committed. */
	private async commit(
		git: GitRunner,
		snapshot: ChangeSnapshot,
		before: string,
		commits: readonly AutoCommitGroup[],
	): Promise<CommitRound> {
		let after = before;
		const subjects: string[] = [];
		const paths: string[] = [];
		for (const group of commits) {
			try {
				const result = await commitFiles(git, snapshot.entries, group.files, group.message);
				after = result.sha;
				subjects.push(subjectOf(group.message));
				paths.push(...result.paths);
				this.owner.deps.log(t('log.autoCommit', this.name, `${result.sha.slice(0, 8)} ${subjectOf(group.message)}`));
			} catch (error) {
				if (subjects.length === 0) throw error;
				void vscode.window.showWarningMessage(t('autoCommit.failed', errorMessage(error)));
				break;
			}
		}
		return { before, after, subjects, paths };
	}

	/** "Commit / Choose… / Not now" for the proposed commits; resolves the ones to make. */
	private async confirm(
		commits: readonly AutoCommitGroup[],
		token: vscode.CancellationToken,
	): Promise<readonly AutoCommitGroup[]> {
		const subjects = commits.map((group) => subjectOf(group.message));
		const text =
			commits.length === 1
				? t('autoCommit.confirm', this.name, subjects[0])
				: t('autoCommit.confirmMany', commits.length, this.name, subjects.join(' · '));
		const commit = t('autoCommit.confirm.commit');
		const choose = t('autoCommit.confirm.choose');
		const skip = t('autoCommit.confirm.skip');
		const buttons = commits.length > 1 ? [commit, choose, skip] : [commit, skip];
		const picked = await untilCancelled(vscode.window.showInformationMessage(text, ...buttons), token);
		if (picked === commit) return commits;
		if (picked !== choose) return [];
		const chosen = await untilCancelled(
			vscode.window.showQuickPick(
				commits.map((group) => ({
					label: subjectOf(group.message),
					detail: t('autoCommit.confirm.files', group.files.length, group.files.join(', ')),
					picked: true,
					group,
				})),
				{ title: t('autoCommit.confirm.pickTitle'), canPickMany: true, ignoreFocusOut: true },
			),
			token,
		);
		return chosen?.map((item) => item.group) ?? [];
	}

	/** Errors VS Code reports in the changed files (deleted ones have none to report). */
	private errorsIn(snapshot: ChangeSnapshot): number {
		const changed = new Set(
			snapshot.entries
				.filter((entry) => entry.index !== 'D' && entry.worktree !== 'D')
				.map((entry) => samePath(path.join(this.root, entry.path))),
		);
		let errors = 0;
		for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
			if (uri.scheme !== 'file' || !changed.has(samePath(uri.fsPath))) continue;
			errors += diagnostics.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error).length;
		}
		return errors;
	}
}

function describeDecision(decision: AutoCommitDecision): string {
	if (decision.kind === 'commit') return `commit × ${decision.commits.length}: ${decision.commits.map((group) => subjectOf(group.message)).join(' | ')}`;
	return `${decision.kind} — ${decision.reason || '—'}`;
}

function subjectOf(message: string): string {
	return message.split('\n', 1)[0];
}

/** git in `root`, for the calls that are never cancelled (undo, submodule check, log). */
function runner(root: string): GitRunner {
	const token = new vscode.CancellationTokenSource().token;
	return (args, options) => execGit(args, root, token, options);
}

/** Whether a repository root belongs to the workspace: inside a folder, or a folder inside it. */
function inWorkspace(root: string): boolean {
	return (vscode.workspace.workspaceFolders ?? []).some(
		(folder) => isWithin(folder.uri.fsPath, root) || isWithin(root, folder.uri.fsPath),
	);
}

function isWithin(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function rootKey(root: string): string {
	return samePath(root);
}

/** Paths compare case-insensitively on Windows. */
function samePath(file: string): string {
	const normalized = path.normalize(file);
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function minutesSince(time: number | undefined): number {
	return time === undefined ? 0 : Math.max(0, Math.round((Date.now() - time) / 60_000));
}

function clamp(value: number, min: number, max: number): number {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/** `thenable`, or undefined once `token` is cancelled or {@link CONFIRM_TIMEOUT_MS} passes. */
function untilCancelled<T>(thenable: Thenable<T>, token: vscode.CancellationToken): Promise<T | undefined> {
	return new Promise((resolve) => {
		const done = (value: T | undefined) => {
			clearTimeout(timer);
			subscription.dispose();
			resolve(value);
		};
		const timer = setTimeout(() => done(undefined), CONFIRM_TIMEOUT_MS);
		const subscription = token.onCancellationRequested(() => done(undefined));
		thenable.then(done, () => done(undefined));
	});
}

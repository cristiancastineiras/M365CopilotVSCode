/**
 * "Generate commit message with M365 Copilot" — a button in the Source
 * Control title bar (and an entry in the quick menu) that writes the message
 * straight into the repository's commit box.
 *
 * Unlike the `m365_generate_commit_message` agent tool, which triggers VS
 * Code's native ✨ generator (answered by whatever model Copilot Chat uses),
 * this asks Microsoft 365 Copilot directly from the staged diff — or the
 * working tree's, new files included, when nothing is staged — with the
 * repository's recent subjects and scopes and the branch name as context.
 * A message that still breaks Conventional Commits after tidying gets one
 * more turn. It never commits: the message lands in the box for the user to
 * review.
 */
import * as vscode from "vscode";
import { registerTracedCommand } from "./debugMode";
import { streamCopilotTurnWithRetry } from "./client";
import { requireUsableProfile } from "./commands";
import { editorTone } from "./models";
import type { ProfileStore } from "./secrets";
import { recentSubjects, type GitRunner } from "./autoCommitGit";
import { readChangesToDescribe } from "./scmChanges";
import { ticketFromBranch } from "../tools/commitContext";
import {
  buildCommitMessagePrompt,
  cleanGeneratedCommitMessage,
  commitMessageProblem,
  normalizeCommitMessage,
  type CommitPromptInput,
} from "../tools/commitMessage";
import { execGit } from "../tools/git";
import { getGitRepository, listGitRepositories, type GitRepository } from "../tools/gitExtension";
import { errorMessage } from "../tools/common";
import { t } from "./i18n";

export function registerScmCommands(
  store: ProfileStore,
  log: (message: string) => void,
): vscode.Disposable[] {
  return [
    registerTracedCommand("m365copilot.generateCommitMessage", (source?: unknown) =>
      generateCommitMessage(store, log, source),
    ),
  ];
}

async function generateCommitMessage(
  store: ProfileStore,
  log: (message: string) => void,
  source: unknown,
) {
  const profile = await requireUsableProfile(store);
  if (!profile) return;

  let repository: GitRepository | undefined;
  try {
    repository = await resolveRepository(source);
  } catch (error) {
    void vscode.window.showErrorMessage(t("scm.failed", errorMessage(error)));
    return;
  }
  if (!repository) return;
  const target = repository;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: t("scm.progress"),
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const cancel = token.onCancellationRequested(() => controller.abort());
      try {
        const cwd = target.rootUri.fsPath;
        const git: GitRunner = (args, options) => execGit(args, cwd, token, options);
        const changes = await readChangesToDescribe(git, cwd);
        if (!changes) {
          void vscode.window.showInformationMessage(t("scm.noChanges"));
          return;
        }
        const branch =
          (await git(["symbolic-ref", "-q", "--short", "HEAD"]).catch(() => "")).trim() ||
          undefined;
        const input: CommitPromptInput = {
          ...changes,
          branch,
          recentSubjects: await recentSubjects(git),
        };
        const ticket = ticketFromBranch(branch);

        const ask = async (prompt: string): Promise<string> => {
          let answer = "";
          await streamCopilotTurnWithRetry({
            profile,
            prompt,
            tone: editorTone(),
            signal: controller.signal,
            log,
            callbacks: { onText: (delta) => (answer += delta) },
          });
          return normalizeCommitMessage(cleanGeneratedCommitMessage(answer), { ticket });
        };
        let message = await ask(buildCommitMessagePrompt(input));
        // One more turn when the message cannot be used as it is (not Conventional
        // Commits, empty…): the model gets its answer back with the reason.
        const problem = commitMessageProblem(message);
        if (problem && !token.isCancellationRequested) {
          log(t("log.commitMessageRetry", problem));
          const retry = await ask(
            buildCommitMessagePrompt({ ...input, rejected: { message, problem } }),
          );
          if (retry && (!commitMessageProblem(retry) || !message)) message = retry;
        }
        log(t("log.commitMessage", message.length, changes.diff.length));
        if (!message) {
          void vscode.window.showWarningMessage(t("scm.empty"));
          return;
        }
        target.inputBox.value = message;
        void vscode.window.setStatusBarMessage(t("scm.done"), 6000);
      } catch (error) {
        if (token.isCancellationRequested) return;
        void vscode.window.showErrorMessage(t("scm.failed", errorMessage(error)));
      } finally {
        cancel.dispose();
      }
    },
  );
}

/**
 * The repository to describe: the one whose Source Control title bar was
 * clicked (VS Code passes its `SourceControl`, which carries `rootUri`), the
 * only one open, or the one the user picks.
 */
export async function resolveRepository(source: unknown): Promise<GitRepository | undefined> {
  const rootUri = (source as { rootUri?: unknown } | undefined)?.rootUri;
  if (rootUri instanceof vscode.Uri) return getGitRepository(rootUri);

  const repositories = await listGitRepositories();
  if (repositories.length === 0) {
    void vscode.window.showWarningMessage(t("scm.noRepository"));
    return undefined;
  }
  if (repositories.length === 1) return repositories[0];

  const picked = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: vscode.workspace.asRelativePath(repository.rootUri, true) || repository.rootUri.fsPath,
      description: repository.rootUri.fsPath,
      repository,
    })),
    { placeHolder: t("scm.pickRepository") },
  );
  return picked?.repository;
}

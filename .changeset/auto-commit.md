---
"m365-copilot-vscode": minor
---

**Auto-commit: M365 Copilot commits your work as you go — when it makes sense, with documented messages.**

- Turn it on per workspace with **Turn auto-commit on/off** (quick menu, command palette or the `…` menu of Source Control). When you pause (`m365copilot.autoCommit.idleSeconds`, 120 s), M365 Copilot looks at the uncommitted changes and decides whether they are a finished unit — a complete fix, even a one-line one, a finished step, a refactor, docs — or work in progress. Finished work is committed with a Conventional Commits subject and a body explaining what changed and why; unrelated changes become separate commits (at most 3 at a time) and files still in progress are left out. Otherwise it waits, and is not asked again until something changes.
- No flood of commits: at least `m365copilot.autoCommit.minIntervalMinutes` (5) since the last commit, and never with unsaved files, agent edits awaiting Keep/Undo, errors in the changed files (`waitForErrors`), conflicts, a detached HEAD, a merge/rebase in progress or more than 150 changed files.
- It commits exactly the files it chose — what you staged for other files stays staged — runs your pre-commit hooks and never pushes. Every auto-commit has **Undo** (soft reset, changes back in the working tree) and **Show**; `m365copilot.autoCommit.mode: "confirm"` asks before each round. The **Auto** status item shows, per repository, what it is doing or why it waits, with **Check now**, **Undo the last auto-commit** and turn off.

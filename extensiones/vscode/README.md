# M365 Copilot for VS Code

**English** · [Español](README.es.md)

Use your **Microsoft 365 Copilot** subscription inside VS Code: as a model in the
chat (next to GitHub Copilot, Claude, etc.), as the **`@m365`** chat participant,
from the editor's context menu and lightbulb, from Source Control, and as inline
ghost-text completions. The whole extension — UI, messages and the instructions
sent to the model — is available in **English and Spanish**.

There is no dashboard and no API key: you capture your session token in the
browser and VS Code uses it.

| Piece | Where | What it does |
|-------|-------|--------------|
| **Browser extension** (recommended) | [`extensiones/browser`](https://github.com/cristiancastineiras/M365CopilotVSCode/tree/main/extensiones/browser) · [releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases) | Captures the token on the M365 Copilot website, renews it before it expires and sends it to VS Code automatically. |
| **Userscript** (alternative) | [`m365copilot-token.user.js`](m365copilot-token.user.js) | The same capture as the browser extension, for Tampermonkey/Violentmonkey: it sends the token to VS Code by itself and shows the connection in a small panel. |
| **VS Code extension** | this folder | Registers the models, the `@m365` participant, the editor/SCM actions and the agent tools, and talks to Microsoft 365 Copilot with your token. |

## Quick start

1. **Get the token into VS Code**
   - *With the browser extension:* install it, open
     <https://m365.cloud.microsoft/chat/> once and send any message. The popup
     turns green and the token reaches VS Code by itself — and keeps being
     renewed while some M365 tab is open.
   - *With the userscript:* install [Tampermonkey](https://www.tampermonkey.net/),
     open [the userscript](https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/extensiones/vscode/m365copilot-token.user.js) to install it (it then updates itself), open
     M365 Copilot and send a message. The first time, Tampermonkey asks to let
     it connect to `localhost` — allow it: that is VS Code. The panel lights up
     when VS Code has the token. Without that permission, **Copy token** in the
     panel and **M365 Copilot: Paste profile or token** still work (the token in
     the clipboard is detected, so Enter is enough).
   - *Without installing anything (e.g. a managed browser):* open
     <https://m365.cloud.microsoft/chat/>, open DevTools (F12) → **Network**,
     type `chathub` in the filter, send a message, right-click the request that
     appears → **Copy** → **Copy URL**, and run **M365 Copilot: Paste profile or token** (the URL in
     the clipboard is detected). The Copilot token travels as `access_token` in
     that URL, not in an `Authorization: Bearer` header: a bearer copied from any
     other request is for another service and fails with 401 (the paste command
     warns about it). It lasts about an hour; repeat when it expires. Web search
     needs one of the two captures above.
2. **Chat**: type **`@m365`** in the chat, or pick one of the **M365 Copilot**
   models (`Auto`, `Quick response`, `Think deeper`, `GPT 5.6 Think deeper`,
   `GPT 5.5`, `Claude Sonnet`…) in the model picker.
3. **Work from the editor**: select code and press **Ctrl+Shift+Alt+I** to edit
   it with an instruction, right-click → **M365 Copilot**, or use the lightbulb
   on an error.

The **M365** item in the status bar tells you at a glance whether the token is
valid and opens a menu with everything else, and VS Code's **Accounts** menu
shows who is signed in. The **Get started** walkthrough
(*Help → Welcome*, or the menu) walks through the same steps step by step — see
also the [illustrated guide](Guide.md).

## Editor integration

### Edit code in place

Select some code (or just place the cursor inside a function) and press
**Ctrl+Shift+Alt+I** (`Cmd+Shift+Alt+I` on macOS) — or right-click →
**M365 Copilot → Edit code…** — and type what should change: *"add error
handling"*, *"convert to async/await"*, *"make it generic"*… Recent instructions
are offered again, followed by a few common ones (simplify, add types, clearer
names, comments, performance…). M365 Copilot rewrites exactly that block, in place, and the
result appears under the Keep/Undo review below; the chat is not involved. The
lightbulb's **Fix with M365 Copilot: «error»** uses the same flow with the
diagnostic as the instruction. If you type in the block while it is being
edited, nothing is overwritten.

**Fix all problems in this file** (lightbulb on any error when the file has two
or more, or right-click → **M365 Copilot**) fixes every error and warning of
the file: one edit per block of code with problems (the function or class each
one is in), done from the bottom of the file up so that the line numbers of the
blocks still to do never move. Each block lands under Keep/Undo.

### Code review as comments

Right-click → **M365 Copilot → Review code** reviews the selection, or the whole
file (the function at the cursor when the file is very large). In the
**Source Control** title bar, ☑ **Review changes with M365 Copilot** reviews
every uncommitted change — modified files against `HEAD` and new untracked
ones — and only comments on the lines you changed (the diff, with what you
removed, goes along with the file).

The findings appear as **comments on the lines** — an error, a warning or a
suggestion, with what is wrong and how to fix it — and are also listed in VS
Code's **Comments** panel. Each one has **✨ Apply fix** (an inline edit of
those lines with the finding as the instruction, under Keep/Undo; the comment
goes once the change is staged), **✕ Dismiss** and **Clear all review
comments**. Up to 10 files per review, two at a time; the model is the one in
`m365copilot.editor.model`.

### `@m365` chat participant

`@m365` always answers with Microsoft 365 Copilot, whatever model is selected in
the picker (if an M365 model is selected, its variant is used).

| Command | What it does |
|---------|--------------|
| `@m365 /explain` | Explains the selected code — or, with no selection, the **function/class at the cursor** (found through the language's own symbol provider). Read-only. |
| `@m365 /fix` | Fixes the problems in that code, including the diagnostics VS Code reports there, and applies the fix with Keep/Undo review. |
| `@m365 /doc` | Adds documentation comments in the language's conventions. |
| `@m365 /tests` | Writes unit tests with the framework the project already uses. |
| `@m365 /terminal` | Explains the **last command of the active terminal** — its output and exit code — and how to fix it. |
| `@m365 <anything>` | Free-form request with the workspace tools; the current selection and `#file` attachments are included as context. |

The participant shows which code it used as a reference, streams its answer,
reports each tool step, offers a **Review pending changes** button after
editing, and suggests follow-ups (`/doc`, `/tests`…).

### Context menu, lightbulb and editor title

- **Right-click → M365 Copilot**: *Edit code…*, *Explain code*, *Ask about this
  code…*, *Review code*, *Fix code*, *Document code*, *Generate tests*, *Fix all
  problems in this file*. *Explain*, *Ask*, *Fix*, *Document* and *Tests* open
  the chat with the right `@m365` command and the exact code you were on.
- **Lightbulb (Ctrl+.)**: **Fix with M365 Copilot: «error»** on errors and
  warnings (fixed in place), **Fix all N problems in this file** when there are
  several, and *Edit… / Explain / Document with M365 Copilot* on a selection.
  Can be turned off with `m365copilot.editor.codeActions`.
- **Editor title bar**: when the open file has agent changes waiting for review,
  ↑ / ↓ (previous / next change), ✓ **Keep**, ↶ **Undo** and ⇄ **Diff** buttons
  appear next to the tabs.
- **Terminal**: right-click → **Explain last terminal command** sends the last
  command, its output and its exit code to `@m365 /terminal`. Needs VS Code's
  shell integration; the output is only kept in memory and only sent when you
  ask (`m365copilot.terminal.captureOutput`).

### Accounts menu

M365 Copilot is also an account in VS Code's **Accounts** menu (the person icon
at the bottom of the activity bar): with a valid token it shows the account
(`you@company.com`) under *M365 Copilot*, and **Sign Out** deletes the token.
Without a token — or once it expires — the menu shows a badge and **Sign in
with M365 Copilot**, which opens M365 Copilot in the browser and waits for the
browser extension or the userscript to send the token (or lets you paste it).
If another extension ever asks for this account, VS Code asks you first.

### The renewal that really renews: sign out and sign in again

**`Sign out and sign in again`** (quick menu and command palette) is the only
renewal that asks for your credentials again. The others renew the *token*, and
the token was never the problem:

- the Copilot token is handed out by the **browser’s Microsoft session**
  (cookies of `login.microsoftonline.com` / `login.live.com` plus MSAL’s token
  cache in `m365.cloud.microsoft`);
- while that session is there, asking for another token gets one **in
  silence**, without ever showing a sign-in page. That is why “renew” never
  asked for anything, anywhere.

So the real renewal is a sign-out. The command:

1. deletes the token stored in VS Code;
2. leaves the request on the local server and opens the browser at M365 Copilot
   with an id in the URL;
3. the **browser extension** recognises it, checks that the id is the one VS
   Code has pending — any site can link a URL, the id is what makes it
   trustworthy — and then walks Microsoft’s own sign-out endpoints (Entra ID,
   personal account and Office), closes the open Microsoft tabs, deletes
   **every cookie** of Microsoft’s domains in every cookie container
   (partitioned ones included) and clears **localStorage, IndexedDB, Cache
   Storage, service workers and FileSystem** of every Microsoft site — which is
   where MSAL’s cache lives;
4. leaves you on the sign-in page and tells VS Code what it deleted: the editor
   summarises it (“N cookies and the data of M sites”), details it in the log,
   and waits for the new token, which arrives by itself once you are in.

The browser’s global HTTP cache is **not** touched on purpose: it cannot be
limited to a few domains, so clearing it would empty every site’s cache without
being needed to be asked for the session again.

**Without the browser extension** (only the Tampermonkey userscript, which
cannot touch cookies) nobody confirms the deletion: after three minutes VS Code
says so and offers to open Microsoft’s sign-out pages by hand, which end the
half of the session that lives server-side — and that alone is enough to be
asked for credentials again.

### Status bar and quick menu

The **M365** status item shows the token state (🔑 none yet, ⚠ expired, 🕑 a
countdown in its last 10 minutes), whether inline completions are on, and a
spinner while a suggestion is on its way. Its tooltip shows the account, the
minutes left and the agent changes pending review. Clicking it opens the
**M365 Copilot menu**: paste token, token status, open M365 Copilot, open the
chat, toggle inline completions, review pending changes, generate a commit
message, auto-commit, language, settings, walkthrough, log and delete credentials.

When the token is about to expire **without having been renewed** (5 minutes
left) or expires during the session, a notification offers **Paste token** /
**Open M365 Copilot**, once per token (`m365copilot.notifications.tokenExpiry`).
The model picker also flags expired tokens. When the browser extension renews
the token, a short status-bar message confirms it.

### Editor settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.editor.codeActions` | `true` | M365 Copilot actions in the lightbulb. |
| `m365copilot.editor.model` | `auto` | Model for answers written straight into the editor: *Edit code…*, the lightbulb fixes, the code review and the commit message. |
| `m365copilot.terminal.captureOutput` | `true` | Keep the last commands' output in memory for `@m365 /terminal`. |
| `m365copilot.notifications.tokenExpiry` | `true` | Warn when the token is about to expire or expires. |

### Source Control: commit message with M365

The ✨ button in the **Source Control** title bar (*Generate commit message with
M365 Copilot*) writes a [Conventional Commits](https://www.conventionalcommits.org/)
message from the staged diff — or the working tree's, if nothing is staged —
straight into the commit box, in the extension's language. It never commits:
you review and commit yourself. Next to it, ☑ reviews those changes before you
commit (see [Code review as comments](#code-review-as-comments)).

### Auto-commit

Turn it on per workspace (**M365 Copilot: Turn auto-commit on/off**, the quick
menu, or the `…` menu of Source Control) and keep working. When you pause, M365
Copilot looks at your uncommitted changes and decides, like a careful senior
developer, whether they are a **finished unit worth a commit** — a complete fix,
even a one-line one, a finished step of a feature, a refactor, docs — or work in
progress. If they are, it commits them with a Conventional Commits subject and a
**body that explains what changed and why**; unrelated finished changes become
separate commits (at most 3 at a time), and files still in progress are left out.
If not, it waits, and is not asked again until something changes.

It is built to give you a useful history, not a flood of tiny commits:

- it only looks after `idleSeconds` without edits, saves or git changes, and not
  before `minIntervalMinutes` since the last commit (yours or automatic);
- it never commits while files are unsaved, agent edits await Keep/Undo, the
  changed files have errors in **Problems**, there are conflicts, HEAD is
  detached or a merge/rebase is in progress — nor more than 150 changed files at
  once;
- it commits exactly the files it chose (whole files); what you staged for other
  files stays staged, pre-commit hooks run as usual, and it **never pushes**.

Every auto-commit shows a notification with **Undo** (a soft reset: the changes
go back to your working tree, uncommitted) and **Show** (full messages and
stats in the log). The **Auto** status item shows what it is doing per
repository — watching, deciding, or why it is waiting — and its menu has
**Check now** (ask right away, ignoring the idle time and interval), **Undo the
last auto-commit**, settings and turn off. Submodules are left alone.

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.autoCommit.mode` | `auto` | `auto` commits on its own (with **Undo**); `confirm` proposes the commits and waits for **Commit**. |
| `m365copilot.autoCommit.idleSeconds` | `120` | Seconds without changes before it looks (20–3600). |
| `m365copilot.autoCommit.minIntervalMinutes` | `5` | Minimum minutes since the last commit (0 = none). |
| `m365copilot.autoCommit.waitForErrors` | `true` | Wait while the changed files have errors. |

## Understands your project (local index)

The extension keeps a **local index of the workspace** — a RAG engine that runs
entirely on your machine, with no embeddings service and nothing to download —
so M365 Copilot knows which files exist, where things live and how they connect:

- **What it indexes:** what git tracks plus untracked files it does not ignore
  (`.gitignore` is honoured), or VS Code's file search without git; minus
  `files.exclude`, `search.exclude`, `m365copilot.index.exclude`, binaries, lock
  files, minified/generated code and files above `m365copilot.index.maxFileKB`.
- **What it knows of each file:** its language, its symbols (functions, classes,
  methods, types… in TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#,
  C/C++, PHP, Ruby, shell, SQL and Markdown), what it imports — resolved to
  files, including the workspace's own packages in a monorepo and aliases such
  as `@/utils` — and which files import it.
- **Search:** BM25 over identifier-aware terms (`getUserToken` matches *get*,
  *user*, *token*), ranking higher what names the file or a symbol, covers more
  of the question and sits near the file you are in. Questions in Spanish find
  English code (*«¿dónde se guarda el token?»* → *save / store / storage*).
- **Always up to date:** built in the background a few seconds after start (a
  spinner in the status bar; this repository takes under a second) and updated
  file by file as you create, change or delete files.

It is used in three ways:

1. **Automatic context.** Every chat request — the M365 models in the model
   picker and `@m365` — carries a short project map and the most relevant code
   for what you asked (`m365copilot.context.autoRetrieve`, up to
   `m365copilot.context.maxChars` characters). For `@m365 /explain` and the
   other commands, the code around the selection is added: callers, definitions
   it uses, related files.
2. **Agent tools.** `m365_search_project` (ranked code search) and
   `m365_project_map` (structure, packages, entry points, most imported modules;
   or a file's outline, imports and importers) — the model is told to use them
   first.
3. **For you.** *M365 Copilot: Search the project…* (results as you type; Enter
   opens the code), *Show project map* and *Rebuild project index*, also in the
   **M365** status bar menu.

Only the code included in a request leaves the machine, to Microsoft 365
Copilot — the same as when you paste it — and only in a trusted workspace.

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.index.enabled` | `true` | Keep the project index. |
| `m365copilot.index.maxFiles` | `5000` | Files indexed at most (source code first). |
| `m365copilot.index.maxFileKB` | `256` | Larger files are not indexed. |
| `m365copilot.index.exclude` | `[]` | Extra globs to leave out, e.g. `**/fixtures/**`. |
| `m365copilot.context.autoRetrieve` | `true` | Add the project context to every chat request. |
| `m365copilot.context.maxChars` | `8000` | Size of that context. |

## Internet access (web search)

The extension's chat turns use a lean BizChat request without the plugins of
the M365 Copilot web app, because with them the model ignores the extension's
tools (see [How it works](#how-it-works)) — which is also why, from VS Code, it
used to have **no internet**. Now:

- **`m365_web_search`** (agent and `@m365`): the model searches the internet
  when it needs current documentation, versions, APIs or error messages. The
  extension runs a **separate** turn the way the web app does — its own request,
  as captured by the browser extension or the userscript, with web search — and
  gives the answer and its **sources** back to the turn that asked.
- **Requests without tools** (e.g. *Ask* mode) go out that way directly, with
  the sources listed under the answer. If BizChat turns that request down, the
  answer comes without web search instead of failing.

It needs the **session captured by the browser extension or the userscript**
(a pasted bare token does not carry the web app's request). Turn it off with
`m365copilot.web.enabled`.

## Models that keep up with M365 Copilot

Microsoft adds and retires M365 Copilot models often, and there is no
documented API that lists them. M365 Copilot does not take a model id either:
the model travels in the `tone` field of each conversation (`magic` is Auto,
`Chat` is Quick response, `Reasoning` is Think deeper, `Gpt_5_6_Reasoning` is
GPT 5.6 Think deeper…). The model list is therefore not fixed: it merges four
sources, and the chat's model picker updates by itself when it changes.

The built-in list follows the web app's own menu and labels: **Auto** (M365
Copilot decides the model and how long to think — recommended), **Quick
response** and **Think deeper** (M365 Copilot picks the model, fast or
thorough), then the named models: GPT 5.6 Think deeper, GPT 5.5 Quick response
/ Think deeper, Claude Sonnet and Claude Sonnet Think deeper. Claude needs your
admin to have Anthropic models enabled. The newest models (GPT-6.1 Sol, Claude
Sonnet 5.5, Claude Opus 5.5…) reach organisations in phases and their `tone`s
are not public: use one once on M365 Copilot with the browser extension or the
userscript installed and it appears in VS Code.

| Source | How it works |
|--------|--------------|
| Built in | The models this version ships with — always available, also offline. |
| Online catalog | [`models.json`](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/models.json) in the repository, downloaded on start and every 12 h. Adding a model there (or `"hidden": true` to retire one) reaches every user without a new release. |
| Detected in the web app | When you use a model on M365 Copilot, the browser extension / userscript sees its `tone` in the chat invocation and sends it with the token. If VS Code does not know it yet, it is added — that proves it exists for your account. |
| Your settings | `m365copilot.models.custom`, e.g. `["Gpt_5_9_Chat"]`, to try a model before it reaches the catalog. |

New models are announced once with a notification. **M365 Copilot: Update
models** (also in the menu) downloads the catalog right away and lists every
model with its source.

A model M365 Copilot knows is not necessarily one your account can use: the
service may turn the request down, or answer with its own canned "I can't help
with that" instead of the model. Either way the extension says so — with the
service's reason, and suggesting Auto — instead of showing that reply as the
answer, and flags the model in the picker (⚠ "not available on your account
right now") for 12 hours or until it works again. **M365 Copilot: Check
models** (also the first entry of *Update models*) sends a short message to
each model, one conversation each, and lists which ones work for you.

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.models.updateFromCatalog` | `true` | Download `models.json` (a plain GET to GitHub; nothing is sent). |
| `m365copilot.models.detectFromBrowser` | `true` | Add the models the web app uses. |
| `m365copilot.models.custom` | `[]` | Extra models by `tone` (or `{ "tone", "name" }`). |

The model settings of sub-agents, inline completions and editor answers
(`*.model`) offer the built-in models.

## Languages (English / Spanish)

`m365copilot.language` (also *Change language* in the menu):

| Value | Behaviour |
|-------|-----------|
| `auto` (default) | Follows VS Code's display language: Spanish for any Spanish locale, English otherwise. |
| `en` / `es` | Forces that language. |

It applies immediately to notifications, the status bar, the menu, tool results,
CodeLens, logs — **and to the instructions sent to the model**, so it answers
in that language (the model is also told to reply in the language you write in).
Command titles, setting descriptions and the walkthrough come from the
extension manifest and always follow VS Code's own display language, as for any
extension.

## Agent mode and tools

In **Agent** or **Edit** mode the model can use **every tool VS Code has active
for the turn**: the editor's native tools, MCP servers, other extensions' tools
and this extension's. BizChat has no native function calling, so the extension
describes the tools in the prompt as text, decodes the model's tool call from
its answer and reports it to VS Code, **which runs it** — exactly as with a
model with native function calling. Whatever you enable or disable in the chat's
tool picker is exactly what the model sees.

This extension's own tools, inside the open workspace:

- search the project index and get the project map (see
  [Understands your project](#understands-your-project-local-index));
- search the internet (see [Internet access](#internet-access-web-search));
- list files without loading their contents;
- search text and return only short matches;
- read numbered file ranges;
- prepare a batch of exact edits, new files or deletions;
- read the errors/warnings VS Code already shows (read-only, compiles nothing);
- query git read-only (`status`/`diff`/`log`; never commits or pushes);
- generate the commit message by triggering VS Code's **native** ✨ *Generate
  Commit Message*, with the staged diff as a fallback;
- create a real commit with that message, validated as Conventional Commits —
  **always** after you confirm the exact message and what will be staged;
- run a terminal command (build, tests…) — **always** after you confirm the
  exact command;
- delegate to sub-agents (see below).

Commands run in a **real VS Code terminal** ("M365 Copilot") using shell
integration, so you watch them run with your own shell profile (PATH, nvm,
conda…). Without shell integration they fall back to a background process and
the result says so. Listing and search respect your `files.exclude` and
`search.exclude` plus a built-in baseline (`node_modules`, `.git`, `dist`…), and
search **says when it was not exhaustive** instead of claiming "no matches".

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.tools.includeEditorTools` | `true` | Also describe native/MCP tools. `false` = only the `m365_*` tools. |
| `m365copilot.tools.duplicates` | `preferEditor` | Which tool the model should try first when a native one and ours do the same thing. The other stays as a fallback. |
| `m365copilot.tools.maxAdvertised` | `48` | Cap on tools described in the prompt (the catalog travels as text). Undescribed tools can still run if the model names them. |

### Reviewing changes (Keep / Undo)

Changes land **in the editor, unsaved**, like VS Code's own editing flows:

- each changed **block (hunk)** is highlighted on its own — added lines in your
  theme's diff colour, removed lines as a red marker — not the whole span from the
  first change to the last;
- every hunk has its own **✓ Keep (+a −b)** and **↶ Undo** CodeLens, and the top
  of the file offers **Keep all / Undo all / Show diff**; the same file-level
  actions, plus **previous / next change**, are in the **editor title bar**;
- the review is the **live diff** against the content before the agent's edit:
  typing inside a change updates it, and undoing it by hand makes it disappear;
- if the agent edits the same file again before you review, the original
  content is kept as the baseline, so Undo really goes back to before the agent;
- the diff compares the previous content with the **real, editable document**;
- the status bar shows how many files are still waiting for review;
- being a normal editor edit, **Ctrl+Z works** as usual.

Nothing is written to disk until you save (new files are created, and **Undo**
deletes them). If you Keep a batch and change your mind, **M365 Copilot: Undo
last batch of agent changes** reverts it.

> The *chat editing* API used by GitHub Copilot Edits is a proposed API not
> available to normally installed extensions, so this reproduces it with stable
> API (decorations + CodeLens + diff + editor title actions).

The terminal tool is the only one that runs arbitrary code: before anything
runs you see the literal command (with an extra warning for classically
destructive patterns — `rm -rf`, `git push --force`, `git reset --hard`…). Its
output is sent to the cloud model, so avoid it on sensitive data.

### Sub-agents

`m365_spawn_agents` lets the model delegate one or more bounded tasks to
**sub-agents** that run autonomously — in parallel when there are several — with
their own loop of the same workspace tools (edits, commands and commits
included, with the usual Keep/Undo review and confirmations). Each sub-agent
only sees its task and returns a concise summary, so broad exploration does not
fill the main conversation's context. Calls that edit, run commands or touch git
are serialised among sub-agents; read-only ones run in parallel. *Known
limitation:* the confirmation dialog does not say which sub-agent asked; the
progress notification and the log do.

| Setting | Default | Purpose |
|---------|---------|---------|
| `m365copilot.subagents.enabled` | `true` | Allow delegation. |
| `m365copilot.subagents.maxConcurrent` | `3` | Sub-agents running at once. |
| `m365copilot.subagents.maxSteps` | `6` | Tool calls per sub-agent before a partial summary. |
| `m365copilot.subagents.model` | `auto` | Model (tone) for sub-agents. |

## Inline completions (ghost text)

M365 Copilot can also predict code as you type. Toggle it from the menu or with
**M365 Copilot: Toggle inline completions**.

**Honest expectations:** latency is **~1-3 s** (each suggestion opens a new
WebSocket; GitHub Copilot answers in ~200-400 ms), and BizChat is a chat
assistant, not a fill-in-the-middle model — the extension strips fences and
"Sure, here you go" preambles, but quality is below a dedicated model. Every
suggestion is a request against your M365 plan; set `triggerMode` to `manual`
and ask with `Alt+\` if that is too much. A cache keeps the suggestion alive
while you type exactly what it proposed, so it does not flicker.

| Setting | Default | Purpose |
|---------|---------|---------|
| `inlineCompletions.enabled` | `true` | Turn ghost text on or off. |
| `inlineCompletions.triggerMode` | `automatic` | `manual` only suggests when asked (far less usage). |
| `inlineCompletions.debounceMs` | `500` | Typing pause before asking. |
| `inlineCompletions.maxLines` | `6` | Max lines per suggestion. |
| `inlineCompletions.timeoutMs` | `6000` | Discard after this long. |
| `inlineCompletions.model` | `auto` | Model to use; `reasoning` is too slow here. |
| `inlineCompletions.disabledLanguages` | `["scminput", "plaintext"]` | Languages where it never triggers automatically (`scminput` = the commit box). |

Output panes, read-only diff sides and git views never trigger a suggestion.

## Commands

All of them are in the menu behind the **M365** status item, and in the command
palette under **M365 Copilot**.

| Command | Action |
|---------|--------|
| `Show menu` | The quick menu (same as clicking the status item). |
| `Open chat with @m365` | Opens the chat with `@m365` ready. |
| `Edit code…` | Edits the selection (or the function at the cursor) in place from an instruction — **Ctrl+Shift+Alt+I**. |
| `Explain last terminal command` | `@m365 /terminal` on the active terminal (also in the terminal's context menu). |
| `Explain code` / `Fix code` / `Document code` / `Generate tests` / `Ask about this code…` | Editor actions (also in the context menu). |
| `Review code` | Reviews the selection or the file; findings become comments on the lines. |
| `Fix all problems in this file` | One inline edit per block with errors/warnings, under Keep/Undo. |
| `Review changes with M365 Copilot` | Reviews the uncommitted changes (Source Control title bar). |
| `Clear all review comments` | Removes the review comments. |
| `Generate commit message with M365 Copilot` | Writes the commit message in Source Control. |
| `Turn auto-commit on/off` | Starts or stops the [auto-commit](#auto-commit) in this workspace. |
| `Auto-commit: check now` | Asks right away whether the current changes deserve a commit. |
| `Undo last auto-commit` | Takes the last auto-commit back out of the history, keeping its changes. |
| `Paste profile or token` | Stores the token in SecretStorage (encrypted). |
| `Token status` | User, expiry and capture time. |
| `Delete credentials` | Deletes the stored token. |
| `Sign out and sign in again` | Deletes the token **and** the browser’s Microsoft session (cookies, MSAL’s cache, site storage) so it asks for your credentials again. |
| `Toggle inline completions` | Ghost text on/off. |
| `Change language` | English / Spanish / automatic. |
| `Update models` | Downloads the model catalog now and lists every model with its source. |
| `Check models` | Sends a short message to each model and lists which ones work on your account. |
| `Search the project…` | Ranked search in the project index; Enter opens the code. |
| `Show project map` | The project map (structure, packages, entry points, most imported modules) as a document. |
| `Rebuild project index` | Indexes the workspace again. |
| `Get started` | Opens the walkthrough. |
| `Show log (diagnostics)` | Opens the "M365 Copilot" output channel. |
| `Review pending agent changes` | Diff of the changes awaiting review. |
| `Keep agent changes` / `Undo agent changes` / `Show diff of agent changes` | Review actions for a whole file (also in the editor title bar). |
| `Next agent change` / `Previous agent change` | Jump between pending changes, across files. |
| `Discard all pending agent changes` | Reverts everything pending at once. |
| `Undo last batch of agent changes` | Restores the last batch you kept. |

## How it works

The M365 Copilot web chat talks to Substrate ("Sydney" / BizChat) over a
WebSocket:

```
wss://substrate.office.com/m365Copilot/Chathub/{oid}@{tid}?access_token=…&ConversationId=…
```

The extension builds that URL and the invocation body itself from the token's
`oid`/`tid` — it deliberately does **not** replay the browser's captured
connection. Replaying the real web session's `endpoint` and
`invocationTemplate` makes BizChat treat the turn as a genuine Copilot web
session, with its own plugins and native tool calling (`BingWebSearch`, a
production `tone`…), and the model then ignores the tool instructions the
extension injects. With the extension's own minimal template the tool protocol
works reliably. That is why pasting the bare token or the full JSON profile is
the same thing for chat turns: only the `accessToken` (and its claims) is used.
The exception is web search: a web turn deliberately replays the captured
request — plugins, options and endpoint `variants` — with fresh ids and no
earlier messages, and is only used where no tools are involved. The
invocation's `locale` follows the extension's language.

## Coming from `ms365-copilot-vscode` (1.3 – 2.0)

Versions 1.3 to 2.0 were published as `ms365-copilot-vscode`, with `ms365copilot.*`
settings. Everything is called `m365` again (as in 1.0), so this is a different
extension for VS Code:

- your `ms365copilot.*` settings are copied to `m365copilot.*` the first time
  (user settings, and each workspace when it is opened); the old entries stay in
  `settings.json`, unused, and can be deleted;
- if the old extension is still installed, a notification offers to uninstall
  it — both would compete for the token from the browser and for `@m365`;
- the token is not carried over (it is tied to each extension): the browser
  extension or the userscript sends it again the next time, or paste it.

## Notes and limits

- **The token expires** (~60–75 min). With the browser extension and an M365 tab
  open somewhere, renewal is automatic; otherwise capture and paste it again
  when the status bar or the notification tells you.
- **Controlled tools.** A tool name the host did not offer for the turn is never
  run. This extension's own tools only accept relative paths inside a trusted
  workspace, and edits always require review; native and MCP tools are
  governed by VS Code with their own confirmations.
- **One conversation per turn.** Each turn opens a new WebSocket and sends the
  flattened history, keeping the most recent turns and bounding tool results so
  cost and size stay predictable.
- The token is stored **only** in VS Code's `SecretStorage` (local, encrypted)
  and is only sent to Microsoft endpoints. The local server that receives it
  from the browser (`localhost:51827`) only accepts the M365/Office origins and
  the browser extension.
- The **native** commit-message tool depends on VS Code's built-in Git extension
  and on some chat model being available to `git.generateCommitMessage`; if
  none is, the tool returns the diff for the model to write the message itself.
  The Source Control ✨ button of this extension does not have that dependency.

## Development

```bash
pnpm install          # from the repository root
pnpm build            # tsdown (rolldown + oxc) → dist/extension.cjs
pnpm watch            # rebuild on save
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint
pnpm test             # protocol, tools, i18n and mock-BizChat tests (no VS Code needed)
pnpm package          # .vsix into ../../releases
```

Press `F5` in VS Code to launch an *Extension Development Host*.

**Userscript.** `m365copilot-token.user.js` is generated — edit
[`userscript/main.ts`](userscript/main.ts). `pnpm build` bundles it with the
capture logic of `@m365copilot/core` (`capture.ts`, the same code the browser
extension's interceptor runs), and `pnpm test` fails if the committed file is
out of date, then runs it against a fake page and a fake Tampermonkey.

**Translations.** Runtime text lives in [`src/locales/en.ts`](src/locales/en.ts)
(the reference) and [`src/locales/es.ts`](src/locales/es.ts), read through
`t('key', …args)` from [`src/i18n.ts`](src/i18n.ts); the Spanish catalog is typed
against the English keys, so a missing key is a compile error, and `pnpm test`
checks that both use the same `{0}` placeholders. Manifest text lives in
`package.nls.json` / `package.nls.es.json`; the tests check that every `%key%`
in `package.json` exists in both. Entries under `prompt.*`, `protocol.*`,
`hint.*`… are read by the model — change them with care.

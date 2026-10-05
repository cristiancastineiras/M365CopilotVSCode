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
| **Userscript** (alternative) | [`ms365copilot-token.user.js`](ms365copilot-token.user.js) | A Tampermonkey panel on `m365.cloud.microsoft` that copies the token for you to paste. |
| **VS Code extension** | this folder | Registers the models, the `@m365` participant, the editor/SCM actions and the agent tools, and talks to Microsoft 365 Copilot with your token. |

## Quick start

1. **Get the token into VS Code**
   - *With the browser extension:* install it, open
     <https://m365.cloud.microsoft/chat/> once and send any message. The popup
     turns green and the token reaches VS Code by itself — and keeps being
     renewed while some M365 tab is open.
   - *With the userscript:* install [Tampermonkey](https://www.tampermonkey.net/),
     install `ms365copilot-token.user.js`, open M365 Copilot, click **Copy token
     only**, then run **M365 Copilot: Paste profile or token** in VS Code.
2. **Chat**: type **`@m365`** in the chat, or pick one of the **M365 Copilot**
   models (`Auto`, `GPT`, `GPT 5.6`, `GPT 5.6 Reasoning`, `Claude Sonnet`,
   `Reasoning`) in the model picker.
3. **Work from the editor**: right-click code → **M365 Copilot**, or use the
   lightbulb on an error.

The **M365** item in the status bar tells you at a glance whether the token is
valid and opens a menu with everything else. The **Get started** walkthrough
(*Help → Welcome*, or the menu) walks through the same steps step by step — see
also the [illustrated guide](Guide.md).

## Editor integration

### `@m365` chat participant

`@m365` always answers with Microsoft 365 Copilot, whatever model is selected in
the picker (if an M365 model is selected, its variant is used).

| Command | What it does |
|---------|--------------|
| `@m365 /explain` | Explains the selected code — or, with no selection, the **function/class at the cursor** (found through the language's own symbol provider). Read-only. |
| `@m365 /fix` | Fixes the problems in that code, including the diagnostics VS Code reports there, and applies the fix with Keep/Undo review. |
| `@m365 /doc` | Adds documentation comments in the language's conventions. |
| `@m365 /tests` | Writes unit tests with the framework the project already uses. |
| `@m365 <anything>` | Free-form request with the workspace tools; the current selection and `#file` attachments are included as context. |

The participant shows which code it used as a reference, streams its answer,
reports each tool step, offers a **Review pending changes** button after
editing, and suggests follow-ups (`/doc`, `/tests`…).

### Context menu, lightbulb and editor title

- **Right-click → M365 Copilot**: *Explain code*, *Ask about this code…*, *Fix
  code*, *Document code*, *Generate tests*. Each opens the chat with the right
  `@m365` command and the exact code you were on.
- **Lightbulb (Ctrl+.)**: **Fix with M365 Copilot: «error»** on errors and
  warnings, and *Explain / Document with M365 Copilot* on a selection. Can be
  turned off with `ms365copilot.editor.codeActions`.
- **Editor title bar**: when the open file has agent changes waiting for review,
  ✓ **Keep**, ↶ **Undo** and ⇄ **Diff** buttons appear next to the tabs.

### Status bar and quick menu

The **M365** status item shows the token state (🔑 none yet, ⚠ expired, 🕑 a
countdown in its last 10 minutes), whether inline completions are on, and a
spinner while a suggestion is on its way. Its tooltip shows the account, the
minutes left and the agent changes pending review. Clicking it opens the
**M365 Copilot menu**: paste token, token status, open M365 Copilot, open the
chat, toggle inline completions, review pending changes, generate a commit
message, language, settings, walkthrough, log and delete credentials.

When the token is about to expire **without having been renewed** (5 minutes
left) or expires during the session, a notification offers **Paste token** /
**Open M365 Copilot**, once per token (`ms365copilot.notifications.tokenExpiry`).
The model picker also flags expired tokens. When the browser extension renews
the token, a short status-bar message confirms it.

### Source Control: commit message with M365

The ✨ button in the **Source Control** title bar (*Generate commit message with
M365 Copilot*) writes a [Conventional Commits](https://www.conventionalcommits.org/)
message from the staged diff — or the working tree's, if nothing is staged —
straight into the commit box, in the extension's language. It never commits:
you review and commit yourself.

## Languages (English / Spanish)

`ms365copilot.language` (also *Change language* in the menu):

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
| `ms365copilot.tools.includeEditorTools` | `true` | Also describe native/MCP tools. `false` = only the `ms365_*` tools. |
| `ms365copilot.tools.duplicates` | `preferEditor` | Which tool the model should try first when a native one and ours do the same thing. The other stays as a fallback. |
| `ms365copilot.tools.maxAdvertised` | `48` | Cap on tools described in the prompt (the catalog travels as text). Undescribed tools can still run if the model names them. |

### Reviewing changes (Keep / Undo)

Changes land **in the editor, unsaved**, like VS Code's own editing flows:

- the touched lines are **highlighted** (your theme's diff colours, plus a mark
  in the overview ruler);
- a **CodeLens** above the change offers **✓ Keep**, **↶ Undo** and **⇄ Show diff**,
  and the same actions appear in the **editor title bar**;
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

`ms365_spawn_agents` lets the model delegate one or more bounded tasks to
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
| `ms365copilot.subagents.enabled` | `true` | Allow delegation. |
| `ms365copilot.subagents.maxConcurrent` | `3` | Sub-agents running at once. |
| `ms365copilot.subagents.maxSteps` | `6` | Tool calls per sub-agent before a partial summary. |
| `ms365copilot.subagents.model` | `auto` | Model (tone) for sub-agents. |

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
| `Explain code` / `Fix code` / `Document code` / `Generate tests` / `Ask about this code…` | Editor actions (also in the context menu). |
| `Generate commit message with M365 Copilot` | Writes the commit message in Source Control. |
| `Paste profile or token` | Stores the token in SecretStorage (encrypted). |
| `Token status` | User, expiry and capture time. |
| `Delete credentials` | Deletes the stored token. |
| `Toggle inline completions` | Ghost text on/off. |
| `Change language` | English / Spanish / automatic. |
| `Get started` | Opens the walkthrough. |
| `Show log (diagnostics)` | Opens the "M365 Copilot" output channel. |
| `Review pending agent changes` | Diff of the changes awaiting review. |
| `Keep agent changes` / `Undo agent changes` / `Show diff of agent changes` | Review actions (also in the editor title bar). |
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
the same thing: only the `accessToken` (and its claims) is used. The
invocation's `locale` follows the extension's language.

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

**Translations.** Runtime text lives in [`src/locales/en.ts`](src/locales/en.ts)
(the reference) and [`src/locales/es.ts`](src/locales/es.ts), read through
`t('key', …args)` from [`src/i18n.ts`](src/i18n.ts); the Spanish catalog is typed
against the English keys, so a missing key is a compile error, and `pnpm test`
checks that both use the same `{0}` placeholders. Manifest text lives in
`package.nls.json` / `package.nls.es.json`; the tests check that every `%key%`
in `package.json` exists in both. Entries under `prompt.*`, `protocol.*`,
`hint.*`… are read by the model — change them with care.

/**
 * English catalog — the reference: its keys define {@link MessageKey}, and
 * locales/es.ts must provide exactly the same set (enforced by its type).
 *
 * `{0}`, `{1}`… are positional placeholders filled by `t()`. Entries under
 * `prompt.*`, `protocol.*`, `hint.*`, `subagent.prompt.*`, `participant.task.*`,
 * `completion.prompt.*`, `scm.prompt*` and `autoCommit.prompt*` are read by the MODEL, not the user:
 * they were tuned against BizChat, so change them with care.
 */
export const en = {
  // ------------------------------------------------------------ activation
  "ext.activated": "M365 Copilot extension activated. Debug log file: {0}",
  "ext.languageChanged":
    "M365 Copilot now speaks {0}. Command titles and settings follow VS Code’s own display language.",

  // ------------------------------------------------------------ deep debug mode
  "debug.enabled":
    "🐞 Deep debug mode ON: everything the extension receives, sends and does is traced in this console. Tokens are hidden; prompts, answers and paths are not. Export it with “M365 Copilot: Export log (.txt)”.",
  "debug.disabled": "🐞 Deep debug mode OFF.",
  "debug.toggledOn":
    "Deep debug mode is on: the “M365 Copilot” console now traces everything the extension does.",
  "debug.toggledOff": "Deep debug mode is off.",
  "debug.toggleFailed": "Could not change the setting: {0}",
  "debug.button.show": "Show console",
  "debug.button.export": "Export log (.txt)",
  "debug.export.title": "Export the M365 Copilot log",
  "debug.export.filter": "Text",
  "debug.export.save": "Export",
  "debug.export.empty": "The log is empty: there is nothing to export yet.",
  "debug.export.saved":
    "Log saved to {0}. Tokens are hidden, but prompts, answers and paths are in it: read it before sharing it.",
  "debug.export.open": "Open",
  "debug.export.reveal": "Show in folder",
  "debug.export.failed": "Could not save the log: {0}",
  "debug.cleared": "Log cleared.",

  // ------------------------------------------------------------ languages
  "language.en": "English",
  "language.es": "Spanish",
  "language.auto": "Automatic (VS Code display language: {0})",
  "language.pick.title": "M365 Copilot — language",
  "language.pick.placeholder":
    "Language for messages, tool results and the prompts sent to the model",

  // ------------------------------------------------------------ profile / token
  "paste.title": "M365 Copilot — paste profile or token",
  "paste.prompt":
    "Paste the token captured by the browser extension or the userscript, or the URL of the “Chathub” WebSocket copied from DevTools (the full JSON profile also works: only its accessToken is used).",
  "paste.placeholder": "eyJ…  or  wss://…/Chathub/…?access_token=eyJ…",
  "paste.validFor": ", valid for ~{0} min",
  "paste.fromClipboard":
    "A token was found in the clipboard — press Enter to use it, or paste a different one.",
  "paste.ready":
    "M365 Copilot is ready{0}{1}. Pick an “M365 Copilot” model in the chat, or type @m365.",
  "paste.openChat": "Open chat",
  "paste.failed": "Could not save the profile: {0}",
  "paste.foreignAudience":
    "This is not the M365 Copilot token: it is for {0}. With it every message fails with 401.",
  "paste.foreignAudience.detail":
    "The Copilot token does not travel in an “Authorization: Bearer” header but in the URL of the chat WebSocket. " +
    "At m365.cloud.microsoft/chat open DevTools (F12) → Network, type chathub in the filter, send a message, right-click " +
    "the request that appears → Copy → Copy URL, and paste that URL here.",
  "paste.foreignAudience.useAnyway": "Use it anyway",
  // ------------------------------------------------- sign out / real renewal
  "signOut.confirm": "Sign out of Microsoft and sign in again?",
  "signOut.confirm.detail":
    "Deletes the saved token AND the Microsoft session of your browser: cookies of login.microsoftonline.com, " +
    "MSAL’s token cache and the site data of M365 Copilot, Outlook, Teams, Office and Bing. It also closes the " +
    "session on Microsoft’s side, so the next visit asks for your credentials.\n\n" +
    "This is the only renewal that really renews: asking for another token reuses the same session, which hands " +
    "one out in silence without ever showing a sign-in page.\n\n" +
    "The browser extension is what does the deleting — the Tampermonkey userscript cannot touch cookies.",
  "signOut.confirm.button": "Sign out",
  "signOut.progress": "Closing the Microsoft session in the browser…",
  "signOut.done":
    "Microsoft session closed: {0} cookies and the data of {1} Microsoft sites deleted.",
  "signOut.partial": "{0} {1} thing(s) could not be deleted; the session is closed anyway.",
  "signOut.signInAnyway": "Sign in again",
  "signOut.showLog": "View log",
  "signOut.waitingToken":
    "Sign in to M365 Copilot in the browser — the new token arrives by itself…",
  "signOut.tokenPending":
    "M365 Copilot: sign in in the browser and the new token will arrive on its own.",
  "signOut.timeout": "The browser did not confirm the sign-out.",
  "signOut.timeout.detail":
    "The saved token has been deleted, but nobody cleared the browser session: install the M365 Copilot browser " +
    "extension (the userscript cannot delete cookies) or use its “Sign out of Microsoft” button.\n\n" +
    "Microsoft’s own sign-out pages also end the session, which is enough to be asked for credentials again:\n{0}",
  "signOut.openLogout": "Open Microsoft sign-out",
  "clear.confirm": "Delete the saved M365 Copilot token?",
  "clear.confirmButton": "Delete",
  "clear.done": "M365 Copilot token deleted.",
  "status.noToken": "M365 Copilot: no token yet. Run “M365 Copilot: Paste profile or token”.",
  "status.user": "User: {0}",
  "status.unknownUser": "(unknown)",
  "status.state": "Status: {0}",
  "status.tokenValid": "token valid",
  "status.tokenExpired": "token EXPIRED",
  "status.minutesLeft": "{0} min left",
  "status.expiredAgo": "expired {0} min ago",
  "status.captured": "Captured: {0}",
  "status.openM365": "Open M365 Copilot",

  // ------------------------------------------------------------ status bar
  "statusbar.tooltip.title": "M365 Copilot",
  "statusbar.tooltip.account": "Account: {0}",
  "statusbar.tooltip.tokenValid": "Token valid · {0} min left",
  "statusbar.tooltip.tokenValidNoExpiry": "Token valid",
  "statusbar.tooltip.tokenExpired": "Token expired {0} min ago",
  "statusbar.tooltip.tokenMissing": "No token yet — paste one to start",
  "statusbar.tooltip.completionsOn": "Inline completions: on",
  "statusbar.tooltip.completionsOff": "Inline completions: off",
  "statusbar.tooltip.busy": "Thinking of a suggestion…",
  "statusbar.tooltip.debug": "Deep debug mode on: everything is being traced",
  "statusbar.tooltip.throttled":
    "M365 Copilot is limiting your account: automatic requests paused until about {0}",
  "statusbar.tooltip.pendingEdits": "Agent changes awaiting review: {0}",
  "statusbar.tooltip.click": "Click to open the M365 Copilot menu.",
  "statusbar.renewed": "M365 Copilot: token renewed automatically ({0} min left).",

  // ------------------------------------------------------------ quick menu
  "menu.title": "M365 Copilot",
  "menu.placeholder": "Choose an action",
  "menu.paste": "Paste profile or token",
  "menu.paste.detail": "Store the token captured in the browser (encrypted SecretStorage)",
  "menu.status": "Token status",
  "menu.openChat": "Open chat with @m365",
  "menu.completionsOff": "Turn inline completions off",
  "menu.completionsOn": "Turn inline completions on",
  "menu.reviewEdits": "Review pending agent changes ({0})",
  "menu.commitMessage": "Generate commit message",
  "menu.autoCommit.on": "Auto-commit: on",
  "menu.autoCommit.off": "Turn on auto-commit",
  "menu.autoCommit.detail": "Commits your changes when they make sense, with documented messages",
  "menu.language": "Language: {0}",
  "menu.settings": "Settings",
  "menu.log": "Show log (diagnostics)",
  "menu.debug.on": "Deep debug mode: on (click to turn off)",
  "menu.debug.off": "Deep debug mode: off",
  "menu.debug.detail":
    "Traces everything the extension receives, sends and does; the log can be exported to a .txt",
  "menu.exportLog": "Export log (.txt)",
  "menu.walkthrough": "Get started",
  "menu.openM365": "Open M365 Copilot in the browser",
  "menu.signOut": "Sign out and sign in again",
  "menu.signOut.detail":
    "Deletes the browser’s Microsoft session too, so it asks for your credentials again",
  "menu.clear": "Delete credentials",
  "menu.section.session": "Session",
  "menu.section.editor": "Editor",
  "menu.section.extension": "Extension",

  // ------------------------------------------------------------ token expiry
  "watcher.expiringSoon": "M365 Copilot: the token expires in {0} min and has not been renewed.",
  "watcher.expired":
    "M365 Copilot: the token has expired. Capture a new one to keep using the models.",
  "watcher.pasteToken": "Paste token",
  "watcher.openM365": "Open M365 Copilot",

  // ------------------------------------------------------------ inline completions
  "completions.toggledOn": "M365 Copilot inline completions turned on.",
  "completions.toggledOff": "M365 Copilot inline completions turned off.",
  "completions.throttled":
    "M365 Copilot is limiting your account until about {0}: no suggestions until then.",
  "completion.prompt.role": "You are a code completion engine, not a conversational assistant.",
  "completion.prompt.continue":
    "Continue the code EXACTLY at the position marked ⟦CURSOR⟧, in {0}.",
  "completion.prompt.rules": "Strict rules:",
  "completion.prompt.rule.only":
    "- Reply ONLY with the text that goes at ⟦CURSOR⟧. No explanations, greetings or comments about what you are doing.",
  "completion.prompt.rule.noRepeat":
    "- Do not repeat the code that is already before or after the cursor.",
  "completion.prompt.rule.noFences": "- Do not use code fences or Markdown.",
  "completion.prompt.rule.maxLines":
    "- At most {0} lines. If there is nothing useful to add, reply with an empty line.",
  "completion.prompt.file": "File: {0}",
  "completion.prompt.codeStart": "--- code ---",
  "completion.prompt.codeEnd": "--- end ---",

  // ------------------------------------------------------------ models
  "model.unavailable":
    "Not available on your account right now — use Auto, or check the models again later.",
  "model.quotaUntil": "Priority access used up until {0} — pick another model in the meantime.",
  "model.needsPremium":
    "Needs a Microsoft 365 Copilot licence — the web app showed your account with Copilot Chat only.",
  "model.needsToken": "Paste your M365 Copilot token to enable it.",
  "model.tokenExpired": "Token expired — paste a new one to use it.",
  "models.new": "M365 Copilot: new model available — {0}. Pick it in the chat model picker.",
  "models.source.observed": "Detected in the M365 Copilot web app (tone {0}).",
  "models.source.custom": "Added in your settings (tone {0}).",
  "models.source.catalog": "From the online model catalog (tone {0}).",
  "models.title": "M365 Copilot models ({0})",
  "models.placeholder": "Pick one to open the chat with it",
  "models.updating": "Updating the M365 Copilot models…",
  "models.updateFailed":
    "M365 Copilot: could not download the model catalog; the last known list stays in use.",
  "models.label.builtin": "built in",
  "models.label.catalog": "online catalog",
  "models.label.observed": "detected in the M365 Copilot web app",
  "models.label.custom": "your settings",
  "models.check.action": "Check which models work on your account",
  "models.check.actionDetail":
    "Sends a short message to each model (a conversation each) and flags the ones the service refuses.",
  "models.check.noToken": "M365 Copilot: paste a valid token first to check the models.",
  "models.check.title": "Checking the M365 Copilot models",
  "models.check.progress": "{0} ({1}/{2})",
  "models.check.empty": "It answered with nothing.",
  "models.check.works": "Works on your account.",
  "models.check.summary": "{0} of {1} models work on your account",
  "models.check.throttled":
    "M365 Copilot is limiting your account until about {0}: check the models after that.",
  "log.modelAvailable": "model {0} answered: no longer flagged as unavailable",
  "log.modelUnavailable": "model {0} flagged as unavailable for this account: {1}",
  "models.rejectedHint":
    " “{0}” may not be available in your organisation (any more); try “M365 Copilot (Auto)” or another model.",
  "menu.models": "Models: update and list",
  "log.modelsCatalog": "model catalog downloaded: {0} entries",
  "log.modelsCatalogFailed": "model catalog not downloaded ({0}); using the cached list",

  // ------------------------------------------------------------ provider
  "provider.noToken": "There is no M365 Copilot token. Run “M365 Copilot: Paste profile or token”.",
  "provider.imageSkipped":
    "⚠️ An image could not be attached ({0}); the answer goes on without it.\n\n",
  "provider.tokenExpired":
    "The M365 Copilot token has expired{0}. Capture it again (browser extension or userscript) and paste it once more.",
  "provider.expiredAgo": " ({0} min ago)",

  // ------------------------------------------------------------ client (BizChat)
  "turn.remoteSandbox":
    "\n\n⚠️ M365 Copilot worked in its own cloud sandbox (/mnt/data or similar), not in your workspace: nothing " +
    "has changed here, and any file or link it mentions lives there. Try again, or pick another model such as " +
    "GPT 5.5 Think deeper.",
  "throttle.notice":
    "M365 Copilot is limiting requests from your account (too many in a short time). Inline completions and the " +
    "automatic checks are paused until about {0}; it lifts by itself if you wait.",

  // ------------------------------------------------------------ logs (output channel)
  "log.chatRequest":
    "chat request: model={0}, {1} messages, prompt={2} chars, tools={3}/{4} ({5} own, {6} from the editor)",
  "log.chatRequestOmitted": ", not described: {0}",
  "log.emptyPrompt": "empty prompt after flattening; nothing is sent",
  "log.toolCallRequested": "tool call requested: {0}",
  "log.completion": "inline completion: {0} ms, {1} raw chars → {2} usable",
  "log.completionFailed": "inline completion failed: {0}",
  "log.completionThrottled":
    "inline completion skipped: M365 Copilot is limiting the account until {0}",
  "log.forcedRetry": "the reply called no tool ({0}): retrying the turn once with a note",
  "log.subagentStep": "[sub-agent {0}] step {1} ({2}): {3}",
  "log.participantRequest": "@m365 request: command={0}, tone={1}, context={2}",
  "log.participantNoToken": "@m365 request (command={0}) without a usable token",
  "log.commitMessage": "commit message generated: {0} chars from a {1}-char diff",
  "log.commitMessageRetry": "commit message rejected ({0}); asking again",
  "log.autoCommit": "auto-commit {0}: {1}",
  "log.server.listening": "✅ Auto-refresh server listening on http://localhost:{0}",
  "log.server.portInUse": "⚠️ Port {0} already in use. The auto-refresh server is not available.",
  "log.server.error": "❌ Auto-refresh server error: {0}",
  "log.server.stopped": "🔌 Auto-refresh server stopped",
  "log.server.originRejected": "⚠️ Request to {0} rejected: origin not allowed ({1})",
  "log.server.readError": "❌ Error reading the request from the browser: {0}",
  "log.server.renewed": "🔄 Token auto-renewed from the browser",
  "log.server.processError": "❌ Error processing the token sent by the browser: {0}",
  "log.server.signOutRequested":
    "🚪 Sign-out requested from the editor (id {0}); waiting for the browser",
  "log.server.signedOut": "🚪 The browser confirmed the sign-out (id {0}); saved token deleted",
  "log.signOut.browserNotOpened":
    "⚠️ The browser could not be opened to close the Microsoft session",
  "log.signOut.report":
    "🚪 Sign-out: {0} cookies deleted ({1} refused), {2} origins cleared, {3} tabs closed, " +
    "{4} logout endpoints visited",
  "log.signOut.dataTypes": "🚪 Data deleted per origin: {0}",
  "log.signOut.skippedDataTypes": "🚪 Data types this browser does not support: {0}",
  "log.signOut.error": "⚠️ Sign-out: {0}",
  "log.signOut.timeout": "⚠️ Nobody confirmed the sign-out. Microsoft’s own endpoints: {0}",

  // ------------------------------------------------------------ prompt (chat provider)
  "prompt.tone": [
    "Be serious, direct and functional: get to the point, no chit-chat or filler.",
    'No filler phrases ("Sure!", "Great question!", "I\'ll help you with that", needless apologies) and no decorative ' +
      "emojis that add no information. Start directly with the answer or the action.",
    "Before a tool call, at most ONE short sentence about what you are going to do — never a whole paragraph " +
      "explaining the plan step by step before running it.",
    "Do not restate the user's question or summarise at the end what you already said or did above. If you made " +
      "changes, say briefly WHAT changed, not the story of how you got there.",
    "Be brief by default: long answers only when the content really needs it (code, a technical explanation the user " +
      "asked for in detail), never to fill space.",
    "Reply in the language the user writes in.",
  ].join("\n"),
  "prompt.markdown": [
    "ALWAYS reply in well-formed Markdown.",
    "MANDATORY: every code block of 2 or more lines must go inside ``` fences with the right language (for example, ```ts). " +
      "Never paste it as plain text: outside a fence, Markdown turns every line break into a space and the code " +
      "becomes unreadable, all on one line.",
    "Use inline code (a single item between `backticks`) only for identifiers, paths, commands and very short " +
      "single-line snippets.",
  ].join("\n"),
  "prompt.skill.ponytail": [
    "WORKING STYLE — lazy senior developer: solve the whole problem with the least new code.",
    "Before writing, read the code the task touches and list every place the change must reach (callers, tests, " +
      "config, exports). Take the first option that fully works: does it need to exist at all? → something already " +
      "in this codebase → the standard library or platform → an installed dependency → one clear line → the minimum code.",
    'No abstraction, option, wrapper or "for later" code nobody asked for; never add a dependency for a few lines. ' +
      "Deletion beats addition. Keep the codebase's structure and conventions. Bug fix: find every caller, fix the root " +
      "cause once. New non-trivial logic leaves one small test. Never cut validation at trust boundaries, error " +
      "handling that prevents data loss, security, accessibility or anything the user asked for.",
    "End code changes with one line: what you skipped or did not check, and any risk.",
  ].join("\n"),
  "prompt.skill.agentSkills": [
    "ENGINEERING DISCIPLINE:",
    "- Before anything non-trivial, state your assumptions in a short list; if the request is ambiguous or " +
      "contradicts the code, name the confusion and ask instead of guessing.",
    "- Push back on approaches with clear problems: say the concrete downside and propose an alternative. No sycophancy.",
    "- Scope: touch only what was asked. Do not clean up, refactor or delete unrelated code or comments.",
    "- New feature: spec (goal, acceptance criteria) → small verifiable tasks → implement in thin slices, each verified " +
      "before the next. Bug: reproduce → find the root cause → fix → add a test that would have caught it.",
    "- Verify, don't assume: a task is done only with evidence (tests, build, diagnostics, output), never because it " +
      '"looks right".',
    "- Review on five axes: correctness, readability, architecture, security, performance.",
  ].join("\n"),
  "prompt.skill.graphify":
    "This workspace has a graphify knowledge graph in `graphify-out/`. For questions about architecture, file " +
    'relationships or "how does X work / what calls Y", use it before searching file by file: read ' +
    '`graphify-out/GRAPH_REPORT.md`, or, if you can run commands, `graphify query "<question>"`, ' +
    '`graphify path "<A>" "<B>"` or `graphify explain "<node>"`. After editing code, ' +
    "`graphify . --update` refreshes it.",
  "prompt.markdownReminder":
    "Remember: if your answer includes code of 2 or more lines, put it inside ``` fences with the language. Never as " +
    "plain text. And be brief and direct: no chit-chat, no restating the obvious, no extra paragraphs.",
  "prompt.continue":
    "Continue this conversation: answer the latest user request. Earlier turns are context; the tool results " +
    "after it are what you have done so far.",
  "prompt.toolResult": "[result of tool {0}]",
  "prompt.toolCall": "[tool call {0}({1})]",
  "prompt.nonTextOmitted": "[non-text attachment omitted]",
  "prompt.attachmentOmitted": "[attachment {0}, {1} KB, omitted]",
  "prompt.imageAttached": "[image attached to this request: {0}, {1} KB]",
  "prompt.imagesAttached": "[{0} image(s) from the user are attached to this request]",
  "prompt.earlierOmitted": "[earlier turns omitted to keep the relevant context]",
  "prompt.charsOmitted": "[... {0} characters omitted ...]",
  "prompt.role.request": "User (current request)",
  "prompt.role.toolResults": "Tool results",
  "prompt.sameResultBelow": "[same result as a later call below]",
  "prompt.olderResultShortened":
    "[older result shortened: {0} more characters; call the tool again if you need them]",
  "env.line": "Environment: {0} · today {1}",
  "env.root": "Workspace root (absolute paths start here): {0}",
  "env.roots": "Workspace folders: {0}",
  "env.shell.windowsPowerShell": "Windows PowerShell 5.1 (no `&&`: chain commands with `;`)",

  // ------------------------------------------------------------ tool protocol (model-facing)
  "protocol.force.giveUp":
    "Note: in an earlier attempt at this request you answered that you could not reach the workspace, without calling " +
    "any tool. You can: the files and commands of this workspace are real and reachable through the tools listed " +
    "above, and the marker runs them on the user's machine. Do not ask the user to paste or upload anything; reply " +
    "with the tool call for the next step.",
  "protocol.force.sandbox":
    "Note: in an earlier attempt at this request you worked in your own cloud sandbox (/mnt/data, /home/…). That is " +
    "not the user's machine: nothing in it is in this workspace, and nothing you create there reaches it. Use only " +
    "the tools listed above, through the marker, for files and commands; reply with the tool call for the next step.",

  // ------------------------------------------------------------ tool invocation (chat UI)
  "tool.listing": "Listing {0}...",
  "tool.listing.workspace": "the workspace",
  "tool.searching": "Searching “{0}”...",
  "tool.reading": "Reading {0}...",
  "tool.preparingEdits": "Preparing {0} edit(s)...",
  "tool.edits.confirmTitle": "Apply M365 Copilot changes",
  "tool.edits.confirmMessage":
    "The changes will be applied in the editor, highlighted and NOT saved to disk. Above each change you will have " +
    "“Keep” to accept it and “Undo” to revert it, plus the diff.",
  "tool.diagnostics.file": "Reading diagnostics of {0}...",
  "tool.diagnostics.workspace": "Reading workspace diagnostics...",
  "tool.git": "Querying git {0}...",
  "tool.generatingCommit": "Generating commit message with VS Code’s native feature...",
  "tool.commit.noMessage": "(no message)",
  "tool.commit.stageAll": "**`git add -A` will be run** (all changes) before committing.",
  "tool.commit.stagePaths": "**`git add` will be run** on: {0}.",
  "tool.commit.stageNone": "Whatever is already staged will be committed (nothing new is added).",
  "tool.commit.invocation": "Creating commit: {0}",
  "tool.commit.confirmTitle": "Create M365 Copilot commit",
  "tool.commit.confirmMessage":
    "M365 Copilot wants to create a commit with this message:\n\n```\n{0}\n```\n\n{1}\n\n" +
    "This creates a real commit in the repository history.",
  "tool.run.risky":
    "\n\n⚠️ **This command matches a potentially destructive pattern** (mass deletion, force push, disk formatting...). " +
    "Review it carefully before continuing.",
  "tool.run.invocation": "Running: {0}",
  "tool.run.confirmTitle": "Run M365 Copilot command",
  "tool.run.confirmMessage":
    "M365 Copilot wants to run this command in your workspace:\n\n```\n{0}\n```\n\n" +
    "It runs with your own user permissions and its output (stdout/stderr) is sent to the cloud model.{1}",
  "tool.error": "Tool error: {0}",

  // ------------------------------------------------------------ workspace tools (results & errors)
  "ws.untrusted": "M365 Copilot tools require a trusted workspace.",
  "ws.notAFile": "The path is not a file: {0}",
  "ws.tooLarge": "The file exceeds the {0} KB limit.",
  "ws.cancelled": "The operation was cancelled.",
  "ws.noFolder": "Open a folder or workspace before using tools.",
  "ws.folderNotFound": "The workspaceFolder “{0}” does not exist.",
  "ws.multipleFolders": "Several workspaces are open ({0}). Specify workspaceFolder.",
  "ws.path.notString": "path must be a workspace-relative path.",
  "ws.path.empty": "path cannot be empty.",
  "ws.path.absolute": "path must be a relative path inside the workspace.",
  "ws.path.escapes": "path cannot leave the workspace.",
  "ws.path.root": "path cannot point to the workspace root.",
  "ws.path.git": "Accessing .git through tools is not allowed.",
  "ws.binary":
    "This file appears to be {0} and cannot be read as text: this tool only reads plain text, it does not extract the " +
    "content of binary/office formats. Do NOT try to read it another way or invent its content from raw bytes — tell " +
    "the user this tool cannot open this kind of file yet, and ask them to paste the relevant text into the chat or " +
    "export/save it as .txt/.md if they need it.",
  "ws.binary.kind": "{0} ({1})",
  "ws.binary.generic": "a binary file ({0})",
  "ws.binary.noExtension": "no extension",
  "ws.binary.pdf": "a PDF",
  "ws.binary.doc": "an old Word document (.doc)",
  "ws.binary.docx": "a Word document",
  "ws.binary.xls": "an old Excel spreadsheet (.xls)",
  "ws.binary.xlsx": "an Excel spreadsheet",
  "ws.binary.ppt": "an old PowerPoint presentation (.ppt)",
  "ws.binary.pptx": "a PowerPoint presentation",
  "ws.binary.image": "an image",
  "ws.binary.zip": "a compressed archive",
  "list.empty": "There are no files in {0} (or they are all excluded).",
  "list.header": "Files in {0}:",
  "list.limited": "Result limited to {0} files. Narrow down path before continuing.",
  "search.queryEmpty": "query must contain text to search for.",
  "search.queryTooLong": "query cannot exceed 500 characters.",
  "search.notExhaustive":
    "WARNING: only {0} of more than {1} files were checked; the search is NOT exhaustive. Narrow it down with path to cover everything.",
  "search.skipped": "{0} file(s) skipped because they are binary or too large.",
  "search.resultCap": "The limit of {0} matches was reached; there may be more.",
  "search.none": "No matches for “{0}” in {1} ({2} file(s) checked{3}).",
  "search.caseSensitive": ", case-sensitive",
  "search.header": "Matches for “{0}” ({1} in {2} file(s) checked):",
  "read.notFound": "The file {0} does not exist.",
  "read.header": "{0}, lines {1}-{2} of {3}:",
  "read.limited": "Reading limited; request a smaller or later range.",
  "diag.noneFile": "No diagnostics in {0}.",
  "diag.noneWorkspace": "No diagnostics in the workspace.",
  "diag.headerFile": "Diagnostics in {0} ({1} in total):",
  "diag.headerWorkspace": "Workspace diagnostics ({0} in total):",
  "diag.limited": "Result limited to {0}. Narrow down path or severity before continuing.",
  "git.scoped": "{0} of {1}",
  "git.noOutput": "git {0}: no output.",
  "git.truncated": "... (output truncated)",
  "git.notInstalled": "git is not installed or not on the PATH.",
  "git.notARepo": "This folder is not a git repository.",
  "git.failed": "git failed: {0}",
  "git.invalidAction": "action must be status, diff or log.",
  "git.extensionMissing": "VS Code’s built-in Git extension is not installed or is disabled.",
  "git.noRepository": "No git repository was found for this folder (is it initialised?).",
  "commit.stagedAll": "all changes (`git add -A`)",
  "commit.nothingStaged":
    "There is nothing staged to commit. Pass stageAll or paths, or run `git add` first (for example with {0}).",
  "commit.stagedBefore": "Staged before committing: {0}.",
  "commit.stagedExisting": "Committed what was already staged (nothing new was added).",
  "commit.created": "Commit created:",
  "commit.pathsNotArray": "paths must be an array of workspace-relative paths.",
  "commit.tooManyPaths": "paths cannot have more than {0} items.",
  "commitMsg.empty": "message cannot be empty.",
  "commitMsg.tooLong": "message exceeds the {0}-character limit.",
  "commitMsg.notConventional":
    "The first line of message does not follow Conventional Commits: it must be " +
    '"type(optional scope)!: summary in the imperative" (valid types: {0}). ' +
    'Example: "fix(auth): avoid null token on refresh". Received: "{1}".',
  "commitMsg.trailingPeriod": "The first line must not end with a period (Conventional Commits).",
  "genCommit.noChanges":
    "There are no changes (staged or in the working tree) to commit in this repository.",
  "genCommit.errorReason": "error: {0}",
  "genCommit.noModelReason": "there may be no chat model available right now",
  "genCommit.generated":
    "Message generated by VS Code (it stays in the Source Control box; edit it there if you change it):\n\n{0}",
  "genCommit.notGenerated":
    "VS Code did not generate any message right now ({0}). Write the message yourself from the diff below.",
  "genCommit.nothingStaged":
    "⚠️ Nothing is staged yet: the diff below is from the working tree (`git add` pending). " +
    "You can still commit with `{0}` using `stageAll` or `paths`.",
  "genCommit.checkConventional":
    "Before using it with {0}, check that the first line follows Conventional Commits: " +
    '"type(optional scope): summary in the imperative" (common types: feat, fix, docs, style, refactor, ' +
    "perf, test, build, ci, chore, revert), without a trailing period.",
  "genCommit.timeout": "git.generateCommitMessage did not answer within {0}s",
  "run.noOutput": "(no output)",
  "run.empty": "command cannot be empty.",
  "run.tooLong": "command exceeds the {0}-character limit.",
  "run.timedOut": "Cancelled by timeout ({0}s).",
  "run.noExitCode": "Process ended without an exit code (cancelled).",
  "run.exitCode": "Exit code: {0}.",
  "run.inTerminal": "Ran in the “{0}” VS Code terminal.",
  "run.headless": "Ran in the background (VS Code shell integration was not available).",
  "run.charsOmitted": "… ({0} characters omitted) …",
  "edit.text.notString": "{0} must be text.",
  "edit.text.empty": "{0} cannot be empty.",
  "edit.oldText.multiple":
    "oldText appears more than once in {0}. Include more context so it is unique.",
  "edit.oldText.noMatch": "oldText does not match the current content of {0}. Read the file again.",
  "edit.summary":
    "Changes applied in the editor and pending the user’s review: {0}. The user will see them highlighted with the " +
    "“Keep” and “Undo” actions above the change. They are not saved to disk yet and the user can revert them, so do " +
    "not assume they are final.",
  "edit.noEdits": "edits must contain at least one edit.",
  "edit.tooMany": "The batch cannot exceed {0} edits.",
  "edit.itemError": "Edit #{0}: {1}",
  "edit.invalidBatch": "{0} of {1} edit(s) are not valid; none was applied:\n{2}",
  "edit.noChange": "The proposal does not produce any change.",
  "edit.notObject": "Each edit must be an object.",
  "edit.replaceMissing": "Cannot replace {0} because it does not exist.",
  "edit.createExists": "{0} already exists; use replace to modify it.",
  "edit.deleteMissing": "Cannot delete {0} because it does not exist.",
  "edit.invalidOperation": "operation must be replace, create or delete.",
  "edit.applyFailed": "VS Code could not apply the changes.",
  "edit.restoreFailed": "VS Code could not restore the previous content.",
  "edit.tooLarge": "{0} exceeds the {1}-character limit.",
  "edit.kept": "M365 Copilot: {0} file(s) accepted. Not saved yet — Ctrl+S to write them.",
  "edit.reverted": "M365 Copilot: {0} file(s) reverted.",
  "edit.revertFailed": "M365 Copilot: could not revert: {0}",
  "edit.noBatch": "M365 Copilot: there is no batch of changes to undo.",
  "edit.batchUndone": "M365 Copilot: the batch of {0} file(s) was undone.",
  "edit.batchUndoFailed": "M365 Copilot: could not undo the batch: {0}",
  "edit.nonePending": "M365 Copilot: there are no pending agent changes.",
  "edit.diffTitle": "{0}: before ↔ M365 Copilot proposal",
  "edit.review.title": "Pending M365 Copilot changes",
  "edit.review.placeholder": "Pick a file to see its diff",
  "edit.lens.keep": "$(check) Keep ({0})",
  "edit.lens.keepTooltip": "Accept this M365 Copilot change",
  "edit.lens.undo": "$(discard) Undo",
  "edit.lens.undoTooltip": "Revert this change and restore the previous content",
  "edit.lens.diff": "$(diff) Show diff",
  "edit.lens.diffTooltip": "Compare with the previous content",
  "edit.lens.keepAll": "$(check-all) Keep all ({0})",
  "edit.lens.undoAll": "$(discard) Undo all",
  "edit.lens.keepHunk": "$(check) Keep ({0})",
  "edit.lens.keepHunkTooltip": "Accept only this block of changes",
  "edit.lens.undoHunk": "$(discard) Undo",
  "edit.lens.undoHunkTooltip": "Revert only this block of changes",
  "edit.status.text": "$(edit) M365: {0} change(s) to review",
  "edit.status.tooltip": "M365 Copilot changes pending Keep/Undo. Click to review them.",
  "diff.newFile": "new file",
  "diff.deletedFile": "deleted file",
  "diff.stats": "+{0} −{1}",
  "diff.modified": "modified",

  // ------------------------------------------------------------ DeepWiki (tools/deepwiki.ts, not registered yet)
  "deepwiki.badRepo":
    'repo must be "owner/name" of a PUBLIC GitHub repository (e.g. "microsoft/vscode").',
  "deepwiki.noQuestion": 'question is required when action="ask".',
  "deepwiki.empty": "DeepWiki ({0}, {1}): no result.",
  "deepwiki.timeout": "DeepWiki did not answer within {0}s.",
  "deepwiki.unreachable": "Could not reach DeepWiki: {0}",
  "deepwiki.http": "DeepWiki returned HTTP {0}.",
  "deepwiki.unrecognised": "DeepWiki did not return a recognisable response.",
  "deepwiki.errorNoDetails": "DeepWiki returned an error without details.",

  // ------------------------------------------------------------ sub-agents
  "subagent.invocation":
    "Delegating {0} sub-task(s) to M365 Copilot sub-agents (it can take several minutes; progress shows in the notifications)...",
  "subagent.invocation.several": "several",
  "subagent.disabled":
    "Delegating to sub-agents is disabled (setting m365copilot.subagents.enabled). " +
    "Enable it if you want to use this tool, or solve the task directly.",
  "subagent.errorPrefix": "Error: {0}",
  "subagent.noToken":
    "There is no saved M365 Copilot token. Ask the user to run “M365 Copilot: Paste profile or token” before delegating tasks.",
  "subagent.tokenExpired":
    "The M365 Copilot token has expired. Ask the user to capture and paste it again.",
  "subagent.progressTitle": "M365 Copilot: {0} sub-agent(s)",
  "subagent.nonText": "[non-text content omitted]",
  "subagent.noContent": "(no content)",
  "subagent.tasks.notArray": "tasks must be an array with at least one task.",
  "subagent.tasks.tooMany": "tasks cannot have more than {0} tasks.",
  "subagent.tasks.notObject": "Task #{0} must be an object.",
  "subagent.tasks.noTask": 'Task #{0} needs a "task" field describing what it must do.',
  "subagent.tasks.defaultLabel": "Task {0}",
  "subagent.step.call": "step {0} — {1}",
  "subagent.step.done": "completed",
  "subagent.step.limit": "limit reached",
  "subagent.step.error": "error: {0}",
  "subagent.report.incomplete": "### ⚠️ {0} (incomplete)",
  "subagent.report.guidance":
    "Result of {0} delegated sub-task(s). Synthesise this into ONE coherent answer for the user — do not paste the " +
    "### sections as-is or mention that they came from sub-agents unless it adds something.",
  "subagent.report.guidanceIncomplete":
    "{0} of them ended up incomplete (⚠️): say so briefly and decide whether it is worth retrying with a smaller scope " +
    "or telling the user about the limit reached.",
  "subagent.cancelled": "Cancelled.",
  "subagent.timeLimit":
    "⏱️ The maximum time ({0} min) for this sub-task was reached without a final answer. Last result:\n{1}",
  "subagent.noText": "(the sub-agent did not return any text).",
  "subagent.stepLimit":
    "⚠️ The limit of {0} step(s) was reached without a final answer. Last result:\n{1}",
  "subagent.prompt.framing":
    "You are an autonomous SUB-AGENT inside VS Code, delegated by the main M365 Copilot agent for ONE concrete, " +
    "bounded task. You do not see the rest of the conversation with the user — only the task below — so do not take " +
    "anything for granted outside it.",
  "subagent.prompt.task": "Assigned task:\n{0}",
  "subagent.prompt.finish":
    "Use the tools you need, one step at a time. When you are done, reply in Markdown with a CONCISE SUMMARY (a few " +
    "paragraphs or a bullet list at most) of what you did and what you found or changed — it is the ONLY thing the main " +
    "agent will read, so do not leave anything important out and do not emit more tool markers once you have that final " +
    "answer. If the summary includes code of 2 or more lines, put it inside ``` fences with the language.",
  "subagent.prompt.omitted": "[earlier sub-agent steps omitted to keep context]",
  "subagent.prompt.callBlock": "Sub-agent (step {0}): called {1} with {2}",
  "subagent.prompt.resultBlock": "Result of {0}:\n{1}",
  "subagent.clipNote": "… ({0} characters omitted)",

  // ------------------------------------------------------------ @m365 chat participant
  "participant.noToken":
    "There is no M365 Copilot token yet. Capture it in the browser and paste it here to start.",
  "participant.tokenExpired":
    "The M365 Copilot token has expired. Capture a new one in the browser and paste it again.",
  "participant.button.paste": "Paste profile or token",
  "participant.button.review": "Review pending changes",
  "participant.noContext":
    "There is no code to work on: open a file and select some code (or place the cursor inside a function), " +
    "attach a file with #, or describe what you need.",
  "participant.progress.thinking": "Asking M365 Copilot…",
  "participant.progress.tool": "Running {0}…",
  "participant.stepLimit":
    "_(Stopped after {0} tool calls without a final answer — choose Continue below, or raise `m365copilot.chat.maxToolCalls` (0 = no limit).)_",
  "participant.timeLimit": "_(Stopped: the request took more than {0} min.)_",
  "participant.error": "The answer could not be completed. {0}",
  "participant.followup.continue": "Continue",
  "participant.followup.continue.prompt": "Continue where you left off.",
  "participant.followup.explain": "Explain this code",
  "participant.followup.fix": "Fix the problems",
  "participant.followup.doc": "Document this code",
  "participant.followup.tests": "Generate tests",
  "participant.followup.terminal": "Explain the last terminal command",
  "participant.task.explain":
    "Explain what the code below does, how it works and anything non-obvious about it (edge cases, pitfalls, " +
    "performance). Be concise and concrete; do not rewrite it unless the user asks. Read more of the workspace only " +
    "if the code depends on something you cannot see.",
  "participant.task.fix":
    "Find and fix the problems in the code below (the diagnostics VS Code reports, if any, plus real bugs you spot). " +
    "Apply the fix to the file with the editing tool — the user reviews it with Keep/Undo — and then explain in one or " +
    "two sentences what was wrong and what you changed. Do not refactor unrelated code.",
  "participant.task.doc":
    "Add documentation comments to the code below, following the conventions of its language (JSDoc/TSDoc, " +
    "docstrings, XML doc…) and the style already used in the project. Apply them to the file with the editing tool and " +
    "do not change any behaviour.",
  "participant.task.tests":
    "Write unit tests for the code below using the test framework and conventions the project already uses (look for " +
    "existing tests first). Create or update the test file with the editing tool, then say in one line how to run them.",
  "participant.task.ask":
    "Answer the user’s request below. Use the workspace tools if you need more context or have to change files " +
    "(edits are reviewed by the user with Keep/Undo).",
  "participant.prompt.framing":
    "You are M365 Copilot, a coding assistant integrated into VS Code and invoked from the chat as @m365. Work step by " +
    "step with the tools, one call at a time. When you are done, reply to the user in Markdown — that reply is shown " +
    "directly in the chat.",
  "participant.prompt.context": "Code context — {0}, lines {1}-{2} ({3}):",
  "participant.prompt.contextTruncated": "[code truncated: {0} more characters]",
  "participant.prompt.diagnostics": "Problems VS Code reports in that code:",
  "participant.prompt.request": "User request:",
  "participant.prompt.noRequest": "(no extra instructions)",
  "participant.prompt.history": "Earlier messages in this chat (context only):",
  "participant.prompt.attached": "Other files the user attached: {0}",
  "participant.noTerminalRun":
    "No command has been captured in this terminal yet. Run the command again (VS Code’s shell integration has to be active in the terminal) and ask again.",
  "participant.task.terminal":
    "Explain why the terminal command below failed — or, if it did not fail, what its output means — and how to fix it. Point at the relevant lines of the output. Read the workspace files involved if you need to; if the fix is a code change, apply it with the editing tool (the user reviews it with Keep/Undo); if it is a command, give it, do not run it.",
  "participant.prompt.terminal": "Last command in the terminal “{0}”:",
  "participant.prompt.terminalRunning": "Still running",
  "participant.prompt.terminalNoExitCode": "Finished (exit code not reported by the shell)",
  "participant.prompt.terminalExitCode": "Exit code: {0}",
  "participant.prompt.terminalTruncated": "[start of the output omitted: {0} characters]",
  "participant.prompt.terminalNoOutput": "(no output)",
  "terminal.none": "M365 Copilot: open a terminal and run the command first.",

  // ------------------------------------------------------------ editor actions
  "actions.ask.prompt": "What do you want to ask M365 Copilot about this code?",
  "actions.ask.placeholder": "e.g. Why can this loop run forever?",
  "actions.noEditor": "M365 Copilot: open a file in the editor first.",
  "actions.chatUnavailable":
    "M365 Copilot: could not open the chat view ({0}). Is chat enabled in VS Code?",
  "actions.codeAction.fixDiagnostic": "Fix with M365 Copilot: {0}",
  "actions.codeAction.explain": "Explain with M365 Copilot",
  "actions.codeAction.document": "Document with M365 Copilot",
  "actions.codeAction.edit": "Edit with M365 Copilot…",

  // ------------------------------------------------------------ inline edit
  "inlineEdit.title": "Edit lines {0}–{1} with M365 Copilot",
  "inlineEdit.placeholder":
    "What should change? e.g. “add error handling”, “convert to async/await”",
  "inlineEdit.recent": "recent",
  "inlineEdit.progress": "M365 Copilot is editing {0}:{1}–{2}…",
  "inlineEdit.tooLarge":
    "M365 Copilot: this code is too large to edit inline. Select a smaller block, or ask @m365 in the chat.",
  "inlineEdit.changed":
    "M365 Copilot: the code changed while the edit was being prepared, so nothing was applied. Try again.",
  "inlineEdit.empty":
    "M365 Copilot did not return any code. Try again, or rephrase the instruction.",
  "inlineEdit.noChange": "M365 Copilot left the code unchanged.",
  "inlineEdit.done": "M365 Copilot: change applied — review it with Keep / Undo.",
  "inlineEdit.failed": "M365 Copilot: the edit failed: {0}",
  "inlineEdit.fixInstruction": "Fix this problem reported by VS Code: {0}",
  "inlineEdit.prompt.role": "You are a code editor inside VS Code, not a conversational assistant.",
  "inlineEdit.prompt.rules":
    "Rewrite the CODE TO EDIT below following the instruction.\nRules:\n- Reply with ONE fenced code block containing the complete new version of that code — nothing before or after it, no explanations.\n- Only that code: do not include the surrounding context, which is shown read-only so you know where the code lives.\n- Keep its indentation and style, and leave untouched everything the instruction does not ask to change.\n- If the instruction cannot be applied to this code, reply with the code unchanged.",
  "inlineEdit.prompt.file": "File: {0} ({1})",
  "inlineEdit.prompt.instruction": "Instruction:",
  "inlineEdit.prompt.diagnostics": "Problems VS Code reports in that code:",
  "inlineEdit.prompt.before": "Context BEFORE the code (read-only, do not repeat it):",
  "inlineEdit.prompt.code": "CODE TO EDIT (lines {0}-{1}):",
  "inlineEdit.prompt.after": "Context AFTER the code (read-only, do not repeat it):",
  "inlineEdit.prompt.reminder":
    "Remember: reply with ONE fenced code block containing the complete new version of the CODE TO EDIT, and nothing else.",

  // ------------------------------------------------------------ SCM commit message
  "scm.progress": "M365 Copilot is writing the commit message…",
  "scm.noChanges": "M365 Copilot: there are no changes to describe in this repository.",
  "scm.noRepository": "M365 Copilot: no git repository was found in this workspace.",
  "scm.pickRepository": "Pick a repository",
  "scm.failed": "M365 Copilot: could not generate the commit message: {0}",
  "scm.empty": "M365 Copilot did not return a commit message. Try again.",
  "scm.done": "M365 Copilot: commit message ready in Source Control — review it before committing.",
  "scm.prompt":
    "Write the git commit message for the changes below, as a careful senior developer who wants a history that " +
    "is still useful months from now.\n" +
    "Format:\n" +
    '- First line: Conventional Commits, "type(scope): summary" — imperative mood ("add", not "added" or "adds"), ' +
    "first word in lowercase unless it is a name, at most 72 characters (ideally about 50), no trailing period. " +
    "Valid types: {0}.\n" +
    "- Then, unless the change is trivial and the first line says it all, a blank line and a body of 1 to 5 short " +
    '"- " points.\n' +
    "- If the change breaks compatibility (a public API, setting, command, file format or CLI option that others " +
    'rely on), put "!" before the colon and end with a line "BREAKING CHANGE: what breaks and how to migrate".\n' +
    "How to write it:\n" +
    "- type = the main purpose: feat (a new capability), fix (corrects a bug), refactor (same behavior, better " +
    "code), perf (faster or lighter), docs (documentation only), test (tests only), build (build system or " +
    "dependencies), ci (CI configuration), style (formatting only), chore (other maintenance), revert.\n" +
    "- scope = the part of the project it affects (package, module or folder), one short lowercase word; reuse a " +
    "scope this repository already uses when one fits, and leave it out when the change spans the whole project.\n" +
    '- summary = what changes, specifically. Never vague: not "update files", "fix bug", "changes" or ' +
    '"improvements".\n' +
    "- body = why it was needed and what it changes in behavior (before → after): the problem it solves, the bug " +
    "it fixes, the effect for users. Do not narrate the diff file by file, list file names or repeat the first " +
    "line.\n" +
    "- If the changes mix unrelated work, the first line describes the main one and the body mentions the rest.\n" +
    "- Describe only what the diff shows: do not invent reasons, tests, issue numbers or benefits.\n" +
    "- Write the message in English, unless the recent commits listed below are all written in another " +
    "language: then use theirs.\n" +
    "- Reply ONLY with the commit message: no code fences, no quotes, no explanations before or after.\n\n" +
    "{1}",
  "scm.prompt.files": "Changed files ({0}):",
  "scm.prompt.diff": "--- diff ---",
  "scm.prompt.diffEnd": "--- end of diff ---",
  "scm.prompt.truncated": "[diff truncated: {0} more characters]",
  "scm.prompt.unstaged":
    "Nothing is staged: these are the working-tree changes the commit is likely to include.",
  "scm.prompt.repair":
    "Your previous answer was:\n{0}\nIt cannot be used: {1}\nReply again with the corrected commit message only.",

  // ------------------------------------------------------------ commit context (SCM + auto-commit)
  "commit.context.branch": "Branch: {0}",
  "commit.context.recent":
    "Latest commits of this repository (match their style, scopes and language):",
  "commit.context.scopes": "Scopes already used here (times): {0}",
  "commit.diff.fileTruncated": "[… {0} more lines of this file not shown]",
  "commit.diff.omitted": "[lock or generated file: +{0} -{1} lines, content not shown]",

  // ------------------------------------------------------------ auto-commit
  "autoCommit.enabled":
    "M365 Copilot auto-commit is on in this workspace: when you pause, it looks at your changes and commits the ones that make sense, with a documented message ({0}). It never pushes.",
  "autoCommit.disabled": "M365 Copilot auto-commit is off in this workspace.",
  "autoCommit.turnOn": "Turn on",
  "autoCommit.mode.auto": "automatically",
  "autoCommit.mode.confirm": "asking you first",
  "autoCommit.failed": "M365 Copilot auto-commit: {0}",
  "autoCommit.committed": "M365 Copilot committed in {0}: {1}",
  "autoCommit.committedMany": "M365 Copilot made {0} commits in {1}: {2}",
  "autoCommit.undo": "Undo",
  "autoCommit.show": "Show",
  "autoCommit.undone":
    "M365 Copilot: auto-commit undone — the changes are back in your working tree, uncommitted.",
  "autoCommit.undoNothing": "M365 Copilot: there is no auto-commit to undo.",
  "autoCommit.undoMoved":
    "M365 Copilot: the auto-commit can no longer be undone from here — there are newer commits on top of it.",
  "autoCommit.confirm": "M365 Copilot proposes a commit in {0}: {1}",
  "autoCommit.confirmMany": "M365 Copilot proposes {0} commits in {1}: {2}",
  "autoCommit.confirm.commit": "Commit",
  "autoCommit.confirm.choose": "Choose…",
  "autoCommit.confirm.skip": "Not now",
  "autoCommit.confirm.pickTitle": "M365 Copilot — commits to make",
  "autoCommit.confirm.files": "{0} file(s): {1}",
  "autoCommit.checking": "M365 Copilot is looking at your changes…",
  "autoCommit.nothing": "M365 Copilot: there is nothing to commit in {0}.",
  "autoCommit.waitNotice": "M365 Copilot is not committing yet in {0}: {1}",
  "autoCommit.busy": "M365 Copilot is already looking at the changes of {0}.",
  "autoCommit.noWatchedRepo":
    "M365 Copilot auto-commit is not watching any git repository of this workspace.",
  "autoCommit.reason.noToken": "no usable M365 token — paste one to resume",
  "autoCommit.reason.throttled": "M365 Copilot is limiting the account until about {0}",
  "autoCommit.reason.pendingEdits": "{0} agent edit(s) waiting for Keep/Undo",
  "autoCommit.reason.unsaved": "unsaved files: {0}",
  "autoCommit.reason.noHead": "the repository has no commits yet — make the first one yourself",
  "autoCommit.reason.detached": "HEAD is detached (not on a branch)",
  "autoCommit.reason.inProgress": "a git operation is in progress: {0}",
  "autoCommit.reason.conflicts": "there are unresolved conflicts",
  "autoCommit.reason.tooMany":
    "{0} changed files — too many for an automatic commit, commit them yourself",
  "autoCommit.reason.errors": "{0} error(s) in the changed files",
  "autoCommit.reason.interval": "last commit {0} min ago; next look in {1} min",
  "autoCommit.reason.changedMeanwhile": "the files changed while M365 Copilot was deciding",
  "autoCommit.reason.invalid": "M365 Copilot did not give a usable answer ({0})",
  "autoCommit.reason.unfinished": "the changes look unfinished",
  "autoCommit.reason.skipped": "you skipped the proposed commit",
  "autoCommit.reason.undone": "you undid the auto-commit",
  "autoCommit.reason.failed": "error: {0}",
  "autoCommit.invalid.noJson": "the answer was not JSON",
  "autoCommit.invalid.decision": 'unknown decision "{0}"',
  "autoCommit.invalid.noFiles": "no commit named a changed file",
  "autoCommit.status.title": "M365 Copilot auto-commit",
  "autoCommit.status.mode":
    "Commits {0}, after {1} s without changes and at least {2} min after the previous commit.",
  "autoCommit.status.clean": "no changes",
  "autoCommit.status.watching": "watching your changes",
  "autoCommit.status.evaluating": "deciding whether to commit…",
  "autoCommit.status.waiting": "waiting: {0}",
  "autoCommit.status.lastCommit": "last auto-commit {0} min ago: {1}",
  "autoCommit.status.click": "Click for the auto-commit options.",
  "autoCommit.menu.title": "M365 Copilot — auto-commit",
  "autoCommit.menu.checkNow": "Check now",
  "autoCommit.menu.checkNow.detail":
    "Ask M365 Copilot right away whether the current changes deserve a commit",
  "autoCommit.menu.undo": "Undo the last auto-commit",
  "autoCommit.menu.off": "Turn off auto-commit",
  "autoCommit.menu.settings": "Auto-commit settings",
  "autoCommit.prompt":
    "You are the auto-commit assistant of a developer who is coding in VS Code. They keep working; you look at " +
    "their uncommitted changes and decide whether this is a good moment to commit them, and how.\n" +
    "Decide like a careful senior developer who wants a clean, useful history:\n" +
    "- COMMIT when the changes are a finished, coherent unit of work: a complete fix (even a one-line one), a " +
    "finished step of a feature, a refactor, docs, tests, configuration.\n" +
    "- WAIT when the work looks unfinished: half-written code, code that would not compile or run, stubs or TODOs " +
    "that were just added, leftover debug output or commented-out blocks, or a change whose other half (its " +
    "callers, its tests, the function it uses) is clearly still missing.\n" +
    "- No noise: do not split one logical change into several commits, and do not commit trivial leftovers on " +
    "their own. When in doubt, WAIT: the developer keeps working and you will be asked again.\n" +
    "- If there are several UNRELATED finished changes, make one commit for each (at most {0}), and leave the " +
    "files that are still in progress out of every commit.\n" +
    "- If the changes have been piling up for a long time, prefer committing the parts that are finished.\n" +
    "Each commit message documents the change for whoever reads the history months from now:\n" +
    '- subject: Conventional Commits, "type(scope): summary" — imperative mood ("add", not "added"), first word ' +
    "in lowercase unless it is a name, at most 72 characters (ideally about 50), no trailing period. Valid " +
    "types: {1}.\n" +
    "- type = the main purpose: feat (a new capability), fix (corrects a bug), refactor (same behavior, better " +
    "code), perf, docs (documentation only), test (tests only), build (build system or dependencies), ci, style " +
    "(formatting only), chore (other maintenance).\n" +
    "- scope = the part of the project it affects, one short lowercase word; reuse a scope this repository " +
    "already uses when one fits, and leave it out when the change spans the whole project.\n" +
    '- summary: what changes, specifically. Never vague: not "update files", "fix bug" or "changes".\n' +
    "- body: 1 to 5 short points saying why it was needed and what it changes in behavior — the problem, the " +
    "effect, the bug it fixes. Do not repeat the subject, list file names or invent reasons the diff does not " +
    "show.\n" +
    "- breaking: add it ONLY if the commit breaks compatibility (a public API, setting, command, file format or " +
    "CLI option others rely on): one sentence saying what breaks and how to migrate.\n" +
    '- Write the "reason" in English. Write the subject and the body in English too, unless the recent commits ' +
    "listed below are all written in another language: then use theirs.\n" +
    "Reply ONLY with one JSON object — no code fences, nothing before or after it. Either:\n" +
    '{"decision":"commit","commits":[{"files":["src/parser.ts"],"subject":"fix(parser): handle empty input",' +
    '"body":["Return an empty tree instead of throwing when the file is empty.","Opening a new, empty file no ' +
    'longer crashes the outline."]}]}\n' +
    "or:\n" +
    '{"decision":"wait","reason":"one short sentence saying what still looks unfinished"}\n' +
    'In "files", use the paths exactly as listed below.\n\n' +
    "{2}",
  "autoCommit.prompt.state": "Repository state:",
  "autoCommit.prompt.lastCommit": 'Last commit: {0} min ago — "{1}"',
  "autoCommit.prompt.pendingFor": "These changes have been piling up for about {0} min.",
  "autoCommit.prompt.lastWait": "Last time you decided to wait because: {0}",
  "autoCommit.prompt.kind.new": "new file",
  "autoCommit.prompt.kind.added": "added",
  "autoCommit.prompt.kind.modified": "modified",
  "autoCommit.prompt.kind.deleted": "deleted",
  "autoCommit.prompt.kind.renamed": "renamed from {0}",
  "autoCommit.prompt.binary": "[binary file, {0} bytes]",
  "autoCommit.prompt.fileTruncated": "[file truncated: {0} bytes in total]",

  // ------------------------------------------------------------ migration from ms365-copilot-vscode
  "migration.settingsMoved":
    "M365 Copilot: {0} setting(s) of the previous version (ms365copilot.*) were copied to m365copilot.*. The old entries in settings.json no longer do anything and can be deleted.",
  "migration.openSettings": "Open settings (JSON)",
  "migration.legacyInstalled":
    "The previous version of M365 Copilot (ms365-copilot-vscode) is still installed. Both would compete for the token from the browser and for @m365 — uninstall the old one.",
  "migration.uninstall": "Uninstall the old version",
  "migration.uninstalled":
    "The old version of M365 Copilot was uninstalled. Reload the window to finish.",
  "migration.reload": "Reload window",
  "migration.uninstallFailed":
    "M365 Copilot: could not uninstall the old version ({0}). Uninstall it from the Extensions view.",
  "log.legacySettingsMigrated": "settings copied from the previous version: {0}",
  "log.legacySettingSkipped": "setting {0} not copied from the previous version: {1}",
  "log.legacyMigrationFailed": "could not copy the settings of the previous version: {0}",

  // ------------------------------------------------------------ Accounts menu
  "account.signIn.title": "Sign in with M365 Copilot",
  "account.signIn.placeholder": "How do you want to bring your M365 Copilot session to VS Code?",
  "account.signIn.browser": "Open M365 Copilot in the browser",
  "account.signIn.browserDetail":
    "The browser extension or the userscript sends the token to VS Code by itself.",
  "account.signIn.paste": "Paste profile or token",
  "account.signIn.pasteDetail":
    "Copied with “Copy token” in the browser extension or the userscript.",
  "account.signIn.waiting":
    "Waiting for the token from the browser… (sign in to M365 Copilot there)",
  "account.signIn.timeout":
    "M365 Copilot: no token arrived from the browser. Is the browser extension or the userscript installed? You can also paste the token.",
  "account.signInCancelled": "Sign-in to M365 Copilot was cancelled.",

  // ------------------------------------------------------------ code review (comments)
  "review.controller": "M365 Copilot review",
  "review.severity.error": "Error",
  "review.severity.warning": "Warning",
  "review.severity.info": "Suggestion",
  "review.suggestion": "Suggested fix:",
  "review.progress": "M365 Copilot is reviewing {0}…",
  "review.partial":
    "M365 Copilot: the file is large, so only lines {0}–{1} (the code at the cursor) are reviewed.",
  "review.tooLarge":
    "M365 Copilot: this code is too large to review at once. Select a smaller part.",
  "review.failed": "M365 Copilot: the review failed: {0}",
  "review.unreadable": "the answer was not a list of findings — try again",
  "review.clean": "M365 Copilot found nothing to comment on in {0}.",
  "review.found":
    "M365 Copilot left {0} review comment(s) in {1}. They are also listed in the Comments panel.",
  "review.show": "Go to the first one",
  "review.fixInstruction": "Fix this problem found in code review: {0}. {1} Suggested fix: {2}",
  "review.changes.progress": "M365 Copilot is reviewing your changes",
  "review.changes.count": "{0} of {1} files",
  "review.changes.none": "M365 Copilot: there are no changes to review.",
  "review.changes.tooMany":
    "M365 Copilot: only the first {0} of the {1} changed files are reviewed.",
  "review.changes.failedFiles": "M365 Copilot could not review: {0}",
  "review.changes.files": "{0} changed file(s)",
  "log.review": "review of {0}: {1} finding(s)",
  "log.reviewSkipped": "review: {0} skipped (too large)",
  "log.reviewFileFailed": "review of {0} failed: {1}",
  "log.reviewUnreadable": "review of {0}: unreadable answer:\n{1}",
  "review.prompt.role": "You are a senior code reviewer inside VS Code.",
  "review.prompt.rules":
    "Review the code below and report only real problems: bugs, wrong logic, unhandled errors or edge cases, " +
    "security issues, race conditions, resource leaks, misleading names, and clearly better alternatives. " +
    "Do not report formatting or style a formatter or linter would catch, and do not praise the code.\n" +
    "Reply with ONE fenced ```json block containing an array, and nothing before or after it. Each item:\n" +
    '{"line": <first line>, "endLine": <last line>, "severity": "error" | "warning" | "info", ' +
    '"title": "<short summary, at most 80 characters>", "message": "<what is wrong and why, 1-3 sentences>", ' +
    '"suggestion": "<how to fix it; optional>"}\n' +
    'Use the line numbers shown at the left of each line ("12 | code"). Write title, message and suggestion in English. ' +
    "If there is nothing worth reporting, reply with [].",
  "review.prompt.file": "File: {0} ({1})",
  "review.prompt.changes":
    "These lines were just changed: {0}. Report only problems in them or caused by them; the rest of the file is context.",
  "review.prompt.diff": 'The diff of those changes (lines starting with "-" were removed):',
  "review.prompt.code": "CODE (each line starts with its number):",
  "review.prompt.reminder":
    "Remember: reply with ONE fenced ```json block containing the array of findings ([] if none), and nothing else.",

  // ------------------------------------------------------------ fix all problems / edit suggestions
  "actions.codeAction.fixAll": "Fix all {0} problems in this file with M365 Copilot",
  "fixAll.none": "M365 Copilot: this file has no errors or warnings to fix.",
  "fixAll.progress": "M365 Copilot is fixing {0} problem(s) in {1}",
  "fixAll.step": "block {0} of {1} (lines {2}–{3})",
  "fixAll.instruction":
    "Fix these problems reported by VS Code in this code, without changing anything else:\n{0}",
  "fixAll.done": "M365 Copilot rewrote {0} block(s) — review them with Keep / Undo.",
  "fixAll.doneSome":
    "M365 Copilot rewrote {0} block(s) — review them with Keep / Undo. {1} more block(s) with problems were left for another run.",
  "fixAll.nothing": "M365 Copilot did not change anything.",
  "fixAll.failed": "M365 Copilot: {0} block(s) could not be fixed. See the log for details.",
  "log.fixAllBlockFailed": "fix all: lines {0}-{1} failed: {2}",
  "inlineEdit.suggestions": "suggestions",
  "inlineEdit.preset.simplify": "Simplify this code without changing what it does",
  "inlineEdit.preset.errors": "Add error handling",
  "inlineEdit.preset.types": "Add type annotations",
  "inlineEdit.preset.names": "Use clearer names for variables and functions",
  "inlineEdit.preset.comments": "Add short comments explaining the non-obvious parts",
  "inlineEdit.preset.performance": "Make it faster without changing what it does",
  "inlineEdit.preset.async": "Convert to async/await",

  // ------------------------------------------------------------ project index (RAG) — read by the MODEL
  "rag.context.header":
    "PROJECT CONTEXT — retrieved automatically from a local index of the user’s workspace for this request. It may be incomplete or slightly out of date: rely on it to know which files exist and where things live, and read the files (m365_read_file) before changing them. Paths are workspace-relative.",
  "rag.context.snippets": "Most relevant code for this request:",
  "rag.context.more": "Also relevant:",
  "rag.context.footer":
    "END OF PROJECT CONTEXT. To look further, use m365_search_project (search) or m365_project_map (structure, imports and importers of a file).",
  "rag.summary.header": "Workspace “{0}”: {1} files indexed ({2}). Areas:",
  "rag.map.empty": "The project index is empty: there are no indexable files in this workspace.",
  "rag.map.header": "Project map of “{0}” — {1} files, {2} chunks indexed.",
  "rag.map.languages": "Languages:",
  "rag.map.packages": "Packages / projects:",
  "rag.map.structure":
    "Structure — folder/ (files): subfolders/ (files), main files [main symbols]:",
  "rag.map.keyFiles": "Key files:",
  "rag.map.entries": "Likely entry points:",
  "rag.map.central": "Most imported modules (← number of files that import them):",
  "rag.map.external": "External dependencies used (files):",
  "rag.map.moreAreas": "… and {0} more folders",
  "rag.map.notFound":
    "Nothing indexed at “{0}”. Use m365_project_map without path to see the structure, or m365_list_files.",
  "rag.file.header": "{0} — {1}, {2} lines",
  "rag.file.symbols": "Symbols (line: kind name):",
  "rag.file.imports": "Imports:",
  "rag.file.external": "external",
  "rag.file.importedBy": "Imported by:",
  "rag.file.notImported": "No indexed file imports it.",
  "rag.folder.header": "Folder {0} — {1} indexed files [main symbols]:",
  "rag.search.header": "Project search: “{0}” — {1} results, most relevant first:",
  "rag.search.none":
    "No results in the project index for “{0}”. Try other words (code terms in English, identifiers), m365_search_text for literal text, or m365_project_map to see the structure.",
  "rag.search.more": "More results (not shown):",
  "rag.search.footer":
    "Read a file with m365_read_file before editing it; the snippets show the most relevant lines of each result.",
  "rag.search.noQuery": "Say what to search for in `query`.",
  "rag.truncated":
    "Note: the project is larger than the index limit (m365copilot.index.maxFiles), so some files are not indexed.",
  "rag.disabled":
    "The project index is turned off (m365copilot.index.enabled). Use m365_search_text and m365_list_files.",
  "rag.notReady":
    "The project index is not ready yet (or the workspace has no indexable files). Use m365_search_text and m365_list_files meanwhile.",
  "web.prompt.role": "You are a research assistant with web search.",
  "web.prompt.rules":
    "Search the web for the query below and answer with the most relevant, up-to-date facts: concise, in bullet points, with exact versions, names and code where they matter. Say when sources disagree or something could not be found. Cite the sources you used.",
  "web.prompt.query": "Query:",
  "web.result.header": "Web search: “{0}”",
  "web.result.sources": "Sources:",
  "web.empty": "The web search for “{0}” returned nothing.",
  "web.noQuery": "Say what to search for in `query`.",
  "web.disabled": "Web search is turned off (m365copilot.web.enabled).",

  // ------------------------------------------------------------ project index (RAG) — for the user
  "tool.searchingProject": "Searching the project for “{0}”...",
  "tool.projectMap": "Reading the project map...",
  "tool.projectMap.path": "Reading the project map of {0}...",
  "tool.webSearching": "Searching the web for “{0}”...",
  "index.progress": "M365 Copilot: indexing the project",
  "index.rebuilding": "M365 Copilot: rebuilding the project index…",
  "index.rebuilt": "M365 Copilot: project index ready — {0} files in {1} s.",
  "index.search.title": "Search the project ({0} files indexed)",
  "index.search.placeholder":
    "What are you looking for? e.g. “where is the token saved”, ProfileStore, login flow",
  "index.map.title": "Project map — {0}",
  "index.status.indexing": "indexing… ({0} files so far)",
  "index.status.ready": "{0} files indexed",
  "index.status.disabled": "index off",
  "index.status.untrusted": "workspace not trusted",
  "menu.section.project": "Project",
  "menu.searchProject": "Search the project…",
  "menu.projectMap": "Project map",
  "menu.rebuildIndex": "Rebuild project index",
  "log.indexBuilt": "project index: {0} files, {1} chunks in {2} ms{3}",
  "log.indexFailed": "project index failed: {0}",
  "log.indexContext": "project context: {0} hits, {1} snippets, {2} chars",
  "log.indexContextFailed": "project context unavailable: {0}",
  "log.webSearch": "web search: {0}",
  "log.webSearchDone": "web search answered: {0} chars, {1} sources",
  "log.webFallback": "the web turn was rejected ({0}); answering without web search",
} satisfies Record<string, string>;

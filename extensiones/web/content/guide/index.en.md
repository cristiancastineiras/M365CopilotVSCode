---
title: "How to use M365 Copilot in VS Code: step-by-step guide"
heading: "Use M365 Copilot in VS Code, step by step"
description: "Install the VS Code extension and the browser extension, connect them with one message and start chatting, editing and committing with Microsoft 365 Copilot."
---

## What you need

- **VS Code 1.104 or later.**
- **A Microsoft 365 account with a Copilot licence.** If you do not have one, the service answers with a licence error and the extension tells you so; ask your Microsoft 365 admin.
- **Chrome, Edge or Firefox 140+** for the browser extension (or Tampermonkey, see [step 6](#6-no-browser-extension-two-alternatives)).

The pack has two pieces. The **VS Code extension** adds the chat, the models and the editor actions. The **browser extension** reads the session token the Microsoft 365 Copilot web app already uses and sends it to VS Code, so you never copy and paste a token.


## 1. Install the VS Code extension

Pick one:

- **VS Marketplace:** open the [extension page](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode) and click **Install**, or run `ext install m365-copilot-vscode.m365-copilot-vscode` in the Quick Open box (`Ctrl+P`).
- **From a file:** download the `.vsix` from the [latest release](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest), then in VS Code open the Extensions view, click the `…` menu and choose **Install from VSIX…**.

When it is installed, an **M365** item appears in the status bar (bottom right). Its icon tells you at a glance whether VS Code has a valid token.

## 2. Install the browser extension

Download it from the [downloads page](../download/) and load it:

- **Chrome:** unzip the file, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
- **Edge:** the same, from `edge://extensions`.
- **Firefox:** open the signed `.xpi` file in Firefox. Without it, go to `about:debugging` → **This Firefox** → **Load Temporary Add-on** and choose the `.zip` (Firefox removes it when it closes).

## 3. Connect with one message

1. Open [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) and sign in.
2. Send any message in the chat.
3. Open the extension's popup. When everything is green, VS Code already has your token.

{{< shot narrow="true" src="popup-en.png" alt="Browser extension popup: connected to VS Code, token valid for 47 more minutes, automatic renewal" caption="Green means connected. The token renews itself while a Microsoft 365 tab is open." >}}

## 4. Chat with @m365

Open the VS Code chat and type **`@m365`** followed by your question. M365 Copilot always answers, whichever model is selected in the picker. Select code first and it travels with the question.

| Command | What it does |
| --- | --- |
| `@m365 /explain` | Explains the selected code, or the function at the cursor. |
| `@m365 /fix` | Fixes the problems in that code and applies the fix with Keep / Undo. |
| `@m365 /doc` | Adds documentation comments. |
| `@m365 /tests` | Writes unit tests with the framework the project already uses. |
| `@m365 /terminal` | Explains the last command of the active terminal and how to fix it. |

{{< shot src="editor-chat.png" alt="VS Code chat answering with M365 Copilot: two problems in the selected getUser function and a more robust version" caption="A question about the selected function, answered in VS Code's chat." >}}

### Using it as a model

If you prefer to pick M365 Copilot as a model (for example in Agent mode), show it first because it does not appear at the start: in the model picker click the gear, choose **Other models** and scroll to the M365 Copilot entries. You can pin them.

{{< shot narrow="true" src="editor-models.png" alt="VS Code model picker with the Microsoft 365 Copilot models: Auto, Quick response, Think deeper, GPT 5.5, GPT 5.6 and Claude Sonnet" caption="The M365 Copilot models in the model picker." >}}

## 5. Edit, review and commit from the editor

- **Edit in place:** select code (or put the cursor in a function), press `Ctrl+Shift+Alt+I` and type what should change. The result lands under **Keep / Undo**, block by block.
- **Right-click → M365 Copilot:** edit, explain, ask, review, fix, document or generate tests for the selected code.
- **Lightbulb (`Ctrl+.`) on an error:** **Fix with M365 Copilot** fixes it in place.
- **Review as comments:** **Review code** leaves its findings as comments on the lines, each with **Apply fix** and **Dismiss**. In Source Control, ☑ reviews all your uncommitted changes.
- **Commit messages:** the ✨ button in the Source Control title bar writes a Conventional Commits message from your diff. It never commits for you.
- **Auto-commit (optional):** turn it on per workspace and it commits finished work with documented messages. It never pushes, and every auto-commit has **Undo**.

{{< shot src="editor-edit.png" alt="VS Code editor with a change proposed by M365 Copilot: new lines highlighted and a Keep, Undo and Show diff bar above them" caption="Every edit waits for you to keep it or undo it." >}}

{{< shot src="editor-review.png" alt="VS Code editor with M365 Copilot review comments on the lines: an off-by-one error and an unvalidated discount warning" caption="Review findings as comments on the lines, each with a suggested fix." >}}

{{< shot src="editor-commit.png" alt="VS Code Source Control view with a commit message written by M365 Copilot in the commit box" caption="The commit message appears in the box. You read it and commit." >}}

## 6. No browser extension? Two alternatives

**Userscript.** Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey), then [install the userscript](https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/extensiones/vscode/m365copilot-token.user.js); it updates itself afterwards. Open Microsoft 365 Copilot and send a message. The first time, Tampermonkey asks to let the script connect to `localhost`: allow it, that is VS Code.

**Paste the token by hand.** Useful on a managed browser where you cannot install anything:

1. Open Microsoft 365 Copilot, press `F12` and go to the **Network** tab.
2. Type `chathub` in the filter and send a message.
3. Right-click the request that appears → **Copy** → **Copy URL**.
4. In VS Code open the command palette (`Ctrl+Shift+P`), run **M365 Copilot: Paste profile or token** and confirm. It detects the URL in your clipboard.

{{< shot src="editor-menu.png" alt="The M365 menu opened from the VS Code status bar: Paste profile or token, token status, open M365 Copilot, sign out and sign in again" caption="The same command is in the M365 menu of the status bar, next to the token status." >}}

{{< note >}}
The Copilot token travels as `access_token` inside that URL, not in an `Authorization: Bearer` header. A bearer copied from another request belongs to a different service and fails with a 401.
{{< /note >}}

Web search needs the session captured by the browser extension or the userscript; a pasted token alone does not carry it.

## 7. When the token expires

The token lasts about an hour. With the browser extension and a Microsoft 365 tab open somewhere, it renews by itself. If not, the status bar item shows a warning and a notification offers **Paste token** or **Open M365 Copilot**: open Microsoft 365 Copilot and send a message again.

To switch accounts, or if renewal goes wrong, use **Sign out and sign in again** from the M365 status bar menu. It also clears the browser's Microsoft session, which is the only thing that makes Microsoft ask for your credentials again. It needs the browser extension.

## 8. Language

The extension follows VS Code's language, English or Spanish, and the instructions sent to the model follow it too. To change it, use the status bar menu → **Change language**, or the `m365copilot.language` setting.

## Common problems

- **A 401 error:** you pasted a bearer from another request. Copy the `chathub` URL instead, as in step 6.
- **No M365 Copilot in the model picker:** click the gear → **Other models**. You can always use `@m365`.
- **A licence error:** the account has no Copilot licence. It is about the account, not the model: ask your Microsoft 365 admin.
- **Claude models do not answer:** your admin has to enable Anthropic models.
- **Still stuck:** [open an issue](https://github.com/cristiancastineiras/M365CopilotVSCode/issues) on GitHub.

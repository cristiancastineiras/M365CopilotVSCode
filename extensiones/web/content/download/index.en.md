---
title: "Download M365 Copilot for VS Code"
heading: "Download the pack"
layout: download
description: "Direct downloads of the M365 Copilot VS Code extension, the Chrome, Edge and Firefox extension and the Tampermonkey userscript, from the latest GitHub release."
---

## Installing the browser extension

The browser extension is not in the browser stores: you load the file from the release. It takes a minute.

### Chrome

1. Unzip `m365-copilot-vscode-extension-chrome.zip` into a folder you will keep (the browser reads it from there).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose that folder.

### Edge

Same as Chrome, with `m365-copilot-vscode-extension-edge.zip` and `edge://extensions`.

### Firefox

- **Permanent:** open the signed `.xpi` file in Firefox (or drag it onto `about:addons`). When a release has no `.xpi` the Firefox button gives you the `.zip` instead.
- **Temporary, no signature needed:** `about:debugging` → **This Firefox** → **Load Temporary Add-on** and choose the `.zip` (no need to unzip it). Firefox removes it when it closes.
- **Developer Edition, Nightly or ESR:** set `xpinstall.signatures.required` to `false` in `about:config`, then `about:addons` → ⚙ → **Install Add-on From File**.

Firefox 140 or later.

## Installing the VS Code extension from a file

Open the Extensions view in VS Code, click the `…` menu and choose **Install from VSIX…**. Or from a terminal: `code --install-extension m365-copilot-vscode-X.Y.Z.vsix`.

## Then connect

Open [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) and send a message. The browser extension's popup turns green and VS Code has your token.

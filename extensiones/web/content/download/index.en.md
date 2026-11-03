---
title: "Download M365 Copilot for VS Code"
heading: "Download the pack"
layout: download
description: "Install the M365 Copilot VS Code extension, the browser extension from the Chrome Web Store (Chrome and Edge) or Firefox Add-ons, and the Tampermonkey userscript."
---

## Installing the browser extension

### Chrome and Edge

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/cdeegiifkgahagfcjhedkdcfbpipffdd). Edge installs it from there too: the first time, it asks you to **Allow extensions from other stores**.

### Firefox

Install it from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/microsoft-365-copilot-vs-code/). Firefox 140 or later.

From the store it updates itself: each new version arrives once the store has reviewed it.

### Without the store

Every [release](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest) also has the `.zip` files:

- **Chrome or Edge:** unzip `m365-copilot-vscode-extension-chrome.zip` (or `-edge.zip`) into a folder you will keep (the browser reads it from there), open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked** and choose that folder.
- **Firefox, temporary:** `about:debugging` → **This Firefox** → **Load Temporary Add-on** and choose `m365-copilot-vscode-extension-firefox.zip` (no need to unzip it). Firefox removes it when it closes.
- **Firefox Developer Edition, Nightly or ESR:** set `xpinstall.signatures.required` to `false` in `about:config`, then `about:addons` → ⚙ → **Install Add-on From File** with the `.zip`.

## Installing the VS Code extension from a file

Open the Extensions view in VS Code, click the `…` menu and choose **Install from VSIX…**. Or from a terminal: `code --install-extension m365-copilot-vscode-X.Y.Z.vsix`.

## Then connect

Open [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) and send a message. The browser extension's popup turns green and VS Code has your token.

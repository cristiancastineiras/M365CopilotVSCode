---
"@m365copilot/core": minor
"m365-copilot-vscode": minor
"m365-copilot-vscode-extension": minor
"@m365copilot/tui": minor
---

The model list is now your account's own model menu, the one the M365 Copilot web app shows.

- VS Code and the TUI ask for it with the chat token (`GET /m365Copilot/getgptlist`): on start, with every new token, and from **M365 Copilot: Update models**. The last menu is kept for when the network is down; the built-in list is only used until the first one loads.
- With a Microsoft 365 Copilot licence the menu also has the licence's models (Claude Opus 5.5, Claude Sonnet 5 / 5.5, GPT-6, GPT-6.1 Sol…), and their turns go on the licence.
- The online catalog (`models.json` in the repository) is gone, and so are the `m365copilot.models.updateFromCatalog` and `m365copilot.models.detectFromBrowser` settings.
- The browser extension and the userscript no longer record which models the web app uses.
- **M365 Copilot: Check models**, which sent a message to every model, is gone: the menu already says which models your account has. `m365copilot.models.custom` still adds a model that is not in it.

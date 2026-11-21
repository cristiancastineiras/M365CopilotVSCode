# @m365copilot/tui

## 4.1.0

### Minor Changes

- 9e2f338: The model list is now your account's own model menu, the one the M365 Copilot web app shows.

  - VS Code and the TUI ask for it with the chat token (`GET /m365Copilot/getgptlist`): on start, with every new token, and from **M365 Copilot: Update models**. The last menu is kept for when the network is down; the built-in list is only used until the first one loads.
  - With a Microsoft 365 Copilot licence the menu also has the licence's models (Claude Opus 5.5, Claude Sonnet 5 / 5.5, GPT-6, GPT-6.1 Sol…), and their turns go on the licence.
  - The online catalog (`models.json` in the repository) is gone, and so are the `m365copilot.models.updateFromCatalog` and `m365copilot.models.detectFromBrowser` settings.
  - The browser extension and the userscript no longer record which models the web app uses.
  - **M365 Copilot: Check models**, which sent a message to every model, is gone: the menu already says which models your account has. `m365copilot.models.custom` still adds a model that is not in it.

### Patch Changes

- Updated dependencies [9e2f338]
- Updated dependencies [c6b738e]
  - @m365copilot/core@4.1.0

## 4.0.1

### Patch Changes

- Updated dependencies [6ae0746]
  - @m365copilot/core@4.0.1

## 4.0.0

### Major Changes

- Mejora en uso de tools y agregado captura de tokens personales en la extension

### Patch Changes

- 4c01307: Support personal Microsoft 365 subscriptions (Personal, Family), whose Copilot token is an encrypted 5-part JWE: the browser extension and the userscript capture it from the chat WebSocket (also on copilot.com), and the paste command accepts it in the chat URL or in a copied profile. Its account comes from the URL, the turn uses the scenario the web app used, and logs hide all five parts. The token's expiry cannot be read, so it stays usable until Microsoft rejects it with a 401. The browser extension now asks for access to copilot.com. Also updates `@vscode/vsce` and its dependencies to clear six security alerts.
- Updated dependencies
- Updated dependencies [2827a29]
- Updated dependencies [4c01307]
  - @m365copilot/core@4.0.0

## 3.0.5

### Patch Changes

- @m365copilot/core@3.0.6

## 3.0.4

### Patch Changes

- @m365copilot/core@3.0.5

## 3.0.3

### Patch Changes

- Updated dependencies [47b08c4]
  - @m365copilot/core@3.0.4

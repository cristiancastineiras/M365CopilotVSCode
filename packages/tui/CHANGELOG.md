# @m365copilot/tui

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

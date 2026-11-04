---
"@m365copilot/core": patch
"@m365copilot/tui": patch
"m365-copilot-vscode": patch
"m365-copilot-vscode-extension": patch
---

Support personal Microsoft 365 subscriptions (Personal, Family), whose Copilot token is an encrypted 5-part JWE: the browser extension and the userscript capture it from the chat WebSocket (also on copilot.com), and the paste command accepts it in the chat URL or in a copied profile. Its account comes from the URL, the turn uses the scenario the web app used, and logs hide all five parts. The token's expiry cannot be read, so it stays usable until Microsoft rejects it with a 401. The browser extension now asks for access to copilot.com. Also updates `@vscode/vsce` and its dependencies to clear six security alerts.

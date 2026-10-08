---
"@m365copilot/core": minor
"m365-copilot-vscode-extension": minor
"m365-copilot-vscode": minor
---

**A cleaner, native-looking popup and userscript panel, with a connection signal instead of the arrow.**

- The M365 → VS Code illustration (`connectionArtSvg`, shared by the browser popup and the Tampermonkey panel) replaces the arrow with a three-ring signal (based on the "wifi loader" by mobinkakei on Uiverse.io, MIT): it spins in grey while looking for the token, in blue while looking for VS Code, stops and points at VS Code once connected, and turns into a weak amber signal when the token expired or you have to sign in.
- Popup and panel are light and simple, in Segoe UI with Windows 11 (Fluent 2) colours and controls: a short status list with coloured dots, one main button and two secondary ones. In the popup the main button is always the next step — **Open M365 Copilot** without a token, **Renew now** when it expired, **Send to VS Code** otherwise — and **Copy token** is disabled for an expired token. The technical "Endpoint" row is gone.
- The guide's screenshots show the new design.

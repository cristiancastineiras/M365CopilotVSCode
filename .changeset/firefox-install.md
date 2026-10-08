---
"m365-copilot-vscode-extension": patch
---

**Firefox: the add-on installs again instead of being reported as corrupt, and actually works.**

- In Firefox nothing worked: the popup showed `can't access property "profile", V is undefined` and the captured token was never read back. Firefox (Manifest V2) only supports callbacks on `chrome.*` — without one they return `undefined`, not a promise — so every `await chrome.runtime.sendMessage(…)` / `chrome.storage.local.get(…)` came back empty. The extension now uses `browser.*` on Firefox (promise-based, same API) and `chrome.*` on Chrome/Edge.

- The Firefox build now has a permanent add-on ID (`browser_specific_settings.gecko.id`). Without it, *Install Add-on From File* rejected the zip with "This add-on could not be installed because it appears to be corrupt"; only a temporary load from `about:debugging` worked.
- It declares Firefox 128 as the minimum (the first version that runs the token interceptor in the page's `MAIN` world) and, for Firefox's built-in data consent, the data it sends to VS Code: the token (`authenticationInfo`) and the captured chat request, which includes the last message typed in Copilot (`personalCommunications`).
- Releases can include a Mozilla-signed `m365-copilot-vscode-extension-firefox.xpi`, the only kind Firefox Release installs permanently: `pnpm sign:firefox` signs it on AMO as an unlisted add-on, and the release workflow does it when the `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` secrets are set. The sources zip AMO asks for now includes `@m365copilot/core` and the lockfile, so the build can be reproduced from it.
- The toolbar badge (`!` when the token expired) now also shows in Firefox, which has `browserAction` instead of `action` in Manifest V2.

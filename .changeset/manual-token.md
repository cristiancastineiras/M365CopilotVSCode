---
"m365-copilot-vscode": patch
---

**Pasting the token by hand (no browser extension, no userscript) works and explains itself.**

- **Paste profile or token** also accepts the URL of the chat WebSocket copied from DevTools (`wss://…/Chathub/…?access_token=eyJ…`, detected in the clipboard) and `Bearer eyJ…`. The Copilot token travels as `access_token` in that URL, not in an `Authorization` header, so this is the simplest way to capture it in a browser where extensions cannot be installed (Network → filter `chathub` → Copy URL). Only the endpoint's `variants` are kept from the URL, never the token or the session ids.
- Pasting a token for another service (a bearer copied from a Graph or search request) used to look connected and then fail every message with "401 Unauthorized". Now the paste asks first, naming the token's audience and how to get the right one; and if such a token is in use, the 401/403 error says it is for another service instead of "expired".
- The README describes this manual capture (English and Spanish).

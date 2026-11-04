---
"@m365copilot/core": patch
"m365-copilot-vscode": patch
"m365-copilot-vscode-extension": patch
---

Automatic sending now tells you what is going on with both kinds of account.

- The userscript panel and the browser extension popup show whether the account is personal or work/school, and what that means for renewing the token.
- They no longer say "Connected" when VS Code is rejecting the token: they say so and tell you to update the VS Code extension. VS Code also warns once per reason, and confirms a token it received even when the token does not say when it expires.
- The browser extension no longer lets another Microsoft frame replace the token in use with an older one, or with none at all.
- The popup copies the whole profile for a personal account, because its token alone cannot be pasted.
- When the service refuses a token (401), VS Code marks it as expired right away and says what to do. For a personal account, whose token does not say when it expires, that is send a message in the web chat: the new token arrives by itself.
- A very long chat address no longer loses the captured endpoint, which says what kind of account it is.

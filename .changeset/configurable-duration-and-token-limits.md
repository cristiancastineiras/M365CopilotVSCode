---
"m365-copilot-vscode": patch
---

Long tasks and long conversations go further.

- `m365copilot.chat.maxDurationMinutes` (8) sets how long one `@m365` request or one sub-agent can run, and `0` removes the limit. The notice when it is reached names the setting.
- A task picks up the token the browser renews while it runs, before each step, instead of ending in an error when the first one expires.
- `m365copilot.models.maxInputTokens` (128000) and `m365copilot.models.maxOutputTokens` (16000) set what VS Code is told about every model.
- `maxInputTokens` now also sets how much of the conversation reaches the model in Copilot Chat: about 448,000 characters by default, up to 750,000, where it was always about 72,000. If the service refuses a message that long, the extension retries with the old size and keeps to it until the window reloads.
- `@m365` and sub-agents keep far more of each tool result: about 75,000 characters by default, where it was 4,000, so a whole `read_file` reaches the model.
- A task that reaches 400,000 characters continues in a new conversation with the request and the steps so far, because BizChat silently forgets the oldest part of a longer one, which is the request.

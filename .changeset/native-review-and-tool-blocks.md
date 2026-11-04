---
"@m365copilot/core": minor
"m365-copilot-vscode": minor
---

`@m365` edits now use VS Code's own review of chat edits, the one GitHub Copilot's have: red and green inline, Keep/Undo on each change, "files changed" next to the chat input, and checkpoints. Edits are saved as they land, so the next command the model runs sees them, and only files that can run code or hold secrets ask for confirmation first.

The review that remains for inline edits and quick fixes no longer leaves files marked as modified after Undo, removes the tab of a created file, follows Ctrl+Z and Ctrl+Y on disk, and shows the previous text when hovering over a change.

The model is less likely to say it cannot use tools: the prompt now asks for a way of working in the user's voice instead of claiming it has access, tools are called with code blocks instead of JSON, the catalog is shorter and always includes one tool for each basic capability, a shell block runs through the terminal tool when the reply opens with it, and a reply that gives up or claims work no tool did is retried at any step of a task. Based on measurements published by github.com/cramt/m365-copilot-proxy.

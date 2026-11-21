---
"@m365copilot/core": minor
"m365-copilot-vscode": minor
---

The `@m365` chat participant is now the **M365 Copilot** agent and its skills.

VS Code is retiring chat participants: the Copilot harness, which replaces the Local one in February 2027, does not support them. Custom agents and skills work in both.

- Pick **M365 Copilot** in the chat's agent picker. It answers with Microsoft 365 Copilot (`M365 Copilot (Auto)` when you switch to it) and works on your workspace with the chat's tools.
- `/explain`, `/fix`, `/doc`, `/tests` and `/terminal` are now the skills `/m365-explain`, `/m365-fix`, `/m365-doc`, `/m365-tests` and `/m365-terminal`. Use them with the agent, or with any agent and model. They only run when you invoke them.
- **Explain**, **Fix**, **Document**, **Generate tests**, **Ask about this code…** and **Explain last terminal command** open the agent with the right skill and the code you were on attached (for **Fix**, with the problems VS Code reports there). The model is the one in `m365copilot.editor.model`.
- New tool `m365_last_terminal_command`: the model reads the last command of the active terminal (its output, exit code and working directory) instead of asking you to paste it.
- `m365copilot.chat.maxToolCalls` is gone: it only limited `@m365`. In the chat, VS Code's own `chat.agent.maxRequests` applies. `m365copilot.chat.maxDurationMinutes` still limits each sub-agent.

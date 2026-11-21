---
name: m365-terminal
description: "Explain the last command run in the active terminal (its output and exit code) and how to fix it."
argument-hint: "(optional) what you expected"
disable-model-invocation: true
---

Read the last command I ran in the terminal with the `m365_last_terminal_command` tool (it may be listed as `m365LastTerminalCommand`): it returns the command, its exit code, where it ran and its output. Then explain why it failed (or, if it did not fail, what its output means) and how to fix it, pointing at the relevant lines of the output. Read the workspace files involved if you need to. If the fix is a code change, apply it with the editing tool (I review it with Keep/Undo); if it is a command, give it to me rather than run it.

If the tool says no command was captured, tell me so, and ask me to run it again or to paste its output.

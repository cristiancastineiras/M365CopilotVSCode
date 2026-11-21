---
name: m365-fix
description: "Fix the problems in the attached or selected code (what VS Code reports there and real bugs) and apply the fix for review with Keep/Undo."
argument-hint: "(optional) what goes wrong"
disable-model-invocation: true
---

Find and fix the problems in the code I attached: the problems VS Code reports there (my message lists them, and the diagnostics tool reads them) plus real bugs you spot. Apply the fix to the file with the editing tool (I review it with Keep/Undo), and then tell me in one or two sentences what was wrong and what you changed. Leave unrelated code as it is.

If I attached nothing, the code I mean is the one my message names, or the file open in my editor.

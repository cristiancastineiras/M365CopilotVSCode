---
"m365-copilot-vscode": minor
"m365-copilot-vscode-extension": minor
"@m365copilot/core": minor
---

**Everything is `m365` again — plus code review as comments, the Accounts menu and "Fix all problems".**

- **Rename:** `ms365` → `m365` everywhere, as in 1.0: the VS Code extension is `m365-copilot-vscode.m365-copilot-vscode`, its settings and commands `m365copilot.*`, its tools `m365_*`, its models `m365-copilot-*`, the shared package `@m365copilot/core`, the userscript `m365copilot-token.user.js` and the artifacts `m365-copilot-vscode-<version>.vsix`.
- **Migration:** the `ms365copilot.*` settings of 1.3–2.0 are copied to `m365copilot.*` once (user settings, and each workspace when opened; model ids renamed too, values you already set in the new keys win). If the old `ms365-copilot-vscode` extension is still installed, a notification offers to uninstall it — both would compete for the token port and `@m365`.
- **Code review as comments:** *Review code* (editor context menu) reviews the selection or the file, and ☑ *Review changes with M365 Copilot* (Source Control title bar) reviews every uncommitted change — modified files against HEAD plus untracked ones — commenting only on the changed lines. Findings appear as comment threads on the lines and in the Comments panel, each with *Apply fix* (an inline edit under Keep/Undo) and *Dismiss*.
- **Accounts menu:** M365 Copilot is an authentication provider: the account shows in VS Code's Accounts menu, *Sign Out* deletes the token, and without a token the menu offers *Sign in with M365 Copilot* (opens M365 Copilot in the browser and waits for the token, or lets you paste it).
- **Fix all problems in this file** (lightbulb, when a file has two or more errors/warnings, and context menu): one inline edit per block with problems, from the bottom up, each under Keep/Undo.
- *Edit code…* now offers common instructions (simplify, add types, clearer names…) after the recent ones.

---

**Todo vuelve a ser `m365` — y además revisión de código como comentarios, el menú Cuentas y «Corregir todos los problemas».**

- **Renombrado:** `ms365` → `m365` en todo, como en la 1.0: la extensión de VS Code es `m365-copilot-vscode.m365-copilot-vscode`, sus ajustes y comandos `m365copilot.*`, sus herramientas `m365_*`, sus modelos `m365-copilot-*`, el paquete compartido `@m365copilot/core`, el userscript `m365copilot-token.user.js` y los artefactos `m365-copilot-vscode-<versión>.vsix`.
- **Migración:** los ajustes `ms365copilot.*` de la 1.3–2.0 se copian a `m365copilot.*` una vez (los de usuario, y los de cada workspace al abrirlo; también se renombran los ids de modelo, y lo que ya hayas puesto en las claves nuevas gana). Si sigue instalada la extensión antigua `ms365-copilot-vscode`, un aviso ofrece desinstalarla: las dos se pelearían por el puerto del token y por `@m365`.
- **Revisión de código como comentarios:** *Revisar código* (menú contextual del editor) revisa la selección o el archivo, y ☑ *Revisar cambios con M365 Copilot* (barra de título de Source Control) revisa todos los cambios sin commitear — archivos modificados respecto a HEAD y los nuevos sin seguimiento — comentando sólo las líneas cambiadas. Los hallazgos aparecen como hilos de comentarios en las líneas y en el panel Comentarios, cada uno con *Aplicar corrección* (una edición en línea bajo Keep/Undo) y *Descartar*.
- **Menú Cuentas:** M365 Copilot es un proveedor de autenticación: la cuenta aparece en el menú Cuentas de VS Code, *Cerrar sesión* borra el token y, sin token, el menú ofrece *Iniciar sesión con M365 Copilot* (abre M365 Copilot en el navegador y espera el token, o te deja pegarlo).
- **Corregir todos los problemas del archivo** (bombilla, cuando un archivo tiene dos o más errores/avisos, y menú contextual): una edición en línea por bloque con problemas, de abajo arriba, cada una bajo Keep/Undo.
- *Editar código…* ofrece ahora instrucciones habituales (simplificar, añadir tipos, nombres más claros…) después de las recientes.

---
"ms365-copilot-vscode": minor
"m365-copilot-vscode-extension": minor
"@ms365copilot/core": minor
---

**English / Spanish everywhere — and deeper editor integration.**

- **i18n (en/es):** the VS Code extension, the browser extension, the userscript and the docs are now available in English and Spanish. New `ms365copilot.language` setting (`auto` follows VS Code's display language); it also switches the language of the instructions sent to the model and BizChat's `locale`. Manifest text via `package.nls*.json`; browser manifest via `_locales`.
- **`@m365` chat participant** with `/explain`, `/fix`, `/doc` and `/tests`, always answered by M365 Copilot, using the selection or the function at the cursor as context, with live streaming, tool progress and follow-ups.
- **Editor:** "M365 Copilot" context submenu, lightbulb actions (*Fix with M365 Copilot* on errors, *Explain/Document* on a selection), Keep/Undo/Diff buttons in the editor title for pending agent changes.
- **Status bar hub** with token state, countdown and a quick menu; notifications when the token is about to expire or expires; the model picker flags expired tokens.
- **Source Control:** ✨ *Generate commit message with M365 Copilot* (Conventional Commits) in the SCM title bar.
- **Get started** walkthrough; inline completions skip output/diff views and the `inlineCompletions.disabledLanguages` setting.
- Fix: the browser popup showed "✓ Sent" even when sending to VS Code failed (handler errors were returned as data instead of thrown).

---

**Inglés / español en todo — e integración más profunda con el editor.**

- **i18n (en/es):** la extensión de VS Code, la de navegador, el userscript y la documentación están en inglés y español. Nuevo ajuste `ms365copilot.language` (`auto` sigue el idioma de VS Code), que cambia también el idioma de las instrucciones que se envían al modelo y el `locale` de BizChat.
- **Participante `@m365`** con `/explain`, `/fix`, `/doc` y `/tests`, que responde siempre con M365 Copilot usando como contexto la selección o la función del cursor, con respuesta en vivo, progreso de herramientas y sugerencias de continuación.
- **Editor:** submenú contextual «M365 Copilot», acciones en la bombilla (*Corregir con M365 Copilot* en errores, *Explicar/Documentar* sobre una selección) y botones Keep/Undo/Diff en la barra de título para los cambios pendientes del agente.
- **Barra de estado** con el estado del token, cuenta atrás y un menú rápido; avisos cuando el token va a caducar o caduca; el selector de modelos marca los tokens caducados.
- **Source Control:** ✨ *Generar mensaje de commit con M365 Copilot* (Conventional Commits) en la barra de título.
- Recorrido de **primeros pasos**; el autocompletado ya no se dispara en vistas de salida/diff y añade el ajuste `inlineCompletions.disabledLanguages`.
- Corrección: el popup del navegador mostraba «✓ Enviado» aunque el envío a VS Code fallara.

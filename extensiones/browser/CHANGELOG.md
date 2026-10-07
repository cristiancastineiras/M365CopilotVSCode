# m365-copilot-vscode-extension

## 2.0.0

### Major Changes

- **Models that update themselves.**

  - The model list is no longer fixed. It merges the built-in models, the online catalog [`models.json`](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/models.json) (downloaded on start and every 12 h, cached for offline use; `"hidden": true` retires a model), the models the M365 Copilot web app actually uses — the browser extension and the userscript record each chat's `tone` and send it with the token — and `ms365copilot.models.custom`. The chat's model picker updates by itself, new models are announced once, and _M365 Copilot: Update models_ refreshes and lists them.
  - New settings: `ms365copilot.models.updateFromCatalog`, `ms365copilot.models.detectFromBrowser`, `ms365copilot.models.custom`.
  - If BizChat rejects a model that is not built in, the error says it may not be available in the tenant and suggests Auto.

  ***

  **Modelos que se actualizan solos.**

  - La lista de modelos ya no es fija. Junta los modelos de serie, el catálogo en línea [`models.json`](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/models.json) (descargado al arrancar y cada 12 h, con caché para usarlo sin conexión; `"hidden": true` retira un modelo), los modelos que usa de verdad la web de M365 Copilot — la extensión de navegador y el userscript apuntan el `tone` de cada chat y lo envían con el token — y `ms365copilot.models.custom`. El selector de modelos del chat se actualiza solo, los modelos nuevos se anuncian una vez y _M365 Copilot: Actualizar modelos_ los refresca y los lista.
  - Ajustes nuevos: `ms365copilot.models.updateFromCatalog`, `ms365copilot.models.detectFromBrowser`, `ms365copilot.models.custom`.
  - Si BizChat rechaza un modelo que no viene de serie, el error indica que puede no estar disponible en el tenant y sugiere Auto.

- 3e7b328: **English / Spanish everywhere — and deeper editor integration.**

  - **i18n (en/es):** the VS Code extension, the browser extension, the userscript and the docs are now available in English and Spanish. New `ms365copilot.language` setting (`auto` follows VS Code's display language); it also switches the language of the instructions sent to the model and BizChat's `locale`. Manifest text via `package.nls*.json`; browser manifest via `_locales`.
  - **`@m365` chat participant** with `/explain`, `/fix`, `/doc` and `/tests`, always answered by M365 Copilot, using the selection or the function at the cursor as context, with live streaming, tool progress and follow-ups.
  - **Editor:** "M365 Copilot" context submenu, lightbulb actions (_Fix with M365 Copilot_ on errors, _Explain/Document_ on a selection), Keep/Undo/Diff buttons in the editor title for pending agent changes.
  - **Status bar hub** with token state, countdown and a quick menu; notifications when the token is about to expire or expires; the model picker flags expired tokens.
  - **Source Control:** ✨ _Generate commit message with M365 Copilot_ (Conventional Commits) in the SCM title bar.
  - **Get started** walkthrough; inline completions skip output/diff views and the `inlineCompletions.disabledLanguages` setting.
  - Fix: the browser popup showed "✓ Sent" even when sending to VS Code failed (handler errors were returned as data instead of thrown).

  ***

  **Inglés / español en todo — e integración más profunda con el editor.**

  - **i18n (en/es):** la extensión de VS Code, la de navegador, el userscript y la documentación están en inglés y español. Nuevo ajuste `ms365copilot.language` (`auto` sigue el idioma de VS Code), que cambia también el idioma de las instrucciones que se envían al modelo y el `locale` de BizChat.
  - **Participante `@m365`** con `/explain`, `/fix`, `/doc` y `/tests`, que responde siempre con M365 Copilot usando como contexto la selección o la función del cursor, con respuesta en vivo, progreso de herramientas y sugerencias de continuación.
  - **Editor:** submenú contextual «M365 Copilot», acciones en la bombilla (_Corregir con M365 Copilot_ en errores, _Explicar/Documentar_ sobre una selección) y botones Keep/Undo/Diff en la barra de título para los cambios pendientes del agente.
  - **Barra de estado** con el estado del token, cuenta atrás y un menú rápido; avisos cuando el token va a caducar o caduca; el selector de modelos marca los tokens caducados.
  - **Source Control:** ✨ _Generar mensaje de commit con M365 Copilot_ (Conventional Commits) en la barra de título.
  - Recorrido de **primeros pasos**; el autocompletado ya no se dispara en vistas de salida/diff y añade el ajuste `inlineCompletions.disabledLanguages`.
  - Corrección: el popup del navegador mostraba «✓ Enviado» aunque el envío a VS Code fallara.

- **Inline edit, per-hunk review and terminal help.**

  - **Edit code in place** (_Edit code…_, **Ctrl+Shift+Alt+I**): rewrite the selection — or the function at the cursor — from an instruction, with recent instructions offered again; the result lands under Keep/Undo, no chat involved. The lightbulb's _Fix with M365 Copilot_ now uses it too, with the diagnostic as the instruction. New setting `ms365copilot.editor.model`.
  - **Per-hunk review:** agent changes are diffed for real (Myers), each block highlighted on its own (removed lines marked), with Keep/Undo per block plus Keep all / Undo all, previous/next change navigation in the editor title, and a live diff that follows your typing.
  - **`@m365 /terminal`** and _Explain last terminal command_ (terminal context menu): explains the last command's output and exit code, captured in memory through shell integration (`ms365copilot.terminal.captureOutput`).
  - _Paste profile or token_ detects a token already in the clipboard.
  - Fix: a second agent edit to a file still waiting for review replaced its baseline, so Undo only reverted the latest edit and the earlier one was silently accepted.

  ***

  **Edición en línea, revisión por bloques y ayuda en el terminal.**

  - **Editar código en el sitio** (_Editar código…_, **Ctrl+Mayús+Alt+I**): reescribe la selección — o la función del cursor — a partir de una instrucción, recordando las recientes; el resultado queda bajo Keep/Undo, sin pasar por el chat. El _Corregir con M365 Copilot_ de la bombilla también lo usa, con el diagnóstico como instrucción. Nuevo ajuste `ms365copilot.editor.model`.
  - **Revisión por bloques:** los cambios del agente se comparan con un diff real (Myers), cada bloque resaltado por separado (con las líneas borradas marcadas), con Keep/Undo por bloque además de Keep todo / Undo todo, navegación al cambio anterior/siguiente en la barra de título y un diff en vivo que sigue lo que escribes.
  - **`@m365 /terminal`** y _Explicar el último comando del terminal_ (menú contextual del terminal): explica la salida y el código de salida del último comando, capturados en memoria mediante la shell integration (`ms365copilot.terminal.captureOutput`).
  - _Pegar perfil o token_ detecta un token que ya esté en el portapapeles.
  - Corrección: una segunda edición del agente sobre un archivo pendiente de revisar sustituía su línea base, así que Undo sólo revertía la última edición y la anterior quedaba aceptada sin avisar.

- **Userscript rebuilt on the browser extension's capture, and an animated M365 → VS Code illustration.**

  - The Tampermonkey userscript is now generated (`extensiones/vscode/userscript/main.ts` → `ms365copilot-token.user.js`) from the same capture logic as the browser extension, moved to `@ms365copilot/core` (`capture.ts`): strict JWT/claims validation, never an older/expired/foreign token, the MSAL cache scanned continuously (the old script stopped once it had a token and never picked up the renewed one), rescans on focus/visibility/storage, bounded frames and templates.
  - It sends the token to VS Code automatically (`GM_xmlhttpRequest` → `localhost:51827`, `@connect localhost`), re-syncs when VS Code starts later, can reload a hidden tab whose token expired, and updates itself (`@updateURL`). `pnpm test` fails if the committed userscript is out of date, and runs it against a fake page and Tampermonkey.
  - New panel for the userscript and new popup hero for the browser extension: an animated illustration with the M365 Copilot and VS Code logos, where VS Code stays grey until it has the token, then lights up and the token flows along the arrow (`connectionArtSvg` in core, shared by both).
  - Fix: the browser extension discarded the chat hub's endpoint (`substrate.office.com` was not accepted as a Microsoft host), so the popup showed "Endpoint: pending" forever.

  ***

  **Userscript reconstruido sobre la captura de la extensión de navegador, e ilustración animada M365 → VS Code.**

  - El userscript de Tampermonkey ahora se genera (`extensiones/vscode/userscript/main.ts` → `ms365copilot-token.user.js`) desde la misma lógica de captura que la extensión de navegador, movida a `@ms365copilot/core` (`capture.ts`): validación estricta del JWT y sus claims, nunca un token más viejo, caducado o de otra audiencia, la caché de MSAL escaneada siempre (el script antiguo dejaba de mirar en cuanto tenía un token y nunca recogía el renovado), re-escaneo al volver a la pestaña o al cambiar el storage, y frames y plantillas acotados.
  - Envía el token a VS Code automáticamente (`GM_xmlhttpRequest` → `localhost:51827`, `@connect localhost`), re-sincroniza si VS Code arranca después, puede recargar una pestaña oculta cuyo token caducó, y se actualiza solo (`@updateURL`). `pnpm test` falla si el userscript del repo está desactualizado, y lo ejecuta contra una página y un Tampermonkey simulados.
  - Nuevo panel del userscript y nueva cabecera del popup de la extensión de navegador: una ilustración animada con los logos de M365 Copilot y VS Code, en la que VS Code está en gris hasta que tiene el token, y entonces se enciende y el token recorre la flecha (`connectionArtSvg` en core, compartida por ambos).
  - Corrección: la extensión de navegador descartaba el endpoint del hub del chat (`substrate.office.com` no se aceptaba como host de Microsoft), así que el popup mostraba «Endpoint: pendiente» para siempre.

### Patch Changes

- Updated dependencies
- Updated dependencies [3e7b328]
- Updated dependencies
- Updated dependencies
  - @ms365copilot/core@2.0.0

## 1.3.0

### Minor Changes

- Añade delegación en sub-agentes (`ms365_spawn_agents`) para tareas independientes en paralelo, y dos herramientas de git: `ms365_generate_commit_message` (dispara la función nativa de VS Code de generar mensaje de commit) y `ms365_git_commit` (crea el commit, validando Conventional Commits, con confirmación explícita del usuario).

### Patch Changes

- Updated dependencies
  - @ms365copilot/core@1.3.0

## 1.0.3

### Patch Changes

- Corrige el empaquetado de la extensión de VS Code añadiendo el campo `repository`, necesario para que `vsce` resuelva los enlaces relativos del README.
- Updated dependencies
  - @m365copilot/core@1.0.3

## 1.0.2

### Patch Changes

- Corrige el workflow de release (Node 22 en CI, requerido por tsdown 0.22).
- Updated dependencies
  - @m365copilot/core@1.0.2

## 1.0.1

### Patch Changes

- Primera release publicada mediante el pipeline de GitHub Actions.
- Updated dependencies
  - @m365copilot/core@1.0.1

## 1.0.0

Primera versión pública.

- Captura automática del token de M365 Copilot mientras navegas por `m365.cloud.microsoft`, Office, Outlook o Teams — sin userscript ni copiar/pegar.
- Renovación automática del token en segundo plano (re-escaneo de la caché de MSAL, recarga de la pestaña o apertura de una nueva si hace falta), con reintentos y backoff.
- Envío automático del token a la extensión de VS Code en cuanto hay uno nuevo, más botones manuales (copiar token, copiar perfil, reenviar, forzar renovación) en el popup.
- Compatible con Chrome/Edge (MV3) y Firefox (MV2).

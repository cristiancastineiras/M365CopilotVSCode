# m365-copilot-vscode

## 3.0.1

### Patch Changes

- @m365copilot/core@3.0.1

## 3.0.0

### Major Changes

- 823d551: **Everything is `m365` again — plus code review as comments, the Accounts menu and "Fix all problems".**

  - **Rename:** `ms365` → `m365` everywhere, as in 1.0: the VS Code extension is `m365-copilot-vscode.m365-copilot-vscode`, its settings and commands `m365copilot.*`, its tools `m365_*`, its models `m365-copilot-*`, the shared package `@m365copilot/core`, the userscript `m365copilot-token.user.js` and the artifacts `m365-copilot-vscode-<version>.vsix`.
  - **Migration:** the `ms365copilot.*` settings of 1.3–2.0 are copied to `m365copilot.*` once (user settings, and each workspace when opened; model ids renamed too, values you already set in the new keys win). If the old `ms365-copilot-vscode` extension is still installed, a notification offers to uninstall it — both would compete for the token port and `@m365`.
  - **Code review as comments:** _Review code_ (editor context menu) reviews the selection or the file, and ☑ _Review changes with M365 Copilot_ (Source Control title bar) reviews every uncommitted change — modified files against HEAD plus untracked ones — commenting only on the changed lines. Findings appear as comment threads on the lines and in the Comments panel, each with _Apply fix_ (an inline edit under Keep/Undo) and _Dismiss_.
  - **Accounts menu:** M365 Copilot is an authentication provider: the account shows in VS Code's Accounts menu, _Sign Out_ deletes the token, and without a token the menu offers _Sign in with M365 Copilot_ (opens M365 Copilot in the browser and waits for the token, or lets you paste it).
  - **Fix all problems in this file** (lightbulb, when a file has two or more errors/warnings, and context menu): one inline edit per block with problems, from the bottom up, each under Keep/Undo.
  - _Edit code…_ now offers common instructions (simplify, add types, clearer names…) after the recent ones.

  ***

  **Todo vuelve a ser `m365` — y además revisión de código como comentarios, el menú Cuentas y «Corregir todos los problemas».**

  - **Renombrado:** `ms365` → `m365` en todo, como en la 1.0: la extensión de VS Code es `m365-copilot-vscode.m365-copilot-vscode`, sus ajustes y comandos `m365copilot.*`, sus herramientas `m365_*`, sus modelos `m365-copilot-*`, el paquete compartido `@m365copilot/core`, el userscript `m365copilot-token.user.js` y los artefactos `m365-copilot-vscode-<versión>.vsix`.
  - **Migración:** los ajustes `ms365copilot.*` de la 1.3–2.0 se copian a `m365copilot.*` una vez (los de usuario, y los de cada workspace al abrirlo; también se renombran los ids de modelo, y lo que ya hayas puesto en las claves nuevas gana). Si sigue instalada la extensión antigua `ms365-copilot-vscode`, un aviso ofrece desinstalarla: las dos se pelearían por el puerto del token y por `@m365`.
  - **Revisión de código como comentarios:** _Revisar código_ (menú contextual del editor) revisa la selección o el archivo, y ☑ _Revisar cambios con M365 Copilot_ (barra de título de Source Control) revisa todos los cambios sin commitear — archivos modificados respecto a HEAD y los nuevos sin seguimiento — comentando sólo las líneas cambiadas. Los hallazgos aparecen como hilos de comentarios en las líneas y en el panel Comentarios, cada uno con _Aplicar corrección_ (una edición en línea bajo Keep/Undo) y _Descartar_.
  - **Menú Cuentas:** M365 Copilot es un proveedor de autenticación: la cuenta aparece en el menú Cuentas de VS Code, _Cerrar sesión_ borra el token y, sin token, el menú ofrece _Iniciar sesión con M365 Copilot_ (abre M365 Copilot en el navegador y espera el token, o te deja pegarlo).
  - **Corregir todos los problemas del archivo** (bombilla, cuando un archivo tiene dos o más errores/avisos, y menú contextual): una edición en línea por bloque con problemas, de abajo arriba, cada una bajo Keep/Undo.
  - _Editar código…_ ofrece ahora instrucciones habituales (simplificar, añadir tipos, nombres más claros…) después de las recientes.

### Minor Changes

- b70aa51: **Auto-commit: M365 Copilot commits your work as you go — when it makes sense, with documented messages.**

  - Turn it on per workspace with **Turn auto-commit on/off** (quick menu, command palette or the `…` menu of Source Control). When you pause (`m365copilot.autoCommit.idleSeconds`, 120 s), M365 Copilot looks at the uncommitted changes and decides whether they are a finished unit — a complete fix, even a one-line one, a finished step, a refactor, docs — or work in progress. Finished work is committed with a Conventional Commits subject and a body explaining what changed and why; unrelated changes become separate commits (at most 3 at a time) and files still in progress are left out. Otherwise it waits, and is not asked again until something changes.
  - No flood of commits: at least `m365copilot.autoCommit.minIntervalMinutes` (5) since the last commit, and never with unsaved files, agent edits awaiting Keep/Undo, errors in the changed files (`waitForErrors`), conflicts, a detached HEAD, a merge/rebase in progress or more than 150 changed files.
  - It commits exactly the files it chose — what you staged for other files stays staged — runs your pre-commit hooks and never pushes. Every auto-commit has **Undo** (soft reset, changes back in the working tree) and **Show**; `m365copilot.autoCommit.mode: "confirm"` asks before each round. The **Auto** status item shows, per repository, what it is doing or why it waits, with **Check now**, **Undo the last auto-commit** and turn off.

- 52fae21: **A cleaner, native-looking popup and userscript panel, with a connection signal instead of the arrow.**

  - The M365 → VS Code illustration (`connectionArtSvg`, shared by the browser popup and the Tampermonkey panel) replaces the arrow with a three-ring signal (based on the "wifi loader" by mobinkakei on Uiverse.io, MIT): it spins in grey while looking for the token, in blue while looking for VS Code, stops and points at VS Code once connected, and turns into a weak amber signal when the token expired or you have to sign in.
  - Popup and panel are light and simple, in Segoe UI with Windows 11 (Fluent 2) colours and controls: a short status list with coloured dots, one main button and two secondary ones. In the popup the main button is always the next step — **Open M365 Copilot** without a token, **Renew now** when it expired, **Send to VS Code** otherwise — and **Copy token** is disabled for an expired token. The technical "Endpoint" row is gone.
  - The guide's screenshots show the new design.

- af5113f: **Models: the M365 Copilot web app's own menu, and a clear answer when a model is not available on your account.**

  - The built-in models follow the web app's menu and labels: **Auto**, **Quick response** and **Think deeper** (M365 Copilot picks the model, fast or thorough — tones `Chat` / `Reasoning`), then GPT 5.6 Think deeper, GPT 5.5 Quick response / Think deeper, Claude Sonnet and the new **Claude Sonnet Think deeper**. `GPT 5.6` (tone `Gpt_5_6_Chat`), which the web app does not offer, is gone; the online catalog also hides it, and the retired GPT 5.4 / 5.3 / 5.2 tones, for installed versions.
  - Models detected in the web app get its labels too: `Gpt_6_1_Sol_Reasoning` reads "GPT 6.1 Sol Think deeper", `Gpt_5_7_Chat` "GPT 5.7 Quick response". The newest models (GPT-6.1 Sol, Claude Sonnet 5.5…) roll out per organisation and their tones are not public, so they appear once you use them on M365 Copilot with the browser extension or the userscript.
  - **Auto is Auto everywhere**: web-search turns used to reuse whichever model you last picked in the web app.
  - When the service turns a forced model down, or answers with its own canned reply instead of the model, the extension says the model is not available on your account (with the service's reason, suggesting Auto) instead of showing that reply as the answer, does not retry it, and flags the model in the chat's model picker for 12 h or until it works again.
  - New command **M365 Copilot: Check models** (also the first entry of _Update models_): one short message per model, then the list of the ones that work on your account.

- 823d551: **It understands your project (local RAG index) and can search the internet again.**

  - **Project index:** a local index of the workspace — no embeddings service, nothing leaves the machine but what a request includes. It honours `.gitignore`, `files.exclude`, `search.exclude` and `m365copilot.index.exclude`, skips binaries, lock files and generated code, knows each file's symbols (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#, C/C++, PHP, Ruby, shell, SQL, Markdown) and imports — resolved to files, monorepo packages and `@/` aliases included — and ranks code with BM25 over identifier-aware terms, with boosts for file and symbol names, query coverage and closeness to the active file. Questions in Spanish find English code. It builds in the background and updates file by file.
  - **Automatic context:** every chat request (M365 models and `@m365`) carries a short project map and the most relevant code (`m365copilot.context.autoRetrieve`, `m365copilot.context.maxChars`); `@m365` commands add the code around the selection.
  - **Agent tools:** `m365_search_project` (ranked code search) and `m365_project_map` (structure, packages, entry points, most imported modules; or a file's outline, imports and importers).
  - **Commands:** _Search the project…_, _Show project map_, _Rebuild project index_ (also in the M365 menu). Settings `m365copilot.index.*`.
  - **Web search:** chat turns from VS Code had no internet (the lean request has no web plugins). `m365_web_search` runs a separate turn the way the web app does — the request captured by the browser extension or the userscript, with web search — and returns the answer with its sources; requests without tools (Ask mode) go out that way directly and list the sources, falling back to a plain answer if BizChat rejects it. Setting `m365copilot.web.enabled`.

  ***

  **Entiende tu proyecto (índice RAG local) y vuelve a poder buscar en internet.**

  - **Índice del proyecto:** un índice local del workspace — sin servicio de embeddings; no sale del equipo más que lo que incluye una petición. Respeta `.gitignore`, `files.exclude`, `search.exclude` y `m365copilot.index.exclude`, se salta binarios, lockfiles y código generado, conoce los símbolos de cada archivo (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#, C/C++, PHP, Ruby, shell, SQL, Markdown) y sus imports — resueltos a archivos, incluidos los paquetes del monorepo y los alias `@/` — y ordena el código con BM25 sobre términos que entienden identificadores, puntuando más los nombres de archivo y de símbolo, la cobertura de la pregunta y la cercanía al archivo activo. Las preguntas en español encuentran código en inglés. Se construye en segundo plano y se actualiza archivo a archivo.
  - **Contexto automático:** cada petición del chat (modelos M365 y `@m365`) lleva un mapa breve del proyecto y el código más relevante (`m365copilot.context.autoRetrieve`, `m365copilot.context.maxChars`); los comandos de `@m365` añaden el código de alrededor de la selección.
  - **Herramientas del agente:** `m365_search_project` (búsqueda de código por relevancia) y `m365_project_map` (estructura, paquetes, puntos de entrada, módulos más importados; o el esquema, imports y quién importa un archivo).
  - **Comandos:** _Buscar en el proyecto…_, _Ver el mapa del proyecto_, _Reconstruir el índice del proyecto_ (también en el menú M365). Ajustes `m365copilot.index.*`.
  - **Búsqueda web:** los turnos de chat desde VS Code no tenían internet (la petición mínima no lleva los plugins web). `m365_web_search` hace un turno aparte como lo hace la web — con la petición capturada por la extensión de navegador o el userscript, con búsqueda web — y devuelve la respuesta con sus fuentes; las peticiones sin herramientas (modo Ask) salen así directamente y listan las fuentes, con una respuesta normal si BizChat la rechaza. Ajuste `m365copilot.web.enabled`.

- af5113f: **Renovar de verdad: cerrar la sesión de Microsoft y volver a iniciarla.**

  Hasta ahora todas las formas de «renovar» renovaban el _token_, y el token
  nunca era el problema: lo entrega la sesión de Microsoft del navegador (cookies
  de `login.microsoftonline.com` / `login.live.com` más la caché de tokens de
  MSAL en `m365.cloud.microsoft`), y mientras esa sesión siga ahí, pedir otro
  token lo entrega **en silencio**, sin mostrar nunca una pantalla de inicio de
  sesión. Por eso no volvía a pedir la sesión en ningún sitio.

  - Comando nuevo en VS Code, **M365 Copilot: Cerrar sesión y volver a entrar**
    (también en el menú rápido de la barra de estado): borra el token guardado,
    pide a la extensión de navegador el borrado completo y espera el token nuevo,
    que llega solo en cuanto vuelves a entrar. Resume lo que se borró («N cookies
    y los datos de M webs de Microsoft») y lo detalla en el registro.
  - Botón nuevo en el popup de la extensión de navegador, **Cerrar sesión de
    Microsoft**, con confirmación en el propio botón.
  - El borrado, por orden: pasa por los endpoints de cierre de sesión de
    Microsoft (Entra ID, cuenta personal y Office) **antes** de tocar nada local
    —necesitan las cookies para saber qué sesión cerrar en el servidor—, cierra
    las pestañas de Microsoft abiertas (una instancia de MSAL viva volvía a
    escribir su caché detrás del borrado), borra **todas las cookies** de los
    dominios de Microsoft en todos los contenedores de cookies, incluidas las
    particionadas, y vacía **localStorage, IndexedDB, Cache Storage, service
    workers y FileSystem** de cada web de Microsoft. Al terminar te deja en la
    pantalla de inicio de sesión.
  - Los dos lados se coordinan por el servidor local: VS Code deja la petición
    con un identificador y abre el navegador con él en la URL; la extensión sólo
    obedece si ese identificador es el que VS Code tiene pendiente, porque una
    URL la puede enlazar cualquier web. Si el navegador estaba cerrado, la
    petición se recoge en el siguiente latido.
  - Sin la extensión de navegador (sólo con el userscript, que no puede tocar
    cookies) VS Code lo dice pasados tres minutos y ofrece abrir a mano las
    páginas de cierre de sesión de Microsoft, que acaban con la mitad de la
    sesión que vive en el servidor: ya basta para que vuelva a pedir credenciales.
  - La extensión de navegador pide dos permisos nuevos, `cookies` y
    `browsingData`, más los dominios de Microsoft: son los que la API exige para
    borrar cada cookie y cada origen. Al actualizar, el navegador los vuelve a
    pedir y la extensión queda desactivada hasta que se acepten. La caché HTTP
    global **no** se toca a propósito: no se puede limitar a unos dominios.

### Patch Changes

- 1fd170a: **Pasting the token by hand (no browser extension, no userscript) works and explains itself.**

  - **Paste profile or token** also accepts the URL of the chat WebSocket copied from DevTools (`wss://…/Chathub/…?access_token=eyJ…`, detected in the clipboard) and `Bearer eyJ…`. The Copilot token travels as `access_token` in that URL, not in an `Authorization` header, so this is the simplest way to capture it in a browser where extensions cannot be installed (Network → filter `chathub` → Copy URL). Only the endpoint's `variants` are kept from the URL, never the token or the session ids.
  - Pasting a token for another service (a bearer copied from a Graph or search request) used to look connected and then fail every message with "401 Unauthorized". Now the paste asks first, naming the token's audience and how to get the right one; and if such a token is in use, the 401/403 error says it is for another service instead of "expired".
  - The README describes this manual capture (English and Spanish).

- Updated dependencies [52fae21]
- Updated dependencies [823d551]
- Updated dependencies [823d551]
  - @m365copilot/core@3.0.0

## 2.0.0

### Major Changes

- **Models that update themselves.**

  - The model list is no longer fixed. It merges the built-in models, the online catalog [`models.json`](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/models.json) (downloaded on start and every 12 h, cached for offline use; `"hidden": true` retires a model), the models the M365 Copilot web app actually uses — the browser extension and the userscript record each chat's `tone` and send it with the token — and `m365copilot.models.custom`. The chat's model picker updates by itself, new models are announced once, and _M365 Copilot: Update models_ refreshes and lists them.
  - New settings: `m365copilot.models.updateFromCatalog`, `m365copilot.models.detectFromBrowser`, `m365copilot.models.custom`.
  - If BizChat rejects a model that is not built in, the error says it may not be available in the tenant and suggests Auto.

  ***

  **Modelos que se actualizan solos.**

  - La lista de modelos ya no es fija. Junta los modelos de serie, el catálogo en línea [`models.json`](https://github.com/cristiancastineiras/M365CopilotVSCode/blob/main/models.json) (descargado al arrancar y cada 12 h, con caché para usarlo sin conexión; `"hidden": true` retira un modelo), los modelos que usa de verdad la web de M365 Copilot — la extensión de navegador y el userscript apuntan el `tone` de cada chat y lo envían con el token — y `m365copilot.models.custom`. El selector de modelos del chat se actualiza solo, los modelos nuevos se anuncian una vez y _M365 Copilot: Actualizar modelos_ los refresca y los lista.
  - Ajustes nuevos: `m365copilot.models.updateFromCatalog`, `m365copilot.models.detectFromBrowser`, `m365copilot.models.custom`.
  - Si BizChat rechaza un modelo que no viene de serie, el error indica que puede no estar disponible en el tenant y sugiere Auto.

- 3e7b328: **English / Spanish everywhere — and deeper editor integration.**

  - **i18n (en/es):** the VS Code extension, the browser extension, the userscript and the docs are now available in English and Spanish. New `m365copilot.language` setting (`auto` follows VS Code's display language); it also switches the language of the instructions sent to the model and BizChat's `locale`. Manifest text via `package.nls*.json`; browser manifest via `_locales`.
  - **`@m365` chat participant** with `/explain`, `/fix`, `/doc` and `/tests`, always answered by M365 Copilot, using the selection or the function at the cursor as context, with live streaming, tool progress and follow-ups.
  - **Editor:** "M365 Copilot" context submenu, lightbulb actions (_Fix with M365 Copilot_ on errors, _Explain/Document_ on a selection), Keep/Undo/Diff buttons in the editor title for pending agent changes.
  - **Status bar hub** with token state, countdown and a quick menu; notifications when the token is about to expire or expires; the model picker flags expired tokens.
  - **Source Control:** ✨ _Generate commit message with M365 Copilot_ (Conventional Commits) in the SCM title bar.
  - **Get started** walkthrough; inline completions skip output/diff views and the `inlineCompletions.disabledLanguages` setting.
  - Fix: the browser popup showed "✓ Sent" even when sending to VS Code failed (handler errors were returned as data instead of thrown).

  ***

  **Inglés / español en todo — e integración más profunda con el editor.**

  - **i18n (en/es):** la extensión de VS Code, la de navegador, el userscript y la documentación están en inglés y español. Nuevo ajuste `m365copilot.language` (`auto` sigue el idioma de VS Code), que cambia también el idioma de las instrucciones que se envían al modelo y el `locale` de BizChat.
  - **Participante `@m365`** con `/explain`, `/fix`, `/doc` y `/tests`, que responde siempre con M365 Copilot usando como contexto la selección o la función del cursor, con respuesta en vivo, progreso de herramientas y sugerencias de continuación.
  - **Editor:** submenú contextual «M365 Copilot», acciones en la bombilla (_Corregir con M365 Copilot_ en errores, _Explicar/Documentar_ sobre una selección) y botones Keep/Undo/Diff en la barra de título para los cambios pendientes del agente.
  - **Barra de estado** con el estado del token, cuenta atrás y un menú rápido; avisos cuando el token va a caducar o caduca; el selector de modelos marca los tokens caducados.
  - **Source Control:** ✨ _Generar mensaje de commit con M365 Copilot_ (Conventional Commits) en la barra de título.
  - Recorrido de **primeros pasos**; el autocompletado ya no se dispara en vistas de salida/diff y añade el ajuste `inlineCompletions.disabledLanguages`.
  - Corrección: el popup del navegador mostraba «✓ Enviado» aunque el envío a VS Code fallara.

- **Inline edit, per-hunk review and terminal help.**

  - **Edit code in place** (_Edit code…_, **Ctrl+Shift+Alt+I**): rewrite the selection — or the function at the cursor — from an instruction, with recent instructions offered again; the result lands under Keep/Undo, no chat involved. The lightbulb's _Fix with M365 Copilot_ now uses it too, with the diagnostic as the instruction. New setting `m365copilot.editor.model`.
  - **Per-hunk review:** agent changes are diffed for real (Myers), each block highlighted on its own (removed lines marked), with Keep/Undo per block plus Keep all / Undo all, previous/next change navigation in the editor title, and a live diff that follows your typing.
  - **`@m365 /terminal`** and _Explain last terminal command_ (terminal context menu): explains the last command's output and exit code, captured in memory through shell integration (`m365copilot.terminal.captureOutput`).
  - _Paste profile or token_ detects a token already in the clipboard.
  - Fix: a second agent edit to a file still waiting for review replaced its baseline, so Undo only reverted the latest edit and the earlier one was silently accepted.

  ***

  **Edición en línea, revisión por bloques y ayuda en el terminal.**

  - **Editar código en el sitio** (_Editar código…_, **Ctrl+Mayús+Alt+I**): reescribe la selección — o la función del cursor — a partir de una instrucción, recordando las recientes; el resultado queda bajo Keep/Undo, sin pasar por el chat. El _Corregir con M365 Copilot_ de la bombilla también lo usa, con el diagnóstico como instrucción. Nuevo ajuste `m365copilot.editor.model`.
  - **Revisión por bloques:** los cambios del agente se comparan con un diff real (Myers), cada bloque resaltado por separado (con las líneas borradas marcadas), con Keep/Undo por bloque además de Keep todo / Undo todo, navegación al cambio anterior/siguiente en la barra de título y un diff en vivo que sigue lo que escribes.
  - **`@m365 /terminal`** y _Explicar el último comando del terminal_ (menú contextual del terminal): explica la salida y el código de salida del último comando, capturados en memoria mediante la shell integration (`m365copilot.terminal.captureOutput`).
  - _Pegar perfil o token_ detecta un token que ya esté en el portapapeles.
  - Corrección: una segunda edición del agente sobre un archivo pendiente de revisar sustituía su línea base, así que Undo sólo revertía la última edición y la anterior quedaba aceptada sin avisar.

- **Userscript rebuilt on the browser extension's capture, and an animated M365 → VS Code illustration.**

  - The Tampermonkey userscript is now generated (`extensiones/vscode/userscript/main.ts` → `m365copilot-token.user.js`) from the same capture logic as the browser extension, moved to `@m365copilot/core` (`capture.ts`): strict JWT/claims validation, never an older/expired/foreign token, the MSAL cache scanned continuously (the old script stopped once it had a token and never picked up the renewed one), rescans on focus/visibility/storage, bounded frames and templates.
  - It sends the token to VS Code automatically (`GM_xmlhttpRequest` → `localhost:51827`, `@connect localhost`), re-syncs when VS Code starts later, can reload a hidden tab whose token expired, and updates itself (`@updateURL`). `pnpm test` fails if the committed userscript is out of date, and runs it against a fake page and Tampermonkey.
  - New panel for the userscript and new popup hero for the browser extension: an animated illustration with the M365 Copilot and VS Code logos, where VS Code stays grey until it has the token, then lights up and the token flows along the arrow (`connectionArtSvg` in core, shared by both).
  - Fix: the browser extension discarded the chat hub's endpoint (`substrate.office.com` was not accepted as a Microsoft host), so the popup showed "Endpoint: pending" forever.

  ***

  **Userscript reconstruido sobre la captura de la extensión de navegador, e ilustración animada M365 → VS Code.**

  - El userscript de Tampermonkey ahora se genera (`extensiones/vscode/userscript/main.ts` → `m365copilot-token.user.js`) desde la misma lógica de captura que la extensión de navegador, movida a `@m365copilot/core` (`capture.ts`): validación estricta del JWT y sus claims, nunca un token más viejo, caducado o de otra audiencia, la caché de MSAL escaneada siempre (el script antiguo dejaba de mirar en cuanto tenía un token y nunca recogía el renovado), re-escaneo al volver a la pestaña o al cambiar el storage, y frames y plantillas acotados.
  - Envía el token a VS Code automáticamente (`GM_xmlhttpRequest` → `localhost:51827`, `@connect localhost`), re-sincroniza si VS Code arranca después, puede recargar una pestaña oculta cuyo token caducó, y se actualiza solo (`@updateURL`). `pnpm test` falla si el userscript del repo está desactualizado, y lo ejecuta contra una página y un Tampermonkey simulados.
  - Nuevo panel del userscript y nueva cabecera del popup de la extensión de navegador: una ilustración animada con los logos de M365 Copilot y VS Code, en la que VS Code está en gris hasta que tiene el token, y entonces se enciende y el token recorre la flecha (`connectionArtSvg` en core, compartida por ambos).
  - Corrección: la extensión de navegador descartaba el endpoint del hub del chat (`substrate.office.com` no se aceptaba como host de Microsoft), así que el popup mostraba «Endpoint: pendiente» para siempre.

### Patch Changes

- Updated dependencies
- Updated dependencies [3e7b328]
- Updated dependencies
- Updated dependencies
  - @m365copilot/core@2.0.0

## 1.3.0

### Minor Changes

- Añade delegación en sub-agentes (`m365_spawn_agents`) para tareas independientes en paralelo, y dos herramientas de git: `m365_generate_commit_message` (dispara la función nativa de VS Code de generar mensaje de commit) y `m365_git_commit` (crea el commit, validando Conventional Commits, con confirmación explícita del usuario).

### Patch Changes

- Updated dependencies
  - @m365copilot/core@1.3.0

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

- M365 Copilot como proveedor de modelos en el chat de VS Code (Auto, GPT, Claude Sonnet, Reasoning).
- Protocolo de llamada a herramientas sobre texto plano: el modelo puede usar tanto las herramientas propias (`m365_*`) como las nativas de VS Code, de MCP y de otras extensiones activas en el turno.
- Edición con revisión Keep/Undo directamente en el editor, sin guardar en disco hasta confirmar.
- Autocompletado en línea (texto fantasma) opcional.
- Sincronización automática del token con la extensión de navegador (o manual, pegando el token capturado con el userscript).

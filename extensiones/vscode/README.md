# M365 Copilot for VS Code

Usa tu suscripción de **Microsoft 365 Copilot** como proveedor de modelos dentro
del chat de VS Code (junto a GitHub Copilot, Claude, etc.). No hay dashboard ni
configuración compleja: capturas el token en el navegador con un userscript y lo
pegas en VS Code.

Son dos piezas:

| Pieza | Carpeta | Qué hace |
|-------|---------|----------|
| **Userscript (Tampermonkey)** | `ms365copilot-token.user.js` (esta carpeta) | Añade un panel en `m365.cloud.microsoft` que copia tu **token**. |
| **Extensión de VS Code** | esta carpeta | Registra los modelos «M365 Copilot» en el chat y abre su propio WebSocket a Substrate usando sólo tu token. |

## Cómo funciona

El chat web de M365 Copilot habla con Substrate («Sydney» / BizChat) por
WebSocket:

```
wss://substrate.office.com/m365Copilot/Chathub/{oid}@{tid}?access_token=…&ConversationId=…
```

El token viaja en la *query string*. La extensión construye esa URL y el
cuerpo de la invocación ella misma, a partir del `oid`/`tid` del token — **no**
reproduce la conexión real del navegador aunque el userscript la haya
capturado. Es intencional: el userscript puede capturar, además del token, el
`endpoint` exacto y la plantilla de invocación (`invocationTemplate`) que usó
la pestaña real, pero reproducir eso verbatim hace que BizChat trate el turno
como una sesión de Copilot web de verdad, con sus propios plugins y
tool-calling nativo (`plugins: [BingWebSearch]`, un `tone` de producción…) —
y entonces el modelo ignora las instrucciones de herramientas que la
extensión le inyecta en el prompt, porque «ya» tiene herramientas reales. Con
la plantilla mínima y propia de la extensión, el modelo no tiene ese desvío y
el protocolo de herramientas (ver más abajo) funciona de forma fiable. Por
eso da exactamente igual pegar el token pelado o el «perfil completo» JSON:
sólo se usa el `accessToken` (y los claims que lleva dentro).

## Uso

### 1. Instala el userscript
1. Instala [Tampermonkey](https://www.tampermonkey.net/).
2. Abre el archivo `ms365copilot-token.user.js` (esta misma carpeta) y dale a
   *Instalar*.
3. Entra en <https://m365.cloud.microsoft/chat/>. En cuanto la página cargue
   la sesión verás el panel abajo a la derecha con «Token: ok».
4. Pulsa **«Copiar sólo el token»** (o «Copiar perfil completo»: con esta
   versión de la extensión da igual cuál uses).

### (Opcional) Auto-renovación sin copiar/pegar

`ms365copilot-token-autorefresh.user.js` (misma carpeta) es una segunda
instalación de Tampermonkey que hace el paso 3–4 por ti de forma continua:
captura el mismo perfil (token Sydney validado por `aud` + endpoint +
plantilla) y lo envía por HTTP local a la extensión en cuanto detecta un
token nuevo o renovado, con reintentos de conexión y sin spamear
notificaciones. Instálalo igual que el anterior y **pega el perfil una sola
vez** (paso 3 de abajo); a partir de ahí, mientras dejes esa pestaña (o
cualquier otra de Office/Teams/Outlook que haga match) abierta en algún sitio
del navegador, cada renovación silenciosa de MSAL se retransmite sola a VS
Code. Cerrar todas esas pestañas corta la renovación: MSAL necesita seguir
vivo en alguna para poder renovar.

### 2. Compila e instala la extensión
```bash
cd ms365-vscode
pnpm install
pnpm build            # bundle con tsdown (rolldown + oxc) → dist/extension.cjs
pnpm package          # genera el .vsix
code --install-extension ms365-copilot-vscode-1.0.0.vsix
```
O pulsa `F5` en VS Code para lanzar una ventana de desarrollo (*Extension
Development Host*).

### 3. Pega el token y chatea
1. `Ctrl+Shift+P` → **«M365 Copilot: Pegar perfil o token»** y pega lo copiado.
2. Abre el chat de VS Code, despliega el selector de modelos y elige uno de los
   **M365 Copilot** (`Auto`, `GPT`, `Claude Sonnet`, `Reasoning`).
3. Chatea normal.

Las respuestas se piden en Markdown. Los bloques de código salen con su botón
nativo de **Copiar** en el chat de VS Code, incluso cuando el backend haya
devuelto un bloque de TypeScript sin vallas Markdown.

## Autocompletado en línea (texto fantasma)

La extensión registra un proveedor de sugerencias en línea, así que M365
Copilot también predice código mientras escribes, al estilo del texto fantasma
de GitHub Copilot. Se activa/desactiva desde el icono **M365** de la barra de
estado o con **«M365 Copilot: Activar/desactivar autocompletado en línea»**.

**Expectativas honestas.** Esto no va a ir como GitHub Copilot, por dos razones
que no dependen de la extensión:

- **Latencia de ~1-3 s.** Cada sugerencia abre un WebSocket nuevo contra
  Substrate y espera la respuesta; Copilot responde en ~200-400 ms. Se mitiga
  con debounce, caché y cortando el stream en cuanto hay líneas suficientes,
  pero no baja a ese rango.
- **BizChat no es un modelo de autocompletado.** Los motores de sugerencias se
  entrenan con *fill-in-the-middle*; BizChat es un asistente conversacional y
  tiende a responder con vallas de código y frases tipo «Claro, aquí tienes».
  La extensión limpia todo eso antes de mostrarlo, pero la calidad es peor que
  la de un modelo dedicado.

Cada sugerencia consume una petición de tu plan de M365. Si te parece mucho,
pon `ms365copilot.inlineCompletions.triggerMode` en `manual` y pídelas a mano
con `Alt+\`.

| Ajuste | Por defecto | Para qué |
|--------|-------------|----------|
| `inlineCompletions.enabled` | `true` | Activa o desactiva el texto fantasma. |
| `inlineCompletions.triggerMode` | `automatic` | `manual` sólo sugiere si lo pides (mucho menos gasto). |
| `inlineCompletions.debounceMs` | `500` | Pausa al teclear antes de pedir sugerencia. |
| `inlineCompletions.maxLines` | `6` | Líneas máximas por sugerencia (menos = más rápido). |
| `inlineCompletions.timeoutMs` | `6000` | A partir de ahí se descarta: llega tarde y estorba. |
| `inlineCompletions.model` | `auto` | Modelo a usar; `reasoning` es demasiado lento aquí. |

La caché mantiene viva la sugerencia mientras tecleas exactamente lo que te
propuso, que es lo que evita que el texto fantasma parpadee en cada tecla.

## Edición con agente

En modo **Agent** o **Edit**, el modelo puede usar **todas las herramientas que
VS Code tenga activas en ese turno**: las nativas del editor, las de servidores
MCP, las de otras extensiones y las de ésta. Las que ofrece VS Code llegan en
`options.tools`; la extensión las describe en el prompt junto con las suyas y,
cuando el modelo pide una, reporta un `LanguageModelToolCallPart` y es **VS Code
quien la ejecuta** — igual que con un modelo con *function calling* nativo. Lo
que enciendas o apagues en el selector de herramientas del chat es exactamente
lo que ve el modelo.

Tres ajustes controlan ese catálogo:

| Ajuste | Por defecto | Para qué |
| ------ | ----------- | -------- |
| `ms365copilot.tools.includeEditorTools` | `true` | Describir también las herramientas nativas/MCP. En `false` vuelve al comportamiento anterior: sólo las `ms365_*`. |
| `ms365copilot.tools.duplicates` | `preferEditor` | Cuando una nativa y una nuestra hacen lo mismo (leer, buscar, editar, terminal…), a cuál se le dice al modelo que vaya primero. La otra no se oculta: queda como alternativa si la preferida falla. |
| `ms365copilot.tools.maxAdvertised` | `48` | Tope de herramientas descritas en el prompt. Con varios servidores MCP el catálogo crece, y aquí viaja como texto, no como *schema*. Las que no se describen siguen siendo ejecutables si el modelo las nombra. |

Las herramientas propias de la extensión, dentro del workspace abierto, son:

- listar archivos sin cargar su contenido;
- buscar texto y devolver sólo coincidencias breves;
- leer rangos de archivo numerados;
- preparar un lote de ediciones exactas, archivos nuevos o borrados;
- leer los errores/avisos que ya muestra VS Code (solo lectura, no compila nada);
- consultar git en modo solo lectura (`status`/`diff`/`log`; nunca hace commit ni push);
- generar el mensaje de commit disparando la función **nativa** de VS Code (✨ *Generate Commit Message* del panel Source Control), con el diff en stage como respaldo si esa función no está disponible;
- crear un commit real con ese mensaje, validado como [Conventional Commits](https://www.conventionalcommits.org/) — **siempre** con tu confirmación explícita, mostrando el mensaje exacto y qué se va a stagear antes de ejecutarlo;
- ejecutar un comando de terminal (build, tests...) — **siempre** con tu confirmación explícita, mostrando el comando exacto antes de correrlo;
- delegar en sub-agentes (ver [«Sub-agentes (delegar tareas)»](#sub-agentes-delegar-tareas) más abajo).

Los comandos se ejecutan en un **terminal real de VS Code** («M365 Copilot»),
usando la *shell integration*: ves el comando correr en directo, con tu perfil
de shell (así `PATH`, nvm, conda y demás se comportan igual que a mano) y el
scrollback te queda ahí después. Si la shell integration no está disponible
(shell no soportada o desactivada), cae a ejecución en segundo plano y te lo
dice en el resultado.

El listado y la búsqueda respetan tus `files.exclude` y `search.exclude`,
además de un baseline propio (`node_modules`, `.git`, `dist`...). La búsqueda
además **avisa cuando no ha sido exhaustiva** en vez de decir simplemente «sin
coincidencias»: si el repo tiene más archivos de los que puede revisar, lo
dice, para que ni tú ni el modelo concluyáis que algo no existe cuando en
realidad no se ha mirado.

### Revisión de cambios (Keep / Undo)

Los cambios se aplican **en el editor, sin guardar en disco**, igual que en los
flujos de edición nativos de VS Code:

- las líneas tocadas quedan **resaltadas** (con los colores de diff de tu tema,
  y marca en la regla lateral);
- encima del cambio aparece un **CodeLens** con **✓ Keep**, **↶ Undo** y
  **⇄ Ver diff**;
- el diff enfrenta el contenido anterior con el **documento real y editable**,
  no con una copia de solo lectura, así que puedes retocar mientras revisas;
- la **barra de estado** avisa de cuántos archivos quedan sin revisar;
- como es una edición normal del editor, **Ctrl+Z funciona** tal cual.

Nada se escribe en disco hasta que guardas (los archivos nuevos sí se crean,
y **Undo** los borra). Si aceptas con Keep y luego te arrepientes, **«M365
Copilot: Deshacer último lote de cambios del agente»** revierte el último lote
aceptado.

> Nota: la API de *chat editing* que usa GitHub Copilot Edits es *proposed
> API* y no está disponible para una extensión instalada normalmente, así que
> esto la reproduce con API estable (decoraciones + CodeLens + diff). El
> comportamiento es equivalente aunque el aspecto no sea idéntico.

La herramienta de terminal es la única que ejecuta código arbitrario: antes de
correr nada te enseña el comando literal (y un aviso extra si coincide con un
patrón típicamente destructivo — `rm -rf`, `git push --force`, `git reset
--hard`...) para que decidas tú. Su salida se envía al modelo en la nube, así
que evita usarla sobre datos sensibles que no quieras que salgan de tu máquina.

### Sub-agentes (delegar tareas)

El modelo también tiene una herramienta `ms365_spawn_agents` para delegar una o
varias tareas acotadas en **sub-agentes** que corren de forma autónoma — en
paralelo si son varias — con su propio ciclo de las mismas 9 herramientas de
arriba (incluidas ediciones, comandos y commits, con la misma revisión
Keep/Undo y confirmación de terminal/commit de siempre). Cada sub-agente sólo ve la tarea que se
le asigna, no el resto de la conversación, y devuelve un resumen conciso — así
explorar mucho (o investigar varias preguntas independientes a la vez) no llena
el contexto de la conversación principal con el detalle.

Al modelo principal le sigue tocando a ti confirmar cualquier edición, comando
o commit que pida un sub-agente: los diálogos son exactamente los mismos que
ya conoces (Keep/Undo, confirmación de terminal con el comando literal,
confirmación de commit con el mensaje exacto), sólo que pueden aparecer
mientras varios sub-agentes exploran en paralelo. Las llamadas que editan
archivos, ejecutan comandos o tocan git (generar mensaje, commitear) se
serializan entre sí (una a la vez, aunque haya varios sub-agentes corriendo)
para que no se pisen; las de solo lectura sí corren en paralelo.
**Limitación conocida:** el diálogo de confirmación no indica qué sub-agente
ni qué tarea originó el comando, la edición o el commit — muestra el
comando/diff/mensaje exacto (lo importante para decidir), pero no ese
contexto; el registro de salida («M365 Copilot») y la notificación de
progreso sí muestran qué sub-agente está en qué paso.

| Ajuste | Por defecto | Para qué |
| ------ | ----------- | -------- |
| `ms365copilot.subagents.enabled` | `true` | Permite delegar tareas. En `false` la herramienta no hace nada: explica por qué en vez de ejecutar. |
| `ms365copilot.subagents.maxConcurrent` | `3` | Cuántos sub-agentes corren a la vez cuando se delegan varias tareas; el resto espera turno. |
| `ms365copilot.subagents.maxSteps` | `6` | Máximo de llamadas a herramientas por sub-agente antes de devolver un resumen parcial con aviso de límite alcanzado. |
| `ms365copilot.subagents.model` | `auto` | Modelo (tone) que usan los sub-agentes, independiente del que tengas elegido en el chat principal. |

## Comandos

| Comando | Acción |
|---------|--------|
| `M365 Copilot: Activar/desactivar autocompletado en línea` | Enciende o apaga el texto fantasma del editor. |
| `M365 Copilot: Pegar perfil o token` | Guarda el perfil/token en SecretStorage (cifrado). |
| `M365 Copilot: Estado / información del token` | Muestra usuario, caducidad y qué se capturó. |
| `M365 Copilot: Borrar credenciales` | Borra el token guardado. |
| `M365 Copilot: Revisar cambios de agente pendientes` | Abre el diff de los cambios sin revisar. |
| `M365 Copilot: Aceptar (Keep) los cambios del agente` | Acepta los cambios pendientes. |
| `M365 Copilot: Revertir (Undo) los cambios del agente` | Restaura el contenido anterior. |
| `M365 Copilot: Ver diff de los cambios del agente` | Compara el antes con el documento actual. |
| `M365 Copilot: Descartar cambios de agente pendientes` | Revierte todo lo pendiente de una vez. |
| `M365 Copilot: Deshacer último lote de cambios del agente` | Restaura todos los archivos del último lote aplicado por el agente. |

## Notas y límites

- **El token caduca** (~60–75 min). Sin el userscript de auto-renovación,
  vuelve a copiar el perfil en la web y pégalo de nuevo cuando la extensión
  avise con el error de caducidad. Con `ms365copilot-token-autorefresh.user.js`
  instalado y alguna pestaña de Office abierta, la renovación es automática.
- **Herramientas controladas.** BizChat no expone tool-calling nativo; la
  extensión traduce una llamada estructurada del modelo a las herramientas de
  VS Code autorizadas para el turno, y **sólo** a ésas: un nombre que el host no
  haya ofrecido no se ejecuta nunca. En las propias sólo se admiten rutas
  relativas dentro del workspace de confianza y las ediciones requieren revisión
  explícita; las nativas y las de MCP las gobierna VS Code con sus propias
  confirmaciones.
- **Conversación por turno.** Cada turno abre un WebSocket nuevo y envía el
  historial aplanado. Para mantener el coste y el tamaño previsibles, conserva
  los turnos más recientes, limita cada resultado de herramienta y hace que las
  lecturas de archivos sean por rango.
- El token se guarda **sólo** en `SecretStorage` de VS Code (local, cifrado) y
  únicamente se envía a los endpoints de Microsoft.
- **Generar mensaje de commit** depende de la extensión Git integrada de VS
  Code (`vscode.git`) y de que en ese momento haya algún modelo de chat
  disponible para `git.generateCommitMessage` (puede ser el propio M365
  Copilot si lo tienes seleccionado, o cualquier otro proveedor activo). Si
  no hay ninguno, la herramienta no falla: te devuelve el diff igualmente
  para que redactes el mensaje tú mismo.

## Desarrollo

```bash
pnpm build       # compilar
pnpm watch       # recompilar al guardar
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
```

Toolchain: **pnpm + tsdown (rolldown + oxc)**. `vscode` queda externo; `ws` se
empaqueta en el bundle.

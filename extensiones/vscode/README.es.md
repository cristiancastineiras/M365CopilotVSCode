# M365 Copilot para VS Code

[English](README.md) · **Español**

Usa tu suscripción de **Microsoft 365 Copilot** dentro de VS Code: como modelo
del chat (junto a GitHub Copilot, Claude, etc.), como el participante de chat
**`@m365`**, desde el menú contextual y la bombilla del editor, desde Source
Control y como autocompletado en línea (texto fantasma). Toda la extensión —
interfaz, mensajes y las instrucciones que se envían al modelo — está disponible
en **inglés y español**.

No hay dashboard ni clave de API: capturas el token de tu sesión en el
navegador y VS Code lo usa.

| Pieza | Dónde | Qué hace |
|-------|-------|----------|
| **Extensión de navegador** (recomendada) | [`extensiones/browser`](https://github.com/cristiancastineiras/M365CopilotVSCode/tree/main/extensiones/browser) · [releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases) | Captura el token en la web de M365 Copilot, lo renueva antes de que caduque y lo envía a VS Code automáticamente. |
| **Userscript** (alternativa) | [`ms365copilot-token.user.js`](ms365copilot-token.user.js) | Un panel de Tampermonkey en `m365.cloud.microsoft` que te copia el token para pegarlo. |
| **Extensión de VS Code** | esta carpeta | Registra los modelos, el participante `@m365`, las acciones del editor/SCM y las herramientas de agente, y habla con Microsoft 365 Copilot con tu token. |

## Inicio rápido

1. **Lleva el token a VS Code**
   - *Con la extensión de navegador:* instálala, abre
     <https://m365.cloud.microsoft/chat/> una vez y envía cualquier mensaje. El
     popup se pone en verde y el token llega solo a VS Code — y se sigue
     renovando mientras haya alguna pestaña de M365 abierta.
   - *Con el userscript:* instala [Tampermonkey](https://www.tampermonkey.net/),
     instala `ms365copilot-token.user.js`, abre M365 Copilot, pulsa **Copiar
     sólo el token** y ejecuta **M365 Copilot: Pegar perfil o token** en VS Code.
2. **Chatea**: escribe **`@m365`** en el chat, o elige uno de los modelos **M365
   Copilot** (`Auto`, `GPT`, `GPT 5.6`, `GPT 5.6 Reasoning`, `Claude Sonnet`,
   `Reasoning`) en el selector de modelos.
3. **Trabaja desde el editor**: clic derecho en el código → **M365 Copilot**, o
   la bombilla sobre un error.

El elemento **M365** de la barra de estado te dice de un vistazo si el token es
válido y abre un menú con todo lo demás. El recorrido **Primeros pasos**
(*Ayuda → Bienvenida*, o desde el menú) repite estos pasos uno a uno — y tienes
también la [guía ilustrada](Guia.md).

## Integración con el editor

### Participante de chat `@m365`

`@m365` responde siempre con Microsoft 365 Copilot, tengas el modelo que tengas
elegido en el selector (si eliges un modelo M365, se usa esa variante).

| Comando | Qué hace |
|---------|----------|
| `@m365 /explain` | Explica el código seleccionado — o, sin selección, la **función/clase del cursor** (localizada con el proveedor de símbolos del propio lenguaje). Sólo lectura. |
| `@m365 /fix` | Corrige los problemas de ese código, incluidos los diagnósticos que VS Code marca ahí, y aplica la corrección con revisión Keep/Undo. |
| `@m365 /doc` | Añade comentarios de documentación con las convenciones del lenguaje. |
| `@m365 /tests` | Escribe tests unitarios con el framework que ya use el proyecto. |
| `@m365 <lo que sea>` | Petición libre con las herramientas del workspace; la selección actual y los adjuntos `#file` se incluyen como contexto. |

El participante muestra qué código usó como referencia, transmite la respuesta
en vivo, informa de cada paso de herramienta, ofrece un botón **Revisar cambios
pendientes** tras editar y sugiere continuaciones (`/doc`, `/tests`…).

### Menú contextual, bombilla y barra de título

- **Clic derecho → M365 Copilot**: *Explicar código*, *Preguntar sobre este
  código…*, *Corregir código*, *Documentar código*, *Generar tests*. Cada uno
  abre el chat con el comando `@m365` adecuado y el código exacto en el que
  estabas.
- **Bombilla (Ctrl+.)**: **Corregir con M365 Copilot: «error»** en errores y
  avisos, y *Explicar / Documentar con M365 Copilot* sobre una selección. Se
  desactiva con `ms365copilot.editor.codeActions`.
- **Barra de título del editor**: cuando el archivo abierto tiene cambios del
  agente pendientes de revisar, aparecen los botones ✓ **Keep**, ↶ **Undo** y
  ⇄ **Diff** junto a las pestañas.

### Barra de estado y menú rápido

El elemento **M365** de la barra de estado muestra el estado del token (🔑 aún
no hay, ⚠ caducado, 🕑 cuenta atrás en sus últimos 10 minutos), si el
autocompletado está activo y un indicador mientras llega una sugerencia. Su
tooltip muestra la cuenta, los minutos restantes y los cambios del agente
pendientes de revisar. Al pulsarlo se abre el **menú de M365 Copilot**: pegar
token, estado del token, abrir M365 Copilot, abrir el chat, activar/desactivar
el autocompletado, revisar cambios pendientes, generar mensaje de commit,
idioma, ajustes, primeros pasos, registro y borrar credenciales.

Cuando el token está a punto de caducar **sin haberse renovado** (quedan 5
minutos) o caduca durante la sesión, una notificación ofrece **Pegar token** /
**Abrir M365 Copilot**, una sola vez por token
(`ms365copilot.notifications.tokenExpiry`). El selector de modelos también marca
los tokens caducados. Cuando la extensión de navegador renueva el token, un
mensaje breve en la barra de estado lo confirma.

### Source Control: mensaje de commit con M365

El botón ✨ de la barra de título de **Source Control** (*Generar mensaje de
commit con M365 Copilot*) redacta un mensaje
[Conventional Commits](https://www.conventionalcommits.org/) a partir del diff en
stage — o del árbol de trabajo si no hay nada en stage — y lo escribe
directamente en el cuadro de commit, en el idioma de la extensión. Nunca
commitea: lo revisas y commiteas tú.

## Idiomas (inglés / español)

`ms365copilot.language` (también *Cambiar idioma* en el menú):

| Valor | Comportamiento |
|-------|----------------|
| `auto` (por defecto) | Sigue el idioma de visualización de VS Code: español para cualquier variante de español, inglés en otro caso. |
| `en` / `es` | Fuerza ese idioma. |

Se aplica al momento a las notificaciones, la barra de estado, el menú, los
resultados de herramientas, los CodeLens, el registro — **y a las instrucciones
que se envían al modelo**, para que responda en ese idioma (además se le pide
que responda en el idioma en que le escribes). Los títulos de comandos, las
descripciones de ajustes y el recorrido de primeros pasos salen del manifiesto
de la extensión y siguen siempre el idioma de visualización de VS Code, como en
cualquier extensión.

## Modo agente y herramientas

En modo **Agent** o **Edit**, el modelo puede usar **todas las herramientas que
VS Code tenga activas en ese turno**: las nativas del editor, las de servidores
MCP, las de otras extensiones y las de ésta. BizChat no tiene *function calling*
nativo, así que la extensión describe las herramientas en el prompt como texto,
decodifica de la respuesta la llamada que pide el modelo y se la pasa a VS Code,
**que es quien la ejecuta** — igual que con un modelo con *function calling*
nativo. Lo que enciendas o apagues en el selector de herramientas del chat es
exactamente lo que ve el modelo.

Las herramientas propias de la extensión, dentro del workspace abierto:

- listar archivos sin cargar su contenido;
- buscar texto y devolver sólo coincidencias breves;
- leer rangos de archivo numerados;
- preparar un lote de ediciones exactas, archivos nuevos o borrados;
- leer los errores/avisos que ya muestra VS Code (solo lectura, no compila nada);
- consultar git en modo solo lectura (`status`/`diff`/`log`; nunca hace commit ni push);
- generar el mensaje de commit disparando la función **nativa** de VS Code
  (✨ *Generate Commit Message*), con el diff en stage como respaldo;
- crear un commit real con ese mensaje, validado como Conventional Commits —
  **siempre** con tu confirmación del mensaje exacto y de qué se va a stagear;
- ejecutar un comando de terminal (build, tests…) — **siempre** con tu
  confirmación del comando exacto;
- delegar en sub-agentes (ver más abajo).

Los comandos se ejecutan en un **terminal real de VS Code** («M365 Copilot») con
la *shell integration*: los ves correr con tu propio perfil de shell (PATH, nvm,
conda…). Sin shell integration caen a un proceso en segundo plano y el
resultado lo indica. El listado y la búsqueda respetan tus `files.exclude` y
`search.exclude` más un baseline propio (`node_modules`, `.git`, `dist`…), y la
búsqueda **avisa cuando no ha sido exhaustiva** en vez de decir «sin
coincidencias».

| Ajuste | Por defecto | Para qué |
|--------|-------------|----------|
| `ms365copilot.tools.includeEditorTools` | `true` | Describir también las herramientas nativas/MCP. `false` = sólo las `ms365_*`. |
| `ms365copilot.tools.duplicates` | `preferEditor` | A cuál debe ir primero el modelo cuando una nativa y una nuestra hacen lo mismo. La otra queda como alternativa. |
| `ms365copilot.tools.maxAdvertised` | `48` | Tope de herramientas descritas en el prompt (el catálogo viaja como texto). Las que no se describen siguen siendo ejecutables si el modelo las nombra. |

### Revisión de cambios (Keep / Undo)

Los cambios se aplican **en el editor, sin guardar en disco**, como en los
flujos de edición nativos de VS Code:

- las líneas tocadas quedan **resaltadas** (colores de diff de tu tema, y marca
  en la regla lateral);
- encima del cambio aparece un **CodeLens** con **✓ Keep**, **↶ Undo** y
  **⇄ Ver diff**, y las mismas acciones en la **barra de título del editor**;
- el diff enfrenta el contenido anterior con el **documento real y editable**;
- la barra de estado indica cuántos archivos quedan por revisar;
- como es una edición normal del editor, **Ctrl+Z funciona** tal cual.

Nada se escribe en disco hasta que guardas (los archivos nuevos sí se crean, y
**Undo** los borra). Si aceptas un lote con Keep y te arrepientes, **M365
Copilot: Deshacer último lote de cambios del agente** lo revierte.

> La API de *chat editing* que usa GitHub Copilot Edits es *proposed API* y no
> está disponible para una extensión instalada normalmente, así que esto la
> reproduce con API estable (decoraciones + CodeLens + diff + acciones en la
> barra de título).

La herramienta de terminal es la única que ejecuta código arbitrario: antes de
correr nada ves el comando literal (con un aviso extra para patrones típicamente
destructivos — `rm -rf`, `git push --force`, `git reset --hard`…). Su salida se
envía al modelo en la nube, así que evítala sobre datos sensibles.

### Sub-agentes

`ms365_spawn_agents` permite al modelo delegar una o varias tareas acotadas en
**sub-agentes** que corren de forma autónoma — en paralelo si son varias — con su
propio ciclo de las mismas herramientas de workspace (ediciones, comandos y
commits incluidos, con la revisión Keep/Undo y las confirmaciones de siempre).
Cada sub-agente sólo ve su tarea y devuelve un resumen conciso, así explorar
mucho no llena el contexto de la conversación principal. Las llamadas que
editan, ejecutan comandos o tocan git se serializan entre sub-agentes; las de
solo lectura corren en paralelo. *Limitación conocida:* el diálogo de
confirmación no indica qué sub-agente lo pidió; la notificación de progreso y
el registro sí.

| Ajuste | Por defecto | Para qué |
|--------|-------------|----------|
| `ms365copilot.subagents.enabled` | `true` | Permitir la delegación. |
| `ms365copilot.subagents.maxConcurrent` | `3` | Sub-agentes a la vez. |
| `ms365copilot.subagents.maxSteps` | `6` | Llamadas a herramientas por sub-agente antes de un resumen parcial. |
| `ms365copilot.subagents.model` | `auto` | Modelo (tone) de los sub-agentes. |

## Autocompletado en línea (texto fantasma)

M365 Copilot también puede predecir código mientras escribes. Se activa o
desactiva desde el menú o con **M365 Copilot: Activar/desactivar autocompletado
en línea**.

**Expectativas honestas:** la latencia es de **~1-3 s** (cada sugerencia abre un
WebSocket nuevo; GitHub Copilot responde en ~200-400 ms), y BizChat es un
asistente conversacional, no un modelo *fill-in-the-middle* — la extensión
limpia las vallas y los «Claro, aquí tienes», pero la calidad es inferior a la de
un modelo dedicado. Cada sugerencia es una petición a tu plan de M365; si es
demasiado, pon `triggerMode` en `manual` y pídelas con `Alt+\`. Una caché
mantiene la sugerencia mientras tecleas exactamente lo que propuso, para que no
parpadee.

| Ajuste | Por defecto | Para qué |
|--------|-------------|----------|
| `inlineCompletions.enabled` | `true` | Activa o desactiva el texto fantasma. |
| `inlineCompletions.triggerMode` | `automatic` | `manual` sólo sugiere si lo pides (mucho menos gasto). |
| `inlineCompletions.debounceMs` | `500` | Pausa al teclear antes de pedir. |
| `inlineCompletions.maxLines` | `6` | Líneas máximas por sugerencia. |
| `inlineCompletions.timeoutMs` | `6000` | Se descarta pasado ese tiempo. |
| `inlineCompletions.model` | `auto` | Modelo; `reasoning` es demasiado lento aquí. |
| `inlineCompletions.disabledLanguages` | `["scminput", "plaintext"]` | Lenguajes donde nunca se dispara solo (`scminput` = cuadro de commit). |

Los paneles de salida, el lado de sólo lectura de los diffs y las vistas de git
nunca disparan una sugerencia.

## Comandos

Todos están en el menú del elemento **M365** de la barra de estado, y en la
paleta de comandos bajo **M365 Copilot**.

| Comando | Acción |
|---------|--------|
| `Mostrar menú` | El menú rápido (igual que pulsar el elemento de la barra de estado). |
| `Abrir el chat con @m365` | Abre el chat con `@m365` listo. |
| `Explicar código` / `Corregir código` / `Documentar código` / `Generar tests` / `Preguntar sobre este código…` | Acciones del editor (también en el menú contextual). |
| `Generar mensaje de commit con M365 Copilot` | Redacta el mensaje de commit en Source Control. |
| `Pegar perfil o token` | Guarda el token en SecretStorage (cifrado). |
| `Estado / información del token` | Usuario, caducidad y hora de captura. |
| `Borrar credenciales` | Borra el token guardado. |
| `Activar/desactivar autocompletado en línea` | Texto fantasma sí/no. |
| `Cambiar idioma` | Inglés / español / automático. |
| `Primeros pasos` | Abre el recorrido de bienvenida. |
| `Mostrar registro (diagnóstico)` | Abre el canal de salida «M365 Copilot». |
| `Revisar cambios de agente pendientes` | Diff de los cambios sin revisar. |
| `Aceptar (Keep)` / `Revertir (Undo)` / `Ver diff de los cambios del agente` | Acciones de revisión (también en la barra de título). |
| `Descartar cambios de agente pendientes` | Revierte todo lo pendiente de una vez. |
| `Deshacer último lote de cambios del agente` | Restaura el último lote aceptado. |

## Cómo funciona

El chat web de M365 Copilot habla con Substrate («Sydney» / BizChat) por
WebSocket:

```
wss://substrate.office.com/m365Copilot/Chathub/{oid}@{tid}?access_token=…&ConversationId=…
```

La extensión construye esa URL y el cuerpo de la invocación ella misma a partir
del `oid`/`tid` del token — **no** reproduce a propósito la conexión capturada en
el navegador. Reproducir el `endpoint` y la `invocationTemplate` reales de la
web hace que BizChat trate el turno como una sesión de Copilot web de verdad,
con sus propios plugins y *tool calling* nativo (`BingWebSearch`, un `tone` de
producción…), y entonces el modelo ignora las instrucciones de herramientas que
inyecta la extensión. Con la plantilla mínima propia, el protocolo de
herramientas funciona de forma fiable. Por eso da igual pegar el token pelado o
el perfil JSON completo: sólo se usa el `accessToken` (y sus claims). El
`locale` de la invocación sigue el idioma de la extensión.

## Notas y límites

- **El token caduca** (~60–75 min). Con la extensión de navegador y alguna
  pestaña de M365 abierta, la renovación es automática; si no, vuelve a
  capturarlo y pegarlo cuando te avise la barra de estado o la notificación.
- **Herramientas controladas.** Un nombre de herramienta que el host no haya
  ofrecido en el turno no se ejecuta nunca. Las propias sólo admiten rutas
  relativas dentro de un workspace de confianza y las ediciones requieren
  revisión siempre; las nativas y las de MCP las gobierna VS Code con sus
  propias confirmaciones.
- **Una conversación por turno.** Cada turno abre un WebSocket nuevo y envía el
  historial aplanado, conservando los turnos más recientes y acotando los
  resultados de herramientas para que coste y tamaño sean previsibles.
- El token se guarda **sólo** en el `SecretStorage` de VS Code (local, cifrado)
  y únicamente se envía a los endpoints de Microsoft. El servidor local que lo
  recibe del navegador (`localhost:51827`) sólo acepta los orígenes de
  M365/Office y la extensión de navegador.
- La herramienta **nativa** de mensaje de commit depende de la extensión Git
  integrada de VS Code y de que haya algún modelo de chat disponible para
  `git.generateCommitMessage`; si no lo hay, devuelve el diff para que el modelo
  redacte el mensaje. El botón ✨ de Source Control de esta extensión no tiene
  esa dependencia.

## Desarrollo

```bash
pnpm install          # desde la raíz del repositorio
pnpm build            # tsdown (rolldown + oxc) → dist/extension.cjs
pnpm watch            # recompilar al guardar
pnpm typecheck        # tsc --noEmit
pnpm lint             # oxlint
pnpm test             # tests de protocolo, herramientas, i18n y BizChat simulado (sin VS Code)
pnpm package          # .vsix en ../../releases
```

Pulsa `F5` en VS Code para lanzar un *Extension Development Host*.

**Traducciones.** Los textos de ejecución viven en
[`src/locales/en.ts`](src/locales/en.ts) (la referencia) y
[`src/locales/es.ts`](src/locales/es.ts), y se leen con `t('clave', …args)` de
[`src/i18n.ts`](src/i18n.ts); el catálogo en español está tipado contra las
claves en inglés, así que una clave que falte es un error de compilación, y
`pnpm test` comprueba que ambos usen los mismos marcadores `{0}`. Los textos del
manifiesto viven en `package.nls.json` / `package.nls.es.json`; los tests
comprueban que cada `%clave%` de `package.json` exista en los dos. Las entradas
`prompt.*`, `protocol.*`, `hint.*`… las lee el modelo: cámbialas con cuidado.

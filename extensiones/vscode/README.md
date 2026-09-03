# M365 Copilot for VS Code

Usa tu suscripción de **Microsoft 365 Copilot** como proveedor de modelos dentro
del chat de VS Code (junto a GitHub Copilot, Claude, etc.). No hay dashboard ni
configuración compleja: algo captura tu token de M365 Copilot en el navegador
y esta extensión lo usa para abrir sus propias conversaciones con Substrate.

https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode

Esta carpeta es sólo la mitad: la extensión de VS Code. Necesita que algo le
mande el token. Hay dos formas de hacerlo, y **puedes usar cualquiera de las
dos** (o las dos a la vez):

| Forma | Dónde vive | Cómo funciona |
|-------|------------|----------------|
| **Extensión de navegador** (recomendada) | [`extensiones/browser`](../browser/README.md) | Captura el token sola mientras navegas por M365/Office/Outlook/Teams y lo mantiene sincronizado y renovado, sin que hagas nada. |
| **Userscript de Tampermonkey** | `m365copilot-token.user.js` (esta carpeta) | Añade un panel en `m365.cloud.microsoft` con un botón para copiar el token a mano. Sirve para probar rápido sin instalar la extensión de navegador, pero el token caduca (~60–75 min) y hay que volver a copiarlo y pegarlo cada vez. |

En ambos casos, esta extensión recibe el token en un servidor HTTP local
(`http://localhost:51827`, sólo accesible desde tu propia máquina) y lo guarda
cifrado en el `SecretStorage` de VS Code — o lo pegas tú a mano con el comando
**«M365 Copilot: Pegar perfil o token»** si usas el userscript.

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

Efecto secundario de lo anterior: el modelo responde a veces con un aviso de
**«Web search is off»**. No es un ajuste que se pueda reactivar desde la
extensión — es el propio backend señalando que este turno no lleva el plugin
`BingWebSearch`, precisamente lo que se evita a propósito arriba. Como
paliativo, la extensión ofrece `m365_deepwiki_search`: consulta en vivo
[DeepWiki](https://deepwiki.com) (documentación generada por IA y preguntas y
respuestas) sobre un repositorio público de GitHub concreto — no es una
búsqueda web general, pero le da al modelo una fuente externa y actual dentro
del mismo protocolo de herramientas de texto.

## Uso

### 1. Instala la extensión
```bash
cd extensiones/vscode
pnpm install
pnpm build            # bundle con tsdown (rolldown + oxc) → dist/extension.cjs
pnpm package          # genera el .vsix
code --install-extension m365-copilot-vscode-1.0.0.vsix
```
O pulsa `F5` en VS Code para lanzar una ventana de desarrollo (*Extension
Development Host*), o instala el `.vsix` ya compilado desde la
[última release en GitHub](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest).

### 2. Consigue el token — elige una opción

**Opción A — extensión de navegador (recomendada).** Instala
[extensiones/browser](../browser/README.md) en Chrome/Edge o Firefox, abre
<https://m365.cloud.microsoft/chat/> y escribe algo. En unos segundos el
popup de la extensión pasa a «Todo listo», con las filas **Token** y
**VS Code** en verde — no hace falta pegar nada, y el token se renueva solo
mientras esa extensión esté instalada.

**Opción B — userscript de Tampermonkey (manual).**
1. Instala [Tampermonkey](https://www.tampermonkey.net/).
2. Abre el archivo `m365copilot-token.user.js` (esta misma carpeta) y dale a
   *Instalar*.
3. Entra en <https://m365.cloud.microsoft/chat/>. En cuanto la página cargue
   la sesión verás el panel abajo a la derecha con «Token: ok».
4. Pulsa **«Copiar sólo el token»** (o «Copiar perfil completo»: con esta
   versión de la extensión da igual cuál uses).
5. En VS Code, `Ctrl+Shift+P` → **«M365 Copilot: Pegar perfil o token»** y
   pega lo copiado. El token caduca a los ~60–75 min: cuando la extensión
   avise, repite este paso.

### 3. Elige el modelo y chatea
1. Abre el chat de VS Code, despliega el selector de modelos y elige uno de los
   **M365 Copilot** (`Auto`, `GPT`, `Claude Sonnet`, `Reasoning`).
2. Chatea normal.

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
pon `m365copilot.inlineCompletions.triggerMode` en `manual` y pídelas a mano
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
| `m365copilot.tools.includeEditorTools` | `true` | Describir también las herramientas nativas/MCP. En `false` vuelve al comportamiento anterior: sólo las `m365_*`. |
| `m365copilot.tools.duplicates` | `preferEditor` | Cuando una nativa y una nuestra hacen lo mismo (leer, buscar, editar, terminal…), a cuál se le dice al modelo que vaya primero. La otra no se oculta: queda como alternativa si la preferida falla. |
| `m365copilot.tools.maxAdvertised` | `48` | Tope de herramientas descritas en el prompt. Con varios servidores MCP el catálogo crece, y aquí viaja como texto, no como *schema*. Las que no se describen siguen siendo ejecutables si el modelo las nombra. |

Las herramientas propias de la extensión, dentro del workspace abierto, son:

- listar archivos sin cargar su contenido;
- buscar texto y devolver sólo coincidencias breves;
- leer rangos de archivo numerados;
- preparar un lote de ediciones exactas, archivos nuevos o borrados;
- leer los errores/avisos que ya muestra VS Code (solo lectura, no compila nada);
- consultar git en modo solo lectura (`status`/`diff`/`log`; nunca hace commit ni push);
- ejecutar un comando de terminal (build, tests...) — **siempre** con tu confirmación explícita, mostrando el comando exacto antes de correrlo.

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

- **El token caduca** (~60–75 min). Con el userscript manual, vuelve a copiar
  el perfil en la web y pégalo de nuevo cuando la extensión avise con el error
  de caducidad. Con la [extensión de navegador](../browser/README.md)
  instalada y alguna pestaña de Office abierta, la renovación es automática.
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

## Desarrollo

```bash
pnpm build       # compilar
pnpm watch       # recompilar al guardar
pnpm typecheck   # tsc --noEmit
pnpm lint        # oxlint
```

Toolchain: **pnpm + tsdown (rolldown + oxc)**. `vscode` queda externo; `ws` se
empaqueta en el bundle.

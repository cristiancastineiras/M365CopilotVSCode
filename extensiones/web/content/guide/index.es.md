---
title: "Cómo usar M365 Copilot en VS Code: guía paso a paso"
heading: "Usa M365 Copilot en VS Code, paso a paso"
slug: guia
description: "Instala la extensión de VS Code y la de navegador, conéctalas con un mensaje y empieza a chatear, editar y hacer commits con Microsoft 365 Copilot."
---

## Qué necesitas

- **VS Code 1.104 o posterior.**
- **Una cuenta de Microsoft 365 con licencia de Copilot.** Si no la tienes, el servicio responde con un error de licencia y la extensión te lo dice; pregunta a tu administrador de Microsoft 365.
- **Chrome, Edge o Firefox 128+** para la extensión de navegador (o Tampermonkey, mira el [paso 6](#6-sin-extensión-de-navegador-dos-alternativas)).

El pack tiene dos piezas. La **extensión de VS Code** añade el chat, los modelos y las acciones del editor. La **extensión de navegador** lee el token de sesión que ya usa la aplicación web de Microsoft 365 Copilot y se lo envía a VS Code, así que nunca copias y pegas un token.

{{< note >}}
Las capturas de VS Code están hechas con la interfaz en inglés; la extensión, en cambio, sigue el idioma de VS Code (inglés o español).
{{< /note >}}

## 1. Instala la extensión de VS Code

Elige una opción:

- **VS Marketplace:** abre la [página de la extensión](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode) y pulsa **Instalar**, o ejecuta `ext install m365-copilot-vscode.m365-copilot-vscode` en la apertura rápida (`Ctrl+P`).
- **Desde un archivo:** descarga el `.vsix` de la [última versión](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest); en VS Code abre la vista de Extensiones, pulsa el menú `…` y elige **Instalar desde VSIX…**.

Al terminar aparece un elemento **M365** en la barra de estado (abajo a la derecha). Su icono te dice de un vistazo si VS Code tiene un token válido.

## 2. Instala la extensión de navegador

Descárgala desde la [página de descargas](../descarga/) y cárgala:

- **Chrome:** descomprime el archivo, abre `chrome://extensions`, activa el **Modo de desarrollador**, pulsa **Cargar descomprimida** y elige la carpeta.
- **Edge:** igual, desde `edge://extensions`.
- **Firefox:** abre en Firefox el archivo `.xpi` firmado. Si no lo hay, ve a `about:debugging` → **Este Firefox** → **Cargar complemento temporal** y elige el `.zip` (Firefox lo quita al cerrarse).

## 3. Conecta con un solo mensaje

1. Abre [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) e inicia sesión.
2. Envía cualquier mensaje en el chat.
3. Abre el popup de la extensión. Cuando todo está en verde, VS Code ya tiene tu token.

{{< shot narrow="true" src="popup-es.png" alt="Popup de la extensión de navegador: conectado con VS Code, token válido 47 minutos más, renovación automática" caption="Verde significa conectado. El token se renueva solo mientras haya una pestaña de Microsoft 365 abierta." >}}

## 4. Chatea con @m365

Abre el chat de VS Code y escribe **`@m365`** seguido de tu pregunta. M365 Copilot siempre responde, sea cual sea el modelo elegido en el selector. Si seleccionas código antes, viaja con la pregunta.

| Comando | Qué hace |
| --- | --- |
| `@m365 /explain` | Explica el código seleccionado, o la función bajo el cursor. |
| `@m365 /fix` | Corrige los problemas de ese código y aplica el arreglo con Keep / Undo. |
| `@m365 /doc` | Añade comentarios de documentación. |
| `@m365 /tests` | Escribe pruebas unitarias con el framework que ya usa el proyecto. |
| `@m365 /terminal` | Explica el último comando del terminal activo y cómo arreglarlo. |

{{< shot src="editor-chat.png" alt="Chat de VS Code respondiendo con M365 Copilot: dos problemas de la función getUser seleccionada y una versión más robusta" caption="Una pregunta sobre la función seleccionada, respondida en el chat de VS Code." >}}

### Usarlo como modelo

Si prefieres elegir M365 Copilot como modelo (por ejemplo en modo Agente), primero hay que mostrarlo, porque al principio no aparece: en el selector de modelos pulsa el engranaje, elige **Otros modelos** y baja hasta las opciones de M365 Copilot. Puedes fijarlas.

{{< shot narrow="true" src="editor-models.png" alt="Selector de modelos de VS Code con los modelos de Microsoft 365 Copilot: Auto, Quick response, Think deeper, GPT 5.5, GPT 5.6 y Claude Sonnet" caption="Los modelos de M365 Copilot en el selector de modelos." >}}

## 5. Edita, revisa y haz commit desde el editor

- **Editar en el sitio:** selecciona código (o pon el cursor en una función), pulsa `Ctrl+Shift+Alt+I` y escribe qué debe cambiar. El resultado queda bajo **Keep / Undo**, bloque a bloque.
- **Clic derecho → M365 Copilot:** editar, explicar, preguntar, revisar, corregir, documentar o generar pruebas para el código seleccionado.
- **Bombilla (`Ctrl+.`) en un error:** **Corregir con M365 Copilot** lo arregla en el sitio.
- **Revisión como comentarios:** **Revisar código** deja sus hallazgos como comentarios en las líneas, cada uno con **Aplicar corrección** y **Descartar**. En Control de código fuente, ☑ revisa todos tus cambios sin confirmar.
- **Mensajes de commit:** el botón ✨ de la barra de título de Control de código fuente escribe un mensaje Conventional Commits a partir de tu diff. Nunca hace el commit por ti.
- **Auto-commit (opcional):** actívalo por espacio de trabajo y hace commit del trabajo terminado con mensajes documentados. Nunca hace push y cada auto-commit tiene **Deshacer**.

{{< shot src="editor-edit.png" alt="Editor de VS Code con un cambio propuesto por M365 Copilot: líneas nuevas resaltadas y una barra Keep, Undo y Show diff encima" caption="Cada edición espera a que la aceptes o la deshagas." >}}

{{< shot src="editor-review.png" alt="Editor de VS Code con comentarios de revisión de M365 Copilot en las líneas: un error por un bucle que se pasa de largo y un aviso por un descuento sin validar" caption="Los hallazgos de la revisión, como comentarios en las líneas y con una corrección sugerida." >}}

{{< shot src="editor-commit.png" alt="Vista de Control de código fuente de VS Code con un mensaje de commit escrito por M365 Copilot en el cuadro de commit" caption="El mensaje de commit aparece en el cuadro. Tú lo lees y haces el commit." >}}

## 6. Sin extensión de navegador: dos alternativas

**Userscript.** Instala [Tampermonkey](https://www.tampermonkey.net/) (o Violentmonkey) y luego [instala el userscript](https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/extensiones/vscode/m365copilot-token.user.js); después se actualiza solo. Abre Microsoft 365 Copilot y envía un mensaje. La primera vez, Tampermonkey pide permitir que el script se conecte a `localhost`: permítelo, es VS Code.

**Pegar el token a mano.** Útil en un navegador gestionado donde no puedes instalar nada:

1. Abre Microsoft 365 Copilot, pulsa `F12` y ve a la pestaña **Red** (Network).
2. Escribe `chathub` en el filtro y envía un mensaje.
3. Clic derecho en la petición que aparece → **Copiar** → **Copiar URL**.
4. En VS Code abre la paleta de comandos (`Ctrl+Shift+P`), ejecuta **M365 Copilot: Pegar perfil o token** y confirma. Detecta la URL que tienes en el portapapeles.

{{< shot src="editor-menu.png" alt="El menú M365 abierto desde la barra de estado de VS Code: pegar perfil o token, estado del token, abrir M365 Copilot, cerrar sesión y volver a entrar" caption="El mismo comando está en el menú M365 de la barra de estado, junto al estado del token." >}}

{{< note >}}
El token de Copilot viaja como `access_token` dentro de esa URL, no en una cabecera `Authorization: Bearer`. Un bearer copiado de otra petición es de otro servicio y falla con un 401.
{{< /note >}}

La búsqueda web necesita la sesión capturada por la extensión de navegador o el userscript; un token pegado solo no la incluye.

## 7. Cuando caduca el token

El token dura aproximadamente una hora. Con la extensión de navegador y una pestaña de Microsoft 365 abierta en algún sitio, se renueva solo. Si no, el elemento de la barra de estado muestra un aviso y una notificación ofrece **Pegar token** o **Abrir M365 Copilot**: abre Microsoft 365 Copilot y vuelve a enviar un mensaje.

Para cambiar de cuenta, o si la renovación falla, usa **Cerrar sesión y volver a entrar** en el menú M365 de la barra de estado. También borra la sesión de Microsoft del navegador, que es lo único que hace que Microsoft vuelva a pedirte las credenciales. Necesita la extensión de navegador.

## 8. Idioma

La extensión sigue el idioma de VS Code, inglés o español, y las instrucciones que se envían al modelo también. Para cambiarlo usa el menú de la barra de estado → **Cambiar idioma**, o el ajuste `m365copilot.language`.

## Problemas habituales

- **Error 401:** pegaste un bearer de otra petición. Copia la URL de `chathub`, como en el paso 6.
- **No aparece M365 Copilot en el selector de modelos:** pulsa el engranaje → **Otros modelos**. Siempre puedes usar `@m365`.
- **Error de licencia:** la cuenta no tiene licencia de Copilot. Es cosa de la cuenta, no del modelo: pregunta a tu administrador de Microsoft 365.
- **Los modelos Claude no responden:** tu administrador debe habilitar los modelos de Anthropic.
- **Sigue sin funcionar:** [abre una incidencia](https://github.com/cristiancastineiras/M365CopilotVSCode/issues) en GitHub.

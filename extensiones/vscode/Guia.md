# Guía de instalación y uso de la extensión de VS Code para M365 Copilot

[English](Guide.md) · **Español**

Hay dos formas de llevar el token de Microsoft 365 Copilot a VS Code:

- **Opción A — extensión de navegador (recomendada).** Captura el token, lo
  renueva antes de que caduque y lo envía a VS Code sin que tengas que copiar ni
  pegar nada.
- **Opción B — userscript de Tampermonkey.** Te muestra un panel en la web de
  M365 Copilot desde el que copias el token para pegarlo en VS Code a mano (y
  repetirlo cuando caduque, ~cada hora).

> Dentro de VS Code tienes además el recorrido **Primeros pasos** de M365
> Copilot (*Ayuda → Bienvenida*, o desde el menú del elemento **M365** de la
> barra de estado), con estos mismos pasos.

## 1. Opción A: extensión de navegador

1. Descarga la extensión para tu navegador desde las
   [releases del repositorio](https://github.com/cristiancastineiras/M365CopilotVSCode/releases)
   (Chrome/Edge o Firefox), descomprímela y cárgala (en Chrome/Edge:
   `chrome://extensions` → *Modo de desarrollador* → *Cargar descomprimida*; en
   Firefox: `about:debugging` → *Este Firefox* → *Cargar complemento temporal*).
2. Entra en [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) y envía
   cualquier mensaje.
3. Abre el popup de la extensión: cuando todo está en verde, el token ya está en
   VS Code. Mientras tengas alguna pestaña de M365 abierta, se renueva solo.

![Popup de la extensión de navegador](imgs/ui-extension-navegador.png)

Si usas esta opción, salta al [paso 4](#4-instalar-la-extensión-de-vs-code).

## 2. Opción B: instalar Tampermonkey y el userscript

Primero, dependiendo del navegador que uses, hay que instalar Tampermonkey, que
es un gestor de userscripts. Se ha probado en Chrome y Edge.

- [Google Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Mozilla Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

Después hay que añadir el userscript que captura el token de acceso, el endpoint
y la plantilla de invocación de Microsoft 365 Copilot:

1. Fija la extensión en la barra de extensiones del navegador y haz clic en ella.

![Opción para crear un nuevo script en Tampermonkey](imgs/tampermonkey-crear-nuevo-script.png)

2. Pulsa **Crear un nuevo script** y pega el contenido del archivo [`ms365copilot-token.user.js`](ms365copilot-token.user.js).

3. Pulsa **Archivo > Guardar**. También puedes arrastrar el archivo sobre el editor.

![Editor de un nuevo script en Tampermonkey](imgs/tampermonkey-nuevo-script.png)

![Instalación del userscript en Tampermonkey](imgs/tampermonkey-instalas-script.png)

Una vez instalado o guardado, debe aparecer en la sección de scripts instalados:

![Userscript instalado en Tampermonkey](imgs/tampermonkey-script-instalado.png)

El panel del userscript sale en español o en inglés según el idioma de tu
navegador.

## 3. Opción B: capturar el token

Con el script instalado y habilitado, entra en [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/).

Dentro de la página debería aparecer un cuadro como este en la esquina inferior
derecha:

![Estado inicial del userscript](imgs/primer-inicio-usercript.png)

Para asegurarte de que se ha capturado todo correctamente, puedes enviar un
«hola» al chat. En realidad, si aparecen las tres bolitas en verde, ya está
listo.

![token copiado](imgs/copiado-token-perfil.png)

Puedes copiar el perfil entero o solo el token: la extensión sólo usa el token
de acceso, así que da igual cuál pegues. Lo más cómodo es **Copiar sólo el
token**.

## 4. Instalar la extensión de VS Code

Abre VS Code e instala la extensión de M365 Copilot.

![Extensión de M365 Copilot en VS Code](imgs/marketplace-vscode-extension.png)

Al instalarla aparece el elemento **M365** en la barra de estado (abajo a la
derecha). Su icono te dice el estado del token (🔑 aún no hay, ⚠ caducado) y al
pulsarlo se abre el menú con todas las acciones.

Si usas el userscript, pega el token: abre la paleta de comandos con
`Ctrl + Shift + P`, busca `M365` y ejecuta **M365 Copilot: Pegar perfil o token**
(o elige *Pegar perfil o token* en el menú de la barra de estado).

![Comandos de M365 Copilot en la paleta de VS Code](imgs/m365-ctrl-shift-p.png)

![Campo para pegar el token o perfil](imgs/pegar-token-perfil.png)

## 5. Mostrar los modelos en el chat

La forma más directa es escribir **`@m365`** en el chat: responde siempre M365
Copilot, sin tocar el selector de modelos.

Si prefieres usarlo como modelo (por ejemplo en modo agente), hay que mostrarlo
en el selector, porque no aparece de primeras:

![Interfaz predeterminada del chat de VS Code](imgs/ui-chat-copilot-default.png)

En el selector de modelos, pulsa la ruleta y después **Otros modelos**:

![Opción Otros modelos en VS Code](imgs/otros-modelos.png)

Desplázate hasta abajo para ver las opciones de M365 Copilot:

![Modelos de M365 Copilot disponibles](imgs/modelos-opciones.png)

Puedes fijarlos; si no, aparecen al final del selector de modelos.

## 6. Empezar a usarlo

Puedes hacer una pregunta de código:

![Ejemplo de una pregunta de código](imgs/prompt-pregunta.png)

O pedir una edición de código: los cambios aparecen resaltados en el editor con
**Keep / Undo** encima (y también en la barra de título del editor) para que los
aceptes o los reviertas.

![Ejemplo de una edición de código](imgs/ejemplo-edicion-codigo.png)

Desde el propio editor:

- **Clic derecho → M365 Copilot**: explicar, preguntar, corregir, documentar o
  generar tests del código seleccionado (o de la función en la que está el
  cursor).
- **Bombilla (`Ctrl + .`)** sobre un error: **Corregir con M365 Copilot**.
- **Source Control**: el botón ✨ de la barra de título redacta el mensaje de
  commit con M365 Copilot.

## 7. Idioma

La extensión sigue por defecto el idioma de VS Code (español o inglés). Para
cambiarlo: menú de la barra de estado → **Idioma**, o el ajuste
`ms365copilot.language`. Cambia también el idioma de las instrucciones que se
envían al modelo, así que responde en ese idioma.

---

Funciona bien con tareas de exploración de archivos y carpetas, preguntas y
edición de código. Está bastante bien teniendo en cuenta que es un wrapper de un
modelo que no está hecho para funcionar como agente ni como MCP.

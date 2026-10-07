# Guía de instalación y uso de la extensión de VS Code para M365 Copilot

[English](Guide.md) · **Español**

Hay dos formas de llevar el token de Microsoft 365 Copilot a VS Code:

- **Opción A — extensión de navegador (recomendada).** Captura el token, lo
  renueva antes de que caduque y lo envía a VS Code sin que tengas que copiar ni
  pegar nada.
- **Opción B — userscript de Tampermonkey.** Hace la misma captura que la
  extensión de navegador (comparten el código) y también envía el token a VS
  Code por sí solo; además muestra un pequeño panel con el estado de la conexión
  y botones para copiar el token a mano.

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

Después hay que añadir el userscript. Lo más sencillo es abrir
[este enlace](https://raw.githubusercontent.com/cristiancastineiras/M365CopilotVSCode/main/extensiones/vscode/m365copilot-token.user.js) con Tampermonkey instalado: te ofrece **Instalar**, y a
partir de ahí el script se actualiza solo cuando sale una versión nueva.

También puedes instalarlo a mano:

1. Fija la extensión en la barra de extensiones del navegador y haz clic en ella.

![Opción para crear un nuevo script en Tampermonkey](imgs/tampermonkey-crear-nuevo-script.png)

2. Pulsa **Crear un nuevo script** y pega el contenido del archivo [`m365copilot-token.user.js`](m365copilot-token.user.js).

3. Pulsa **Archivo > Guardar**. También puedes arrastrar el archivo sobre el editor.

![Editor de un nuevo script en Tampermonkey](imgs/tampermonkey-nuevo-script.png)

![Instalación del userscript en Tampermonkey](imgs/tampermonkey-instalas-script.png)

Una vez instalado o guardado, debe aparecer en la sección de scripts instalados:

![Userscript instalado en Tampermonkey](imgs/tampermonkey-script-instalado.png)

El panel del userscript sale en español o en inglés según el idioma de tu
navegador.

> Si ya tenías instalada una versión antigua del userscript, sustitúyela por la
> nueva (o instálala desde el enlace de arriba): la antigua dejaba de recoger el
> token en cuanto tenía uno y sólo permitía copiarlo a mano.

## 3. Opción B: capturar el token

Con el script instalado y habilitado, entra en [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/).

En la esquina inferior derecha aparece el panel del userscript. Envía un
«hola» en el chat para que capture el token.

**La primera vez, Tampermonkey te pedirá permiso para que el script se conecte a
`localhost`.** Pulsa **Permitir siempre**: es el servidor local de la extensión
de VS Code, y es lo que permite enviarle el token sin copiar ni pegar.

La ilustración del panel te dice en qué punto estás:

<img src="imgs/connection-states.png" width="260" alt="Estados de la conexión: esperando el token, token capturado, conectado con VS Code y token caducado">

1. **Esperando el token**: los dos logos en gris; el de M365 «respira».
2. **Token listo**: el logo de M365 se enciende, pero VS Code sigue en gris porque no responde todavía (ábrelo con la extensión activa).
3. **Conectado con VS Code**: el logo de VS Code se enciende y el token recorre la flecha. Ya está — se volverá a enviar solo cada vez que se renueve.
4. **Token caducado**: recarga la página (el botón del panel lo hace) o vuelve a iniciar sesión.

El panel se puede minimizar (–) a un pequeño icono, y el menú de Tampermonkey
tiene **Enviar el token a VS Code ahora**, **Mostrar el panel** y la opción de
renovar sola una pestaña oculta cuyo token ha caducado (recargándola).

Si no das el permiso de `localhost`, el panel sigue teniendo **Copiar token** y
**Copiar perfil**: pega cualquiera de los dos en VS Code con **M365 Copilot:
Pegar perfil o token**.

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

O pedir una edición de código: cada bloque cambiado aparece resaltado en el
editor con su propio **Keep / Undo** encima (y las acciones del archivo entero,
con ↑ / ↓ para saltar entre cambios, en la barra de título del editor) para que
lo aceptes o lo reviertas bloque a bloque.

![Ejemplo de una edición de código](imgs/ejemplo-edicion-codigo.png)

Desde el propio editor:

- **`Ctrl + Mayús + Alt + I`** con código seleccionado (o el cursor dentro de una
  función): escribe una instrucción («añade manejo de errores») y el cambio se
  aplica ahí mismo, con Keep / Undo.
- **Clic derecho → M365 Copilot**: editar, explicar, preguntar, revisar,
  corregir, documentar o generar tests del código seleccionado (o de la función
  en la que está el cursor). **Revisar código** deja sus hallazgos como
  comentarios en las líneas, cada uno con **Aplicar corrección** y **Descartar**
  (también aparecen en el panel **Comentarios**).
- **Bombilla (`Ctrl + .`)** sobre un error: **Corregir con M365 Copilot**, que lo
  corrige en el sitio, y **Corregir todos los problemas del archivo** si hay
  varios.
- **Source Control**: el botón ✨ de la barra de título redacta el mensaje de
  commit con M365 Copilot, y ☑ revisa como comentarios tus cambios sin commitear.
- **Menú Cuentas** (icono de persona, abajo a la izquierda): muestra tu cuenta de
  M365 Copilot, cierra la sesión (borra el token) y la inicia cuando no hay token.

M365 Copilot además **conoce tu proyecto**: un índice local del workspace añade
el código relevante a cada petición, y **M365 Copilot: Buscar en el proyecto…**
encuentra código por su significado («dónde se guarda el token»). Con la
extensión de navegador o el userscript, también puede **buscar en internet**
cuando lo necesita.
- **Terminal**: si un comando falla, clic derecho en el terminal → **Explicar el
  último comando del terminal**.

## 7. Idioma

La extensión sigue por defecto el idioma de VS Code (español o inglés). Para
cambiarlo: menú de la barra de estado → **Idioma**, o el ajuste
`m365copilot.language`. Cambia también el idioma de las instrucciones que se
envían al modelo, así que responde en ese idioma.

---

Funciona bien con tareas de exploración de archivos y carpetas, preguntas y
edición de código. Está bastante bien teniendo en cuenta que es un wrapper de un
modelo que no está hecho para funcionar como agente ni como MCP.

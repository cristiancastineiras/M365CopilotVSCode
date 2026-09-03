# Guía de instalación y uso de la extensión de VS Code para M365 Copilot

> **¿Primera vez?** La forma más cómoda hoy es instalar la
> [extensión de navegador](../browser/README.md): captura el token sola y lo
> mantiene renovado, sin copiar ni pegar nada. Esta guía explica la vía
> manual con Tampermonkey — útil para probar rápido o si prefieres no
> instalar una extensión de navegador que corre en segundo plano.

## 0. Instalar la extensión de navegador (Recomendado)

![Ui extension](imgs/ui-extension-navegador.png)

**¿Por qué primero?** Esta extensión captura el token de M365 Copilot sola mientras navegas
y lo mantiene renovado — sin copiar ni pegar nada. Una vez instalada y emparejada, funciona
automáticamente. Es la forma más cómoda de usar M365 Copilot en VS Code.

### Descargar

1. Ve a [la última release en GitHub](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest).
2. Descarga uno de estos archivos (según tu navegador):
   - `m365-copilot-vscode-extension-chrome.zip` — para Chrome, Edge o Brave
   - `m365-copilot-vscode-extension-firefox.zip` — para Firefox

### Instalar en Chrome, Edge o Brave

1. Descomprime el `.zip` en una carpeta cualquiera de tu ordenador.
2. Abre `chrome://extensions` en la barra de direcciones.
3. Arriba a la derecha, activa el **Modo de desarrollador** (esquina superior derecha).
4. Haz clic en **Cargar extensión sin empaquetar**.
5. Selecciona la carpeta que descomprimiste en el paso 1.
6. Listo — verás el icono de la extensión en la barra de herramientas.

### Instalar en Firefox

1. Descomprime el `.zip` en una carpeta cualquiera de tu ordenador.
2. Abre `about:debugging#/runtime/this-firefox` en la barra de direcciones.
3. Pulsa **Cargar complemento temporal…**
4. Selecciona el archivo `manifest.json` dentro de la carpeta descomprimida.
5. Listo — verás el icono de la extensión en la barra de herramientas.

> **Nota:** En Firefox, la extensión es temporal: la olvida al cerrar el navegador. Para algo
> permanente hace falta firmarla en addons.mozilla.org, que todavía no está hecho. 

## 1. Instalar Tampermonkey (opcional)

Primero, dependiendo del navegador que uses, hay que instalar Tampermonkey, que
es un gestor de userscripts. En este caso se ha probado en Chrome y Edge.

- [Google Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Mozilla Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- [Microsoft Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

## 2. Instalar el userscript

Una vez instalado Tampermonkey, hay que añadir el userscript que captura el token
de acceso, el endpoint y la plantilla de invocación de Microsoft 365 Copilot.

Para ello puedes instalarlo manualmente:

1. Fija la extensión en la barra de extensiones del navegador y haz clic en ella.

![Opción para crear un nuevo script en Tampermonkey](imgs/tampermonkey-crear-nuevo-script.png)

2. Pulsa **Crear un nuevo script** y pega el contenido del archivo [`m365copilot-token.user.js`](m365copilot-token.user.js).

3. Pulsa **Archivo > Guardar**. También puedes arrastrar el archivo sobre el editor.

![Editor de un nuevo script en Tampermonkey](imgs/tampermonkey-nuevo-script.png)

![Instalación del userscript en Tampermonkey](imgs/tampermonkey-instalas-script.png)

Una vez instalado o guardado, debe aparecer en la sección de scripts instalados:

![Userscript instalado en Tampermonkey](imgs/tampermonkey-script-instalado.png)

## 3. Capturar el token

Con el script instalado y habilitado, entra en [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/).

Dentro de la página debería aparecer un cuadro como este en la esquina inferior
derecha:

![Estado inicial del userscript](imgs/primer-inicio-usercript.png)

Para asegurarte de que se ha capturado todo correctamente, puedes enviar un
«hola» al chat. En realidad, si aparecen las tres bolitas en verde, ya está
listo.

![token copiado](imgs/copiado-token-perfil.png)

Puedes copiar el perfil entero o solo el token. La diferencia es que el perfil
entero incluye el endpoint y la plantilla de invocación, mientras que el token
solo incluye el token de acceso.

Yo sugiero copiar solo el token. Suele responder mejor porque no copia la
plantilla de invocación predeterminada de Microsoft 365 Copilot, que hace que el
chat se comporte de forma diferente a la web. Así funciona mejor con las
herramientas de desarrollo de VS Code.

## 4. Instalar la extensión de VS Code

Una vez copiado el token, abre VS Code e instala la extensión de M365 Copilot,
que permite invocar Microsoft 365 Copilot desde el editor.

![Extensión de M365 Copilot en VS Code](imgs/marketplace-vscode-extension.png)

Una vez instalada, abre la paleta de comandos con `Ctrl + Shift + P` y busca `M365`.

![Comandos de M365 Copilot en la paleta de VS Code](imgs/m365-ctrl-shift-p.png)

El comando más importante es **M365 Copilot: Pegar perfil o token**, que permite
pegar el token copiado anteriormente desde el userscript.

![Campo para pegar el token o perfil](imgs/pegar-token-perfil.png)

Una vez pegado, ya puedes invocar Microsoft 365 Copilot desde VS Code.

## 5. Mostrar los modelos en el chat

Antes de empezar, hay que configurar los modelos porque no aparecen en el chat
de primeras:

![Interfaz predeterminada del chat de VS Code](imgs/ui-chat-copilot-default.png)

En el selector de modelos, pulsa la ruleta y después **Otros modelos**:

![Opción Otros modelos en VS Code](imgs/otros-modelos.png)

Desplázate hasta abajo para ver las opciones de M365 Copilot:

![Modelos de M365 Copilot disponibles](imgs/modelos-opciones.png)

Yo los tengo fijados, pero es opcional. En la interfaz normal aparecen al final
del selector de modelos.

## 6. Empezar a usarlo

Una vez hecho esto, ya puedes empezar a usarlo.

Por ejemplo, puedes hacer una pregunta de código:

![Ejemplo de una pregunta de código](imgs/prompt-pregunta.png)

También puedes pedir una edición de código:

![Ejemplo de una edición de código](imgs/ejemplo-edicion-codigo.png)

De momento funciona con tareas básicas: explorar archivos y carpetas, responder
preguntas y editar código. Está bastante bien teniendo en cuenta que es un
wrapper de un modelo que no está hecho para funcionar como agente ni como MCP.

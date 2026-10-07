# M365 Copilot — extensión de navegador

[English](README.md) · **Español**

Compañera de la extensión [M365 Copilot para VS Code](../vscode). Captura el
token de tu sesión de **Microsoft 365 Copilot** en la web de M365 y lo mantiene
sincronizado con VS Code, para que nunca tengas que copiar y pegar un token a
mano.

- **Captura:** en `m365.cloud.microsoft` (y en páginas de Office/Outlook/Teams),
  un content script que corre en la página lee el token que ya usa la web
  (URL del WebSocket, cabeceras de las peticiones y caché de MSAL).
- **Sincronización:** el background lo envía al servidor local de la extensión
  de VS Code (`http://localhost:51827/token`) y lo reenvía si VS Code arranca
  después.
- **Renovación:** unos 12 minutos antes de que caduque, pide uno nuevo a la
  pestaña de M365, después recarga esa pestaña y, si no hay ninguna, abre una en
  segundo plano — con backoff, y un badge rojo cuando hace falta que inicies
  sesión.

El popup muestra una ilustración animada **M365 → VS Code** — el logo de VS Code
está en gris hasta que VS Code tiene el token, entonces se enciende y el token
recorre la flecha — además del estado del token, del endpoint, de la conexión
con VS Code y de la renovación, con los botones **Enviar a VS Code**, **Copiar
token** y **Renovar ahora**. La lógica de captura y la ilustración viven en
`@m365copilot/core` y las comparte el userscript de Tampermonkey, así que los
dos se comportan igual. Está disponible en **inglés y español** (según el idioma del
navegador), igual que el nombre y la descripción de la extensión.

## Instalación

Descarga `m365-copilot-vscode-extension-chrome.zip` o `…-firefox.zip` desde las
[releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases),
descomprímelo y:

- **Chrome / Edge:** `chrome://extensions` → *Modo de desarrollador* → *Cargar descomprimida*.
- **Firefox:** `about:debugging` → *Este Firefox* → *Cargar complemento temporal*.

Después abre <https://m365.cloud.microsoft/chat/> y envía un mensaje.

## Desarrollo

```bash
pnpm install            # desde la raíz del repositorio
pnpm dev                # Chrome/Edge con HMR
pnpm dev:firefox
pnpm build              # → ../../releases/chrome
pnpm zip && pnpm zip:firefox
pnpm typecheck
pnpm test               # política y ciclo de renovación contra un `chrome` falso
```

Stack: [WXT](https://wxt.dev/) + React 18 + TypeScript. El contrato compartido
con VS Code (puerto, rutas, tipos del perfil, utilidades de JWT) vive en
[`@m365copilot/core`](../../packages/core).

```
entrypoints/
  background.ts            service worker: almacenamiento, sincronización con VS Code, renovación
  content.ts               puente (mundo ISOLATED) entre la página y el background
  interceptor.content.ts   captura en el mundo MAIN (WebSocket / fetch / XHR / caché MSAL)
  popup/                   popup en React
utils/
  i18n.ts                  textos del popup y de los errores (en / es)
  refreshPolicy.ts         decisión de renovación, pura (con tests)
  tokenRefresher.ts        ciclo de renovación sobre chrome.alarms (con tests)
public/
  _locales/{en,es}/        nombre, descripción y tooltip de la extensión
```

**Traducciones:** los textos de la interfaz están en [`utils/i18n.ts`](utils/i18n.ts)
(el catálogo en español está tipado contra las claves en inglés); el nombre, la
descripción y el tooltip del manifiesto, en `public/_locales/<idioma>/messages.json`.

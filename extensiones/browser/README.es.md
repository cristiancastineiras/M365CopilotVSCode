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

El popup — claro y limpio, en Segoe UI y con el aspecto de Windows 11 — muestra
una ilustración animada **M365 → VS Code**: entre los logos, una señal de tres
anillos gira mientras busca el token y a VS Code, y se convierte en una señal que
apunta a VS Code cuando conecta (VS Code sigue en gris hasta entonces). Debajo,
el estado del token, de la conexión con VS Code y de la renovación, y un botón
principal que siempre es el paso siguiente (**Abrir M365 Copilot**, **Renovar
ahora** o **Enviar a VS Code**) más **Copiar token**. La lógica de captura y la ilustración viven en
`@m365copilot/core` y las comparte el userscript de Tampermonkey, así que los
dos se comportan igual. Está disponible en **inglés y español** (según el idioma del
navegador), igual que el nombre y la descripción de la extensión.

## Instalación

Descárgala desde las
[releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases):

- **Chrome / Edge:** descomprime `m365-copilot-vscode-extension-chrome.zip` →
  `chrome://extensions` → *Modo de desarrollador* → *Cargar descomprimida*.
- **Firefox (permanente):** abre `m365-copilot-vscode-extension-firefox.xpi` en
  Firefox (o arrástralo a `about:addons`). Es el build firmado por Mozilla, el
  único que Firefox Release instala de forma permanente; las releases sin
  `.xpi` no se firmaron.
- **Firefox (temporal, sin firma):** `about:debugging` → *Este Firefox* →
  *Cargar complemento temporal* → elige
  `m365-copilot-vscode-extension-firefox.zip` (no hace falta descomprimirlo).
  Firefox lo quita al cerrarse.
- **Firefox Developer Edition / Nightly / ESR:** pon
  `xpinstall.signatures.required` a `false` en `about:config` y luego
  `about:addons` → ⚙ → *Instalar complemento desde archivo* con el `.zip`.

Firefox 128 o posterior. Si Firefox dice que el complemento «parece estar
dañado», el zip es de la 2.0.0 o anterior (no llevaba ID de complemento):
vuelve a descargarlo.

Después abre <https://m365.cloud.microsoft/chat/> y envía un mensaje.

## Cerrar sesión de Microsoft

El botón **Cerrar sesión de Microsoft** del popup (confirma en el propio botón)
es lo que hace posible renovar de verdad: borra la sesión de Microsoft de este
navegador y te deja en la pantalla de inicio de sesión.

Por qué hace falta: el token de Copilot lo entrega la sesión de Microsoft
(cookies de `login.microsoftonline.com` más la caché de tokens de MSAL), así
que mientras esa sesión siga ahí, pedir otro token lo entrega en silencio sin
preguntar nada. El botón, por orden: pasa por los endpoints de cierre de sesión
de Microsoft (Entra ID, cuenta personal y Office) **antes** de borrar nada
—necesitan las cookies para saber qué sesión cerrar—, cierra las pestañas de
Microsoft, borra todas las cookies de los dominios de Microsoft en todos los
contenedores (incluidas las particionadas) y vacía localStorage, IndexedDB,
Cache Storage, service workers y FileSystem de cada web de Microsoft.

La extensión de VS Code puede pedir lo mismo con su comando **Cerrar sesión y
volver a entrar**: abre esta web con un identificador en la URL, y la extensión
sólo obedece si coincide con el que VS Code tiene pendiente en su servidor
local, porque una URL la puede enlazar cualquier web. Si el navegador estaba
cerrado, la petición se recoge en el siguiente latido (hasta un minuto).

### Permisos

| Permiso | Para qué |
|---------|----------|
| `storage` | El token capturado y el estado del auto-renovador. |
| `tabs`, `activeTab` | Encontrar, recargar o abrir la pestaña de M365 Copilot. |
| `alarms` | El latido de 1 min del auto-renovador (en MV3 el background se duerme). |
| `cookies` | Borrar las cookies de sesión de Microsoft al cerrar sesión. |
| `browsingData` | Vaciar la caché de MSAL y el almacenamiento de las webs de Microsoft. |
| `http://localhost/*` | Enviar el token al servidor local de la extensión de VS Code. |
| `*://*.microsoftonline.com/*` y el resto de dominios de Microsoft | Las dos APIs anteriores exigen permiso sobre cada cookie y cada origen que tocan. La lista la define `signOut.ts` en `packages/core`. |

`cookies`, `browsingData` y los dominios de Microsoft son **nuevos**: al
actualizar, el navegador los vuelve a pedir y la extensión queda desactivada
hasta que los aceptes.

## Desarrollo

```bash
pnpm install            # desde la raíz del repositorio
pnpm dev                # Chrome/Edge con HMR
pnpm dev:firefox
pnpm build              # → ../../releases/chrome
pnpm zip && pnpm zip:firefox
pnpm sign:firefox       # .xpi firmado por Mozilla (AMO, unlisted): requiere WEB_EXT_API_KEY / WEB_EXT_API_SECRET
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

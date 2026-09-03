# M365 Copilot — Extensión de navegador

Captura tu token de **Microsoft 365 Copilot** mientras navegas normal y lo
mantiene sincronizado con la [extensión de VS Code](../vscode/README.md), sin
que tengas que copiar ni pegar nada. Es la forma recomendada de usar M365
Copilot en VS Code: una vez instalada y emparejada una vez, funciona sola.

## Qué hace, en corto

1. Detecta el token en cuanto usas M365 Copilot, Outlook, Teams o cualquier
   web de Office (`m365.cloud.microsoft`, `office.com`, `outlook.office.com`,
   `teams.microsoft.com`).
2. Lo manda automáticamente al servidor local que abre la extensión de VS
   Code (`http://localhost:51827`).
3. Lo vigila y lo renueva sola antes de que caduque (el token dura unos
   60–75 min), sin recargar nada si no hace falta.
4. Si VS Code está cerrado, no pasa nada: la extensión sigue capturando y
   reintenta enviarlo en cuanto lo detecte abierto.

Todo esto pasa en segundo plano. El icono de la barra de extensiones abre un
popup con el estado (token, endpoint, conexión con VS Code, renovación) y
unos pocos botones manuales por si algo falla o prefieres controlarlo tú.

## Cómo funciona por dentro

Tres piezas, cada una con un trabajo concreto:

- **`interceptor.content.ts`** corre en el contexto real de la página (mundo
  `MAIN`), donde puede engancharse a `WebSocket`, `fetch`, `XMLHttpRequest` y
  leer la caché de MSAL que la propia web de Microsoft guarda en
  `localStorage`/`sessionStorage`. Ahí es donde de verdad aparece el token: no
  hace falta ninguna acción tuya, sólo tener la pestaña abierta.
- **`content.ts`** es el puente hacia la extensión (mundo aislado): recibe lo
  que capturó el interceptor por `postMessage` y se lo pasa al background.
  Existe porque el mundo `MAIN` no tiene acceso a las APIs de la extensión
  (`chrome.runtime`).
- **`background.ts`** (service worker) guarda el token, decide cuándo hace
  falta renovarlo (`utils/refreshPolicy.ts`) usando `chrome.alarms` — el único
  reloj fiable en Manifest V3, porque Chrome duerme el service worker a los
  pocos segundos de inactividad — y lo envía al servidor local de VS Code.

La política de renovación es simple y en cascada: si al token le queda poco,
primero pide al interceptor que vuelva a mirar la caché de MSAL (la web ya
renueva sola cada ~50 min, así que muchas veces ya hay uno nuevo esperando);
si eso no basta, recarga la pestaña; si no hay ninguna pestaña abierta, abre
una en segundo plano; y si tras varios intentos seguidos no consigue nada,
avisa de que hace falta iniciar sesión a mano.

El token, el endpoint y compañía se guardan sólo en el almacenamiento local
de la extensión (`chrome.storage`) y sólo se envían a `localhost` (tu propia
extensión de VS Code) y a los dominios de Microsoft.

## Instalación

Todavía no está publicada en Chrome Web Store ni en Firefox Add-ons, así que
se instala "sin empaquetar" desde los `.zip` de cada versión:

1. Descarga `m365-copilot-vscode-extension-chrome.zip` (o `-firefox.zip`)
   desde la [última release en GitHub](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest),
   o compílalo tú mismo (ver [Desarrollo](#desarrollo)).
2. Descomprímelo.
3. **Chrome / Edge**: abre `chrome://extensions`, activa el **modo
   desarrollador** y pulsa **Cargar extensión sin empaquetar**, apuntando a
   la carpeta descomprimida.
4. **Firefox**: abre `about:debugging#/runtime/this-firefox` → **Cargar
   complemento temporal…** y elige el `manifest.json` de la carpeta
   descomprimida. (Firefox la olvida al cerrar el navegador; para algo
   permanente hace falta firmarla en addons.mozilla.org.)

Después, instala también la [extensión de VS Code](../vscode/README.md) —
sin ella no hay a quién enviarle el token.

## El popup

Al hacer clic en el icono de la extensión ves cuatro estados:

| Fila | Qué indica |
|------|------------|
| **Token** | Si hay uno capturado y cuánto le queda antes de caducar. |
| **Endpoint** | Si ya se capturó la URL del chat de Copilot (informativo). |
| **VS Code** | Si el servidor local de la extensión de VS Code responde ahora mismo. |
| **Renovación** | Qué está haciendo el auto-renovador en este momento (nada, buscando token nuevo, recargando la pestaña, esperando…). |

Y tres botones:

- **Enviar a VS Code** — reenvía el token guardado ya mismo, sin esperar al
  siguiente ciclo automático.
- **Copiar token** — lo copia al portapapeles, por si quieres pegarlo a mano
  con **«M365 Copilot: Pegar perfil o token»** en VS Code.
- **Renovar ahora** — fuerza un ciclo de renovación inmediato, saltándose la
  espera entre intentos.

## Desarrollo

```bash
pnpm install          # instala dependencias (todo el monorepo)
pnpm dev               # Chrome/Edge, con recarga en caliente
pnpm dev:firefox       # lo mismo, para Firefox

pnpm build              # build de producción → releases/chrome/chrome-mv3
pnpm build:firefox       # → releases/firefox/firefox-mv2
pnpm zip                 # build + .zip → releases/chrome/*.zip
pnpm zip:firefox         # build + .zip → releases/firefox/*.zip

pnpm typecheck
pnpm test               # refreshPolicy.ts y el ciclo completo de tokenRefresher.ts
```

En desarrollo, `pnpm dev` carga la extensión con recarga en caliente desde
`.output/chrome-mv3` (WXT gestiona el `chrome://extensions` por ti la primera
vez si le dejas). El bundler es Vite 8, que ya bundlea con **Rolldown** y
transforma con **Oxc** por debajo — ver la config compartida en
[`wxt.config.base.ts`](wxt.config.base.ts).

## Permisos del manifest, y por qué

| Permiso | Para qué |
|---------|----------|
| `storage` | Guardar el token capturado y el estado de renovación. |
| `tabs`, `activeTab` | Encontrar o abrir una pestaña de M365 cuando hace falta renovar. |
| `alarms` | El único reloj fiable en un service worker de Manifest V3 (Chrome lo duerme en segundos; sin `alarms` la renovación automática no puede despertarlo). |
| `host_permissions: http://localhost/*` | Hablar con el servidor local que abre la extensión de VS Code, sin bloqueo de CORS. |

No pide acceso a tus pestañas en general: los content scripts sólo se
inyectan en los dominios de Microsoft 365 listados arriba.

## Estructura

```
entrypoints/
├── background.ts               Service worker: guarda el token, decide cuándo renovar, lo envía a VS Code.
├── content.ts                  Puente (mundo aislado) entre el interceptor y el background.
├── interceptor.content.ts      Enganchado a fetch/WebSocket/XHR/MSAL (mundo MAIN): aquí se captura el token.
└── popup/                      Popup en React (estado + botones manuales).
utils/
├── tokenRefresher.ts           Orquesta el ciclo de renovación con chrome.alarms.
├── refreshPolicy.ts            Lógica pura (sin `chrome.*`) de cuándo y qué renovar — con tests.
├── storage.ts                  Envoltorio tipado sobre chrome.storage.
├── messaging.ts                Envoltorio tipado sobre chrome.runtime.sendMessage.
└── logger.ts
wxt.config.base.ts              Config de build compartida entre Chrome y Firefox.
wxt.config.ts / wxt.config.firefox.ts   Sólo lo que difiere por navegador (outDir).
```

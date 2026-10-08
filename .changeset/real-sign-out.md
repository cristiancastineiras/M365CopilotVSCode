---
"m365-copilot-vscode": minor
"m365-copilot-vscode-extension": minor
---

**Renovar de verdad: cerrar la sesión de Microsoft y volver a iniciarla.**

Hasta ahora todas las formas de «renovar» renovaban el *token*, y el token
nunca era el problema: lo entrega la sesión de Microsoft del navegador (cookies
de `login.microsoftonline.com` / `login.live.com` más la caché de tokens de
MSAL en `m365.cloud.microsoft`), y mientras esa sesión siga ahí, pedir otro
token lo entrega **en silencio**, sin mostrar nunca una pantalla de inicio de
sesión. Por eso no volvía a pedir la sesión en ningún sitio.

- Comando nuevo en VS Code, **M365 Copilot: Cerrar sesión y volver a entrar**
  (también en el menú rápido de la barra de estado): borra el token guardado,
  pide a la extensión de navegador el borrado completo y espera el token nuevo,
  que llega solo en cuanto vuelves a entrar. Resume lo que se borró («N cookies
  y los datos de M webs de Microsoft») y lo detalla en el registro.
- Botón nuevo en el popup de la extensión de navegador, **Cerrar sesión de
  Microsoft**, con confirmación en el propio botón.
- El borrado, por orden: pasa por los endpoints de cierre de sesión de
  Microsoft (Entra ID, cuenta personal y Office) **antes** de tocar nada local
  —necesitan las cookies para saber qué sesión cerrar en el servidor—, cierra
  las pestañas de Microsoft abiertas (una instancia de MSAL viva volvía a
  escribir su caché detrás del borrado), borra **todas las cookies** de los
  dominios de Microsoft en todos los contenedores de cookies, incluidas las
  particionadas, y vacía **localStorage, IndexedDB, Cache Storage, service
  workers y FileSystem** de cada web de Microsoft. Al terminar te deja en la
  pantalla de inicio de sesión.
- Los dos lados se coordinan por el servidor local: VS Code deja la petición
  con un identificador y abre el navegador con él en la URL; la extensión sólo
  obedece si ese identificador es el que VS Code tiene pendiente, porque una
  URL la puede enlazar cualquier web. Si el navegador estaba cerrado, la
  petición se recoge en el siguiente latido.
- Sin la extensión de navegador (sólo con el userscript, que no puede tocar
  cookies) VS Code lo dice pasados tres minutos y ofrece abrir a mano las
  páginas de cierre de sesión de Microsoft, que acaban con la mitad de la
  sesión que vive en el servidor: ya basta para que vuelva a pedir credenciales.
- La extensión de navegador pide dos permisos nuevos, `cookies` y
  `browsingData`, más los dominios de Microsoft: son los que la API exige para
  borrar cada cookie y cada origen. Al actualizar, el navegador los vuelve a
  pedir y la extensión queda desactivada hasta que se acepten. La caché HTTP
  global **no** se toca a propósito: no se puede limitar a unos dominios.

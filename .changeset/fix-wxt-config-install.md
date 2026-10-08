---
"m365-copilot-vscode-extension": patch
---

**Arreglado: `pnpm install` fallaba en un clon limpio, y con él la release de la v3.0.0.**

La configuración de WXT importaba la lista de dominios de Microsoft desde el
paquete `@m365copilot/core`, pero ese archivo lo carga `wxt prepare`, que corre
como **postinstall** de la extensión de navegador: durante el propio
`pnpm install`, cuando todavía nadie ha compilado nada. En un clon limpio
(CI, o cualquiera que acabe de clonar el repo) `packages/core/dist/index.js`
aún no existe, así que el install entero se caía con «Cannot find module» y la
release de la v3.0.0 nunca llegó a publicarse. En un repo ya trabajado no se
notaba, porque el `dist` estaba construido de antes.

Ahora la configuración importa el **fuente** (`packages/core/src/signOut`), que
existe siempre: el cargador de la configuración sabe leer TypeScript, así que
sigue habiendo una única fuente de verdad para los dominios sin depender de que
nada esté compilado.

# M365 Copilot para VS Code

[![Versión en VS Marketplace](https://flat.badgen.net/vs-marketplace/v/m365-copilot-vscode.m365-copilot-vscode?label=VS%20Marketplace&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Instalaciones](https://flat.badgen.net/vs-marketplace/i/m365-copilot-vscode.m365-copilot-vscode?label=instalaciones&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Descargas](https://flat.badgen.net/vs-marketplace/d/m365-copilot-vscode.m365-copilot-vscode?label=descargas&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Valoración](https://flat.badgen.net/vs-marketplace/rating/m365-copilot-vscode.m365-copilot-vscode?label=valoraci%C3%B3n&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode&ssr=false#review-details)

[![Última versión](https://img.shields.io/github/v/release/cristiancastineiras/M365CopilotVSCode?label=versi%C3%B3n&logo=github&color=24292f)](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest)
[![Compilación](https://img.shields.io/github/actions/workflow/status/cristiancastineiras/M365CopilotVSCode/release.yml?label=compilaci%C3%B3n&logo=githubactions&logoColor=white)](https://github.com/cristiancastineiras/M365CopilotVSCode/actions/workflows/release.yml)
[![Descargas en GitHub](https://img.shields.io/github/downloads/cristiancastineiras/M365CopilotVSCode/total?label=descargas%20en%20GitHub&logo=github&color=24292f)](https://github.com/cristiancastineiras/M365CopilotVSCode/releases)
[![Estrellas](https://img.shields.io/github/stars/cristiancastineiras/M365CopilotVSCode?label=estrellas&logo=github&color=e3b341&style=flat)](https://github.com/cristiancastineiras/M365CopilotVSCode/stargazers)
[![Incidencias](https://img.shields.io/github/issues/cristiancastineiras/M365CopilotVSCode?label=incidencias&logo=github)](https://github.com/cristiancastineiras/M365CopilotVSCode/issues)
[![Licencia: AGPL-3.0](https://img.shields.io/github/license/cristiancastineiras/M365CopilotVSCode?label=licencia&color=blue)](LICENSE)
[![Architecture diagram](https://gitdiagram.com/diagram-badge.svg)](https://gitdiagram.com/cristiancastineiras/m365copilotvscode?utm_source=readme&utm_medium=badge)

[English](README.md) · **Español**

**Web:** <https://cristiancastineiras.github.io/M365CopilotVSCode/es/> — descargas, guía paso a paso y preguntas frecuentes (código en [`extensiones/web`](extensiones/web), hecha con Hugo y publicada por [`pages.yml`](.github/workflows/pages.yml)).

Monorepo (pnpm workspaces + Turborepo) de las piezas que llevan tu suscripción
de **Microsoft 365 Copilot** a VS Code — como modelos del chat, el participante
`@m365`, acciones del editor y de Source Control, un autocommit que commitea
el trabajo terminado con mensajes documentados, revisión de código como
comentarios en las líneas, una cuenta en el menú Cuentas de VS Code,
herramientas de agente, un índice local del proyecto (RAG) que le da el contexto
de tu código, búsqueda web y autocompletado en línea — y mantienen su token
sincronizado. Todo está
disponible en **inglés y español**.

> **Aviso Legal**
>
> M365CopilotVSCode es un proyecto independiente de código abierto y no está afiliado, respaldado, patrocinado ni aprobado por Microsoft Corporation.
>
> Los usuarios son responsables de cumplir todos los términos, licencias y políticas aplicables de Microsoft al utilizar este software.
>
> Este software se proporciona "TAL CUAL" ("AS IS"), sin garantías de ningún tipo, ya sean expresas o implícitas.

```
.
├── extensiones/
│   ├── browser/     Extensión de navegador (WXT + React). Captura el token en
│   │                la web de Copilot y lo envía al servidor local de VS Code.
│   └── vscode/      Extensión de VS Code. Levanta el servidor local, guarda el
│                    perfil y expone Copilot en el chat y en el editor.
├── packages/
│   ├── core/        @m365copilot/core — lógica y CONTRATOS compartidos. La
│   │                raíz (tipos del perfil, decodificación de JWT, clasificación
│   │                de token, constantes del servidor local) es segura para el
│   │                navegador; `/bizchat` es la capa de protocolo para Node —
│   │                cliente BizChat, protocolo de herramientas, catálogo de
│   │                modelos, i18n— sobre la que se construye cada cliente.
│   └── tui/         Chat en el terminal. Cliente de `@m365copilot/core/bizchat`.
├── turbo.json       Pipeline de tareas (build/dev/typecheck/test…).
├── tsconfig.base.json  Opciones de TypeScript comunes.
└── pnpm-workspace.yaml
```

| Paquete                | Documentación                                                                  |
| ---------------------- | ------------------------------------------------------------------------------ |
| Extensión de VS Code   | [README](extensiones/vscode/README.es.md) · [guía](extensiones/vscode/Guia.md) |
| Extensión de navegador | [README](extensiones/browser/README.es.md)                                     |

## Primeros pasos

```bash
pnpm install
pnpm build        # core → extensión de VS Code → extensión de navegador
pnpm test
pnpm package      # .vsix, zips de Chrome/Edge/Firefox y userscript en releases/
```

Requiere Node ≥ 22.18 y pnpm 10.

`releases/` está en `.gitignore`: los artefactos oficiales (VS Code, Chrome,
Edge, Firefox y el userscript de Tampermonkey) los genera
[`.github/workflows/release.yml`](.github/workflows/release.yml) al subir un
tag `vX.Y.Z` y sólo se publican en las
[releases de GitHub](https://github.com/cristiancastineiras/M365CopilotVSCode/releases).

## Idiomas

- **Extensión de VS Code:** `m365copilot.language` = `auto` (sigue el idioma de
  VS Code) / `en` / `es`. Cambia notificaciones, barra de estado, resultados de
  herramientas y las instrucciones que se envían al modelo. Los textos del
  manifiesto (comandos, ajustes, primeros pasos) salen de `package.nls.json` /
  `package.nls.es.json`.
- **Extensión de navegador:** sigue el idioma del navegador; textos del
  manifiesto en `public/_locales/`, de la interfaz en `utils/i18n.ts`.
- **Userscript:** sigue el idioma del navegador.
- **Documentación:** cada README/guía tiene versión en inglés y en español.

## Actualizar los modelos

[`models.json`](models.json) es el catálogo de modelos en línea que descarga la
extensión de VS Code (al arrancar y cada 12 h): añade una entrada — `tone` tal
como lo envía la web de M365 Copilot, más `name` y un `detail` en `en`/`es` — y
haz push a `main`; todos los usuarios la reciben sin publicar versión.
`"hidden": true` retira un modelo, aunque venga de serie. Los tests comprueban
que el archivo se puede leer.

## Publicar una versión

Las versiones se gestionan con [Changesets](https://github.com/changesets/changesets);
los tres paquetes suben siempre juntos.

```bash
pnpm changeset          # describe el cambio
pnpm version-packages   # sube versiones + CHANGELOGs
git commit -am "chore: release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags
```

El push del tag lanza `.github/workflows/release.yml`, que compila todo y publica
una release de GitHub con el `.vsix` y los dos zips del navegador.

# M365 Copilot → VS Code · Monorepo

[English](README.md) · **Español**

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
│   └── core/        @m365copilot/core — lógica y CONTRATOS compartidos:
│                    tipos del perfil, decodificación de JWT, clasificación de
│                    token y las constantes del servidor local (puerto/ruta).
├── turbo.json       Pipeline de tareas (build/dev/typecheck/test…).
├── tsconfig.base.json  Opciones de TypeScript comunes.
└── pnpm-workspace.yaml
```

| Paquete | Documentación |
|---------|---------------|
| Extensión de VS Code | [README](extensiones/vscode/README.es.md) · [guía](extensiones/vscode/Guia.md) |
| Extensión de navegador | [README](extensiones/browser/README.es.md) |

## Primeros pasos

```bash
pnpm install
pnpm build        # core → extensión de VS Code → extensión de navegador
pnpm test
pnpm package      # .vsix + zips de Chrome/Firefox en releases/
```

Requiere Node ≥ 22.18 y pnpm 10.

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

# M365 Copilot → VS Code · Monorepo

Usa tu suscripción de **Microsoft 365 Copilot** como un proveedor de modelos
más en el chat de VS Code (junto a GitHub Copilot, Claude, etc.), sin
dashboard ni configuración compleja. Este repo tiene las dos piezas que lo
hacen posible:

- **[extensiones/browser](extensiones/browser/README.md)** — extensión de
  navegador (Chrome/Edge y Firefox). Captura tu token de M365 Copilot sola
  mientras navegas por Office/Outlook/Teams, lo renueva antes de que caduque
  y lo sincroniza con VS Code sin que tengas que copiar ni pegar nada.
- **[extensiones/vscode](extensiones/vscode/README.md)** — extensión de VS
  Code. Recibe ese token en un servidor local, y lo usa para registrar
  «M365 Copilot» como modelo de chat, con autocompletado en línea y
  herramientas de agente (leer/editar archivos, terminal, git…).

Ambas comparten **[packages/core](packages/core/CHANGELOG.md)**
(`@m365copilot/core`): los tipos del perfil, la decodificación de JWT y las
constantes del servidor local (puerto y rutas), para que las dos piezas
nunca se desincronicen entre sí.

Si sólo quieres **usarlo**, empieza por la
[guía de instalación](extensiones/vscode/Guia.md) o directamente por el
[README de la extensión de VS Code](extensiones/vscode/README.md#uso). Si
quieres **tocar el código**, sigue leyendo.

## Estructura

```
.
├── extensiones/
│   ├── browser/     Extensión de navegador (WXT + React + Rolldown/Oxc).
│   └── vscode/      Extensión de VS Code (tsdown/rolldown, CJS).
├── packages/
│   └── core/        @m365copilot/core — lógica y contratos compartidos.
├── .github/workflows/release.yml   Release automática al hacer push de un tag.
├── turbo.json        Pipeline de tareas (build/dev/typecheck/lint/test).
├── tsconfig.base.json  Opciones de TypeScript comunes.
└── pnpm-workspace.yaml
```

## Desarrollo

Requisitos: Node ≥ 20 y pnpm (el repo fija la versión exacta en
`packageManager`; con Corepack activado (`corepack enable`) se instala sola).

```bash
pnpm install       # dependencias de los 3 paquetes
pnpm build         # compila los 3 (turbo respeta el orden: core antes que las extensiones)
pnpm dev           # watch de los 3 a la vez
pnpm typecheck
pnpm lint
pnpm test
```

Cada paquete tiene también sus propios comandos — ver su README
([browser](extensiones/browser/README.md#desarrollo),
[vscode](extensiones/vscode/README.md#desarrollo)).

## Cómo sacar una versión nueva

Los tres paquetes suben de versión **juntos** (van en un grupo `fixed` de
[Changesets](https://github.com/changesets/changesets)), así que un solo tag
libera todo a la vez: el `.vsix` de VS Code y los `.zip` de Chrome y Firefox,
cada uno con su changelog.

```bash
pnpm changeset            # describe el cambio (te hace un par de preguntas)
pnpm version-packages      # sube la versión y actualiza los 3 CHANGELOG.md
git add -A && git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z && git push --follow-tags
```

En cuanto el tag llega a GitHub, el workflow
[`release.yml`](.github/workflows/release.yml) compila y empaqueta las dos
extensiones y publica una **release de GitHub** con los tres artefactos
(`.vsix`, `.zip` de Chrome, `.zip` de Firefox) y las notas de versión
generadas a partir de los `CHANGELOG.md`.

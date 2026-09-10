# M365 Copilot → VS Code · Monorepo

Monorepo (pnpm workspaces + Turborepo) de las dos piezas que llevan tu token de
**Microsoft 365 Copilot** a VS Code y lo mantienen sincronizado.

```
.
├── extensiones/
│   ├── browser/     Extensión de navegador (WXT + React). Captura el token en
│   │                la web de Copilot y lo envía al servidor local de VS Code.
│   └── vscode/      Extensión de VS Code. Levanta el servidor local, guarda el
│                    perfil y expone Copilot como proveedor de modelos.
├── packages/
│   └── core/        @ms365copilot/core — lógica y CONTRATOS compartidos:
│                    tipos del perfil, decodificación de JWT, clasificación de
│                    token y las constantes del servidor local (puerto/ruta).
├── turbo.json       Pipeline de tareas (build/dev/typecheck/…).
├── tsconfig.base.json  Opciones de TypeScript comunes.
└── pnpm-workspace.yaml
```

# @m365copilot/core

## 1.3.0

### Minor Changes

- Añade delegación en sub-agentes (`ms365_spawn_agents`) para tareas independientes en paralelo, y dos herramientas de git: `ms365_generate_commit_message` (dispara la función nativa de VS Code de generar mensaje de commit) y `ms365_git_commit` (crea el commit, validando Conventional Commits, con confirmación explícita del usuario).

## 1.0.3

### Patch Changes

- Corrige el empaquetado de la extensión de VS Code añadiendo el campo `repository`, necesario para que `vsce` resuelva los enlaces relativos del README.

## 1.0.2

### Patch Changes

- Corrige el workflow de release (Node 22 en CI, requerido por tsdown 0.22).

## 1.0.1

### Patch Changes

- Primera release publicada mediante el pipeline de GitHub Actions.

## 1.0.0

Primera versión.

- Tipos y contratos del perfil capturado (`CopilotProfile`, `TokenClaims`).
- Decodificación de JWT y extracción de claims (`decodeJwtPayload`, `extractClaims`).
- Comprobación de validez/caducidad del token (`isTokenUsable`, `minutesUntilExpiry`, `isSydneyToken`).
- Constantes del servidor local compartidas por las dos extensiones (puerto, rutas, claves de almacenamiento).

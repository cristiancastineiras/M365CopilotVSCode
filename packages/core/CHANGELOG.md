# @m365copilot/core

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

# @m365copilot/core

## 1.0.0

Primera versión.

- Tipos y contratos del perfil capturado (`CopilotProfile`, `TokenClaims`).
- Decodificación de JWT y extracción de claims (`decodeJwtPayload`, `extractClaims`).
- Comprobación de validez/caducidad del token (`isTokenUsable`, `minutesUntilExpiry`, `isSydneyToken`).
- Constantes del servidor local compartidas por las dos extensiones (puerto, rutas, claves de almacenamiento).

# m365-copilot-vscode-extension

## 1.0.2

### Patch Changes

- Corrige el workflow de release (Node 22 en CI, requerido por tsdown 0.22).
- Updated dependencies
  - @m365copilot/core@1.0.2

## 1.0.1

### Patch Changes

- Primera release publicada mediante el pipeline de GitHub Actions.
- Updated dependencies
  - @m365copilot/core@1.0.1

## 1.0.0

Primera versión pública.

- Captura automática del token de M365 Copilot mientras navegas por `m365.cloud.microsoft`, Office, Outlook o Teams — sin userscript ni copiar/pegar.
- Renovación automática del token en segundo plano (re-escaneo de la caché de MSAL, recarga de la pestaña o apertura de una nueva si hace falta), con reintentos y backoff.
- Envío automático del token a la extensión de VS Code en cuanto hay uno nuevo, más botones manuales (copiar token, copiar perfil, reenviar, forzar renovación) en el popup.
- Compatible con Chrome/Edge (MV3) y Firefox (MV2).

# m365-copilot-vscode-extension

## 1.0.0

Primera versión pública.

- Captura automática del token de M365 Copilot mientras navegas por `m365.cloud.microsoft`, Office, Outlook o Teams — sin userscript ni copiar/pegar.
- Renovación automática del token en segundo plano (re-escaneo de la caché de MSAL, recarga de la pestaña o apertura de una nueva si hace falta), con reintentos y backoff.
- Envío automático del token a la extensión de VS Code en cuanto hay uno nuevo, más botones manuales (copiar token, copiar perfil, reenviar, forzar renovación) en el popup.
- Compatible con Chrome/Edge (MV3) y Firefox (MV2).

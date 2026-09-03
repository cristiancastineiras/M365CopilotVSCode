# m365-copilot-vscode

## 1.0.3

### Patch Changes

- Corrige el empaquetado de la extensión de VS Code añadiendo el campo `repository`, necesario para que `vsce` resuelva los enlaces relativos del README.
- Updated dependencies
  - @m365copilot/core@1.0.3

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

- M365 Copilot como proveedor de modelos en el chat de VS Code (Auto, GPT, Claude Sonnet, Reasoning).
- Protocolo de llamada a herramientas sobre texto plano: el modelo puede usar tanto las herramientas propias (`m365_*`) como las nativas de VS Code, de MCP y de otras extensiones activas en el turno.
- Edición con revisión Keep/Undo directamente en el editor, sin guardar en disco hasta confirmar.
- Autocompletado en línea (texto fantasma) opcional.
- Sincronización automática del token con la extensión de navegador (o manual, pegando el token capturado con el userscript).

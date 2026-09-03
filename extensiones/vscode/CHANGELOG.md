# m365-copilot-vscode

## 1.0.0

Primera versión pública.

- M365 Copilot como proveedor de modelos en el chat de VS Code (Auto, GPT, Claude Sonnet, Reasoning).
- Protocolo de llamada a herramientas sobre texto plano: el modelo puede usar tanto las herramientas propias (`m365_*`) como las nativas de VS Code, de MCP y de otras extensiones activas en el turno.
- Edición con revisión Keep/Undo directamente en el editor, sin guardar en disco hasta confirmar.
- Autocompletado en línea (texto fantasma) opcional.
- Sincronización automática del token con la extensión de navegador (o manual, pegando el token capturado con el userscript).

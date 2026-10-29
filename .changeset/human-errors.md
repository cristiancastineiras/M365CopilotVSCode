---
"m365-copilot-vscode": patch
"@m365copilot/core": patch
---

**Los errores se leen como una frase, no como un volcado técnico.**

- **Sin pila en el chat:** cuando una petición falla, el chat de Copilot ya no
  añade la traza (`Error: … at serviceResultError (client.ts:357)…`) tras el
  motivo; sólo queda el mensaje.
- **Mensajes más claros:** fuera los códigos (`PerUserThrottled`, `401
  Unauthorized`, `403 Forbidden`, `429`, el código de cierre del socket) y la
  cita repetida del servidor cuando el mensaje ya explica lo que pasa (límite de
  peticiones, cuota, licencia). Los códigos siguen en el error y en la traza del
  modo debug profundo.

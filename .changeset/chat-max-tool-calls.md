---
"m365-copilot-vscode": patch
---

**`@m365` ya no se detiene a las 10 llamadas a herramientas: el límite es un ajuste y se puede continuar con un clic.**

- **Ajuste nuevo `m365copilot.chat.maxToolCalls`:** llamadas a herramientas por
  petición antes de detenerse. Sube de 10 a 30 por defecto; `0` quita el límite
  (la petición se detiene igualmente a los 8 minutos). `/explain` y `/terminal`
  conservan sus límites cortos (4 y 6).
- **Botón «Continuar»:** si una petición se corta por el límite de llamadas o de
  tiempo, el chat ofrece continuarla en vez de pedir que lo escribas, y el aviso
  indica el ajuste que lo controla.

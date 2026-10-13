---
"m365-copilot-vscode": patch
---

**Mejores mensajes de commit, tanto en el botón ✨ de Source Control como en el autocommit.**

- **Convenciones del repositorio:** el modelo ve los últimos 30 subjects (sin
  merges) y los ámbitos que usan con cuántas veces, para reutilizarlos en vez
  de inventar otros. El botón de Source Control antes no veía nada del
  historial.
- **Instrucciones más precisas:** cómo elegir el tipo y el ámbito, un subject
  concreto (nunca «actualizar archivos»), un cuerpo que explica el porqué y el
  cambio de comportamiento, `!` + `BREAKING CHANGE:` para los cambios
  incompatibles, y nada inventado que el diff no muestre. Si todos los commits
  recientes están en otro idioma, el mensaje sigue ese idioma.
- **El cambio entero a la vista:** cada archivo con sus líneas añadidas y
  quitadas; con diffs grandes el presupuesto se reparte entre archivos en vez
  de cortar los últimos, y los lockfiles y archivos generados se quedan en su
  recuento. Sin nada en stage, el botón ahora ve el contenido de los archivos
  nuevos, no sólo su nombre.
- **Pulido automático:** `Feat:` → `feat:`, alias como `feature`/`bugfix`,
  sin punto final, cuerpo reflujado a 72 columnas y sin firmas ni coautores de
  asistentes. Si el mensaje sigue sin cumplir Conventional Commits, el botón se
  lo devuelve al modelo una vez con el motivo.
- **Ticket de la rama:** `feature/ABC-123-…` o `fix/42-…` añaden
  `Refs: ABC-123` / `Refs: #42` al final del mensaje.
- Los ámbitos con letras no ASCII (`fix(configuración): …`) ya son válidos.

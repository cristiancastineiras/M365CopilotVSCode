---
"m365-copilot-vscode": patch
---

**El agente ya no pierde la tarea y los prompts van más comprimidos.**

- **Petición fijada:** en modo agente, cada resultado de herramienta (hasta
  12 KB) se comía el presupuesto del historial (48 KB) y, tras unos 4 pasos, la
  petición del usuario era lo primero que se descartaba. Ahora se queda siempre,
  marcada como «petición actual»; los dos últimos resultados van enteros, los
  anteriores se recortan a su principio y uno repetido tal cual más adelante se
  queda en una línea que remite a él. Los mensajes que sólo traen resultados se
  etiquetan como tales, no como si los hubiera escrito el usuario. En una sesión
  de 12 lecturas de 10 KB: antes 48 KB, sin la petición y con 5 de 12 pasos
  visibles; ahora 40 KB, con la petición y los 12 pasos.
- **Lo mismo en `@m365` y los sub-agentes:** sus resultados antiguos se recortan
  en vez de que se caigan los primeros pasos.
- **Entorno en el prompt:** sistema y shell (Windows PowerShell 5.1 avisa de que
  no hay `&&`), la raíz absoluta del workspace (las herramientas nativas piden
  rutas absolutas y el modelo no la conocía) y la fecha.
- **Catálogo de herramientas más ligero y sin contradicciones:** una
  herramienta duplicada de una nativa va en una línea con su firma; las reglas y
  el ejemplo de `m365_apply_edits` sólo salen si es la herramienta de edición
  preferida; los ejemplos nunca enseñan la duplicada; `workspaceFolder` se omite
  en workspaces de una carpeta. En modo agente: de ~15,5 a ~12,5 mil caracteres.
- **Seguimientos cortos** («ahora el otro»): el índice del proyecto se busca
  también con la petición anterior.

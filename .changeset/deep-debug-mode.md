---
"m365-copilot-vscode": patch
---

**Modo debug profundo: una consola que traza todo lo que la extensión recibe, envía y hace, y un registro exportable a `.txt`.**

- **Un ajuste y un botón:** `m365copilot.debug.deep` (con enlaces en su
  descripción a _Mostrar consola_, _Exportar registro_ y _Limpiar registro_),
  una entrada en el menú rápido del elemento **M365** y el comando _Alternar
  modo debug profundo_. Al activarlo se abre la consola «M365 Copilot» y el
  elemento de la barra de estado lleva un 🐞 para que no se olvide encendido.
- **Lo que recibe:** cada petición al servidor local (método, URL, comprobación
  de origen, cabeceras, cuerpo y respuesta) y cada trama que BizChat devuelve
  (tipo, tamaño, tiempo desde el inicio del turno, contenido completo).
- **Lo que envía y adónde:** endpoint, cabeceras, upgrade y handshake de la
  conexión, el prompt exacto como texto legible, la descarga del catálogo de
  modelos, cada proceso `git` y comando de shell (carpeta, código de salida,
  salida, tiempo), los temporizadores que cortan un turno y los reintentos.
- **Lo que hace:** cada petición de chat de VS Code (mensajes, herramientas
  ofrecidas, modo elegido), las herramientas con su entrada y su resultado, los
  comandos, las ediciones propuestas y su Keep/Undo, el contexto del índice, el
  autocompletado, el autocommit, el estado del token y cada cambio de ajustes,
  precedido de una foto del entorno (versiones, sistema, workspace, ajustes y
  perfil sin el token).
- **Exportar a `.txt`:** _Exportar registro (.txt)_ guarda lo que hay en un
  búfer circular (últimas ~40 000 entradas, ~8 MB) con una cabecera y la hora UTC
  de cada entrada; _Limpiar registro_ lo vacía para reproducir un problema desde
  cero. Funciona también con el modo apagado (guarda el registro normal).
- **Seguro de compartir, con matices:** los tokens, los JWT, las cabeceras
  `Authorization`, las cookies y los `access_token=` se ocultan siempre, en la
  consola y en el archivo. Los prompts, las respuestas y las rutas no: el aviso
  al exportar lo dice.
- **Sin coste cuando está apagado:** `debug()` es una comprobación booleana y
  los datos se construyen sólo si el modo está encendido.

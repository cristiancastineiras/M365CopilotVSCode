---
"m365-copilot-vscode": minor
"m365-copilot-vscode-extension": minor
"@m365copilot/core": minor
---

**It understands your project (local RAG index) and can search the internet again.**

- **Project index:** a local index of the workspace — no embeddings service, nothing leaves the machine but what a request includes. It honours `.gitignore`, `files.exclude`, `search.exclude` and `m365copilot.index.exclude`, skips binaries, lock files and generated code, knows each file's symbols (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#, C/C++, PHP, Ruby, shell, SQL, Markdown) and imports — resolved to files, monorepo packages and `@/` aliases included — and ranks code with BM25 over identifier-aware terms, with boosts for file and symbol names, query coverage and closeness to the active file. Questions in Spanish find English code. It builds in the background and updates file by file.
- **Automatic context:** every chat request (M365 models and `@m365`) carries a short project map and the most relevant code (`m365copilot.context.autoRetrieve`, `m365copilot.context.maxChars`); `@m365` commands add the code around the selection.
- **Agent tools:** `m365_search_project` (ranked code search) and `m365_project_map` (structure, packages, entry points, most imported modules; or a file's outline, imports and importers).
- **Commands:** *Search the project…*, *Show project map*, *Rebuild project index* (also in the M365 menu). Settings `m365copilot.index.*`.
- **Web search:** chat turns from VS Code had no internet (the lean request has no web plugins). `m365_web_search` runs a separate turn the way the web app does — the request captured by the browser extension or the userscript, with web search — and returns the answer with its sources; requests without tools (Ask mode) go out that way directly and list the sources, falling back to a plain answer if BizChat rejects it. Setting `m365copilot.web.enabled`.

---

**Entiende tu proyecto (índice RAG local) y vuelve a poder buscar en internet.**

- **Índice del proyecto:** un índice local del workspace — sin servicio de embeddings; no sale del equipo más que lo que incluye una petición. Respeta `.gitignore`, `files.exclude`, `search.exclude` y `m365copilot.index.exclude`, se salta binarios, lockfiles y código generado, conoce los símbolos de cada archivo (TypeScript/JavaScript, Python, Go, Rust, Java/Kotlin/C#, C/C++, PHP, Ruby, shell, SQL, Markdown) y sus imports — resueltos a archivos, incluidos los paquetes del monorepo y los alias `@/` — y ordena el código con BM25 sobre términos que entienden identificadores, puntuando más los nombres de archivo y de símbolo, la cobertura de la pregunta y la cercanía al archivo activo. Las preguntas en español encuentran código en inglés. Se construye en segundo plano y se actualiza archivo a archivo.
- **Contexto automático:** cada petición del chat (modelos M365 y `@m365`) lleva un mapa breve del proyecto y el código más relevante (`m365copilot.context.autoRetrieve`, `m365copilot.context.maxChars`); los comandos de `@m365` añaden el código de alrededor de la selección.
- **Herramientas del agente:** `m365_search_project` (búsqueda de código por relevancia) y `m365_project_map` (estructura, paquetes, puntos de entrada, módulos más importados; o el esquema, imports y quién importa un archivo).
- **Comandos:** *Buscar en el proyecto…*, *Ver el mapa del proyecto*, *Reconstruir el índice del proyecto* (también en el menú M365). Ajustes `m365copilot.index.*`.
- **Búsqueda web:** los turnos de chat desde VS Code no tenían internet (la petición mínima no lleva los plugins web). `m365_web_search` hace un turno aparte como lo hace la web — con la petición capturada por la extensión de navegador o el userscript, con búsqueda web — y devuelve la respuesta con sus fuentes; las peticiones sin herramientas (modo Ask) salen así directamente y listan las fuentes, con una respuesta normal si BizChat la rechaza. Ajuste `m365copilot.web.enabled`.

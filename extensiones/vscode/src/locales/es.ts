/**
 * Catálogo en español. Su tipo obliga a tener EXACTAMENTE las mismas claves
 * que locales/en.ts (una que falte o sobre es un error de compilación), y el
 * test de paridad de test/e2e.mts comprueba además que cada mensaje use los
 * mismos marcadores `{0}`, `{1}`… que su versión en inglés.
 *
 * Los textos `prompt.*`, `protocol.*`, `hint.*`, etc. los lee el MODELO: son
 * los que ya estaban afinados contra BizChat, conservados tal cual.
 */
import type { en } from "./en";

export const es: Record<keyof typeof en, string> = {
  // ------------------------------------------------------------ activación
  "ext.activated": "Extensión M365 Copilot activada. Registro de diagnóstico en: {0}",
  // ------------------------------------------------------------ modo debug profundo
  "debug.enabled":
    "🐞 Modo debug profundo ACTIVADO: todo lo que la extensión recibe, envía y hace se traza en esta consola. Los tokens se ocultan; los prompts, las respuestas y las rutas, no. Expórtalo con «M365 Copilot: Exportar registro (.txt)».",
  "debug.disabled": "🐞 Modo debug profundo DESACTIVADO.",
  "debug.toggledOn":
    "Modo debug profundo activado: la consola «M365 Copilot» traza ahora todo lo que hace la extensión.",
  "debug.toggledOff": "Modo debug profundo desactivado.",
  "debug.toggleFailed": "No se pudo cambiar el ajuste: {0}",
  "debug.button.show": "Mostrar consola",
  "debug.button.export": "Exportar registro (.txt)",
  "debug.export.title": "Exportar el registro de M365 Copilot",
  "debug.export.filter": "Texto",
  "debug.export.save": "Exportar",
  "debug.export.empty": "El registro está vacío: todavía no hay nada que exportar.",
  "debug.export.saved":
    "Registro guardado en {0}. Los tokens están ocultos, pero lleva prompts, respuestas y rutas: léelo antes de compartirlo.",
  "debug.export.open": "Abrir",
  "debug.export.reveal": "Mostrar en la carpeta",
  "debug.export.failed": "No se pudo guardar el registro: {0}",
  "debug.cleared": "Registro limpiado.",

  "ext.languageChanged":
    "M365 Copilot ahora habla {0}. Los títulos de comandos y ajustes siguen el idioma de visualización de VS Code.",

  // ------------------------------------------------------------ idiomas
  "language.en": "inglés",
  "language.es": "español",
  "language.auto": "Automático (idioma de VS Code: {0})",
  "language.pick.title": "M365 Copilot — idioma",
  "language.pick.placeholder":
    "Idioma de los mensajes, de los resultados de herramientas y de los prompts que se envían al modelo",

  // ------------------------------------------------------------ perfil / token
  "paste.title": "M365 Copilot — pegar perfil o token",
  "paste.prompt":
    "Pega el token capturado con la extensión de navegador o el userscript, o la URL del WebSocket «Chathub» copiada de DevTools (el «perfil completo» JSON también vale: sólo se usa su accessToken).",
  "paste.placeholder": "eyJ…  o  wss://…/Chathub/…?access_token=eyJ…",
  "paste.validFor": ", válido ~{0} min",
  "paste.fromClipboard": "Hay un token en el portapapeles — pulsa Intro para usarlo, o pega otro.",
  "paste.ready":
    "M365 Copilot listo{0}{1}. Elige un modelo «M365 Copilot» en el chat o escribe @m365.",
  "paste.openChat": "Abrir chat",
  "paste.failed": "No se pudo guardar el perfil: {0}",
  "paste.foreignAudience":
    "Este no es el token de M365 Copilot: es para {0}. Con él todos los mensajes fallan con 401.",
  "paste.foreignAudience.detail":
    "El token de Copilot no viaja en una cabecera «Authorization: Bearer», sino en la URL del WebSocket del chat. " +
    "En m365.cloud.microsoft/chat abre DevTools (F12) → Red, escribe chathub en el filtro, envía un mensaje, clic derecho " +
    "en la petición que aparece → Copiar → Copiar URL, y pega esa URL aquí.",
  "paste.foreignAudience.useAnyway": "Usarlo igualmente",
  // ------------------------------------- cerrar sesión / renovación de verdad
  "signOut.confirm": "¿Cerrar la sesión de Microsoft y volver a entrar?",
  "signOut.confirm.detail":
    "Borra el token guardado Y la sesión de Microsoft del navegador: las cookies de login.microsoftonline.com, " +
    "la caché de tokens de MSAL y los datos de las webs de M365 Copilot, Outlook, Teams, Office y Bing. Cierra " +
    "además la sesión en el servidor de Microsoft, así que la próxima visita pedirá tus credenciales.\n\n" +
    "Es la única renovación que renueva de verdad: pedir otro token reutiliza la misma sesión, que lo entrega en " +
    "silencio sin volver a mostrar ninguna pantalla de inicio de sesión.\n\n" +
    "Quien borra es la extensión de navegador — el userscript de Tampermonkey no puede tocar las cookies.",
  "signOut.confirm.button": "Cerrar sesión",
  "signOut.progress": "Cerrando la sesión de Microsoft en el navegador…",
  "signOut.done":
    "Sesión de Microsoft cerrada: {0} cookies y los datos de {1} webs de Microsoft borrados.",
  "signOut.partial":
    "{0} Hubo {1} cosa(s) que no se pudieron borrar; la sesión queda cerrada igualmente.",
  "signOut.signInAnyway": "Volver a entrar",
  "signOut.showLog": "Ver el registro",
  "signOut.waitingToken":
    "Inicia sesión en M365 Copilot en el navegador: el token nuevo llega solo…",
  "signOut.tokenPending":
    "M365 Copilot: inicia sesión en el navegador y el token nuevo llegará por su cuenta.",
  "signOut.timeout": "El navegador no ha confirmado el cierre de sesión.",
  "signOut.timeout.detail":
    "El token guardado se ha borrado, pero nadie ha limpiado la sesión del navegador: instala la extensión de " +
    "navegador de M365 Copilot (el userscript no puede borrar cookies) o usa su botón «Cerrar sesión de " +
    "Microsoft».\n\nLas propias páginas de cierre de sesión de Microsoft también acaban con la sesión, y eso ya " +
    "basta para que te vuelva a pedir las credenciales:\n{0}",
  "signOut.openLogout": "Abrir el cierre de sesión de Microsoft",
  "clear.confirm": "¿Borrar el token de M365 Copilot guardado?",
  "clear.confirmButton": "Borrar",
  "clear.done": "Token de M365 Copilot borrado.",
  "status.noToken": "M365 Copilot: sin token. Ejecuta «M365 Copilot: Pegar perfil o token».",
  "status.user": "Usuario: {0}",
  "status.unknownUser": "(desconocido)",
  "status.state": "Estado: {0}",
  "status.tokenValid": "token válido",
  "status.tokenExpired": "token CADUCADO",
  "status.minutesLeft": "{0} min restantes",
  "status.expiredAgo": "caducó hace {0} min",
  "status.captured": "Capturado: {0}",
  "status.openM365": "Abrir M365 Copilot",

  // ------------------------------------------------------------ barra de estado
  "statusbar.tooltip.title": "M365 Copilot",
  "statusbar.tooltip.account": "Cuenta: {0}",
  "statusbar.tooltip.tokenValid": "Token válido · quedan {0} min",
  "statusbar.tooltip.tokenValidNoExpiry": "Token válido",
  "statusbar.tooltip.tokenExpired": "Token caducado hace {0} min",
  "statusbar.tooltip.tokenMissing": "Sin token todavía — pega uno para empezar",
  "statusbar.tooltip.completionsOn": "Autocompletado en línea: activado",
  "statusbar.tooltip.completionsOff": "Autocompletado en línea: desactivado",
  "statusbar.tooltip.busy": "Pensando una sugerencia…",
  "statusbar.tooltip.debug": "Modo debug profundo activado: se está trazando todo",
  "statusbar.tooltip.throttled":
    "M365 Copilot está limitando tu cuenta: peticiones automáticas en pausa hasta {0} aprox.",
  "statusbar.tooltip.pendingEdits": "Cambios del agente pendientes de revisar: {0}",
  "statusbar.tooltip.click": "Clic para abrir el menú de M365 Copilot.",
  "statusbar.renewed": "M365 Copilot: token renovado automáticamente (quedan {0} min).",

  // ------------------------------------------------------------ menú rápido
  "menu.title": "M365 Copilot",
  "menu.placeholder": "Elige una acción",
  "menu.paste": "Pegar perfil o token",
  "menu.paste.detail": "Guarda el token capturado en el navegador (SecretStorage cifrado)",
  "menu.status": "Estado del token",
  "menu.openChat": "Abrir el chat con @m365",
  "menu.completionsOff": "Desactivar el autocompletado en línea",
  "menu.completionsOn": "Activar el autocompletado en línea",
  "menu.reviewEdits": "Revisar cambios del agente pendientes ({0})",
  "menu.commitMessage": "Generar mensaje de commit",
  "menu.autoCommit.on": "Autocommit: activado",
  "menu.autoCommit.off": "Activar el autocommit",
  "menu.autoCommit.detail":
    "Hace commit de tus cambios cuando tiene sentido, con mensajes documentados",
  "menu.language": "Idioma: {0}",
  "menu.settings": "Ajustes",
  "menu.log": "Mostrar registro (diagnóstico)",
  "menu.debug.on": "Modo debug profundo: activado (clic para desactivarlo)",
  "menu.debug.off": "Modo debug profundo: desactivado",
  "menu.debug.detail":
    "Traza todo lo que la extensión recibe, envía y hace; el registro se puede exportar a un .txt",
  "menu.exportLog": "Exportar registro (.txt)",
  "menu.walkthrough": "Primeros pasos",
  "menu.openM365": "Abrir M365 Copilot en el navegador",
  "menu.signOut": "Cerrar sesión y volver a entrar",
  "menu.signOut.detail":
    "Borra también la sesión de Microsoft del navegador, para que te pida las credenciales",
  "menu.clear": "Borrar credenciales",
  "menu.section.session": "Sesión",
  "menu.section.editor": "Editor",
  "menu.section.extension": "Extensión",

  // ------------------------------------------------------------ caducidad del token
  "watcher.expiringSoon": "M365 Copilot: el token caduca en {0} min y no se ha renovado.",
  "watcher.expired":
    "M365 Copilot: el token ha caducado. Captura uno nuevo para seguir usando los modelos.",
  "watcher.pasteToken": "Pegar token",
  "watcher.openM365": "Abrir M365 Copilot",

  // ------------------------------------------------------------ autocompletado en línea
  "completions.toggledOn": "Autocompletado de M365 Copilot activado.",
  "completions.toggledOff": "Autocompletado de M365 Copilot desactivado.",
  "completions.throttled":
    "M365 Copilot está limitando tu cuenta hasta {0} aprox.: no habrá sugerencias hasta entonces.",
  "completion.prompt.role":
    "Actúas como un motor de autocompletado de código, no como un asistente conversacional.",
  "completion.prompt.continue":
    "Continúa el código EXACTAMENTE en la posición marcada con ⟦CURSOR⟧, en {0}.",
  "completion.prompt.rules": "Reglas estrictas:",
  "completion.prompt.rule.only":
    "- Responde SÓLO con el texto que va en ⟦CURSOR⟧. Nada de explicaciones, saludos ni comentarios sobre lo que haces.",
  "completion.prompt.rule.noRepeat":
    "- No repitas el código que ya está antes del cursor ni el que va después.",
  "completion.prompt.rule.noFences": "- No uses vallas de código ni Markdown.",
  "completion.prompt.rule.maxLines":
    "- Como mucho {0} líneas. Si no hay nada útil que añadir, responde con una línea vacía.",
  "completion.prompt.file": "Archivo: {0}",
  "completion.prompt.codeStart": "--- código ---",
  "completion.prompt.codeEnd": "--- fin ---",

  // ------------------------------------------------------------ modelos
  "model.unavailable":
    "No disponible en tu cuenta ahora mismo — usa Auto, o vuelve a comprobar los modelos más tarde.",
  "model.quotaUntil": "Acceso prioritario agotado hasta {0} — mientras tanto, elige otro modelo.",
  "model.needsPremium":
    "Necesita una licencia de Microsoft 365 Copilot — la web mostró tu cuenta solo con Copilot Chat.",
  "model.needsToken": "Pega tu token de M365 Copilot para activarlo.",
  "model.tokenExpired": "Token caducado — pega uno nuevo para usarlo.",
  "models.new":
    "M365 Copilot: nuevo modelo disponible — {0}. Elígelo en el selector de modelos del chat.",
  "models.source.observed": "Detectado en la web de M365 Copilot (tone {0}).",
  "models.source.custom": "Añadido en tus ajustes (tone {0}).",
  "models.source.catalog": "Del catálogo de modelos en línea (tone {0}).",
  "models.title": "Modelos de M365 Copilot ({0})",
  "models.placeholder": "Elige uno para abrir el chat con él",
  "models.updating": "Actualizando los modelos de M365 Copilot…",
  "models.updateFailed":
    "M365 Copilot: no se pudo descargar el catálogo de modelos; se sigue usando la última lista conocida.",
  "models.label.builtin": "de serie",
  "models.label.catalog": "catálogo en línea",
  "models.label.observed": "detectado en la web de M365 Copilot",
  "models.label.custom": "tus ajustes",
  "models.check.action": "Comprobar qué modelos funcionan en tu cuenta",
  "models.check.actionDetail":
    "Envía un mensaje corto a cada modelo (una conversación por modelo) y marca los que el servicio rechace.",
  "models.check.noToken": "M365 Copilot: pega antes un token válido para comprobar los modelos.",
  "models.check.title": "Comprobando los modelos de M365 Copilot",
  "models.check.progress": "{0} ({1}/{2})",
  "models.check.empty": "No contestó nada.",
  "models.check.works": "Funciona en tu cuenta.",
  "models.check.summary": "{0} de {1} modelos funcionan en tu cuenta",
  "models.check.throttled":
    "M365 Copilot está limitando tu cuenta hasta {0} aprox.: comprueba los modelos después.",
  "log.modelAvailable": "el modelo {0} contestó: ya no se marca como no disponible",
  "log.modelUnavailable": "el modelo {0} queda marcado como no disponible en esta cuenta: {1}",
  "models.rejectedHint":
    " Puede que «{0}» no esté (ya) disponible en tu organización; prueba «M365 Copilot (Auto)» u otro modelo.",
  "menu.models": "Modelos: actualizar y ver la lista",
  "log.modelsCatalog": "catálogo de modelos descargado: {0} entradas",
  "log.modelsCatalogFailed": "catálogo de modelos no descargado ({0}); se usa la lista en caché",

  // ------------------------------------------------------------ proveedor
  "provider.noToken": "No hay token de M365 Copilot. Ejecuta «M365 Copilot: Pegar perfil o token».",
  "provider.imageSkipped":
    "⚠️ No se ha podido adjuntar una imagen ({0}); la respuesta sigue sin ella.\n\n",
  "provider.tokenExpired":
    "El token de M365 Copilot ha caducado{0}. Vuelve a capturarlo (extensión de navegador o userscript) y pégalo de nuevo.",
  "provider.expiredAgo": " (hace {0} min)",

  // ------------------------------------------------------------ cliente (BizChat)
  "turn.remoteSandbox":
    "\n\n⚠️ M365 Copilot ha trabajado en su propio sandbox en la nube (/mnt/data o parecido), no en tu workspace: " +
    "aquí no ha cambiado nada, y los archivos o enlaces que mencione están allí. Vuelve a intentarlo, o elige otro " +
    "modelo como GPT 5.5 Think deeper.",
  "throttle.notice":
    "M365 Copilot está limitando las peticiones de tu cuenta (demasiadas en poco tiempo). El autocompletado y las " +
    "comprobaciones automáticas quedan en pausa hasta {0} aprox.; se levanta sola si esperas.",

  // ------------------------------------------------------------ registro (canal de salida)
  "log.chatRequest":
    "petición del chat: modelo={0}, {1} mensajes, prompt={2} chars, herramientas={3}/{4} ({5} propias, {6} del editor)",
  "log.chatRequestOmitted": ", sin describir: {0}",
  "log.emptyPrompt": "prompt vacío tras aplanar; no se envía nada",
  "log.toolCallRequested": "llamada de herramienta solicitada: {0}",
  "log.completion": "autocompletado: {0} ms, {1} chars crudos → {2} usables",
  "log.completionFailed": "autocompletado falló: {0}",
  "log.completionThrottled": "autocompletado omitido: M365 Copilot limita la cuenta hasta {0}",
  "log.forcedRetry":
    "la respuesta no llamó a ninguna herramienta ({0}): se repite el turno una vez con una nota",
  "log.subagentStep": "[sub-agente {0}] paso {1} ({2}): {3}",
  "log.participantRequest": "petición a @m365: comando={0}, tone={1}, contexto={2}",
  "log.participantNoToken": "petición a @m365 (comando={0}) sin un token utilizable",
  "log.commitMessage": "mensaje de commit generado: {0} chars a partir de un diff de {1} chars",
  "log.commitMessageRetry": "mensaje de commit rechazado ({0}); se vuelve a pedir",
  "log.autoCommit": "autocommit {0}: {1}",
  "log.server.listening": "✅ Servidor de auto-renovación escuchando en http://localhost:{0}",
  "log.server.portInUse":
    "⚠️ Puerto {0} ya en uso. El servidor de auto-renovación no está disponible.",
  "log.server.error": "❌ Error en servidor de auto-renovación: {0}",
  "log.server.stopped": "🔌 Servidor de auto-renovación detenido",
  "log.server.originRejected": "⚠️ Solicitud a {0} rechazada: origen no permitido ({1})",
  "log.server.readError": "❌ Error leyendo la petición del navegador: {0}",
  "log.server.renewed": "🔄 Token auto-renovado desde el navegador",
  "log.server.processError": "❌ Error al procesar el token enviado por el navegador: {0}",
  "log.server.signOutRequested":
    "🚪 Cierre de sesión pedido desde el editor (id {0}); esperando al navegador",
  "log.server.signedOut":
    "🚪 El navegador ha confirmado el cierre de sesión (id {0}); token guardado borrado",
  "log.signOut.browserNotOpened":
    "⚠️ No se pudo abrir el navegador para cerrar la sesión de Microsoft",
  "log.signOut.report":
    "🚪 Cierre de sesión: {0} cookies borradas ({1} rechazadas), {2} orígenes vaciados, " +
    "{3} pestañas cerradas, {4} endpoints de logout visitados",
  "log.signOut.dataTypes": "🚪 Datos borrados por origen: {0}",
  "log.signOut.skippedDataTypes": "🚪 Tipos de datos que este navegador no admite: {0}",
  "log.signOut.error": "⚠️ Cierre de sesión: {0}",
  "log.signOut.timeout": "⚠️ Nadie confirmó el cierre de sesión. Endpoints de Microsoft: {0}",

  // ------------------------------------------------------------ prompt (proveedor del chat)
  "prompt.tone": [
    "Sé serio, directo y funcional: ve al grano, sin cháchara ni relleno.",
    'Nada de coletillas de relleno ("¡Claro!", "¡Buena pregunta!", "Voy a ayudarte con eso", disculpas innecesarias) ' +
      "ni emojis decorativos que no aportan información. Empieza directamente por la respuesta o la acción.",
    "Antes de una llamada a herramienta, como mucho UNA frase corta de qué vas a hacer — nunca un párrafo explicando " +
      "el plan paso a paso antes de ejecutarlo.",
    "No repitas la pregunta del usuario ni resumas al final lo que ya has dicho o hecho arriba. Si hiciste cambios, " +
      "di escuetamente QUÉ cambió, no el relato de cómo llegaste ahí.",
    "Sé breve por defecto: respuestas largas sólo cuando el contenido de verdad lo requiere (código, una explicación " +
      "técnica que el usuario pidió en detalle), nunca por rellenar espacio.",
    "Responde en el mismo idioma en el que escribe el usuario.",
  ].join("\n"),
  "prompt.markdown": [
    "Responde SIEMPRE en Markdown bien formado.",
    "OBLIGATORIO: todo bloque de código de 2 o más líneas debe ir entre vallas ``` con el lenguaje adecuado (por ejemplo, ```ts). Nunca lo pegues como texto plano: fuera de una valla, Markdown convierte cada salto de línea en un espacio y el código sale ilegible, todo en una línea.",
    "Usa código en línea (una sola voz entre `backticks`) sólo para identificadores, rutas, comandos y fragmentos muy cortos de una sola línea.",
  ].join("\n"),
  "prompt.skill.ponytail": [
    "ESTILO DE TRABAJO — desarrollador senior perezoso: resuelve el problema completo con el mínimo código nuevo.",
    "Antes de escribir, lee el código que toca la tarea y enumera cada sitio al que debe llegar el cambio (llamadores, " +
      "tests, configuración, exports). Toma la primera opción que funcione entera: ¿hace falta que exista? → algo que ya " +
      "hay en este código → la biblioteca estándar o la plataforma → una dependencia ya instalada → una línea clara → el mínimo código.",
    "Nada de abstracciones, opciones, envoltorios ni código «para luego» que nadie pidió; nunca una dependencia nueva " +
      "por cuatro líneas. Borrar gana a añadir. Respeta la estructura y las convenciones del código. Bug: busca todos " +
      "los llamadores y arregla la causa raíz una vez. La lógica nueva no trivial deja un test pequeño. Nunca recortes " +
      "validación en fronteras de confianza, manejo de errores que evita perder datos, seguridad, accesibilidad ni nada que pidiera el usuario.",
    "Termina los cambios de código con una línea: qué no hiciste o no comprobaste, y cualquier riesgo.",
  ].join("\n"),
  "prompt.skill.agentSkills": [
    "DISCIPLINA DE INGENIERÍA:",
    "- Antes de algo no trivial, enumera tus supuestos en una lista corta; si la petición es ambigua o contradice el " +
      "código, nombra la confusión y pregunta en vez de adivinar.",
    "- Rebate los enfoques con problemas claros: di el inconveniente concreto y propone una alternativa. Sin complacencia.",
    "- Alcance: toca sólo lo que se pidió. No limpies, refactorices ni borres código o comentarios ajenos a la tarea.",
    "- Funcionalidad nueva: especificación (objetivo, criterios de aceptación) → tareas pequeñas verificables → " +
      "implementa en rebanadas finas, cada una verificada antes de la siguiente. Bug: reprodúcelo → encuentra la causa " +
      "raíz → arréglalo → añade un test que lo habría detectado.",
    "- Verifica, no supongas: una tarea está hecha sólo con pruebas (tests, build, diagnósticos, salida), nunca porque " +
      "«parece bien».",
    "- Revisa en cinco ejes: corrección, legibilidad, arquitectura, seguridad, rendimiento.",
  ].join("\n"),
  "prompt.skill.graphify":
    "Este workspace tiene un grafo de conocimiento de graphify en `graphify-out/`. Para preguntas de arquitectura, " +
    "relaciones entre archivos o «cómo funciona X / quién llama a Y», úsalo antes de buscar archivo por archivo: lee " +
    '`graphify-out/GRAPH_REPORT.md` o, si puedes ejecutar comandos, `graphify query "<pregunta>"`, ' +
    '`graphify path "<A>" "<B>"` o `graphify explain "<nodo>"`. Tras editar código, ' +
    "`graphify . --update` lo actualiza.",
  "prompt.markdownReminder":
    "Recuerda: si tu respuesta incluye código de 2 o más líneas, ponlo entre vallas ``` con el lenguaje. Nunca como " +
    "texto plano. Y sé breve y directo: sin cháchara, sin repetir lo obvio, sin párrafos de más.",
  "prompt.continue":
    "Continúa esta conversación: responde a la última petición del usuario. Los turnos anteriores son contexto; " +
    "los resultados de herramientas que la siguen son lo que llevas hecho.",
  "prompt.toolResult": "[resultado de la herramienta {0}]",
  "prompt.toolCall": "[llamada a herramienta {0}({1})]",
  "prompt.nonTextOmitted": "[contenido adjunto no textual omitido]",
  "prompt.attachmentOmitted": "[adjunto {0}, {1} KB, omitido]",
  "prompt.imageAttached": "[imagen adjunta a esta petición: {0}, {1} KB]",
  "prompt.imagesAttached": "[{0} imagen(es) del usuario van adjuntas a esta petición]",
  "prompt.earlierOmitted": "[turnos anteriores omitidos para conservar el contexto relevante]",
  "prompt.charsOmitted": "[... {0} caracteres omitidos ...]",
  "prompt.role.request": "Usuario (petición actual)",
  "prompt.role.toolResults": "Resultados de herramientas",
  "prompt.sameResultBelow": "[mismo resultado que una llamada posterior, más abajo]",
  "prompt.olderResultShortened":
    "[resultado antiguo recortado: {0} caracteres más; vuelve a llamar a la herramienta si los necesitas]",
  "env.line": "Entorno: {0} · hoy {1}",
  "env.root": "Raíz del workspace (las rutas absolutas empiezan aquí): {0}",
  "env.roots": "Carpetas del workspace: {0}",
  "env.shell.windowsPowerShell": "Windows PowerShell 5.1 (sin `&&`: encadena comandos con `;`)",

  // ------------------------------------------------------------ protocolo de herramientas (lo lee el modelo)
  "protocol.force.giveUp":
    "Nota: en un intento anterior de esta petición respondiste que no podías acceder al workspace, sin llamar a " +
    "ninguna herramienta. Sí puedes: los archivos y comandos de este workspace son reales y están a tu alcance con las " +
    "herramientas de la lista de arriba, y el marcador las ejecuta en la máquina del usuario. No le pidas que pegue " +
    "ni suba nada; responde con la llamada a herramienta del siguiente paso.",
  "protocol.force.sandbox":
    "Nota: en un intento anterior de esta petición trabajaste en tu propio sandbox en la nube (/mnt/data, /home/…). " +
    "Esa no es la máquina del usuario: nada de lo que hay allí está en este workspace, y nada de lo que crees allí " +
    "llega a él. Usa solo las herramientas de la lista de arriba, con el marcador, para archivos y comandos; responde " +
    "con la llamada a herramienta del siguiente paso.",

  // ------------------------------------------------------------ invocación de herramientas (UI del chat)
  "tool.listing": "Listando {0}...",
  "tool.listing.workspace": "el workspace",
  "tool.searching": "Buscando «{0}»...",
  "tool.reading": "Leyendo {0}...",
  "tool.preparingEdits": "Preparando {0} edición(es)...",
  "tool.edits.confirmTitle": "Aplicar cambios de M365 Copilot",
  "tool.edits.confirmMessage":
    "Los cambios se aplicarán en el editor, resaltados y SIN guardar en disco. " +
    "Encima de cada cambio tendrás «Keep» para aceptarlo y «Undo» para revertirlo, además del diff.",
  "tool.diagnostics.file": "Leyendo diagnósticos de {0}...",
  "tool.diagnostics.workspace": "Leyendo diagnósticos del workspace...",
  "tool.git": "Consultando git {0}...",
  "tool.generatingCommit": "Generando mensaje de commit con la función nativa de VS Code...",
  "tool.commit.noMessage": "(sin mensaje)",
  "tool.commit.stageAll": "**Se hará `git add -A`** (todos los cambios) antes de commitear.",
  "tool.commit.stagePaths": "**Se hará `git add`** de: {0}.",
  "tool.commit.stageNone": "Se commiteará lo que ya esté en stage (no se añade nada nuevo).",
  "tool.commit.invocation": "Creando commit: {0}",
  "tool.commit.confirmTitle": "Crear commit de M365 Copilot",
  "tool.commit.confirmMessage":
    "M365 Copilot quiere crear un commit con este mensaje:\n\n```\n{0}\n```\n\n{1}\n\n" +
    "Esto crea un commit real en el historial del repositorio.",
  "tool.run.risky":
    "\n\n⚠️ **Este comando coincide con un patrón potencialmente destructivo** (borrado masivo, push forzado, formateo del disco...). Revísalo con cuidado antes de continuar.",
  "tool.run.invocation": "Ejecutando: {0}",
  "tool.run.confirmTitle": "Ejecutar comando de M365 Copilot",
  "tool.run.confirmMessage":
    "M365 Copilot quiere ejecutar este comando en tu workspace:\n\n```\n{0}\n```\n\n" +
    "Se ejecuta con tus propios permisos de usuario y su salida (stdout/stderr) se envía al modelo en la nube.{1}",
  "tool.error": "Error de herramienta: {0}",

  // ------------------------------------------------------------ herramientas de workspace (resultados y errores)
  "ws.untrusted": "Las herramientas de M365 Copilot requieren un workspace de confianza.",
  "ws.notAFile": "La ruta no es un archivo: {0}",
  "ws.tooLarge": "El archivo supera el límite de {0} KB.",
  "ws.cancelled": "La operación fue cancelada.",
  "ws.noFolder": "Abre una carpeta o workspace antes de usar herramientas.",
  "ws.folderNotFound": "No existe el workspaceFolder «{0}».",
  "ws.multipleFolders": "Hay varios workspaces abiertos ({0}). Especifica workspaceFolder.",
  "ws.path.notString": "path debe ser una ruta relativa al workspace.",
  "ws.path.empty": "path no puede estar vacío.",
  "ws.path.absolute": "path debe ser una ruta relativa dentro del workspace.",
  "ws.path.escapes": "path no puede salir del workspace.",
  "ws.path.root": "path no puede apuntar a la raíz del workspace.",
  "ws.path.git": "No se permite acceder a .git mediante herramientas.",
  "ws.binary":
    "Este archivo parece ser {0} y no se puede leer como texto: esta herramienta sólo lee texto plano, " +
    "no extrae el contenido de formatos binarios/ofimáticos. NO intentes leerlo de otra forma ni inventes su " +
    "contenido a partir de bytes crudos — dile al usuario que esta herramienta no puede abrir este tipo de " +
    "archivo todavía, y pídele que pegue el texto relevante en el chat o lo exporte/guarde como .txt/.md si lo " +
    "necesita.",
  "ws.binary.kind": "{0} ({1})",
  "ws.binary.generic": "un archivo binario ({0})",
  "ws.binary.noExtension": "sin extensión",
  "ws.binary.pdf": "un PDF",
  "ws.binary.doc": "un documento de Word antiguo (.doc)",
  "ws.binary.docx": "un documento de Word",
  "ws.binary.xls": "una hoja de Excel antigua (.xls)",
  "ws.binary.xlsx": "una hoja de Excel",
  "ws.binary.ppt": "una presentación de PowerPoint antigua (.ppt)",
  "ws.binary.pptx": "una presentación de PowerPoint",
  "ws.binary.image": "una imagen",
  "ws.binary.zip": "un archivo comprimido",
  "list.empty": "No hay archivos en {0} (o están todos excluidos).",
  "list.header": "Archivos en {0}:",
  "list.limited": "Resultado limitado a {0} archivos. Acota path antes de seguir.",
  "search.queryEmpty": "query debe contener texto para buscar.",
  "search.queryTooLong": "query no puede superar 500 caracteres.",
  "search.notExhaustive":
    "AVISO: sólo se revisaron {0} de más de {1} archivos; la búsqueda NO es exhaustiva. Acota con path para cubrirlo todo.",
  "search.skipped": "{0} archivo(s) omitidos por ser binarios o demasiado grandes.",
  "search.resultCap": "Se alcanzó el límite de {0} coincidencias; puede haber más.",
  "search.none": "Sin coincidencias para «{0}» en {1} ({2} archivo(s) revisados{3}).",
  "search.caseSensitive": ", distinguiendo mayúsculas",
  "search.header": "Coincidencias para «{0}» ({1} en {2} archivo(s) revisados):",
  "read.notFound": "No existe el archivo {0}.",
  "read.header": "{0}, líneas {1}-{2} de {3}:",
  "read.limited": "Lectura limitada; solicita un rango más pequeño o posterior.",
  "diag.noneFile": "Sin diagnósticos en {0}.",
  "diag.noneWorkspace": "Sin diagnósticos en el workspace.",
  "diag.headerFile": "Diagnósticos en {0} ({1} en total):",
  "diag.headerWorkspace": "Diagnósticos del workspace ({0} en total):",
  "diag.limited": "Resultado limitado a {0}. Acota path o severity antes de seguir.",
  "git.scoped": "{0} de {1}",
  "git.noOutput": "git {0}: sin salida.",
  "git.truncated": "... (salida truncada)",
  "git.notInstalled": "git no está instalado o no está en el PATH.",
  "git.notARepo": "Esta carpeta no es un repositorio git.",
  "git.failed": "git falló: {0}",
  "git.invalidAction": "action debe ser status, diff o log.",
  "git.extensionMissing":
    "La extensión Git integrada de VS Code no está instalada o está deshabilitada.",
  "git.noRepository": "No se encontró un repositorio git para esta carpeta (¿está inicializado?).",
  "commit.stagedAll": "todos los cambios (`git add -A`)",
  "commit.nothingStaged":
    "No hay nada en stage para commitear. Pasa stageAll o paths, o haz `git add` primero (por ejemplo con {0}).",
  "commit.stagedBefore": "Stage añadido antes de commitear: {0}.",
  "commit.stagedExisting":
    "Se ha commiteado lo que ya estaba en stage (no se ha añadido nada nuevo).",
  "commit.created": "Commit creado:",
  "commit.pathsNotArray": "paths debe ser un array de rutas relativas al workspace.",
  "commit.tooManyPaths": "paths no puede tener más de {0} elementos.",
  "commitMsg.empty": "message no puede estar vacío.",
  "commitMsg.tooLong": "message supera el límite de {0} caracteres.",
  "commitMsg.notConventional":
    "La primera línea de message no sigue Conventional Commits: debe ser " +
    '"tipo(ámbito opcional)!: resumen en imperativo" (tipos válidos: {0}). ' +
    'Ejemplo: "fix(auth): evitar token nulo en refresh". Recibido: "{1}".',
  "commitMsg.trailingPeriod": "La primera línea no debe terminar en punto (Conventional Commits).",
  "genCommit.noChanges":
    "No hay ningún cambio (en stage ni en el árbol de trabajo) que commitear en este repositorio.",
  "genCommit.errorReason": "error: {0}",
  "genCommit.noModelReason": "puede que no haya un modelo de chat disponible en este momento",
  "genCommit.generated":
    "Mensaje generado por VS Code (queda en el cuadro de Source Control; edítalo ahí si lo cambias):\n\n{0}",
  "genCommit.notGenerated":
    "VS Code no generó ningún mensaje ahora mismo ({0}). Redacta tú el mensaje a partir del diff de abajo.",
  "genCommit.nothingStaged":
    "⚠️ No hay nada en stage todavía: el diff de abajo es del árbol de trabajo (`git add` pendiente). " +
    "Puedes commitear igualmente con `{0}` usando `stageAll` o `paths`.",
  "genCommit.checkConventional":
    "Antes de usarlo con {0}, comprueba que la primera línea sigue Conventional Commits: " +
    '"tipo(ámbito opcional): resumen en imperativo" (tipos habituales: feat, fix, docs, style, refactor, ' +
    "perf, test, build, ci, chore, revert), sin punto final.",
  "genCommit.timeout": "git.generateCommitMessage no respondió en {0}s",
  "run.noOutput": "(sin salida)",
  "run.empty": "command no puede estar vacío.",
  "run.tooLong": "command supera el límite de {0} caracteres.",
  "run.timedOut": "Cancelado por timeout ({0}s).",
  "run.noExitCode": "Proceso terminado sin código de salida (cancelado).",
  "run.exitCode": "Código de salida: {0}.",
  "run.inTerminal": "Ejecutado en el terminal «{0}» de VS Code.",
  "run.headless":
    "Ejecutado en segundo plano (la shell integration de VS Code no estaba disponible).",
  "run.charsOmitted": "… ({0} caracteres omitidos) …",
  "edit.text.notString": "{0} debe ser texto.",
  "edit.text.empty": "{0} no puede estar vacío.",
  "edit.oldText.multiple":
    "oldText aparece más de una vez en {0}. Incluye más contexto para que sea único.",
  "edit.oldText.noMatch":
    "oldText no coincide con el contenido actual de {0}. Vuelve a leer el archivo.",
  "edit.summary":
    "Cambios aplicados en el editor y pendientes de revisión del usuario: {0}. " +
    "El usuario los verá resaltados con las acciones «Keep» y «Undo» encima del cambio. " +
    "No están guardados en disco todavía y el usuario puede revertirlos, así que no des por hecho que son definitivos.",
  "edit.noEdits": "edits debe contener al menos una edición.",
  "edit.tooMany": "El lote no puede superar {0} ediciones.",
  "edit.itemError": "Edición #{0}: {1}",
  "edit.invalidBatch": "{0} de {1} edición(es) no son válidas; no se ha aplicado ninguna:\n{2}",
  "edit.noChange": "La propuesta no produce ningún cambio.",
  "edit.notObject": "Cada edición debe ser un objeto.",
  "edit.replaceMissing": "No se puede reemplazar {0} porque no existe.",
  "edit.createExists": "{0} ya existe; usa replace para modificarlo.",
  "edit.deleteMissing": "No se puede borrar {0} porque no existe.",
  "edit.invalidOperation": "operation debe ser replace, create o delete.",
  "edit.applyFailed": "VS Code no pudo aplicar los cambios.",
  "edit.restoreFailed": "VS Code no pudo restaurar el contenido anterior.",
  "edit.tooLarge": "{0} supera el límite de {1} caracteres.",
  "edit.kept":
    "M365 Copilot: {0} archivo(s) aceptados. Sin guardar todavía — Ctrl+S para escribirlos.",
  "edit.reverted": "M365 Copilot: {0} archivo(s) revertidos.",
  "edit.revertFailed": "M365 Copilot: no se pudo revertir: {0}",
  "edit.noBatch": "M365 Copilot: no hay un lote de cambios para deshacer.",
  "edit.batchUndone": "M365 Copilot: se deshizo el lote de {0} archivo(s).",
  "edit.batchUndoFailed": "M365 Copilot: no se pudo deshacer el lote: {0}",
  "edit.nonePending": "M365 Copilot: no hay cambios de agente pendientes.",
  "edit.diffTitle": "{0}: antes ↔ propuesta de M365 Copilot",
  "edit.review.title": "Cambios de M365 Copilot pendientes",
  "edit.review.placeholder": "Elige un archivo para ver el diff",
  "edit.lens.keep": "$(check) Keep ({0})",
  "edit.lens.keepTooltip": "Aceptar este cambio de M365 Copilot",
  "edit.lens.undo": "$(discard) Undo",
  "edit.lens.undoTooltip": "Revertir este cambio y restaurar el contenido anterior",
  "edit.lens.diff": "$(diff) Ver diff",
  "edit.lens.diffTooltip": "Comparar con el contenido anterior",
  "edit.lens.keepAll": "$(check-all) Keep todo ({0})",
  "edit.lens.undoAll": "$(discard) Undo todo",
  "edit.lens.keepHunk": "$(check) Keep ({0})",
  "edit.lens.keepHunkTooltip": "Aceptar sólo este bloque de cambios",
  "edit.lens.undoHunk": "$(discard) Undo",
  "edit.lens.undoHunkTooltip": "Revertir sólo este bloque de cambios",
  "edit.status.text": "$(edit) M365: {0} cambio(s) sin revisar",
  "edit.status.tooltip": "Cambios de M365 Copilot pendientes de Keep/Undo. Clic para revisarlos.",
  "diff.newFile": "archivo nuevo",
  "diff.deletedFile": "archivo borrado",
  "diff.stats": "+{0} −{1}",
  "diff.modified": "modificado",

  // ------------------------------------------------------------ DeepWiki (tools/deepwiki.ts, aún sin registrar)
  "deepwiki.badRepo":
    'repo debe tener el formato "owner/nombre" de un repositorio PÚBLICO de GitHub (ej. "microsoft/vscode").',
  "deepwiki.noQuestion": 'question es obligatorio cuando action="ask".',
  "deepwiki.empty": "DeepWiki ({0}, {1}): sin resultado.",
  "deepwiki.timeout": "DeepWiki no respondió en {0}s.",
  "deepwiki.unreachable": "No se pudo contactar con DeepWiki: {0}",
  "deepwiki.http": "DeepWiki devolvió HTTP {0}.",
  "deepwiki.unrecognised": "DeepWiki no devolvió una respuesta reconocible.",
  "deepwiki.errorNoDetails": "DeepWiki devolvió un error sin detalles.",

  // ------------------------------------------------------------ sub-agentes
  "subagent.invocation":
    "Delegando {0} sub-tarea(s) a sub-agentes de M365 Copilot (puede tardar varios minutos; el progreso se ve en las notificaciones)...",
  "subagent.invocation.several": "varias",
  "subagent.disabled":
    "La delegación en sub-agentes está desactivada (ajuste m365copilot.subagents.enabled). " +
    "Actívala si quieres poder usar esta herramienta, o resuelve la tarea directamente.",
  "subagent.errorPrefix": "Error: {0}",
  "subagent.noToken":
    "No hay token de M365 Copilot guardado. Pide al usuario que ejecute «M365 Copilot: Pegar perfil o token» antes de delegar tareas.",
  "subagent.tokenExpired":
    "El token de M365 Copilot ha caducado. Pide al usuario que lo vuelva a capturar y pegar.",
  "subagent.progressTitle": "M365 Copilot: {0} sub-agente(s)",
  "subagent.nonText": "[contenido no textual omitido]",
  "subagent.noContent": "(sin contenido)",
  "subagent.tasks.notArray": "tasks debe ser un array con al menos una tarea.",
  "subagent.tasks.tooMany": "tasks no puede tener más de {0} tareas.",
  "subagent.tasks.notObject": "La tarea #{0} debe ser un objeto.",
  "subagent.tasks.noTask":
    'La tarea #{0} necesita un campo "task" con la descripción de lo que debe hacer.',
  "subagent.tasks.defaultLabel": "Tarea {0}",
  "subagent.step.call": "paso {0} — {1}",
  "subagent.step.done": "completado",
  "subagent.step.limit": "límite alcanzado",
  "subagent.step.error": "error: {0}",
  "subagent.report.incomplete": "### ⚠️ {0} (incompleto)",
  "subagent.report.guidance":
    "Resultado de {0} sub-tarea(s) delegada(s). Sintetiza esto en UNA respuesta coherente para el " +
    "usuario — no pegues las secciones ### tal cual ni menciones que venían de sub-agentes salvo que aporte algo.",
  "subagent.report.guidanceIncomplete":
    "{0} de ellas quedó(ron) incompleta(s) (⚠️): dilo brevemente y decide si merece la " +
    "pena reintentarla con menos alcance o informar al usuario del límite alcanzado.",
  "subagent.cancelled": "Cancelado.",
  "subagent.timeLimit":
    "⏱️ Se alcanzó el tiempo máximo ({0} min) para esta sub-tarea sin una respuesta final. Último resultado:\n{1}",
  "subagent.noText": "(el sub-agente no devolvió texto).",
  "subagent.stepLimit":
    "⚠️ Se alcanzó el límite de {0} paso(s) sin una respuesta final. Último resultado:\n{1}",
  "subagent.prompt.framing":
    "Eres un SUB-AGENTE autónomo dentro de VS Code, delegado por el agente principal de M365 Copilot para UNA " +
    "tarea concreta y acotada. No ves el resto de la conversación con el usuario — sólo la tarea de abajo — " +
    "así que no des nada por hecho fuera de ella.",
  "subagent.prompt.task": "Tarea encomendada:\n{0}",
  "subagent.prompt.finish":
    "Usa las herramientas que necesites, un paso a la vez. Cuando termines, responde en Markdown con un RESUMEN " +
    "CONCISO (unos pocos párrafos o una lista de puntos como mucho) de lo que hiciste y lo que encontraste o " +
    "cambiaste — es lo ÚNICO que va a leer el agente principal, así que no dejes fuera nada importante ni " +
    "emitas más marcadores de herramienta una vez tengas esa respuesta final. Si el resumen incluye código de " +
    "2 o más líneas, ponlo entre vallas ``` con el lenguaje.",
  "subagent.prompt.omitted": "[pasos anteriores del sub-agente omitidos para conservar contexto]",
  "subagent.prompt.callBlock": "Sub-agente (paso {0}): llamó a {1} con {2}",
  "subagent.prompt.resultBlock": "Resultado de {0}:\n{1}",
  "subagent.clipNote": "… ({0} caracteres omitidos)",

  // ------------------------------------------------------------ participante de chat @m365
  "participant.noToken":
    "Todavía no hay token de M365 Copilot. Captúralo en el navegador y pégalo aquí para empezar.",
  "participant.tokenExpired":
    "El token de M365 Copilot ha caducado. Captura uno nuevo en el navegador y vuelve a pegarlo.",
  "participant.button.paste": "Pegar perfil o token",
  "participant.button.review": "Revisar cambios pendientes",
  "participant.noContext":
    "No hay código con el que trabajar: abre un archivo y selecciona código (o deja el cursor dentro de una función), " +
    "adjunta un archivo con # o describe lo que necesitas.",
  "participant.progress.thinking": "Consultando a M365 Copilot…",
  "participant.progress.tool": "Ejecutando {0}…",
  "participant.stepLimit":
    "_(Me detuve tras {0} llamadas a herramientas sin una respuesta final — pulsa Continuar abajo, o sube `m365copilot.chat.maxToolCalls` (0 = sin límite).)_",
  "participant.timeLimit": "_(Me detuve: la petición superó los {0} min.)_",
  "participant.error": "No se ha podido completar la respuesta. {0}",
  "participant.followup.continue": "Continuar",
  "participant.followup.continue.prompt": "Continúa donde lo dejaste.",
  "participant.followup.explain": "Explica este código",
  "participant.followup.fix": "Corrige los problemas",
  "participant.followup.doc": "Documenta este código",
  "participant.followup.tests": "Genera tests",
  "participant.followup.terminal": "Explica el último comando del terminal",
  "participant.task.explain":
    "Explica qué hace el código de abajo, cómo funciona y lo que no sea evidente (casos límite, trampas, " +
    "rendimiento). Sé conciso y concreto; no lo reescribas salvo que el usuario lo pida. Lee más del workspace sólo " +
    "si el código depende de algo que no ves.",
  "participant.task.fix":
    "Encuentra y corrige los problemas del código de abajo (los diagnósticos que marca VS Code, si los hay, y los " +
    "bugs reales que detectes). Aplica la corrección en el archivo con la herramienta de edición — el usuario la " +
    "revisa con Keep/Undo — y después explica en una o dos frases qué fallaba y qué cambiaste. No refactorices código ajeno al problema.",
  "participant.task.doc":
    "Añade comentarios de documentación al código de abajo, siguiendo las convenciones de su lenguaje (JSDoc/TSDoc, " +
    "docstrings, XML doc…) y el estilo que ya use el proyecto. Aplícalos en el archivo con la herramienta de edición " +
    "y no cambies ningún comportamiento.",
  "participant.task.tests":
    "Escribe tests unitarios para el código de abajo con el framework y las convenciones de test que ya use el " +
    "proyecto (busca primero los tests existentes). Crea o actualiza el archivo de tests con la herramienta de " +
    "edición y después di en una línea cómo ejecutarlos.",
  "participant.task.ask":
    "Responde a la petición del usuario de abajo. Usa las herramientas del workspace si necesitas más contexto o " +
    "tienes que cambiar archivos (el usuario revisa las ediciones con Keep/Undo).",
  "participant.prompt.framing":
    "Eres M365 Copilot, un asistente de programación integrado en VS Code e invocado desde el chat como @m365. " +
    "Trabaja paso a paso con las herramientas, una llamada cada vez. Cuando termines, responde al usuario en " +
    "Markdown — esa respuesta se muestra directamente en el chat.",
  "participant.prompt.context": "Contexto de código — {0}, líneas {1}-{2} ({3}):",
  "participant.prompt.contextTruncated": "[código recortado: {0} caracteres más]",
  "participant.prompt.diagnostics": "Problemas que VS Code marca en ese código:",
  "participant.prompt.request": "Petición del usuario:",
  "participant.prompt.noRequest": "(sin instrucciones adicionales)",
  "participant.prompt.history": "Mensajes anteriores de este chat (sólo como contexto):",
  "participant.prompt.attached": "Otros archivos que adjuntó el usuario: {0}",
  "participant.noTerminalRun":
    "Todavía no se ha capturado ningún comando en este terminal. Vuelve a ejecutarlo (la shell integration de VS Code tiene que estar activa en el terminal) y pregunta de nuevo.",
  "participant.task.terminal":
    "Explica por qué ha fallado el comando de terminal de abajo — o, si no falló, qué significa su salida — y cómo arreglarlo. Señala las líneas relevantes de la salida. Lee los archivos del workspace implicados si lo necesitas; si el arreglo es un cambio de código, aplícalo con la herramienta de edición (el usuario lo revisa con Keep/Undo); si es un comando, dalo, no lo ejecutes.",
  "participant.prompt.terminal": "Último comando en el terminal «{0}»:",
  "participant.prompt.terminalRunning": "Todavía en ejecución",
  "participant.prompt.terminalNoExitCode": "Terminado (la shell no informó del código de salida)",
  "participant.prompt.terminalExitCode": "Código de salida: {0}",
  "participant.prompt.terminalTruncated": "[principio de la salida omitido: {0} caracteres]",
  "participant.prompt.terminalNoOutput": "(sin salida)",
  "terminal.none": "M365 Copilot: abre un terminal y ejecuta primero el comando.",

  // ------------------------------------------------------------ acciones del editor
  "actions.ask.prompt": "¿Qué quieres preguntarle a M365 Copilot sobre este código?",
  "actions.ask.placeholder": "p. ej. ¿Por qué este bucle puede no terminar nunca?",
  "actions.noEditor": "M365 Copilot: abre primero un archivo en el editor.",
  "actions.chatUnavailable":
    "M365 Copilot: no se pudo abrir la vista del chat ({0}). ¿Está el chat activado en VS Code?",
  "actions.codeAction.fixDiagnostic": "Corregir con M365 Copilot: {0}",
  "actions.codeAction.explain": "Explicar con M365 Copilot",
  "actions.codeAction.document": "Documentar con M365 Copilot",
  "actions.codeAction.edit": "Editar con M365 Copilot…",

  // ------------------------------------------------------------ edición en línea
  "inlineEdit.title": "Editar líneas {0}–{1} con M365 Copilot",
  "inlineEdit.placeholder":
    "¿Qué debe cambiar? p. ej. «añade manejo de errores», «pásalo a async/await»",
  "inlineEdit.recent": "reciente",
  "inlineEdit.progress": "M365 Copilot está editando {0}:{1}–{2}…",
  "inlineEdit.tooLarge":
    "M365 Copilot: este código es demasiado grande para editarlo en línea. Selecciona un bloque más pequeño, o pregunta a @m365 en el chat.",
  "inlineEdit.changed":
    "M365 Copilot: el código cambió mientras se preparaba la edición, así que no se aplicó nada. Vuelve a intentarlo.",
  "inlineEdit.empty":
    "M365 Copilot no devolvió código. Vuelve a intentarlo o reformula la instrucción.",
  "inlineEdit.noChange": "M365 Copilot dejó el código sin cambios.",
  "inlineEdit.done": "M365 Copilot: cambio aplicado — revísalo con Keep / Undo.",
  "inlineEdit.failed": "M365 Copilot: la edición falló: {0}",
  "inlineEdit.fixInstruction": "Corrige este problema que marca VS Code: {0}",
  "inlineEdit.prompt.role":
    "Actúas como un editor de código dentro de VS Code, no como un asistente conversacional.",
  "inlineEdit.prompt.rules":
    "Reescribe el CÓDIGO A EDITAR de abajo siguiendo la instrucción.\nReglas:\n- Responde con UN solo bloque de código entre vallas que contenga la versión nueva completa de ese código — nada antes ni después, sin explicaciones.\n- Sólo ese código: no incluyas el contexto que lo rodea, que se muestra en solo lectura para que sepas dónde está.\n- Conserva su sangría y su estilo, y no toques nada que la instrucción no pida cambiar.\n- Si la instrucción no se puede aplicar a este código, responde con el código sin cambios.",
  "inlineEdit.prompt.file": "Archivo: {0} ({1})",
  "inlineEdit.prompt.instruction": "Instrucción:",
  "inlineEdit.prompt.diagnostics": "Problemas que VS Code marca en ese código:",
  "inlineEdit.prompt.before": "Contexto ANTES del código (solo lectura, no lo repitas):",
  "inlineEdit.prompt.code": "CÓDIGO A EDITAR (líneas {0}-{1}):",
  "inlineEdit.prompt.after": "Contexto DESPUÉS del código (solo lectura, no lo repitas):",
  "inlineEdit.prompt.reminder":
    "Recuerda: responde con UN solo bloque de código entre vallas con la versión nueva completa del CÓDIGO A EDITAR, y nada más.",

  // ------------------------------------------------------------ mensaje de commit (Source Control)
  "scm.progress": "M365 Copilot está redactando el mensaje de commit…",
  "scm.noChanges": "M365 Copilot: no hay cambios que describir en este repositorio.",
  "scm.noRepository": "M365 Copilot: no se encontró ningún repositorio git en este workspace.",
  "scm.pickRepository": "Elige un repositorio",
  "scm.failed": "M365 Copilot: no se pudo generar el mensaje de commit: {0}",
  "scm.empty": "M365 Copilot no devolvió ningún mensaje de commit. Vuelve a intentarlo.",
  "scm.done":
    "M365 Copilot: mensaje de commit listo en Source Control — revísalo antes de commitear.",
  "scm.prompt":
    "Escribe el mensaje de commit de git para los cambios de abajo, como un desarrollador sénior cuidadoso que " +
    "quiere un historial que siga siendo útil dentro de unos meses.\n" +
    "Formato:\n" +
    '- Primera línea: Conventional Commits, "tipo(ámbito): resumen" — en imperativo o infinitivo, como lo hagan ' +
    'los commits recientes ("añade" o "añadir", no "añadido"), primera palabra en minúscula salvo que sea un ' +
    "nombre propio, como mucho 72 caracteres (mejor unos 50) y sin punto final. Tipos válidos: {0}.\n" +
    "- Después, salvo que el cambio sea trivial y la primera línea lo diga todo, una línea en blanco y un cuerpo " +
    'de 1 a 5 puntos breves "- ".\n' +
    "- Si el cambio rompe la compatibilidad (una API pública, un ajuste, un comando, un formato de archivo o una " +
    'opción de CLI de la que otros dependen), pon "!" antes de los dos puntos y termina con una línea ' +
    '"BREAKING CHANGE: qué se rompe y cómo migrar".\n' +
    "Cómo escribirlo:\n" +
    "- tipo = el propósito principal: feat (una capacidad nueva), fix (corrige un fallo), refactor (mismo " +
    "comportamiento, mejor código), perf (más rápido o ligero), docs (sólo documentación), test (sólo tests), " +
    "build (sistema de build o dependencias), ci (configuración de CI), style (sólo formato), chore (otro " +
    "mantenimiento), revert.\n" +
    "- ámbito = la parte del proyecto afectada (paquete, módulo o carpeta), una palabra corta en minúsculas; " +
    "reutiliza un ámbito que este repositorio ya use cuando encaje, y omítelo si el cambio abarca todo el proyecto.\n" +
    '- resumen = qué cambia, en concreto. Nunca vago: nada de "actualizar archivos", "arreglar bug", "cambios" o ' +
    '"mejoras".\n' +
    "- cuerpo = por qué hacía falta y qué cambia en el comportamiento (antes → después): el problema que resuelve, " +
    "el fallo que arregla, el efecto para el usuario. No narres el diff archivo por archivo, no enumeres archivos " +
    "ni repitas la primera línea.\n" +
    "- Si los cambios mezclan trabajos sin relación, la primera línea describe el principal y el cuerpo menciona " +
    "el resto.\n" +
    "- Describe sólo lo que muestra el diff: no inventes motivos, tests, números de incidencia ni beneficios.\n" +
    "- Escribe el mensaje en español, salvo que los commits recientes de abajo estén todos escritos en otro " +
    "idioma: entonces usa el suyo.\n" +
    "- Responde ÚNICAMENTE con el mensaje de commit: sin vallas de código, sin comillas y sin explicaciones antes ni después.\n\n" +
    "{1}",
  "scm.prompt.files": "Archivos cambiados ({0}):",
  "scm.prompt.diff": "--- diff ---",
  "scm.prompt.diffEnd": "--- fin del diff ---",
  "scm.prompt.truncated": "[diff recortado: {0} caracteres más]",
  "scm.prompt.unstaged":
    "No hay nada en stage: estos son los cambios del árbol de trabajo que probablemente incluirá el commit.",
  "scm.prompt.repair":
    "Tu respuesta anterior fue:\n{0}\nNo se puede usar: {1}\nResponde de nuevo sólo con el mensaje de commit corregido.",

  // ------------------------------------------------------------ contexto del commit (SCM + autocommit)
  "commit.context.branch": "Rama: {0}",
  "commit.context.recent":
    "Últimos commits de este repositorio (sigue su estilo, sus ámbitos y su idioma):",
  "commit.context.scopes": "Ámbitos que ya se usan aquí (veces): {0}",
  "commit.diff.fileTruncated": "[… {0} líneas más de este archivo sin mostrar]",
  "commit.diff.omitted": "[archivo de bloqueo o generado: +{0} -{1} líneas, contenido sin mostrar]",

  // ------------------------------------------------------------ autocommit
  "autoCommit.enabled":
    "Autocommit de M365 Copilot activado en este workspace: cuando hagas una pausa, mirará tus cambios y hará commit de los que tengan sentido, con un mensaje documentado ({0}). Nunca hace push.",
  "autoCommit.disabled": "Autocommit de M365 Copilot desactivado en este workspace.",
  "autoCommit.turnOn": "Activar",
  "autoCommit.mode.auto": "automáticamente",
  "autoCommit.mode.confirm": "preguntándote antes",
  "autoCommit.failed": "Autocommit de M365 Copilot: {0}",
  "autoCommit.committed": "M365 Copilot hizo commit en {0}: {1}",
  "autoCommit.committedMany": "M365 Copilot hizo {0} commits en {1}: {2}",
  "autoCommit.undo": "Deshacer",
  "autoCommit.show": "Ver",
  "autoCommit.undone":
    "M365 Copilot: autocommit deshecho — los cambios vuelven a estar en tu árbol de trabajo, sin commitear.",
  "autoCommit.undoNothing": "M365 Copilot: no hay ningún autocommit que deshacer.",
  "autoCommit.undoMoved":
    "M365 Copilot: el autocommit ya no se puede deshacer desde aquí — hay commits más nuevos encima.",
  "autoCommit.confirm": "M365 Copilot propone un commit en {0}: {1}",
  "autoCommit.confirmMany": "M365 Copilot propone {0} commits en {1}: {2}",
  "autoCommit.confirm.commit": "Hacer commit",
  "autoCommit.confirm.choose": "Elegir…",
  "autoCommit.confirm.skip": "Ahora no",
  "autoCommit.confirm.pickTitle": "M365 Copilot — commits a hacer",
  "autoCommit.confirm.files": "{0} archivo(s): {1}",
  "autoCommit.checking": "M365 Copilot está mirando tus cambios…",
  "autoCommit.nothing": "M365 Copilot: no hay nada que commitear en {0}.",
  "autoCommit.waitNotice": "M365 Copilot todavía no hace commit en {0}: {1}",
  "autoCommit.busy": "M365 Copilot ya está mirando los cambios de {0}.",
  "autoCommit.noWatchedRepo":
    "El autocommit de M365 Copilot no está vigilando ningún repositorio git de este workspace.",
  "autoCommit.reason.noToken": "no hay un token de M365 válido — pega uno para continuar",
  "autoCommit.reason.throttled": "M365 Copilot está limitando la cuenta hasta {0} aprox.",
  "autoCommit.reason.pendingEdits": "{0} edición(es) del agente esperando Keep/Undo",
  "autoCommit.reason.unsaved": "archivos sin guardar: {0}",
  "autoCommit.reason.noHead": "el repositorio aún no tiene commits — haz tú el primero",
  "autoCommit.reason.detached": "HEAD está desacoplado (no estás en una rama)",
  "autoCommit.reason.inProgress": "hay una operación de git en curso: {0}",
  "autoCommit.reason.conflicts": "hay conflictos sin resolver",
  "autoCommit.reason.tooMany":
    "{0} archivos cambiados — demasiados para un commit automático, haz tú el commit",
  "autoCommit.reason.errors": "{0} error(es) en los archivos cambiados",
  "autoCommit.reason.interval": "último commit hace {0} min; vuelve a mirar en {1} min",
  "autoCommit.reason.changedMeanwhile": "los archivos cambiaron mientras M365 Copilot decidía",
  "autoCommit.reason.invalid": "M365 Copilot no dio una respuesta utilizable ({0})",
  "autoCommit.reason.unfinished": "los cambios parecen sin terminar",
  "autoCommit.reason.skipped": "descartaste el commit propuesto",
  "autoCommit.reason.undone": "deshiciste el autocommit",
  "autoCommit.reason.failed": "error: {0}",
  "autoCommit.invalid.noJson": "la respuesta no era JSON",
  "autoCommit.invalid.decision": 'decisión desconocida "{0}"',
  "autoCommit.invalid.noFiles": "ningún commit nombraba un archivo cambiado",
  "autoCommit.status.title": "Autocommit de M365 Copilot",
  "autoCommit.status.mode":
    "Hace commit {0}, tras {1} s sin cambios y al menos {2} min después del commit anterior.",
  "autoCommit.status.clean": "sin cambios",
  "autoCommit.status.watching": "vigilando tus cambios",
  "autoCommit.status.evaluating": "decidiendo si hacer commit…",
  "autoCommit.status.waiting": "esperando: {0}",
  "autoCommit.status.lastCommit": "último autocommit hace {0} min: {1}",
  "autoCommit.status.click": "Haz clic para ver las opciones del autocommit.",
  "autoCommit.menu.title": "M365 Copilot — autocommit",
  "autoCommit.menu.checkNow": "Comprobar ahora",
  "autoCommit.menu.checkNow.detail":
    "Preguntar ya a M365 Copilot si los cambios actuales merecen un commit",
  "autoCommit.menu.undo": "Deshacer el último autocommit",
  "autoCommit.menu.off": "Desactivar el autocommit",
  "autoCommit.menu.settings": "Ajustes del autocommit",
  "autoCommit.prompt":
    "Eres el asistente de autocommit de un desarrollador que programa en VS Code. Él sigue trabajando; tú miras " +
    "sus cambios sin commitear y decides si es un buen momento para hacer commit, y cómo.\n" +
    "Decide como un desarrollador sénior cuidadoso que quiere un historial limpio y útil:\n" +
    "- COMMIT cuando los cambios son una unidad de trabajo terminada y coherente: un arreglo completo (aunque sea " +
    "de una línea), un paso terminado de una funcionalidad, un refactor, documentación, tests, configuración.\n" +
    "- ESPERAR cuando el trabajo parece a medias: código a medio escribir, código que no compilaría o no " +
    "funcionaría, stubs o TODO recién añadidos, salidas de depuración o bloques comentados olvidados, o un cambio " +
    "al que claramente le falta su otra mitad (quien lo llama, sus tests, la función que usa).\n" +
    "- Nada de ruido: no partas un mismo cambio lógico en varios commits ni hagas commit de restos triviales por " +
    "sí solos. Ante la duda, ESPERA: el desarrollador sigue trabajando y se te volverá a preguntar.\n" +
    "- Si hay varios cambios terminados SIN RELACIÓN entre sí, haz un commit para cada uno (como mucho {0}) y deja " +
    "fuera de todos los commits los archivos que siguen en curso.\n" +
    "- Si los cambios llevan mucho tiempo acumulándose, inclínate por commitear las partes que ya están terminadas.\n" +
    "Cada mensaje de commit documenta el cambio para quien lea el historial dentro de unos meses:\n" +
    '- subject: Conventional Commits, "tipo(ámbito): resumen" — en imperativo o infinitivo, como lo hagan los ' +
    'commits recientes ("añade" o "añadir", no "añadido"), primera palabra en minúscula salvo que sea un nombre ' +
    "propio, como mucho 72 caracteres (mejor unos 50) y sin punto final. Tipos válidos: {1}.\n" +
    "- tipo = el propósito principal: feat (una capacidad nueva), fix (corrige un fallo), refactor (mismo " +
    "comportamiento, mejor código), perf, docs (sólo documentación), test (sólo tests), build (sistema de build o " +
    "dependencias), ci, style (sólo formato), chore (otro mantenimiento).\n" +
    "- ámbito = la parte del proyecto afectada, una palabra corta en minúsculas; reutiliza un ámbito que este " +
    "repositorio ya use cuando encaje, y omítelo si el cambio abarca todo el proyecto.\n" +
    '- resumen: qué cambia, en concreto. Nunca vago: nada de "actualizar archivos", "arreglar bug" o "cambios".\n' +
    "- body: de 1 a 5 puntos breves que digan por qué hacía falta y qué cambia en el comportamiento — el problema, " +
    "el efecto, el fallo que arregla. No repitas el subject, no enumeres archivos ni inventes motivos que el diff " +
    "no muestre.\n" +
    "- breaking: añádelo SÓLO si el commit rompe la compatibilidad (una API pública, un ajuste, un comando, un " +
    "formato de archivo o una opción de CLI de la que otros dependen): una frase que diga qué se rompe y cómo migrar.\n" +
    '- Escribe el "reason" en español. Escribe el subject y el body también en español, salvo que los commits ' +
    "recientes de abajo estén todos escritos en otro idioma: entonces usa el suyo.\n" +
    "Responde ÚNICAMENTE con un objeto JSON — sin vallas de código, nada antes ni después. O bien:\n" +
    '{"decision":"commit","commits":[{"files":["src/parser.ts"],"subject":"fix(parser): manejar la entrada vacía",' +
    '"body":["Devuelve un árbol vacío en vez de lanzar una excepción cuando el archivo está vacío.","Abrir un ' +
    'archivo nuevo y vacío ya no rompe el esquema."]}]}\n' +
    "o bien:\n" +
    '{"decision":"wait","reason":"una frase breve que diga qué sigue pareciendo sin terminar"}\n' +
    'En "files", usa las rutas exactamente como aparecen abajo.\n\n' +
    "{2}",
  "autoCommit.prompt.state": "Estado del repositorio:",
  "autoCommit.prompt.lastCommit": 'Último commit: hace {0} min — "{1}"',
  "autoCommit.prompt.pendingFor": "Estos cambios llevan acumulándose unos {0} min.",
  "autoCommit.prompt.lastWait": "La última vez decidiste esperar porque: {0}",
  "autoCommit.prompt.kind.new": "archivo nuevo",
  "autoCommit.prompt.kind.added": "añadido",
  "autoCommit.prompt.kind.modified": "modificado",
  "autoCommit.prompt.kind.deleted": "borrado",
  "autoCommit.prompt.kind.renamed": "renombrado desde {0}",
  "autoCommit.prompt.binary": "[archivo binario, {0} bytes]",
  "autoCommit.prompt.fileTruncated": "[archivo recortado: {0} bytes en total]",

  // ------------------------------------------------------------ migración desde ms365-copilot-vscode
  "migration.settingsMoved":
    "M365 Copilot: se han copiado {0} ajuste(s) de la versión anterior (ms365copilot.*) a m365copilot.*. Las entradas antiguas de settings.json ya no hacen nada y se pueden borrar.",
  "migration.openSettings": "Abrir ajustes (JSON)",
  "migration.legacyInstalled":
    "La versión anterior de M365 Copilot (ms365-copilot-vscode) sigue instalada. Las dos se pelearían por el token del navegador y por @m365: desinstala la antigua.",
  "migration.uninstall": "Desinstalar la versión antigua",
  "migration.uninstalled":
    "Se ha desinstalado la versión antigua de M365 Copilot. Recarga la ventana para terminar.",
  "migration.reload": "Recargar ventana",
  "migration.uninstallFailed":
    "M365 Copilot: no se pudo desinstalar la versión antigua ({0}). Desinstálala desde la vista Extensiones.",
  "log.legacySettingsMigrated": "ajustes copiados de la versión anterior: {0}",
  "log.legacySettingSkipped": "el ajuste {0} no se copió de la versión anterior: {1}",
  "log.legacyMigrationFailed": "no se pudieron copiar los ajustes de la versión anterior: {0}",

  // ------------------------------------------------------------ menú Cuentas
  "account.signIn.title": "Iniciar sesión con M365 Copilot",
  "account.signIn.placeholder": "¿Cómo quieres traer tu sesión de M365 Copilot a VS Code?",
  "account.signIn.browser": "Abrir M365 Copilot en el navegador",
  "account.signIn.browserDetail":
    "La extensión de navegador o el userscript envían el token a VS Code por su cuenta.",
  "account.signIn.paste": "Pegar perfil o token",
  "account.signIn.pasteDetail":
    "Copiado con «Copiar token» en la extensión de navegador o en el userscript.",
  "account.signIn.waiting":
    "Esperando el token del navegador… (inicia sesión allí en M365 Copilot)",
  "account.signIn.timeout":
    "M365 Copilot: no ha llegado ningún token del navegador. ¿Está instalada la extensión de navegador o el userscript? También puedes pegar el token.",
  "account.signInCancelled": "Se ha cancelado el inicio de sesión en M365 Copilot.",

  // ------------------------------------------------------------ revisión de código (comentarios)
  "review.controller": "Revisión de M365 Copilot",
  "review.severity.error": "Error",
  "review.severity.warning": "Aviso",
  "review.severity.info": "Sugerencia",
  "review.suggestion": "Corrección sugerida:",
  "review.progress": "M365 Copilot está revisando {0}…",
  "review.partial":
    "M365 Copilot: el archivo es grande, así que sólo se revisan las líneas {0}–{1} (el código del cursor).",
  "review.tooLarge":
    "M365 Copilot: este código es demasiado grande para revisarlo de una vez. Selecciona una parte más pequeña.",
  "review.failed": "M365 Copilot: la revisión ha fallado: {0}",
  "review.unreadable": "la respuesta no era una lista de hallazgos; vuelve a intentarlo",
  "review.clean": "M365 Copilot no ha encontrado nada que comentar en {0}.",
  "review.found":
    "M365 Copilot ha dejado {0} comentario(s) de revisión en {1}. También aparecen en el panel Comentarios.",
  "review.show": "Ir al primero",
  "review.fixInstruction":
    "Corrige este problema encontrado en la revisión de código: {0}. {1} Corrección sugerida: {2}",
  "review.changes.progress": "M365 Copilot está revisando tus cambios",
  "review.changes.count": "{0} de {1} archivos",
  "review.changes.none": "M365 Copilot: no hay cambios que revisar.",
  "review.changes.tooMany":
    "M365 Copilot: sólo se revisan los primeros {0} de los {1} archivos cambiados.",
  "review.changes.failedFiles": "M365 Copilot no ha podido revisar: {0}",
  "review.changes.files": "{0} archivo(s) cambiado(s)",
  "log.review": "revisión de {0}: {1} hallazgo(s)",
  "log.reviewSkipped": "revisión: {0} omitido (demasiado grande)",
  "log.reviewFileFailed": "la revisión de {0} ha fallado: {1}",
  "log.reviewUnreadable": "revisión de {0}: respuesta ilegible:\n{1}",
  "review.prompt.role": "Eres un revisor de código sénior dentro de VS Code.",
  "review.prompt.rules":
    "Revisa el código de abajo y señala sólo problemas reales: errores, lógica incorrecta, errores o casos límite sin tratar, " +
    "problemas de seguridad, condiciones de carrera, fugas de recursos, nombres engañosos y alternativas claramente mejores. " +
    "No señales formato ni estilo que detectaría un formateador o un linter, y no elogies el código.\n" +
    "Responde con UN solo bloque ```json entre vallas que contenga un array, y nada antes ni después. Cada elemento:\n" +
    '{"line": <primera línea>, "endLine": <última línea>, "severity": "error" | "warning" | "info", ' +
    '"title": "<resumen breve, 80 caracteres como máximo>", "message": "<qué está mal y por qué, 1-3 frases>", ' +
    '"suggestion": "<cómo corregirlo; opcional>"}\n' +
    'Usa los números de línea que aparecen a la izquierda de cada línea ("12 | código"). Escribe title, message y suggestion en español. ' +
    "Si no hay nada que merezca la pena señalar, responde con [].",
  "review.prompt.file": "Archivo: {0} ({1})",
  "review.prompt.changes":
    "Estas líneas acaban de cambiar: {0}. Señala sólo problemas en ellas o causados por ellas; el resto del archivo es contexto.",
  "review.prompt.diff":
    'El diff de esos cambios (las líneas que empiezan por "-" se han eliminado):',
  "review.prompt.code": "CÓDIGO (cada línea empieza por su número):",
  "review.prompt.reminder":
    "Recuerda: responde con UN solo bloque ```json entre vallas con el array de hallazgos ([] si no hay ninguno), y nada más.",

  // ------------------------------------------------------------ corregir todos los problemas / sugerencias de edición
  "actions.codeAction.fixAll": "Corregir los {0} problemas de este archivo con M365 Copilot",
  "fixAll.none": "M365 Copilot: este archivo no tiene errores ni avisos que corregir.",
  "fixAll.progress": "M365 Copilot está corrigiendo {0} problema(s) en {1}",
  "fixAll.step": "bloque {0} de {1} (líneas {2}–{3})",
  "fixAll.instruction":
    "Corrige estos problemas que VS Code señala en este código, sin cambiar nada más:\n{0}",
  "fixAll.done": "M365 Copilot ha reescrito {0} bloque(s): revísalos con Keep / Undo.",
  "fixAll.doneSome":
    "M365 Copilot ha reescrito {0} bloque(s): revísalos con Keep / Undo. Quedan {1} bloque(s) con problemas para otra pasada.",
  "fixAll.nothing": "M365 Copilot no ha cambiado nada.",
  "fixAll.failed":
    "M365 Copilot: no se han podido corregir {0} bloque(s). Mira el registro para más detalles.",
  "log.fixAllBlockFailed": "corregir todo: las líneas {0}-{1} han fallado: {2}",
  "inlineEdit.suggestions": "sugerencias",
  "inlineEdit.preset.simplify": "Simplifica este código sin cambiar lo que hace",
  "inlineEdit.preset.errors": "Añade manejo de errores",
  "inlineEdit.preset.types": "Añade anotaciones de tipos",
  "inlineEdit.preset.names": "Usa nombres más claros para variables y funciones",
  "inlineEdit.preset.comments": "Añade comentarios breves que expliquen lo que no es obvio",
  "inlineEdit.preset.performance": "Hazlo más rápido sin cambiar lo que hace",
  "inlineEdit.preset.async": "Convierte a async/await",

  // ------------------------------------------------------------ índice del proyecto (RAG) — lo lee el MODELO
  "rag.context.header":
    "CONTEXTO DEL PROYECTO — recuperado automáticamente de un índice local del workspace del usuario para esta petición. Puede estar incompleto o algo desactualizado: úsalo para saber qué archivos existen y dónde está cada cosa, y lee los archivos (m365_read_file) antes de cambiarlos. Las rutas son relativas al workspace.",
  "rag.context.snippets": "Código más relevante para esta petición:",
  "rag.context.more": "También relevante:",
  "rag.context.footer":
    "FIN DEL CONTEXTO DEL PROYECTO. Para buscar más, usa m365_search_project (búsqueda) o m365_project_map (estructura, imports y quién importa un archivo).",
  "rag.summary.header": "Workspace «{0}»: {1} archivos indexados ({2}). Áreas:",
  "rag.map.empty":
    "El índice del proyecto está vacío: no hay archivos indexables en este workspace.",
  "rag.map.header": "Mapa del proyecto «{0}» — {1} archivos, {2} fragmentos indexados.",
  "rag.map.languages": "Lenguajes:",
  "rag.map.packages": "Paquetes / proyectos:",
  "rag.map.structure":
    "Estructura — carpeta/ (archivos): subcarpetas/ (archivos), archivos principales [símbolos principales]:",
  "rag.map.keyFiles": "Archivos clave:",
  "rag.map.entries": "Posibles puntos de entrada:",
  "rag.map.central": "Módulos más importados (← número de archivos que los importan):",
  "rag.map.external": "Dependencias externas usadas (archivos):",
  "rag.map.moreAreas": "… y {0} carpetas más",
  "rag.map.notFound":
    "No hay nada indexado en «{0}». Usa m365_project_map sin path para ver la estructura, o m365_list_files.",
  "rag.file.header": "{0} — {1}, {2} líneas",
  "rag.file.symbols": "Símbolos (línea: tipo nombre):",
  "rag.file.imports": "Importa:",
  "rag.file.external": "externo",
  "rag.file.importedBy": "Lo importan:",
  "rag.file.notImported": "Ningún archivo indexado lo importa.",
  "rag.folder.header": "Carpeta {0} — {1} archivos indexados [símbolos principales]:",
  "rag.search.header":
    "Búsqueda en el proyecto: «{0}» — {1} resultados, los más relevantes primero:",
  "rag.search.none":
    "No hay resultados en el índice del proyecto para «{0}». Prueba otras palabras (términos de código en inglés, identificadores), m365_search_text para texto literal, o m365_project_map para ver la estructura.",
  "rag.search.more": "Más resultados (sin mostrar):",
  "rag.search.footer":
    "Lee el archivo con m365_read_file antes de editarlo; los fragmentos muestran las líneas más relevantes de cada resultado.",
  "rag.search.noQuery": "Indica qué buscar en `query`.",
  "rag.truncated":
    "Nota: el proyecto supera el límite del índice (m365copilot.index.maxFiles), así que hay archivos sin indexar.",
  "rag.disabled":
    "El índice del proyecto está desactivado (m365copilot.index.enabled). Usa m365_search_text y m365_list_files.",
  "rag.notReady":
    "El índice del proyecto aún no está listo (o el workspace no tiene archivos indexables). Usa m365_search_text y m365_list_files mientras tanto.",
  "web.prompt.role": "Eres un asistente de investigación con búsqueda web.",
  "web.prompt.rules":
    "Busca en la web la consulta de abajo y responde con los datos más relevantes y actuales: conciso, en viñetas, con versiones, nombres y código exactos cuando importen. Di si las fuentes no coinciden o si algo no se encontró. Cita las fuentes que hayas usado. Responde en español.",
  "web.prompt.query": "Consulta:",
  "web.result.header": "Búsqueda web: «{0}»",
  "web.result.sources": "Fuentes:",
  "web.empty": "La búsqueda web de «{0}» no ha devuelto nada.",
  "web.noQuery": "Indica qué buscar en `query`.",
  "web.disabled": "La búsqueda web está desactivada (m365copilot.web.enabled).",

  // ------------------------------------------------------------ índice del proyecto (RAG) — para el usuario
  "tool.searchingProject": "Buscando en el proyecto «{0}»...",
  "tool.projectMap": "Leyendo el mapa del proyecto...",
  "tool.projectMap.path": "Leyendo el mapa del proyecto de {0}...",
  "tool.webSearching": "Buscando en internet «{0}»...",
  "index.progress": "M365 Copilot: indexando el proyecto",
  "index.rebuilding": "M365 Copilot: reconstruyendo el índice del proyecto…",
  "index.rebuilt": "M365 Copilot: índice del proyecto listo — {0} archivos en {1} s.",
  "index.search.title": "Buscar en el proyecto ({0} archivos indexados)",
  "index.search.placeholder":
    "¿Qué buscas? p. ej. «dónde se guarda el token», ProfileStore, flujo de login",
  "index.map.title": "Mapa del proyecto — {0}",
  "index.status.indexing": "indexando… ({0} archivos por ahora)",
  "index.status.ready": "{0} archivos indexados",
  "index.status.disabled": "índice desactivado",
  "index.status.untrusted": "workspace sin confianza",
  "menu.section.project": "Proyecto",
  "menu.searchProject": "Buscar en el proyecto…",
  "menu.projectMap": "Mapa del proyecto",
  "menu.rebuildIndex": "Reconstruir el índice del proyecto",
  "log.indexBuilt": "índice del proyecto: {0} archivos, {1} fragmentos en {2} ms{3}",
  "log.indexFailed": "el índice del proyecto ha fallado: {0}",
  "log.indexContext": "contexto del proyecto: {0} resultados, {1} fragmentos, {2} caracteres",
  "log.indexContextFailed": "contexto del proyecto no disponible: {0}",
  "log.webSearch": "búsqueda web: {0}",
  "log.webSearchDone": "búsqueda web respondida: {0} caracteres, {1} fuentes",
  "log.webFallback": "el turno con web se ha rechazado ({0}); se responde sin búsqueda web",
};

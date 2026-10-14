---
"m365-copilot-vscode": patch
---

**Chats temporales, un *stop* de verdad y avisos claros cuando M365 Copilot limita o rechaza un turno.**

- **Chats temporales:** cada turno (cada paso del agente, cada sugerencia de
  autocompletado) es una conversación propia, y cada una podía quedar en el
  historial de Copilot de la web. Ahora salen como chat temporal
  (`disableMemory=1`): funcionan igual y no dejan nada en ese historial. El
  ajuste nuevo `m365copilot.history.save` los guarda como antes.
- **Parar de verdad:** al cancelar, la extensión manda la misma trama *stop*
  que el botón de parar de la web, en vez de cerrar el socket y dejar al modelo
  escribiendo; cierra en cuanto el servicio la confirma, o a los 2 s.
- **El turno acaba con la llamada a herramienta:** en el chat, en `@m365` y en
  los sub-agentes, el turno termina en cuanto la llamada está completa, sin
  esperar a lo que el modelo escriba detrás (a menudo resultados inventados,
  durante minutos).
- **Throttling:** `Throttled` / `PerUserThrottled` ya no se reintenta (solo lo
  alargaba). El error lo explica, y el autocompletado, el autocommit (salvo
  *Comprobar ahora*) y *Comprobar modelos* esperan hasta 75 min después del
  último turno limitado, con ⌚ en la barra de estado y un aviso al empezar.
  Cualquier respuesta levanta la pausa.
- **Cuota y licencia:** el acceso prioritario agotado (`OutOfCredits`, o su
  texto enlatado) dice cuándo se renueva (medianoche UTC; el semanal, el lunes)
  y marca el modelo hasta entonces, en vez de 12 h. Una licencia no válida
  (`InvalidCopilotLicense`) lo dice sin marcar ningún modelo. Ninguno de los dos
  se reintenta.
- **`Disengaged`:** la invocación declara ese tipo de mensaje (el servicio solo
  manda los declarados), y cuando M365 Copilot rehúsa responder llega como
  error, nunca como texto que una edición en línea pudiera insertar.
- **Modelos:** el catálogo en línea (`models.json`) añade GPT-6.1 Sol
  (`Gpt_61_Sol_Reasoning`) y GPT 6.0 Sol (`Gpt_6_Sol_Reasoning`), y vuelve a
  ofrecer GPT 5.6 Quick response (`Gpt_5_6_Chat`).

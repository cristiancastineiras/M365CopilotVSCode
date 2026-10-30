# M365 Copilot para VS Code: conexión desde Chrome

Conecta tu sesión web de Microsoft 365 Copilot con la extensión M365 Copilot para Visual Studio Code. Este complemento de Chrome captura el token que utiliza tu sesión del navegador y lo sincroniza con VS Code para evitar que tengas que copiarlo y pegarlo manualmente.

Su función es concreta: mantener el enlace de autenticación entre el navegador y el editor. No es un chat independiente, no sustituye a Microsoft 365 Copilot y no incluye una cuenta, una suscripción ni permisos adicionales sobre los servicios de Microsoft. Necesitas una sesión válida y acceso a las funciones que quieras utilizar.

## Para qué sirve

Si utilizas la extensión M365 Copilot para VS Code, el navegador es el lugar donde inicias sesión en Microsoft y donde la aplicación web obtiene sus credenciales. Este complemento facilita el traslado del token al editor y gestiona los intentos de renovación cuando se aproxima su caducidad.

En lugar de buscar una credencial y repetir una operación manual cada vez que cambia, puedes consultar el estado desde el popup de Chrome. Allí se distinguen el token disponible, la conexión con VS Code y la renovación. Esa separación ayuda a identificar si falta iniciar sesión, abrir el editor o recuperar la conexión local.

La extensión está pensada para acompañar tu trabajo en el editor, no para añadir otra interfaz de conversación al navegador. Las funciones de conversación y programación que ofrezca la extensión de VS Code pertenecen a ese componente y dependen de su configuración.

## Qué necesitas

- Chrome con este complemento instalado y habilitado.
- La extensión M365 Copilot para VS Code instalada en el editor.
- Acceso a Microsoft 365 Copilot con la cuenta que vayas a utilizar.
- Una sesión de Microsoft válida en el perfil de Chrome donde instalaste el complemento.
- Que el navegador pueda comunicarse con el servidor local de la extensión de VS Code.

La instalación del complemento no concede acceso a servicios que tu cuenta no tenga habilitados. Si tu organización exige una licencia, una comprobación adicional o determinadas condiciones de acceso, tendrás que cumplirlas también al utilizar esta conexión.

El enlace descrito utiliza localhost. No debes dar por hecho que un navegador en un equipo y un editor en otro puedan comunicarse mediante esta configuración. Los entornos remotos, los contenedores y las sesiones de escritorio con restricciones pueden requerir revisar dónde se ejecuta cada componente.

## Primeros pasos

1. Instala y habilita la extensión M365 Copilot para VS Code.
2. Abre el editor y comprueba que la extensión está activa.
3. En Chrome, entra en https://m365.cloud.microsoft/chat/.
4. Inicia sesión con la cuenta que quieres utilizar y envía un mensaje.
5. Abre el popup de este complemento para consultar el token y la conexión.
6. Si el token está disponible pero falta enviarlo, utiliza la acción correspondiente del popup.

Enviar un mensaje en la web permite que la aplicación realice las peticiones en las que puede detectarse el token. Tener una pestaña abierta no significa necesariamente que ya se haya capturado una credencial válida.

Si abres VS Code después del navegador, el complemento puede volver a enviar el token al detectar que el editor está disponible. No necesitas interpretar una desconexión inicial como un fallo definitivo: comprueba primero que ambos componentes están abiertos y activos.

## Cómo funciona la captura

El complemento trabaja sobre la sesión que ya utiliza la aplicación web. La captura contempla la URL del WebSocket, las cabeceras de las peticiones y la caché de autenticación de MSAL. Estos mecanismos permiten detectar el token empleado por la web sin que tengas que extraerlo a mano.

La captura no sustituye al inicio de sesión. Si Microsoft solicita que introduzcas tus credenciales, confirmes tu identidad o completes una comprobación de tu organización, debes hacerlo en la página correspondiente. La extensión no puede garantizar una renovación silenciosa cuando el servicio requiere tu intervención.

Además de la página de Microsoft 365 Copilot, el proyecto contempla páginas de Office, Outlook y Teams dentro de su integración con la sesión de Microsoft. Eso no convierte al complemento en una herramienta general para gestionar esos servicios ni implica que cualquier página abierta vaya a producir un token utilizable.

Un token es una credencial de acceso. Aunque no sea tu contraseña, debes tratarlo como información sensible. No lo publiques en incidencias, capturas, conversaciones compartidas ni archivos del repositorio.

## Sincronización con el editor

El proceso en segundo plano envía el token al servidor local de la extensión de VS Code. La dirección utilizada para esta entrega es http://localhost:51827/token.

Esta comunicación conecta dos componentes: el complemento del navegador y la extensión del editor. Que la sesión web funcione no demuestra por sí solo que el editor esté preparado para recibir el token. Del mismo modo, que VS Code esté abierto no garantiza que su extensión esté activa o que el servidor local esté disponible.

Si el editor todavía no está preparado, el complemento contempla el reenvío posterior. Puedes revisar el estado desde el popup y utilizar la acción de envío cuando esté disponible, sin tener que cerrar tu sesión de Microsoft como primera medida.

Localhost identifica el equipo desde el que se realiza la conexión. No es una dirección de soporte ni un servicio público al que debas enviar credenciales desde otro dispositivo. Evita modificar esta configuración o exponer el puerto a otras redes sin comprender las consecuencias.

## Qué muestra el popup

El popup reúne el estado del token, la conexión con VS Code y la renovación. Una ilustración representa el enlace entre Microsoft 365 y el editor, mientras los textos y las acciones indican el siguiente paso disponible.

La interfaz está disponible en español e inglés según el idioma del navegador. El nombre y la descripción del complemento también cuentan con traducciones mediante el sistema de idiomas del navegador.

La acción principal cambia según la situación. Puede ofrecer abrir Microsoft 365 Copilot, renovar el token o enviarlo a VS Code. También existe una acción para copiar el token cuando necesites realizar una operación manual.

Conviene leer cada estado por separado:

- El estado del token indica si hay una credencial disponible y permite valorar su vigencia.
- El estado de conexión indica si el complemento puede comunicarse con VS Code.
- El estado de renovación ayuda a detectar si se está intentando recuperar una credencial o si hace falta intervenir.

No interpretes una animación como garantía de que todas las operaciones han terminado. Comprueba los mensajes del popup y, si el editor sigue sin funcionar, revisa también el estado de su propia extensión.

## Renovación del token

Los tokens tienen una duración limitada. El complemento intenta renovarlos aproximadamente doce minutos antes de su caducidad para reducir las interrupciones durante el uso del editor. Este margen es un momento de actuación, no una ampliación de los permisos ni de la duración que establece Microsoft.

La renovación sigue una secuencia: primero solicita una credencial a la pestaña de Microsoft 365; después puede recargar esa pestaña y, si no hay ninguna disponible, abrir una en segundo plano. Por eso puedes observar actividad en el navegador aunque estés trabajando en VS Code.

Los intentos incorporan esperas progresivas cuando no consiguen recuperar el token. No se trata de repetir peticiones sin límite ni de garantizar que una sesión caducada pueda recuperarse automáticamente. Si hace falta iniciar sesión, el complemento muestra un aviso mediante un indicador rojo.

La renovación depende de que Chrome pueda ejecutar el complemento y de que la sesión web siga siendo válida. Cerrar el navegador, suspender el equipo, perder la conexión o tener pendiente una comprobación de identidad puede impedir que el proceso termine en el momento previsto.

Cuando vuelvas al equipo, consulta el popup antes de asumir que el token continúa vigente. Si se solicita tu intervención, abre Microsoft 365 Copilot y completa el inicio de sesión. Después comprueba que el nuevo token llega al editor.

## Acciones disponibles

### Abrir Microsoft 365 Copilot

Esta acción te lleva a la aplicación web para iniciar sesión o generar la actividad necesaria para capturar una credencial. Utilízala cuando todavía no haya un token disponible o cuando el navegador necesite recuperar una sesión válida.

Comprueba la cuenta mostrada en la web antes de continuar. En un navegador con varias sesiones de Microsoft, tener acceso a una aplicación no significa necesariamente que estés utilizando la identidad que quieres conectar al editor.

### Renovar ahora

Permite solicitar un intento de renovación sin esperar al siguiente momento programado. Resulta útil cuando el token está próximo a caducar o cuando acabas de recuperar la sesión web después de una interrupción.

La acción no evita los requisitos de autenticación del servicio. Si aparece una pantalla de acceso, una solicitud de confirmación o un aviso de tu organización, resuélvelo en la web antes de volver a comprobar el estado.

### Enviar a VS Code

Envía la credencial disponible al componente local del editor. Puede ayudarte cuando abriste VS Code después de Chrome o cuando la captura ya se ha completado, pero la conexión con el editor todavía necesita recuperarse.

Si el envío falla, revisa primero que VS Code esté abierto y que su extensión esté activa. Repetir el envío no soluciona por sí mismo un servidor local detenido, una restricción de comunicación o una credencial que ya haya caducado.

### Copiar token

Ofrece una alternativa manual para los casos en los que necesites copiar la credencial. Utilízala únicamente si conoces el destino y sabes por qué hace falta. La sincronización automática evita tener que recurrir al portapapeles en el uso habitual.

El portapapeles puede ser accesible para otras aplicaciones o formar parte de un historial. No pegues el token en buscadores, formularios de soporte, documentos compartidos ni conversaciones. Evita también incluirlo accidentalmente en una captura de pantalla.

## Permisos y finalidad

El complemento necesita permisos relacionados con su función de enlace entre la sesión web y el editor. Los permisos no equivalen a una licencia de Microsoft 365 ni conceden derechos adicionales sobre los datos de tu organización.

- Almacenamiento: conservar el estado y los datos necesarios para el funcionamiento del complemento.
- Pestañas: localizar y gestionar las páginas utilizadas en la captura, la renovación y el cierre de sesión.
- Pestaña activa: intervenir sobre la pestaña correspondiente en las acciones que lo requieren.
- Alarmas: programar las comprobaciones y los intentos de renovación.
- Cookies: gestionar las cookies de los dominios contemplados durante el cierre de sesión completo.
- Datos de navegación: eliminar almacenamiento de los orígenes correspondientes durante ese cierre.
- Acceso a dominios de Microsoft: permitir la integración con las páginas donde se utiliza la sesión.
- Acceso a localhost: entregar el token al servidor local de la extensión de VS Code.

Revisa los permisos que Chrome muestre al instalar o actualizar el complemento. Si utilizas un navegador administrado, las políticas de tu organización pueden impedir su instalación, limitar su ejecución o restringir la comunicación con servicios locales.

No desactives controles corporativos para conseguir que funcione. Consulta con la persona responsable de tu entorno si no sabes si está permitido conectar la sesión web con una herramienta del editor.

## Cerrar sesión de Microsoft

El cierre de sesión completo es una operación distinta de cerrar el popup, detener el editor o cerrar una pestaña. Está pensado para eliminar los elementos que mantienen la sesión de Microsoft en el navegador y requiere confirmación.

El proceso utiliza los puntos de cierre de sesión, cierra otras pestañas de Microsoft y elimina cookies y almacenamiento de los dominios contemplados. El orden importa porque una página que siga abierta podría volver a escribir datos de autenticación.

Esta operación puede afectar a otras aplicaciones de Microsoft abiertas en el mismo perfil de Chrome. Puedes tener que volver a identificarte en servicios como Outlook, Teams u Office. Guarda antes cualquier trabajo pendiente y revisa la confirmación.

No utilices el cierre completo como primer paso ante un problema de conexión con VS Code. Si el token existe y la web funciona, comprueba primero el editor y el enlace local. Borrar una sesión válida puede añadir pasos sin resolver la causa original.

Cerrar sesión no desinstala el complemento ni la extensión del editor. Tampoco debe confundirse con revocar todas las sesiones de una cuenta en todos sus dispositivos. Para administrar la seguridad de la cuenta, utiliza las opciones que ofrezca Microsoft o tu organización.

## Uso responsable de las credenciales

El token permite actuar dentro del alcance y la vigencia que tenga asignados. Su carácter temporal no lo convierte en información pública. Trátalo con el mismo cuidado que cualquier otra credencial de acceso.

Utiliza el complemento en equipos y perfiles de navegador que controles. En un equipo compartido, presta atención a qué cuenta está conectada y a quién puede acceder al editor, al portapapeles o al almacenamiento del perfil.

No envíes tokens para pedir ayuda. Para describir un problema suele ser suficiente indicar qué estado aparece, qué acción falla y si la aplicación web funciona. Oculta también direcciones de correo, identificadores y datos de tu organización cuando no sean necesarios.

La entrega a localhost describe el destino de sincronización con el editor; no significa que Microsoft 365 funcione sin conexión. La autenticación y el uso de sus servicios siguen dependiendo de la comunicación con Microsoft.

Sin garantías de cifrado adicional, auditorías ni certificaciones. Revisa código.

## Si no aparece ningún token

Comprueba que has iniciado sesión en Microsoft 365 Copilot dentro del mismo perfil de Chrome donde está instalado el complemento. Una sesión abierta en otro navegador o en otro perfil no es la misma sesión.

Abre la aplicación web y envía un mensaje para que se produzcan las peticiones donde puede detectarse la credencial. Si la página muestra un error de acceso, resuélvelo primero allí: el complemento no puede crear una autorización que la cuenta no tenga.

Revisa también que la extensión esté habilitada y tenga permitido ejecutarse en las páginas correspondientes. Si acabas de instalarla y la página ya estaba abierta, vuelve a cargarla para que la integración pueda iniciarse.

## Si VS Code aparece desconectado

Comprueba que el editor esté abierto y que la extensión M365 Copilot para VS Code esté instalada y activa. Después vuelve al popup y revisa si cambia el estado de conexión.

Si el token está disponible, utiliza la acción de envío cuando corresponda. No copies la credencial a destinos alternativos ni abras el puerto a otras redes para intentar solucionar una desconexión.

En remoto, comprueba dónde se ejecuta el receptor del token.

## Si la renovación requiere iniciar sesión

Abre Microsoft 365 Copilot y completa las comprobaciones que aparezcan. Un cambio de contraseña, una sesión caducada o una política de acceso pueden exigir una interacción que el complemento no puede realizar por ti.

Tras iniciar sesión, comprueba la captura y el envío al editor.

## Si cambia la cuenta utilizada

Comprueba la cuenta de Microsoft 365 Copilot y su sincronización con VS Code.

Espera a que se capture una credencial de la sesión deseada y revisa el estado de sincronización. Si decides utilizar el cierre completo para cambiar de identidad, recuerda que puede afectar a otras sesiones de Microsoft del mismo perfil.
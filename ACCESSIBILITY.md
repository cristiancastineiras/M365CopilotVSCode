# Política de accesibilidad

Este proyecto busca que sus extensiones, documentación e interfaces puedan ser utilizadas por el mayor número posible de personas, incluidas aquellas que emplean tecnologías de asistencia.

## Alcance

Esta política se aplica a:

- La extensión de Visual Studio Code.
- La extensión de navegador.
- El userscript.
- La documentación y las guías.
- Los flujos de configuración, autenticación y gestión de errores.

## Principios

Las contribuciones deben procurar:

- Permitir el uso completo mediante teclado.
- Mantener un orden de foco predecible y visible.
- Utilizar etiquetas, nombres accesibles y texto alternativo adecuados.
- No depender únicamente del color para transmitir información.
- Mantener contraste suficiente entre texto, controles y fondos.
- Respetar las preferencias del sistema, incluido el movimiento reducido.
- Mostrar mensajes de estado y error claros y comprensibles.
- Utilizar HTML semántico antes que soluciones personalizadas.
- Evitar animaciones, parpadeos o cambios visuales que dificulten el uso.
- Mantener un lenguaje directo, consistente y fácil de comprender.

## Desarrollo y revisión

Cuando un cambio afecte a una interfaz, debe revisarse, cuando corresponda:

- Navegación completa mediante teclado.
- Indicadores de foco visibles.
- Lectura mediante tecnologías de asistencia.
- Escalado y zoom sin pérdida de contenido o funcionalidad.
- Contraste en temas claros, oscuros y de alto contraste.
- Estados de carga, éxito, advertencia y error.
- Preferencias de movimiento reducido.
- Localización en inglés y español.

Las pruebas automatizadas no sustituyen la revisión manual de los flujos principales.

## Informar de un problema

Los problemas de accesibilidad pueden comunicarse mediante una incidencia del repositorio.

Incluye, cuando sea posible:

- Componente y versión afectados.
- Tecnología de asistencia utilizada.
- Sistema operativo, navegador o versión de Visual Studio Code.
- Pasos para reproducir el problema.
- Comportamiento esperado y comportamiento actual.
- Capturas o grabaciones que no contengan datos sensibles.

No incluyas tokens, credenciales, datos personales ni información privada.

## Contribuciones

Las correcciones y mejoras de accesibilidad son bienvenidas. Antes de enviar un pull request, consulta [CONTRIBUTING.md](./CONTRIBUTING.md) y describe cómo se ha validado el cambio.

## Limitaciones conocidas

Si se identifica una limitación que no puede corregirse de inmediato, se documentará junto con su impacto y, cuando sea posible, una alternativa de uso.
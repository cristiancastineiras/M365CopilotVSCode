# Contribuir

Gracias por contribuir a este proyecto. Antes de enviar cambios, revisa el [Código de conducta](./CODE_OF_CONDUCT.md).

## Requisitos

- Node.js compatible con las versiones indicadas por el proyecto.
- `pnpm`.
- Visual Studio Code para desarrollar y probar la extensión.

## Preparación

Instala las dependencias desde la raíz:

```bash
pnpm install
```

Comandos principales:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

## Estructura del repositorio

- `extensiones/vscode`: extensión de Visual Studio Code.
- `extensiones/browser`: extensión para navegadores.
- `packages/core`: funcionalidad compartida.
- `.changeset`: cambios destinados a publicación.

## Flujo de trabajo

1. Crea una rama desde la rama principal.
2. Realiza cambios pequeños y relacionados.
3. Añade o actualiza pruebas cuando corresponda.
4. Ejecuta compilación, comprobación de tipos, lint y pruebas.
5. Añade un changeset si el cambio afecta a una versión publicada.
6. Abre un pull request con una descripción clara.

## Commits

Utiliza mensajes compatibles con Conventional Commits:

```text
feat(vscode): añade una nueva herramienta
fix(browser): corrige la renovación del token
docs: actualiza la guía de instalación
```

Usa el modo imperativo y evita mezclar cambios no relacionados.

## Pull requests

El pull request debe incluir:

- Motivo y alcance del cambio.
- Componentes afectados.
- Pasos utilizados para validarlo.
- Incidencias relacionadas.
- Capturas o vídeos si modifica una interfaz visual.
- Posibles incompatibilidades o riesgos.

Antes de solicitar revisión:

- Revisa tu propio diff.
- Resuelve errores de compilación, tipos, lint y pruebas.
- Mantén la rama actualizada respecto a la rama principal.
- No incluyas secretos, tokens, datos personales ni archivos generados innecesarios.

## Incidencias

Antes de abrir una incidencia, comprueba que no exista otra equivalente. Incluye:

- Pasos reproducibles.
- Resultado esperado.
- Resultado real.
- Versión y entorno.
- Registros relevantes sin secretos ni datos personales.

Para cambios amplios o incompatibles, abre primero una propuesta para acordar el alcance.

## Seguridad

No publiques vulnerabilidades explotables en incidencias públicas. Comunícalas de forma privada a las personas responsables del repositorio.

## Licencia

Al enviar una contribución, aceptas que se distribuya bajo la licencia del repositorio y declaras que tienes derecho a aportarla.
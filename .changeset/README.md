# Changesets

Este directorio contiene los archivos de changesets para gestionar versiones y changelogs.

## Cómo usar

### 1. Crear un changeset

Cuando hagas cambios que deban reflejarse en una nueva versión:

```bash
pnpm changeset
```

Esto te guiará por un proceso interactivo donde:
- Seleccionas qué tipo de cambio es (major, minor, patch)
- Describes el cambio

Se creará un archivo markdown en `.changeset/` con un nombre aleatorio.

### 2. Actualizar versiones

Cuando estés listo para crear una nueva versión:

```bash
pnpm version
```

Esto:
- Actualiza la versión en `package.json`
- Actualiza o crea `CHANGELOG.md`
- Elimina los archivos de changeset consumidos

### 3. Publicar

Cuando quieras publicar la extensión:

```bash
pnpm release
```

Esto construye y publica el paquete.

## Tipos de cambios

- **patch** (0.0.X): Correcciones de bugs, cambios menores
- **minor** (0.X.0): Nuevas características, cambios compatibles
- **major** (X.0.0): Cambios que rompen compatibilidad

# 🚀 WXT Modern Extension

Un proyecto de extensión de navegador ultra-rápido construido con las últimas tecnologías.

## ✨ Stack Tecnológico

- **[WXT](https://wxt.dev/)** - Framework moderno para extensiones de navegador
- **React 18** - UI library
- **TypeScript 5** - Type safety
- **Vite 8** (beta) - Build tool ultra-rápido
- **Rolldown** - Bundler de próxima generación
- **OXC** - Transformaciones ultra-rápidas
- **pnpm** - Package manager eficiente

## 🛠️ Instalación

```bash
# Instalar dependencias
pnpm install

# Preparar WXT
pnpm run postinstall
```

## 🚀 Desarrollo

```bash
# Chrome/Edge
pnpm dev

# Firefox
pnpm dev:firefox
```

Luego carga la extensión desde `.output/chrome-mv3` (o `firefox-mv3`) en tu navegador:
- **Chrome**: `chrome://extensions` → Activar modo desarrollador → Cargar extensión sin empaquetar
- **Firefox**: `about:debugging` → Este Firefox → Cargar complemento temporal

## 📦 Build

```bash
# Chrome/Edge
pnpm build

# Firefox
pnpm build:firefox

# Crear ZIP para distribución
pnpm zip
```

## 📁 Estructura del Proyecto

```
├── entrypoints/
│   ├── background.ts      # Service worker / background script
│   ├── content.ts         # Content script
│   └── popup/
│       ├── index.html     # Popup HTML
│       ├── main.tsx       # Popup entry point
│       ├── App.tsx        # Popup React component
│       └── style.css      # Estilos globales
├── wxt.config.ts          # Configuración de WXT
├── tsconfig.json          # Configuración de TypeScript
└── package.json
```

## 🎯 Características

- ⚡ Hot Module Replacement (HMR) en desarrollo
- 📦 Tree-shaking automático
- 🎨 React con TypeScript
- 🔧 Configuración optimizada para producción
- 🌐 Soporte multi-navegador (Chrome, Firefox, Edge, Safari)
- 📝 Type-safe con definiciones de Chrome APIs

## 📚 Documentación

- https://wxt.dev/
- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/)
- https://vitejs.dev/

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Abre un issue o pull request.

## 📄 Licencia

MIT
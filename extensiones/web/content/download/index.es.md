---
title: "Descargar M365 Copilot for VS Code"
heading: "Descarga el pack"
slug: descarga
layout: download
description: "Descargas directas de la extensión de VS Code de M365 Copilot, la extensión de Chrome, Edge y Firefox y el userscript de Tampermonkey, desde la última versión de GitHub."
---

## Instalar la extensión de navegador

La extensión de navegador no está en las tiendas: cargas el archivo de la release. Lleva un minuto.

### Chrome

1. Descomprime `m365-copilot-vscode-extension-chrome.zip` en una carpeta que vayas a conservar (el navegador la lee desde ahí).
2. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige esa carpeta.

### Edge

Igual que en Chrome, con `m365-copilot-vscode-extension-edge.zip` y `edge://extensions`.

### Firefox

- **Permanente:** abre el archivo `.xpi` firmado en Firefox (o arrástralo a `about:addons`). Cuando una release no trae `.xpi`, el botón de Firefox te da el `.zip`.
- **Temporal, sin firma:** `about:debugging` → **Este Firefox** → **Cargar complemento temporal** y elige el `.zip` (no hace falta descomprimirlo). Firefox lo quita al cerrarse.
- **Developer Edition, Nightly o ESR:** pon `xpinstall.signatures.required` a `false` en `about:config`, y luego `about:addons` → ⚙ → **Instalar complemento desde archivo**.

Firefox 140 o posterior.

## Instalar la extensión de VS Code desde un archivo

Abre la vista de Extensiones de VS Code, pulsa el menú `…` y elige **Instalar desde VSIX…**. O desde una terminal: `code --install-extension m365-copilot-vscode-X.Y.Z.vsix`.

## Después, conecta

Abre [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) y envía un mensaje. El popup de la extensión de navegador se pone en verde y VS Code ya tiene tu token.

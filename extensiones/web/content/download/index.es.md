---
title: "Descargar M365 Copilot for VS Code"
heading: "Descarga el pack"
slug: descarga
layout: download
description: "Instala la extensión de VS Code de M365 Copilot, la extensión de navegador desde la Chrome Web Store (Chrome y Edge) o Firefox Add-ons, y el userscript de Tampermonkey."
---

## Instalar la extensión de navegador

### Chrome y Edge

Instálala desde la [Chrome Web Store](https://chromewebstore.google.com/detail/cdeegiifkgahagfcjhedkdcfbpipffdd). Edge también la instala desde ahí: la primera vez te pide **Permitir extensiones de otras tiendas**.

### Firefox

Instálala desde [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/microsoft-365-copilot-vs-code/). Firefox 140 o posterior.

Desde la tienda se actualiza sola: cada versión nueva llega en cuanto la tienda termina de revisarla.

### Sin tienda

Cada [release](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest) trae también los `.zip`:

- **Chrome o Edge:** descomprime `m365-copilot-vscode-extension-chrome.zip` (o `-edge.zip`) en una carpeta que vayas a conservar (el navegador la lee desde ahí), abre `chrome://extensions` (o `edge://extensions`), activa el **Modo de desarrollador**, pulsa **Cargar descomprimida** y elige esa carpeta.
- **Firefox, temporal:** `about:debugging` → **Este Firefox** → **Cargar complemento temporal** y elige `m365-copilot-vscode-extension-firefox.zip` (no hace falta descomprimirlo). Firefox lo quita al cerrarse.
- **Developer Edition, Nightly o ESR:** pon `xpinstall.signatures.required` a `false` en `about:config`, y luego `about:addons` → ⚙ → **Instalar complemento desde archivo** con el `.zip`.

## Instalar la extensión de VS Code desde un archivo

Abre la vista de Extensiones de VS Code, pulsa el menú `…` y elige **Instalar desde VSIX…**. O desde una terminal: `code --install-extension m365-copilot-vscode-X.Y.Z.vsix`.

## Después, conecta

Abre [Microsoft 365 Copilot](https://m365.cloud.microsoft/chat/) y envía un mensaje. El popup de la extensión de navegador se pone en verde y VS Code ya tiene tu token.

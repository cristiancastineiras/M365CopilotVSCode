# M365 Copilot — browser extension

**English** · [Español](README.es.md)

Companion of the [M365 Copilot for VS Code](../vscode) extension. It captures
your **Microsoft 365 Copilot** session token on the M365 website and keeps it in
sync with VS Code, so you never copy and paste a token by hand.

- **Capture:** on `m365.cloud.microsoft` (and Office/Outlook/Teams pages), a
  content script running in the page reads the token the web app already uses
  (WebSocket URL, request headers and the MSAL cache).
- **Sync:** the background sends it to the VS Code extension's local server
  (`http://localhost:51827/token`) and resends it when VS Code starts later.
- **Renewal:** about 12 minutes before the token expires it asks the M365 tab
  for a fresh one, then reloads that tab, then opens one in the background if
  there is none — with back-off, and a red badge when you have to sign in.

The popup shows an animated **M365 → VS Code** illustration — the VS Code logo
stays grey until VS Code has the token, then lights up and the token flows along
the arrow — plus the token, endpoint, VS Code connection and renewal state, and
**Send to VS Code**, **Copy token** and **Renew now** buttons. The capture logic
and the illustration live in `@m365copilot/core` and are shared with the
Tampermonkey userscript, so both behave the same. It is
available in **English and Spanish** (following the browser's language), as are
the extension's name and description.

## Install

Download `m365-copilot-vscode-extension-chrome.zip` or `…-firefox.zip` from the
[releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases),
unzip it and:

- **Chrome / Edge:** `chrome://extensions` → *Developer mode* → *Load unpacked*.
- **Firefox:** `about:debugging` → *This Firefox* → *Load Temporary Add-on*.

Then open <https://m365.cloud.microsoft/chat/> and send a message.

## Development

```bash
pnpm install            # from the repository root
pnpm dev                # Chrome/Edge with HMR
pnpm dev:firefox
pnpm build              # → ../../releases/chrome
pnpm zip && pnpm zip:firefox
pnpm typecheck
pnpm test               # refresh policy and refresh cycle against a fake `chrome`
```

Stack: [WXT](https://wxt.dev/) + React 18 + TypeScript. The shared contract with
VS Code (port, paths, profile types, JWT helpers) lives in
[`@m365copilot/core`](../../packages/core).

```
entrypoints/
  background.ts            service worker: storage, sync with VS Code, renewal
  content.ts               ISOLATED-world bridge between the page and the background
  interceptor.content.ts   MAIN-world capture (WebSocket / fetch / XHR / MSAL cache)
  popup/                   React popup
utils/
  i18n.ts                  popup and error texts (en / es)
  refreshPolicy.ts         pure renewal decision (tested)
  tokenRefresher.ts        renewal cycle on chrome.alarms (tested)
public/
  _locales/{en,es}/        extension name, description and toolbar tooltip
```

**Translations:** UI text is in [`utils/i18n.ts`](utils/i18n.ts) (the Spanish
catalog is typed against the English keys); the manifest's name, description and
tooltip are in `public/_locales/<language>/messages.json`.

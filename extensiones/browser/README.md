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

The popup — light and clean, in Segoe UI with the look of Windows 11 — shows an
animated **M365 → VS Code** illustration: a three-ring signal between the logos
spins while it looks for the token and for VS Code, and turns into a signal
pointing at VS Code once it is connected (VS Code stays grey until then). Below,
the token, VS Code connection and renewal state, and one main button that is
always the next step (**Open M365 Copilot**, **Renew now** or **Send to VS
Code**) plus **Copy token**. The capture logic
and the illustration live in `@m365copilot/core` and are shared with the
Tampermonkey userscript, so both behave the same. It is
available in **English and Spanish** (following the browser's language), as are
the extension's name and description.

## Install

Download it from the
[releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases):

- **Chrome / Edge:** unzip `m365-copilot-vscode-extension-chrome.zip` →
  `chrome://extensions` → *Developer mode* → *Load unpacked*.
- **Firefox (permanent):** open `m365-copilot-vscode-extension-firefox.xpi` in
  Firefox (or drag it onto `about:addons`). It is the Mozilla-signed build, the
  only kind Firefox Release installs permanently; releases without the `.xpi`
  were not signed.
- **Firefox (temporary, no signature needed):** `about:debugging` → *This
  Firefox* → *Load Temporary Add-on* → choose
  `m365-copilot-vscode-extension-firefox.zip` (no need to unzip it). Firefox
  removes it when it closes.
- **Firefox Developer Edition / Nightly / ESR:** set
  `xpinstall.signatures.required` to `false` in `about:config` and then
  `about:addons` → ⚙ → *Install Add-on From File* with the `.zip`.

Firefox 128 or later. If Firefox says the add-on "appears to be corrupt", the
zip is 2.0.0 or older (it had no add-on ID): download it again.

Then open <https://m365.cloud.microsoft/chat/> and send a message.

## Development

```bash
pnpm install            # from the repository root
pnpm dev                # Chrome/Edge with HMR
pnpm dev:firefox
pnpm build              # → ../../releases/chrome
pnpm zip && pnpm zip:firefox
pnpm sign:firefox       # Mozilla-signed .xpi (AMO, unlisted): needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET
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

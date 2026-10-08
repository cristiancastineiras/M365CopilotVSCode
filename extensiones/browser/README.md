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

## Signing out of Microsoft

The popup’s **Sign out of Microsoft** button (it confirms in the button itself)
is what makes a real renewal possible: it deletes this browser’s Microsoft
session and leaves you on the sign-in page.

Why it is needed: the Copilot token is handed out by the Microsoft session
(cookies of `login.microsoftonline.com` plus MSAL’s token cache), so while that
session is there, asking for another token gets one in silence without asking
anything. The button, in order: walks Microsoft’s sign-out endpoints (Entra ID,
personal account and Office) **before** deleting anything — they need the
cookies to know which session to end —, closes the Microsoft tabs, deletes
every cookie of Microsoft’s domains in every cookie container (partitioned ones
included) and clears localStorage, IndexedDB, Cache Storage, service workers
and FileSystem of every Microsoft site.

The VS Code extension can ask for the same thing with its **Sign out and sign
in again** command: it opens this site with an id in the URL, and the extension
only obeys if it matches the one VS Code has pending on its local server, since
any site can link a URL. If the browser was closed, the request is picked up on
the next heartbeat (up to a minute).

### Permissions

| Permission | What for |
|------------|----------|
| `storage` | The captured token and the auto-renewer’s state. |
| `tabs`, `activeTab` | Finding, reloading or opening the M365 Copilot tab. |
| `alarms` | The auto-renewer’s 1-min heartbeat (in MV3 the background sleeps). |
| `cookies` | Deleting Microsoft’s session cookies on sign-out. |
| `browsingData` | Clearing MSAL’s cache and the site storage of Microsoft’s sites. |
| `http://localhost/*` | Sending the token to the VS Code extension’s local server. |
| `*://*.microsoftonline.com/*` and Microsoft’s other domains | The two APIs above require permission over every cookie and origin they touch. The list is defined by `signOut.ts` in `packages/core`. |

`cookies`, `browsingData` and Microsoft’s domains are **new**: on update the
browser asks for them again and the extension stays disabled until you accept.

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

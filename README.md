# M365 Copilot for VS Code

[![VS Marketplace version](https://flat.badgen.net/vs-marketplace/v/m365-copilot-vscode.m365-copilot-vscode?label=VS%20Marketplace&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Installs](https://flat.badgen.net/vs-marketplace/i/m365-copilot-vscode.m365-copilot-vscode?label=installs&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Downloads](https://flat.badgen.net/vs-marketplace/d/m365-copilot-vscode.m365-copilot-vscode?label=downloads&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode)
[![Rating](https://flat.badgen.net/vs-marketplace/rating/m365-copilot-vscode.m365-copilot-vscode?label=rating&color=0f6cbd)](https://marketplace.visualstudio.com/items?itemName=m365-copilot-vscode.m365-copilot-vscode&ssr=false#review-details)

[![Latest release](https://img.shields.io/github/v/release/cristiancastineiras/M365CopilotVSCode?label=release&logo=github&color=24292f)](https://github.com/cristiancastineiras/M365CopilotVSCode/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/cristiancastineiras/M365CopilotVSCode/release.yml?label=build&logo=githubactions&logoColor=white)](https://github.com/cristiancastineiras/M365CopilotVSCode/actions/workflows/release.yml)
[![GitHub downloads](https://img.shields.io/github/downloads/cristiancastineiras/M365CopilotVSCode/total?label=GitHub%20downloads&logo=github&color=24292f)](https://github.com/cristiancastineiras/M365CopilotVSCode/releases)
[![Stars](https://img.shields.io/github/stars/cristiancastineiras/M365CopilotVSCode?label=stars&logo=github&color=e3b341&style=flat)](https://github.com/cristiancastineiras/M365CopilotVSCode/stargazers)
[![Issues](https://img.shields.io/github/issues/cristiancastineiras/M365CopilotVSCode?label=issues&logo=github)](https://github.com/cristiancastineiras/M365CopilotVSCode/issues)
[![License: AGPL-3.0](https://img.shields.io/github/license/cristiancastineiras/M365CopilotVSCode?label=license&color=blue)](LICENSE)
[![Architecture diagram](https://gitdiagram.com/diagram-badge.svg)](https://gitdiagram.com/cristiancastineiras/m365copilotvscode?utm_source=readme&utm_medium=badge)

**English** · [Español](README.es.md)

**Website:** <https://cristiancastineiras.github.io/M365CopilotVSCode/> — downloads, step-by-step guide and FAQ (source in [`extensiones/web`](extensiones/web), built with Hugo and published by [`pages.yml`](.github/workflows/pages.yml)).

Monorepo (pnpm workspaces + Turborepo) of the pieces that bring your
**Microsoft 365 Copilot** subscription into VS Code — as chat models, the
`@m365` chat participant, editor and Source Control actions, an auto-commit
that commits finished work with documented messages, code review as
comments on the lines, an account in VS Code's Accounts menu, agent tools, a
local project index (RAG) that gives it the context of your code, web search and
inline completions — and keep its token in sync. Everything is available in
**English and Spanish**.

> **Legal Notice**
>
> M365CopilotVSCode is an independent open source project and is not affiliated with, endorsed by, sponsored by, or approved by Microsoft Corporation.
>
> Users are responsible for complying with all applicable Microsoft terms, licenses, and policies when using this software.
>
> This software is provided "AS IS" without warranties of any kind.

```
.
├── extensiones/
│   ├── browser/     Browser extension (WXT + React). Captures the token on the
│   │                Copilot website and sends it to VS Code's local server.
│   └── vscode/      VS Code extension. Runs the local server, stores the
│                    profile and exposes Copilot in the chat and the editor.
├── packages/
│   ├── core/        @m365copilot/core — shared logic and CONTRACTS. The root
│   │                (profile types, JWT decoding, token classification, local
│   │                server constants) is browser-safe; `/bizchat` is the Node
│   │                protocol layer — BizChat client, tool protocol, model
│   │                catalog, i18n — that every client is built on.
│   └── tui/         Terminal chat. A client of `@m365copilot/core/bizchat`.
├── turbo.json       Task pipeline (build/dev/typecheck/test…).
├── tsconfig.base.json  Common TypeScript options.
└── pnpm-workspace.yaml
```

| Package           | Docs                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| VS Code extension | [README](extensiones/vscode/README.md) · [guide](extensiones/vscode/Guide.md) |
| Browser extension | [README](extensiones/browser/README.md)                                       |

## Getting started

```bash
pnpm install
pnpm build        # core → VS Code extension → browser extension
pnpm test
pnpm package      # .vsix, Chrome/Edge/Firefox zips and userscript into releases/
```

Requires Node ≥ 22.18 and pnpm 10.

`releases/` is git-ignored: the official artifacts (VS Code, Chrome, Edge,
Firefox and the Tampermonkey userscript) are built by
[`.github/workflows/release.yml`](.github/workflows/release.yml) when a
`vX.Y.Z` tag is pushed and published only on the
[GitHub releases](https://github.com/cristiancastineiras/M365CopilotVSCode/releases).

## Languages

- **VS Code extension:** `m365copilot.language` = `auto` (follows VS Code's
  display language) / `en` / `es`. It changes notifications, status bar, tool
  results and the instructions sent to the model. Manifest text (commands,
  settings, walkthrough) comes from `package.nls.json` / `package.nls.es.json`.
- **Browser extension:** follows the browser's language; manifest text in
  `public/_locales/`, UI text in `utils/i18n.ts`.
- **Userscript:** follows the browser's language.
- **Docs:** every README/guide has an English and a Spanish version.

## Updating the models

[`models.json`](models.json) is the online model catalog the VS Code extension
downloads (on start and every 12 h): add an entry — `tone` as the M365 Copilot
web app sends it, plus `name` and an `en`/`es` `detail` — and push to `main`;
every user gets it without a release. `"hidden": true` retires a model, even a
built-in one. The tests check that the file parses.

## Releasing

Versions are managed with [Changesets](https://github.com/changesets/changesets);
the three packages always move together.

```bash
pnpm changeset          # describe the change
pnpm version-packages   # bump versions + CHANGELOGs
git commit -am "chore: release vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which builds everything
and publishes a GitHub release with the `.vsix` and both browser zips.

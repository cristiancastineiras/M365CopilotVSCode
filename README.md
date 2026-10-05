# M365 Copilot → VS Code · Monorepo

**English** · [Español](README.es.md)

Monorepo (pnpm workspaces + Turborepo) of the pieces that bring your
**Microsoft 365 Copilot** subscription into VS Code — as chat models, the
`@m365` chat participant, editor and Source Control actions, agent tools and
inline completions — and keep its token in sync. Everything is available in
**English and Spanish**.

```
.
├── extensiones/
│   ├── browser/     Browser extension (WXT + React). Captures the token on the
│   │                Copilot website and sends it to VS Code's local server.
│   └── vscode/      VS Code extension. Runs the local server, stores the
│                    profile and exposes Copilot in the chat and the editor.
├── packages/
│   └── core/        @ms365copilot/core — shared logic and CONTRACTS: profile
│                    types, JWT decoding, token classification and the local
│                    server constants (port/path).
├── turbo.json       Task pipeline (build/dev/typecheck/test…).
├── tsconfig.base.json  Common TypeScript options.
└── pnpm-workspace.yaml
```

| Package | Docs |
|---------|------|
| VS Code extension | [README](extensiones/vscode/README.md) · [guide](extensiones/vscode/Guide.md) |
| Browser extension | [README](extensiones/browser/README.md) |

## Getting started

```bash
pnpm install
pnpm build        # core → VS Code extension → browser extension
pnpm test
pnpm package      # .vsix + Chrome/Firefox zips into releases/
```

Requires Node ≥ 22.18 and pnpm 10.

## Languages

- **VS Code extension:** `ms365copilot.language` = `auto` (follows VS Code's
  display language) / `en` / `es`. It changes notifications, status bar, tool
  results and the instructions sent to the model. Manifest text (commands,
  settings, walkthrough) comes from `package.nls.json` / `package.nls.es.json`.
- **Browser extension:** follows the browser's language; manifest text in
  `public/_locales/`, UI text in `utils/i18n.ts`.
- **Userscript:** follows the browser's language.
- **Docs:** every README/guide has an English and a Spanish version.

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

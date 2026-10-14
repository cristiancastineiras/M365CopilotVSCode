/**
 * Two lines about where the model is working, prepended to chat and agent
 * prompts: the operating system and shell — so `m365_run_command` and the
 * native terminal tool get commands that run there (Windows PowerShell 5.1
 * has no `&&`) — the absolute workspace root(s) — VS Code's native tools
 * want absolute paths, and the model had no way to know them — and today's
 * date, for "latest version" questions and changelogs.
 *
 * Kept free of the `vscode` import so test/e2e.mts can check it; the values
 * are gathered by `currentEnvironment` in editorContext.ts.
 */
import { t } from "./i18n";

export interface EnvironmentInfo {
  /** `process.platform`. */
  readonly platform: string;
  /** `vscode.env.shell`: the default terminal shell's executable, if known. */
  readonly shell?: string;
  readonly folders: readonly { readonly name: string; readonly path: string }[];
  /** Local date, `YYYY-MM-DD`. */
  readonly date: string;
}

const PLATFORMS: Readonly<Record<string, string>> = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
};

/** A readable shell name, with the one quirk models get wrong most: `&&` in Windows PowerShell. */
export function describeShell(shell: string | undefined): string | undefined {
  if (!shell) return undefined;
  const name =
    shell
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.toLowerCase()
      .replace(/\.exe$/, "") ?? "";
  if (name === "powershell") return t("env.shell.windowsPowerShell");
  if (name === "pwsh") return "PowerShell 7";
  if (name === "cmd") return "cmd.exe";
  return name || undefined;
}

export function renderEnvironment(info: EnvironmentInfo): string {
  const system = [PLATFORMS[info.platform] ?? info.platform, describeShell(info.shell)]
    .filter(Boolean)
    .join(" · ");
  const lines = [t("env.line", system, info.date)];
  if (info.folders.length === 1) lines.push(t("env.root", info.folders[0]?.path ?? ""));
  else if (info.folders.length > 1) {
    lines.push(
      t("env.roots", info.folders.map((folder) => `${folder.name} (${folder.path})`).join(", ")),
    );
  }
  return lines.join("\n");
}

/** `YYYY-MM-DD` in local time. */
export function localDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

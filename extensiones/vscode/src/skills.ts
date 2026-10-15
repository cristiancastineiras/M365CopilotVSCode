/**
 * Working styles injected into every chat and `@m365` prompt, distilled from
 * the Claude Code skills Ponytail, agent-skills and Graphify. The full skills
 * (hundreds of KB) do not fit in a BizChat turn, so each one is a short rule
 * set in the locale catalogs. Kept free of the `vscode` import so test/e2e.mts
 * can check it; the flags are read by `currentSkills` in editorContext.ts.
 */
import { t } from "./i18n";

export interface SkillFlags {
  readonly ponytail: boolean;
  readonly agentSkills: boolean;
  /** Graphify only helps when the workspace already has `graphify-out/graph.json`. */
  readonly graphify: boolean;
}

export function renderSkills(flags: SkillFlags): string {
  return [
    flags.ponytail ? t("prompt.skill.ponytail") : "",
    flags.agentSkills ? t("prompt.skill.agentSkills") : "",
    flags.graphify ? t("prompt.skill.graphify") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

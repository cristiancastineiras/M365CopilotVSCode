/**
 * When the model answers a turn that offered tools without calling any, two
 * cases are worth one more try instead of showing the answer:
 *
 *  - it "gives up": says it cannot reach the files or run anything, and asks the
 *    user to paste or upload them — although the tools are right there. A
 *    stochastic reflex of M365's chat models, worst on the first step;
 *  - it worked in M365's own cloud sandbox (`/mnt/data`, `/home/claude`,
 *    `/home/oai`, files handed back as Teams `asyncgw` links): a real machine, but
 *    not the user's, so whatever it found or made there is not in the workspace.
 *    GPT-6 Sol and Claude Sonnet 5 do it on their own.
 *
 * Both measured by github.com/cramt/m365-copilot-proxy (MIT, © 2026 Alexandra
 * Østermark; packages/core/src/tools.ts, docs §5): a retry with a note that says
 * what is true fixes most of them. Their phrase lists are English and Turkish;
 * these are written for this extension, in English and Spanish, kept to the
 * first person or to the workspace so that an ordinary answer does not match.
 *
 * Deliberately vscode-free (the chat provider, `@m365` and the sub-agents use it,
 * and the tests).
 */

/** Below this, a reply is too short to judge. */
const MIN_CHARS = 12;

/** What the reply would need to be about to count as giving up on the workspace. */
const WORKSPACE_EN = String.raw`(?:files?|folders?|director(?:y|ies)|workspace|repo(?:sitory)?|project|code ?base|file ?system|terminal|shell|commands?|your (?:machine|computer|environment|system))`;
const WORKSPACE_ES = String.raw`(?:archivos?|ficheros?|carpetas?|directorios?|workspace|espacio de trabajo|repositorio|proyecto|c[oó]digo fuente|sistema de archivos|terminal|consola|comandos?|tu (?:m[aá]quina|equipo|ordenador|entorno|sistema))`;
/** What the user is asked to hand over. */
const CONTENT_EN = String.raw`(?:the\s+|your\s+)?(?:contents?|code|files?|output)`;
const CONTENT_ES = String.raw`(?:el|los|tu|tus)\s+(?:contenido|c[oó]digo|archivos?|ficheros?|salida)`;

const GIVE_UP_PATTERNS: readonly RegExp[] = [
  // English: "I can't access your files", "I don't have access to the workspace".
  new RegExp(
    String.raw`\b(?:i\s+(?:can(?:'|’)?t|cannot|am\s+(?:not\s+able|unable)\s+to|don(?:'|’)?t\s+have\s+(?:a\s+way|the\s+ability)\s+to)|unable\s+to)\s+(?:directly\s+)?(?:access|read|open|see|view|inspect|list|browse|run|execute|edit|modify|write\s+to|create)\b[^.\n]{0,60}${WORKSPACE_EN}`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:don(?:'|’)?t|do\s+not|no\s+longer)\s+have\s+(?:direct\s+)?access\s+to\b[^.\n]{0,40}${WORKSPACE_EN}`,
    "i",
  ),
  // …and hands the job back: "paste the contents here", "could you share the file".
  new RegExp(
    String.raw`\bpaste\s+(?:it|them|${CONTENT_EN})\s+(?:here|below|in\s+(?:the|this)\s+chat)\b`,
    "i",
  ),
  new RegExp(String.raw`\bpaste\s+(?:here\s+)?(?:the\s+)?contents?\s+of\b`, "i"),
  new RegExp(
    String.raw`\b(?:could|can|would)\s+you\s+(?:please\s+)?(?:paste|share|upload|send|provide)\s+(?:me\s+)?${CONTENT_EN}\b`,
    "i",
  ),
  /\b(?:my\s+)?(?:tools?|functions?|file[- ]editing|shell)\s+(?:are|is)\s+(?:not\s+available|unavailable|not\s+accessible|not\s+enabled)\s+(?:to\s+me|here|in\s+this)/i,
  /\b(?:restart|start\s+over|re-?run)\s+(?:the\s+|this\s+)?(?:task|session|conversation)\s+in\s+(?:a\s+)?(?:coding|tool|shell)[- ]enabled/i,
  // "I don't have a functioning shell tool", "the session does not expose the filesystem".
  /\bi\s+(?:don(?:'|’)?t|do\s+not)\s+have\s+(?:a\s+|any\s+)?(?:functioning\s+|working\s+|usable\s+)?(?:shell|terminal|tools?|file[- ]system)\b/i,
  /\b(?:session|environment|runtime)\s+(?:does\s+not|doesn(?:'|’)?t|cannot)\s+(?:expose|mount|provide)\s+(?:the\s+|a\s+)?(?:local\s+)?(?:repository\s+)?(?:file\s?system|files)/i,
  // Spanish: "no puedo acceder a tus archivos", "no tengo acceso al repositorio".
  new RegExp(
    String.raw`\bno\s+(?:puedo|soy\s+capaz\s+de|tengo\s+(?:forma|manera|c[oó]mo)\s+de)\s+(?:acceder|leer|abrir|ver|consultar|revisar|inspeccionar|listar|explorar|ejecutar|lanzar|editar|modificar|escribir|crear)\b[^.\n]{0,60}${WORKSPACE_ES}`,
    "i",
  ),
  new RegExp(
    String.raw`\bno\s+(?:tengo|dispongo\s+de)\s+(?:acceso\s+(?:directo\s+)?al?|forma\s+de\s+acceder\s+al?)\b[^.\n]{0,40}${WORKSPACE_ES}`,
    "i",
  ),
  // …y devuelve el trabajo: «pégame el contenido», «¿puedes compartir el archivo?».
  new RegExp(
    String.raw`\b(?:p[eé]game|p[aá]same|comp[aá]rteme|env[ií]ame|proporci[oó]name|s[uú]beme)\s+(?:aqu[ií]\s+)?${CONTENT_ES}\b`,
    "i",
  ),
  /\b(?:pega|copia)\s+aqu[ií]\b/i,
  new RegExp(
    String.raw`\b(?:puedes|podr[ií]as)\s+(?:pegar|compartir|subir|enviar|pasar)(?:me)?\s+(?:aqu[ií]\s+)?${CONTENT_ES}\b`,
    "i",
  ),
  /\b(?:mis\s+|las\s+)?herramientas\s+no\s+(?:est[aá]n|parecen\s+estar)\s+(?:disponibles|activas|habilitadas)/i,
  /\bno\s+tengo\s+(?:acceso\s+a\s+)?(?:las\s+|mis\s+)?herramientas\b/i,
  // «no puedo usar herramientas», «no dispongo de terminal», «esta sesión no me da acceso».
  /\bno\s+(?:puedo\s+(?:usar|utilizar|llamar\s+a|invocar)|dispongo\s+de|cuento\s+con)\s+(?:las\s+|mis\s+|ninguna\s+|una\s+)?(?:herramientas?|terminal|shell|consola)\b/i,
  /\b(?:esta\s+)?(?:sesi[oó]n|entorno)\s+no\s+(?:me\s+)?(?:da|permite|ofrece|expone)\s+(?:el\s+)?acceso\b/i,
];

/**
 * Claims of having changed something. Only meaningful in a conversation where no
 * tool has run: a model that did the work called one (github.com/cramt/m365-copilot-proxy,
 * looksLikeHallucinatedCompletion).
 */
const FAKE_COMPLETION_PATTERNS: readonly RegExp[] = [
  /\bI(?:'ve|’ve|\s+have|\s+just)?\s+(?:created|wrote|written|replaced|updated|saved|applied|added|modified|implemented|rewrote|fixed|changed|ran|executed)\b/i,
  /\b(?:the\s+)?(?:file|files|change|changes|code|fix)\s+(?:has|have|is|was|were)\s+(?:been\s+)?(?:created|replaced|updated|saved|written|applied|added|modified)\b/i,
  /\b(?:he|ya\s+he)\s+(?:creado|escrito|reemplazado|actualizado|guardado|aplicado|a[nñ]adido|modificado|implementado|corregido|cambiado|ejecutado)\b/i,
  /\b(?:el\s+archivo|los\s+archivos|el\s+cambio|los\s+cambios|el\s+c[oó]digo)\s+(?:ha|han|ya\s+est[aá]n?)\s+(?:sido\s+)?(?:creado|actualizado|guardado|aplicado|modificado|corregido)s?\b/i,
];

/** Anchored to what only M365's own runtime writes: its paths and its Teams artifact links. */
const REMOTE_SANDBOX_PATTERNS: readonly RegExp[] = [
  /sandbox:\/mnt\/data\b/i,
  /(?:^|[\s`'"(:])\/mnt\/(?:data|user-data)\b/im,
  /(?:^|[\s`'"(:])\/home\/(?:claude|oai)\b/im,
  /https?:\/\/[^\s)\]]*asyncgw\.teams\.microsoft\.com\//i,
];

/** Whether the reply says it cannot reach the workspace and hands the job back. */
export function looksLikeGiveUp(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= MIN_CHARS && GIVE_UP_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Whether the reply is about M365's own cloud sandbox instead of the workspace. */
export function looksLikeRemoteSandbox(text: string): boolean {
  return REMOTE_SANDBOX_PATTERNS.some((pattern) => pattern.test(text));
}

export type ToolFreeProblem = "giveUp" | "sandbox" | "fakeCompletion";

/** Whether the reply says it changed something. See {@link FAKE_COMPLETION_PATTERNS}. */
export function looksLikeFakeCompletion(text: string): boolean {
  return FAKE_COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * What is wrong with a reply that called no tool although tools were offered,
 * or null when it is a real answer. `remoteWork`: the service reported the
 * model running something in its sandbox during the turn. `toolsRan`: a tool has
 * already run in this conversation, so a claim of having changed something may
 * well be true.
 */
export function toolFreeProblem(
  text: string,
  remoteWork = false,
  toolsRan = true,
): ToolFreeProblem | null {
  if (remoteWork || looksLikeRemoteSandbox(text)) return "sandbox";
  if (looksLikeGiveUp(text)) return "giveUp";
  return !toolsRan && looksLikeFakeCompletion(text) ? "fakeCompletion" : null;
}

/** The note a retry adds for each problem (`protocol.force.*`). */
export const FORCE_NOTE_KEYS = {
  giveUp: "protocol.force.giveUp",
  sandbox: "protocol.force.sandbox",
  fakeCompletion: "protocol.force.fakeCompletion",
} as const;

/** How much prose is held back before it streams, so a give-up can be replaced unseen. */
export const PROSE_HOLD_CHARS = 2_000;

/**
 * Holds the start of a reply back while it is short, so that a give-up can be
 * dropped and retried before the user sees it. A long reply, or one that reaches
 * its tool call, flows as usual from that point on — a few seconds of delay for
 * short answers only.
 */
export class ProseHold {
  private held = "";
  private flowing = false;
  private readonly release: (text: string) => void;
  private readonly limit: number;

  // Plain fields, not parameter properties: the tests load this file with
  // Node's --experimental-strip-types.
  constructor(release: (text: string) => void, limit = PROSE_HOLD_CHARS) {
    this.release = release;
    this.limit = limit;
  }

  push(delta: string): void {
    if (!delta) return;
    if (this.flowing) {
      this.release(delta);
      return;
    }
    this.held += delta;
    if (this.held.length > this.limit) this.flush();
  }

  /** Let what is held out, and everything after it. */
  flush(): void {
    if (this.flowing) return;
    this.flowing = true;
    if (this.held) this.release(this.held);
    this.held = "";
  }

  /** Whether nothing has reached the user yet. */
  get holding(): boolean {
    return !this.flowing;
  }

  /** Drop what is held (the reply is being retried) and return it. */
  discard(): string {
    const text = this.held;
    this.held = "";
    return text;
  }
}

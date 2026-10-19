/**
 * The terminal UI, built on @opentui/core — the same component toolkit
 * opencode's own TUI uses. Layout and palette are ours: a scrollable
 * transcript (banner, user messages, notices, and markdown answers that
 * stream through the library's renderer) with a rounded composer pinned at
 * the bottom, over a near-black background with a warm peach accent.
 *
 * The library owns editing, selection and the mouse; this file owns the
 * prompter: Ctrl+C cancels a running answer — at the prompt it clears the
 * line, and a second press within two seconds leaves — Ctrl+D on an empty
 * line leaves too, Tab completes commands, ↑/↓ walk the history and Ctrl+L
 * clears the transcript.
 *
 * Nothing here imports `vscode`: text goes through this package's own i18n,
 * the partial Chinese catalog included.
 */
import {
  BoxRenderable,
  InputRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextRenderable,
  bold,
  createCliRenderer,
  dim,
  fg,
  t as styled,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
  type StyleDefinitionInput,
} from "@opentui/core";
import { t } from "./i18n";
import { looksLikeProfile } from "@m365copilot/core/bizchat";

/** Near-black background, warm peach accent, muted greys for everything else. */
const THEME = {
  bg: "#101010",
  panel: "#1C1C1C",
  element: "#262626",
  line: "#343434",
  text: "#E7E2DD",
  muted: "#8B857F",
  faint: "#5C5751",
  accent: "#F5A97F",
  ok: "#8FD48F",
  warn: "#E5C07B",
  error: "#E06C75",
  link: "#7AA2F7",
  code: "#E5C07B",
} as const;

/** Style groups the markdown renderer looks up while parsing answers. */
const MARKDOWN_STYLES: Readonly<Record<string, StyleDefinitionInput>> = {
  default: { fg: THEME.text },
  conceal: { fg: THEME.faint },
  "markup.heading": { fg: THEME.accent, bold: true },
  "markup.raw": { fg: THEME.code },
  "markup.strong": { fg: THEME.text, bold: true },
  "markup.italic": { fg: THEME.text, italic: true },
  "markup.strikethrough": { fg: THEME.muted, dim: true },
  "markup.link": { fg: THEME.link, underline: true },
  "markup.link.label": { fg: THEME.link, underline: true },
  "markup.link.url": { fg: THEME.muted, underline: true },
  "markup.quote": { fg: THEME.muted, italic: true },
  "markup.list": { fg: THEME.accent },
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export class ExitRequested extends Error {}

export type NoticeLevel = "info" | "dim" | "ok" | "warn" | "error";

const NOTICE_COLOR: Readonly<Record<NoticeLevel, string>> = {
  info: THEME.text,
  dim: THEME.muted,
  ok: THEME.ok,
  warn: THEME.warn,
  error: THEME.error,
};

export interface AskOptions {
  /** The muted status row shown above the input. */
  readonly status: string;
  /** Command names for tab completion. */
  readonly commands: readonly string[];
}

export interface SourceLink {
  readonly title: string;
  readonly url: string;
}

export class ChatUi {
  private renderer: CliRenderer | null = null;
  private syntax: SyntaxStyle | null = null;
  private transcript: ScrollBoxRenderable | null = null;
  private statusText: TextRenderable | null = null;
  private input: InputRenderable | null = null;

  private history: string[] = [];
  private commands: readonly string[] = [];
  private histIndex = 0;
  private draft = "";
  private lastInterrupt = 0;
  private editorActive = false;
  private turnCanceller: (() => void) | null = null;
  private resolveAsk: ((line: string) => void) | null = null;
  private rejectAsk: ((error: unknown) => void) | null = null;

  /**
   * Brings up the alternate screen and the component tree; the TUI owns the
   * terminal until {@link stop}. Only once this returns can the other
   * methods (banner, ask…) be used.
   */
  async start(history: readonly string[]): Promise<void> {
    this.history = [...history];
    const renderer = await createCliRenderer({
      // Ctrl+C is ours (cancel a turn / leave at the prompt), and the
      // process signals stay with main.ts, which owns the shutdown order.
      exitOnCtrlC: false,
      exitSignals: [],
      screenMode: "alternate-screen",
      backgroundColor: THEME.bg,
      autoFocus: false,
      useMouse: true,
      targetFps: 30,
    });
    try {
      const syntax = SyntaxStyle.fromStyles(MARKDOWN_STYLES, renderer.nativeScene);
      this.renderer = renderer;
      this.syntax = syntax;
      this.build(renderer);
      renderer.start();
    } catch (error) {
      this.renderer = null;
      this.syntax = null;
      try {
        renderer.destroy();
      } catch {
        // the terminal is going down anyway
      }
      throw error;
    }
  }

  /**
   * Tears the renderer down and waits for the terminal to be restored —
   * main.ts only closes stdout after this resolves. Safe to call twice, or
   * before {@link start} has finished (a signal during startup).
   */
  async stop(): Promise<void> {
    const renderer = this.renderer;
    this.renderer = null;
    this.syntax = null;
    this.transcript = null;
    this.statusText = null;
    this.input = null;
    if (!renderer) return;
    try {
      renderer.destroy();
    } catch {
      // the terminal is going down anyway
    }
    try {
      await renderer.closed;
    } catch {
      // a failed teardown must not mask the real exit reason
    }
  }

  private build(renderer: CliRenderer): void {
    const app = new BoxRenderable(renderer, {
      id: "app",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: THEME.bg,
    });
    renderer.root.add(app);

    const transcript = new ScrollBoxRenderable(renderer, {
      id: "transcript",
      flexGrow: 1,
      minHeight: 0,
      scrollY: true,
      scrollX: false,
      stickyScroll: true,
      stickyStart: "bottom",
      viewportCulling: false,
      contentOptions: {
        flexDirection: "column",
        gap: 1,
        paddingX: 1,
      },
    });
    app.add(transcript);

    const composer = new BoxRenderable(renderer, {
      id: "composer",
      flexShrink: 0,
      flexDirection: "column",
      marginX: 1,
      marginTop: 1,
      marginBottom: 1,
    });
    app.add(composer);

    const statusText = new TextRenderable(renderer, {
      id: "status",
      content: "",
      fg: THEME.muted,
      wrapMode: "word",
      paddingX: 1,
    });
    composer.add(statusText);

    const promptBox = new BoxRenderable(renderer, {
      id: "prompt",
      height: 3,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: THEME.line,
      backgroundColor: THEME.panel,
      paddingLeft: 1,
      paddingRight: 1,
    });
    composer.add(promptBox);

    const sign = new TextRenderable(renderer, {
      id: "prompt-sign",
      content: styled`${fg(THEME.accent)(bold("❯"))}`,
      flexShrink: 0,
    });
    promptBox.add(sign);

    const input = new InputRenderable(renderer, {
      id: "prompt-input",
      flexGrow: 1,
      placeholder: t("tui.ui.placeholder"),
      placeholderColor: THEME.faint,
      textColor: THEME.text,
      backgroundColor: THEME.panel,
      focusedTextColor: THEME.text,
      focusedBackgroundColor: THEME.panel,
      cursorColor: THEME.accent,
    });
    promptBox.add(input);

    const hints = new TextRenderable(renderer, {
      id: "prompt-hints",
      content: t("tui.ui.hints"),
      fg: THEME.faint,
      wrapMode: "word",
      paddingX: 1,
    });
    composer.add(hints);

    input.on("enter", () => this.submitLine());
    input.on("focused", () => {
      promptBox.borderColor = THEME.accent;
      renderer.requestRender();
    });
    input.on("blurred", () => {
      promptBox.borderColor = THEME.line;
      renderer.requestRender();
    });
    renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key));

    this.transcript = transcript;
    this.statusText = statusText;
    this.input = input;
  }

  /**
   * While an answer streams there is no editor catching Ctrl+C — in raw mode
   * the terminal delivers 0x03 as a key, never as SIGINT — so this is what
   * cancels the running turn. At the prompt the editor's own rules apply.
   */
  setTurnCanceller(handler: (() => void) | null): void {
    this.turnCanceller = handler;
  }

  // ------------------------------------------------------------- the keys

  /**
   * Runs before the focused component: whatever this preventDefaults never
   * reaches it. The keys left alone (editing, Backspace, ←/→, Home/End…)
   * are the library's own bindings.
   */
  private handleKey(key: KeyEvent): void {
    const ctrl = key.ctrl === true;
    if (!(ctrl && key.name === "c")) this.lastInterrupt = 0;

    if (!this.editorActive) {
      // Streaming: Ctrl+C aborts the turn instead of idling in an editor.
      if (ctrl && key.name === "c") {
        key.preventDefault();
        this.turnCanceller?.();
      }
      return;
    }

    const input = this.input;
    if (!input) return;

    if (ctrl && key.name === "c") {
      key.preventDefault();
      if (input.value.length > 0) {
        input.value = "";
        this.lastInterrupt = 0;
        return;
      }
      if (Date.now() - this.lastInterrupt < 2000) {
        this.leaveEditor();
        this.rejectAsk?.(new ExitRequested());
        this.resolveAsk = null;
        this.rejectAsk = null;
        return;
      }
      this.lastInterrupt = Date.now();
      this.notice("dim", t("tui.interrupted"));
      return;
    }
    if (ctrl && key.name === "d") {
      key.preventDefault();
      if (input.value.length === 0) {
        this.leaveEditor();
        this.rejectAsk?.(new ExitRequested());
        this.resolveAsk = null;
        this.rejectAsk = null;
      }
      return;
    }
    if (ctrl && key.name === "l") {
      key.preventDefault();
      this.clear();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      this.complete();
      return;
    }
    if (key.name === "up") {
      key.preventDefault();
      this.recall(-1);
      return;
    }
    if (key.name === "down") {
      key.preventDefault();
      this.recall(1);
    }
  }

  private leaveEditor(): void {
    this.editorActive = false;
    this.input?.blur();
  }

  /** The line the input submitted: end the prompt and hand it to the loop. */
  private submitLine(): void {
    const input = this.input;
    if (!input || !this.editorActive) return;
    const line = input.value;
    this.leaveEditor();
    if (line.trim() && !looksLikeProfile(line.trim())) this.history.push(line);
    this.histIndex = this.history.length;
    const resolve = this.resolveAsk;
    this.resolveAsk = null;
    this.rejectAsk = null;
    resolve?.(line);
  }

  /** ↑/↓ over the history; the untouched line comes back as the draft. */
  private recall(direction: -1 | 1): void {
    const input = this.input;
    if (!input) return;
    if (direction === -1) {
      if (this.histIndex === this.history.length) this.draft = input.value;
      if (this.histIndex > 0) {
        this.histIndex -= 1;
        input.value = this.history[this.histIndex] ?? "";
      }
      return;
    }
    if (this.histIndex < this.history.length) {
      this.histIndex += 1;
      input.value =
        this.histIndex === this.history.length ? this.draft : (this.history[this.histIndex] ?? "");
    }
  }

  /** Tab: complete a /command to the longest common prefix. */
  private complete(): void {
    const input = this.input;
    if (!input) return;
    const current = input.value;
    if (!current.startsWith("/") || current.includes(" ")) return;
    const candidates = this.commands.filter((command) => command.startsWith(current));
    const first = candidates[0];
    if (first === undefined) return;
    let common = first;
    for (const candidate of candidates) {
      while (!candidate.startsWith(common)) common = common.slice(0, -1);
    }
    input.value = candidates.length === 1 ? `${common} ` : common;
  }

  // ------------------------------------------------------------- the blocks

  private appendBlock(child: Renderable): void {
    this.transcript?.add(child);
    this.renderer?.requestRender();
  }

  /** The welcome box: title, version, tips and the log path. */
  banner(version: string, logPath: string | null): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const box = new BoxRenderable(renderer, {
      id: "banner",
      flexShrink: 0,
      flexDirection: "column",
      gap: 0,
      border: true,
      borderStyle: "rounded",
      borderColor: THEME.line,
      backgroundColor: THEME.panel,
      title: ` ${t("tui.banner.title")} `,
      titleColor: THEME.accent,
      titleAlignment: "left",
      bottomTitle: `${t("tui.banner.version", version)} `,
      bottomTitleAlignment: "right",
      paddingX: 2,
      paddingY: 0,
    });
    box.add(
      new TextRenderable(renderer, {
        id: "banner-tip",
        content: t("tui.banner.tip"),
        fg: THEME.muted,
        wrapMode: "word",
      }),
    );
    if (logPath) {
      box.add(
        new TextRenderable(renderer, {
          id: "banner-log",
          content: t("tui.banner.log", logPath),
          fg: THEME.faint,
          wrapMode: "word",
        }),
      );
    }
    this.appendBlock(box);
  }

  /** A block of plain (multi-line) text, e.g. the command list. */
  say(text: string): void {
    this.notice("info", text);
  }

  help(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.appendBlock(
      new TextRenderable(renderer, {
        id: "help-title",
        content: styled`${fg(THEME.accent)(bold(t("tui.help.title")))}`,
        flexShrink: 0,
      }),
    );
    this.notice("info", t("tui.help.body"));
  }

  /** Wipes the transcript; the composer stays where it is. */
  clear(): void {
    const transcript = this.transcript;
    if (!transcript) return;
    for (const child of transcript.getChildren()) child.destroyRecursively();
    this.renderer?.requestRender();
  }

  /** A short message: one colored block appended after whatever came before. */
  notice(level: NoticeLevel, text: string): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.appendBlock(
      new TextRenderable(renderer, {
        content: text,
        fg: NOTICE_COLOR[level],
        wrapMode: "word",
        flexShrink: 0,
      }),
    );
  }

  /** The submitted input, echoed above the answer — tokens never get here. */
  echoInput(line: string): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const block = new BoxRenderable(renderer, {
      id: `echo-${Date.now()}`,
      flexShrink: 0,
      flexDirection: "row",
      gap: 1,
      backgroundColor: THEME.element,
      paddingX: 1,
    });
    block.add(
      new TextRenderable(renderer, {
        content: styled`${fg(THEME.accent)(bold("❯"))}`,
        flexShrink: 0,
      }),
    );
    block.add(
      new TextRenderable(renderer, {
        content: line,
        fg: THEME.text,
        wrapMode: "word",
        flexGrow: 1,
      }),
    );
    this.appendBlock(block);
  }

  startAnswer(): AnswerBox {
    const renderer = this.renderer;
    const syntax = this.syntax;
    if (!renderer || !syntax) throw new Error("startAnswer() before start()");
    const box = new AnswerBox(renderer, syntax);
    this.appendBlock(box.root);
    return box;
  }

  // ------------------------------------------------------------- the editor

  /**
   * Reads one line: the status row goes up, the input takes the focus and
   * resolves when Enter submits (or rejects with {@link ExitRequested} on
   * Ctrl+C twice / Ctrl+D). A pasted profile is never kept in the history.
   */
  ask(options: AskOptions): Promise<string> {
    const renderer = this.renderer;
    const input = this.input;
    if (!renderer || !input) return Promise.resolve("");
    return new Promise<string>((resolve, reject) => {
      this.editorActive = true;
      this.commands = options.commands;
      this.histIndex = this.history.length;
      this.draft = "";
      this.resolveAsk = resolve;
      this.rejectAsk = reject;
      if (this.statusText) this.statusText.content = options.status;
      input.value = "";
      input.focus();
      renderer.requestRender();
    });
  }
}

// --------------------------------------------------------------- the answer

/**
 * One answer: `⏺ M365 Copilot` (a spinner until the first token), the
 * markdown streamed through the library's renderer, and a muted footer with
 * the timing and the sources once finished.
 */
export class AnswerBox {
  private static counter = 0;

  /** @internal ChatUi mounts it in the transcript (same file). */
  readonly root: BoxRenderable;

  private readonly renderer: CliRenderer;
  private readonly header: TextRenderable;
  private readonly body: MarkdownRenderable;
  private readonly footer: TextRenderable;
  private spinner: NodeJS.Timeout | null = null;
  private spinnerFrame = 0;
  private readonly started = Date.now();
  private text = "";
  private chars = 0;
  private sources: readonly SourceLink[] = [];
  private mounted = false;
  private finished = false;

  constructor(renderer: CliRenderer, syntax: SyntaxStyle) {
    this.renderer = renderer;
    AnswerBox.counter += 1;
    const id = `answer-${AnswerBox.counter}`;
    this.root = new BoxRenderable(renderer, {
      id,
      flexShrink: 0,
      flexDirection: "column",
    });
    this.header = new TextRenderable(renderer, {
      id: `${id}-header`,
      content: "",
      flexShrink: 0,
    });
    this.body = new MarkdownRenderable(renderer, {
      id: `${id}-body`,
      content: "",
      syntaxStyle: syntax,
      fg: THEME.text,
      conceal: true,
      streaming: true,
      flexShrink: 0,
    });
    this.footer = new TextRenderable(renderer, {
      id: `${id}-footer`,
      content: "",
      fg: THEME.muted,
      wrapMode: "word",
      flexShrink: 0,
    });
    this.root.add(this.header);
    this.root.add(this.body);
    this.root.add(this.footer);
    this.renderHeader();
    this.spinner = setInterval(() => this.tick(), 110);
  }

  /** Nothing visible yet: the web→tools fallback only makes sense before this flips. */
  get empty(): boolean {
    return this.chars === 0;
  }

  setSources(sources: readonly SourceLink[]): void {
    this.sources = sources;
  }

  update(delta: string): void {
    if (!delta || this.finished) return;
    if (!this.mounted) {
      // First token: the spinner gives way to the name for good.
      this.mounted = true;
      this.stopSpinner();
      this.renderHeader();
    }
    this.chars += delta.length;
    this.text += delta;
    this.body.content = this.text;
    this.renderer.requestRender();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.stopSpinner();
    if (!this.mounted) {
      this.mounted = true;
      this.renderHeader();
    }
    // Pin the trailing block: the parser only finalizes it once streaming is off.
    this.body.streaming = false;
    const seconds = Math.max(1, Math.round((Date.now() - this.started) / 1000));
    let note = t("tui.meta", seconds, this.chars);
    if (this.sources.length > 0) note += t("tui.meta.sources", this.sources.length);
    const lines = [note];
    if (this.sources.length > 0) {
      lines.push("", t("tui.sources"));
      for (const source of this.sources) {
        lines.push(`  · ${source.title ? `${source.title} — ${source.url}` : source.url}`);
      }
    }
    this.footer.content = styled`${dim(lines.join("\n"))}`;
    this.renderer.requestRender();
  }

  private renderHeader(): void {
    this.header.content = this.mounted
      ? styled`${fg(THEME.accent)(bold("⏺"))} ${fg(THEME.text)(bold(t("tui.assistant")))}`
      : styled`${fg(THEME.accent)(SPINNER[this.spinnerFrame % SPINNER.length] ?? "⠋")} ${dim(t("tui.thinking"))}`;
  }

  private tick(): void {
    if (this.mounted || this.finished) return;
    this.spinnerFrame += 1;
    this.renderHeader();
    this.renderer.requestRender();
  }

  private stopSpinner(): void {
    if (this.spinner) {
      clearInterval(this.spinner);
      this.spinner = null;
    }
  }
}

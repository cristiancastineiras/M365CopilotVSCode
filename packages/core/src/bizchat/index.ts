/**
 * The BizChat layer: everything a client needs to talk to Microsoft 365
 * Copilot over its chat protocol, with no host API in sight — no `vscode`, no
 * DOM. The VS Code extension and the terminal TUI both run on it, and so can
 * any other client (an MCP server, an OpenAI-compatible endpoint, another IDE).
 *
 * It is a separate entry point (`@m365copilot/core/bizchat`) from the package
 * root on purpose: the root is shared with the browser extension and must stay
 * free of Node-only code, while this layer needs `ws` and `node:crypto`.
 *
 *   client          the WebSocket client: turns, streaming, errors, retries
 *   toolProtocol    the text protocol that lets the model call tools
 *   toolCatalog     the tool list a turn offers, with the hints the model reads
 *   modelCatalog    which models (tones) exist and how they are labelled
 *   profile         parsing what the user pastes into a profile
 *   throttle        backing off when M365 Copilot limits an account
 *   repetitionGuard cutting a model that loops
 *   logger          the log sink and the deep-debug trace
 *   i18n            the messages of this layer and the engine apps build on
 */
export * from "./client";
export * from "./logger";
export * from "./modelCatalog";
export * from "./profile";
export * from "./repetitionGuard";
export * from "./throttle";
export * from "./toolCatalog";
export * from "./toolProtocol";
export {
  bizChatLocale,
  coreMessageKeys,
  formatMoment,
  getLocale,
  placeholdersOf,
  registerCatalogs,
  setLocale,
  translate,
  translateIn,
  type AppCatalogs,
  type CoreMessageKey,
  type Locale,
} from "./i18n";

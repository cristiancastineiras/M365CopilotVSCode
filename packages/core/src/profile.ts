/**
 * Forma normalizada del "perfil" que se captura de la web de M365 Copilot y
 * se envía a la extensión de VS Code. Sólo `accessToken` (y los claims que se
 * decodifican de él) es imprescindible; `endpoint`/`invocationTemplate` se
 * conservan por compatibilidad y diagnóstico.
 */
export interface TokenClaims {
  oid?: string;
  tid?: string;
  aud?: string;
  exp?: number;
  upn?: string;
}

export interface CopilotProfile {
  version: number;
  accessToken: string;
  /** URL `wss://…/Chathub/{oid}@{tid}?…` capturada de la web. */
  endpoint: string | null;
  origin: string;
  userAgent: string;
  /** El objeto `arguments[0]` de la invocación SignalR `chat`. */
  invocationTemplate: Record<string, unknown> | null;
  /** Tipo de frame SignalR (4 = StreamInvocation, 1 = Invocation). */
  invocationType: number;
  claims: TokenClaims | null;
  capturedAt: string;
  /**
   * `tone`s (modelos) que la web de M365 Copilot ha usado de verdad, vistos en
   * sus invocaciones `chat`: la extensión de VS Code añade al selector los que
   * aún no conoce. Opcional: los perfiles antiguos no lo traen.
   */
  observedTones?: string[];
}

import type { TokenClaims } from './profile';

/**
 * Decodifica el payload de un JWT sin validar la firma. Isomorfo: `atob` y
 * `TextDecoder` existen tanto en el navegador como en Node 18+, así que sirve
 * igual en el content script del navegador y en la extensión de VS Code.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extrae los claims relevantes, normalizando el nombre de usuario (upn). */
export function extractClaims(token: string): TokenClaims | null {
  const raw = decodeJwtPayload(token);
  if (!raw) return null;
  return {
    oid: typeof raw.oid === 'string' ? raw.oid : undefined,
    tid: typeof raw.tid === 'string' ? raw.tid : undefined,
    aud: typeof raw.aud === 'string' ? raw.aud : undefined,
    exp: typeof raw.exp === 'number' ? raw.exp : undefined,
    upn:
      (typeof raw.upn === 'string' && raw.upn) ||
      (typeof raw.unique_name === 'string' && raw.unique_name) ||
      (typeof raw.preferred_username === 'string' && raw.preferred_username) ||
      undefined,
  };
}

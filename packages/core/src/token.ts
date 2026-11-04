import type { CopilotProfile } from "./profile";
import { decodeJwtPayload, isEncryptedToken } from "./jwt";

export type AccountKind = "personal" | "enterprise";

/** El tenant de las cuentas personales de Microsoft y el que usa para ellas el hub del chat. */
const PERSONAL_TENANTS: ReadonlySet<string> = new Set([
  "9188040d-6c67-4c5b-b112-36a304b66dad",
  "84df9e7f-e9f6-40af-b435-aaaaaaaaaaaa",
]);

/**
 * ¿De qué tipo de cuenta es el token? Sólo el de las personales va cifrado, pero
 * una de ellas también puede traer un JWT: ahí lo dice el tenant. null sin token.
 */
export function accountKind(
  profile: { accessToken?: string | null; claims?: { tid?: string } | null } | null | undefined,
): AccountKind | null {
  if (!profile?.accessToken) return null;
  if (isEncryptedToken(profile.accessToken)) return "personal";
  return PERSONAL_TENANTS.has(profile.claims?.tid?.toLowerCase() ?? "") ? "personal" : "enterprise";
}

/** ¿Es un token de Substrate/Sydney, el que usa Copilot? */
export function isSydneyToken(token: string): boolean {
  const claims = decodeJwtPayload(token);
  if (!claims) return false;
  const aud = String(claims.aud || "");
  const scp = String(claims.scp || claims.scope || "");
  return (
    aud.includes("substrate.office.com") ||
    aud.includes("substrate.svc.cloud.microsoft") ||
    /sydney|m365chat/i.test(scp)
  );
}

/** True cuando el token existe y no ha caducado (con un margen de skew). */
export function isTokenUsable(
  profile: Pick<CopilotProfile, "accessToken" | "claims" | "tokenRejected">,
  skewSeconds = 60,
): boolean {
  if (profile.tokenRejected) return false;
  const exp = profile.claims?.exp;
  if (!exp) return Boolean(profile.accessToken);
  return exp * 1000 - Date.now() > skewSeconds * 1000;
}

/** Minutos hasta la caducidad del token, o null si se desconoce. */
export function minutesUntilExpiry(profile: Pick<CopilotProfile, "claims">): number | null {
  const exp = profile.claims?.exp;
  if (!exp) return null;
  return Math.round((exp * 1000 - Date.now()) / 60000);
}

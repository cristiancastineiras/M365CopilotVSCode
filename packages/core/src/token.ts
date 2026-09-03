import type { CopilotProfile } from './profile';
import { decodeJwtPayload } from './jwt';

/** ¿Es un token de Substrate/Sydney, el que usa Copilot? */
export function isSydneyToken(token: string): boolean {
  const claims = decodeJwtPayload(token);
  if (!claims) return false;
  const aud = String(claims.aud || '');
  const scp = String(claims.scp || claims.scope || '');
  return (
    aud.includes('substrate.office.com') ||
    aud.includes('substrate.svc.cloud.microsoft') ||
    /sydney|m365chat/i.test(scp)
  );
}

/** True cuando el token existe y no ha caducado (con un margen de skew). */
export function isTokenUsable(
  profile: Pick<CopilotProfile, 'accessToken' | 'claims'>,
  skewSeconds = 60,
): boolean {
  const exp = profile.claims?.exp;
  if (!exp) return Boolean(profile.accessToken);
  return exp * 1000 - Date.now() > skewSeconds * 1000;
}

/** Minutos hasta la caducidad del token, o null si se desconoce. */
export function minutesUntilExpiry(profile: Pick<CopilotProfile, 'claims'>): number | null {
  const exp = profile.claims?.exp;
  if (!exp) return null;
  return Math.round((exp * 1000 - Date.now()) / 60000);
}

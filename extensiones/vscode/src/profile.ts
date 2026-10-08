/**
 * El "perfil" es lo que se captura de la web de M365 Copilot (con la extensión
 * de navegador o el userscript). Puede ser:
 *   - un objeto JSON completo (token + endpoint + frame de invocación), o
 *   - un JWT pelado (sólo el token).
 *
 * `endpoint` e `invocationTemplate` se conservan por compatibilidad y como
 * diagnóstico, pero client.ts ya NO los usa para construir peticiones: sólo
 * `accessToken` (y sus claims) importan. Los tipos y utilidades compartidas
 * viven en `@m365copilot/core`; aquí sólo queda el parseo de lo pegado, que
 * es específico de VS Code.
 */
import {
	decodeJwtPayload,
	extractClaims,
	isSydneyToken,
	isTokenUsable,
	normalizeEndpoint,
	tokenInSocketUrl,
	TONE_PATTERN,
	type CopilotProfile,
	type TokenClaims,
} from '@m365copilot/core';
import { t } from './i18n';

export type { CopilotProfile, TokenClaims } from '@m365copilot/core';
export { decodeJwtPayload, isTokenUsable, minutesUntilExpiry } from '@m365copilot/core';

const DEFAULT_ORIGIN = 'https://m365.cloud.microsoft';
const DEFAULT_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class ProfileParseError extends Error {}

const BARE_JWT = /^ey[\w-]+\.[\w-]+\.[\w-]+$/;
/** `Bearer eyJ…`, as copied from an `Authorization` header. */
const BEARER_JWT = /^bearer\s+(ey[\w-]+\.[\w-]+\.[\w-]+)$/i;
/** The chat WebSocket URL copied from DevTools (`wss://…/Chathub/…?access_token=…`). */
const SOCKET_URL = /^(wss?|https?):\/\//i;

/**
 * Something the paste command can use: a bare JWT, `Bearer <JWT>`, the chat
 * WebSocket URL with its `access_token`, or a JSON profile with an access
 * token — what the browser side copies or what DevTools shows.
 */
export function looksLikeProfile(text: string): boolean {
	const value = text.trim();
	if (BARE_JWT.test(value) || BEARER_JWT.test(value)) return true;
	if (SOCKET_URL.test(value)) return /[?&]access_token=ey/.test(value);
	return value.startsWith('{') && /"(accessToken|access_token|token)"\s*:\s*"ey/.test(value);
}

/**
 * Parsea lo que el usuario pegó en un {@link CopilotProfile} normalizado.
 * Acepta un perfil JSON completo, un JWT pelado (con o sin `Bearer `) o la
 * URL del WebSocket del chat: el token de Copilot no viaja en ninguna
 * cabecera `Authorization`, sino en el `access_token` de esa URL, así que
 * para capturarlo a mano lo más fácil es DevTools → Red, filtro `chathub` →
 * Copiar URL.
 */
export function parsePastedProfile(input: string): CopilotProfile {
	const text = input.trim();
	if (!text) throw new ProfileParseError(t('profile.error.empty'));

	// ¿JWT pelado?
	if (BARE_JWT.test(text)) {
		return normalize({ accessToken: text });
	}
	const bearer = BEARER_JWT.exec(text);
	if (bearer) {
		return normalize({ accessToken: bearer[1] });
	}
	if (SOCKET_URL.test(text)) {
		const token = tokenInSocketUrl(text);
		if (!token) throw new ProfileParseError(t('profile.error.urlWithoutToken'));
		// Sin el token ni los ids de esa sesión; conserva las `variants`.
		return normalize({ accessToken: token, endpoint: normalizeEndpoint(text) || undefined });
	}

	let obj: unknown;
	try {
		obj = JSON.parse(text);
	} catch {
		throw new ProfileParseError(t('profile.error.notJwtOrJson'));
	}

	if (!obj || typeof obj !== 'object') {
		throw new ProfileParseError(t('profile.error.notObject'));
	}

	const record = obj as Record<string, unknown>;
	const token =
		(typeof record.accessToken === 'string' && record.accessToken) ||
		(typeof record.access_token === 'string' && record.access_token) ||
		(typeof record.token === 'string' && record.token) ||
		'';
	if (!token) {
		throw new ProfileParseError(t('profile.error.noToken'));
	}

	return normalize(record, token);
}

function normalize(record: Record<string, unknown>, token?: string): CopilotProfile {
	const accessToken = (token ?? (record.accessToken as string) ?? '').trim();
	const claims: TokenClaims | null =
		extractClaims(accessToken) ?? (record.claims as TokenClaims | undefined) ?? null;

	if (!accessToken || accessToken.split('.').length !== 3) {
		throw new ProfileParseError(t('profile.error.invalidJwt'));
	}

	return {
		version: typeof record.version === 'number' ? record.version : 1,
		accessToken,
		endpoint: typeof record.endpoint === 'string' ? record.endpoint : null,
		origin: typeof record.origin === 'string' ? record.origin : DEFAULT_ORIGIN,
		userAgent: typeof record.userAgent === 'string' ? record.userAgent : DEFAULT_UA,
		invocationTemplate:
			record.invocationTemplate && typeof record.invocationTemplate === 'object'
				? (record.invocationTemplate as Record<string, unknown>)
				: null,
		invocationType: typeof record.invocationType === 'number' ? record.invocationType : 4,
		claims,
		capturedAt:
			typeof record.capturedAt === 'string' ? record.capturedAt : new Date().toISOString(),
		...observedTonesOf(record),
	};
}

/**
 * The audience of a token that is NOT the M365 Copilot (Substrate/Sydney) one,
 * or null when it is. The browser extension and the userscript only ever
 * capture Copilot's token, but a token copied by hand from DevTools is often
 * the `Authorization: Bearer` of another request on the page (Graph, search…):
 * it decodes fine and has not expired — so everything looks connected — yet
 * the chat rejects it with 401. `?` when the token has no readable audience.
 */
export function foreignAudience(token: string): string | null {
	if (isSydneyToken(token)) return null;
	const aud = decodeJwtPayload(token)?.aud;
	return typeof aud === 'string' && aud ? aud : '?';
}

/** The models the web app used (sent by the browser side), kept only if they look like tones. */
function observedTonesOf(record: Record<string, unknown>): Pick<CopilotProfile, 'observedTones'> {
	if (!Array.isArray(record.observedTones)) return {};
	const tones = record.observedTones
		.filter((tone): tone is string => typeof tone === 'string' && TONE_PATTERN.test(tone))
		.slice(-20);
	return tones.length > 0 ? { observedTones: tones } : {};
}

/** Who a profile signs in as, for VS Code's Accounts menu (account.ts). */
export interface ProfileAccount {
	/** Stable per user and tenant, so a renewed token is the same session. */
	readonly sessionId: string;
	readonly accountId: string;
	readonly label: string;
}

/**
 * The account behind a usable token; undefined without one or once it has
 * expired — in the Accounts menu an expired token is "signed out".
 */
export function accountOf(profile: CopilotProfile | null | undefined): ProfileAccount | undefined {
	if (!profile || !isTokenUsable(profile)) return undefined;
	const claims = profile.claims ?? extractClaims(profile.accessToken) ?? {};
	const upn = claims.upn?.trim();
	const accountId = claims.oid ?? upn ?? 'm365copilot';
	return {
		sessionId: `${claims.tid ?? 'tenant'}/${accountId}`,
		accountId,
		label: upn || t('account.unknownUser'),
	};
}

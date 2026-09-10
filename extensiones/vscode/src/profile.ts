/**
 * El "perfil" es lo que se captura de la web de M365 Copilot (con la extensión
 * de navegador o el userscript). Puede ser:
 *   - un objeto JSON completo (token + endpoint + frame de invocación), o
 *   - un JWT pelado (sólo el token).
 *
 * `endpoint` e `invocationTemplate` se conservan por compatibilidad y como
 * diagnóstico, pero client.ts ya NO los usa para construir peticiones: sólo
 * `accessToken` (y sus claims) importan. Los tipos y utilidades compartidas
 * viven en `@ms365copilot/core`; aquí sólo queda el parseo de lo pegado, que
 * es específico de VS Code.
 */
import { extractClaims, type CopilotProfile, type TokenClaims } from '@ms365copilot/core';

export type { CopilotProfile, TokenClaims } from '@ms365copilot/core';
export { decodeJwtPayload, isTokenUsable, minutesUntilExpiry } from '@ms365copilot/core';

const DEFAULT_ORIGIN = 'https://m365.cloud.microsoft';
const DEFAULT_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class ProfileParseError extends Error {}

/**
 * Parsea lo que el usuario pegó en un {@link CopilotProfile} normalizado.
 * Acepta un perfil JSON completo o un JWT pelado.
 */
export function parsePastedProfile(input: string): CopilotProfile {
	const text = input.trim();
	if (!text) throw new ProfileParseError('No se pegó nada.');

	// ¿JWT pelado?
	if (/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(text)) {
		return normalize({ accessToken: text });
	}

	let obj: unknown;
	try {
		obj = JSON.parse(text);
	} catch {
		throw new ProfileParseError(
			'Lo pegado no es ni un JWT ni un JSON válido. Usa el botón «Copiar perfil completo» de la extensión o el userscript.',
		);
	}

	if (!obj || typeof obj !== 'object') {
		throw new ProfileParseError('El JSON pegado no es un objeto de perfil.');
	}

	const record = obj as Record<string, unknown>;
	const token =
		(typeof record.accessToken === 'string' && record.accessToken) ||
		(typeof record.access_token === 'string' && record.access_token) ||
		(typeof record.token === 'string' && record.token) ||
		'';
	if (!token) {
		throw new ProfileParseError('El perfil no contiene ningún accessToken.');
	}

	return normalize(record, token);
}

function normalize(record: Record<string, unknown>, token?: string): CopilotProfile {
	const accessToken = (token ?? (record.accessToken as string) ?? '').trim();
	const claims: TokenClaims | null =
		extractClaims(accessToken) ?? (record.claims as TokenClaims | undefined) ?? null;

	if (!accessToken || accessToken.split('.').length !== 3) {
		throw new ProfileParseError('El accessToken no parece un JWT válido.');
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
	};
}

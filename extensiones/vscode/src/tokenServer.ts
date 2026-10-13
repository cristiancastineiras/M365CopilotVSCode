import * as http from 'http';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import {
	HEALTH_ENDPOINT_PATH,
	SIGNOUT_ENDPOINT_PATH,
	TOKEN_ENDPOINT_PATH,
	TOKEN_SERVER_PORT,
	type SignOutReport,
} from '@m365copilot/core';
import type { CopilotProfile } from './profile';
import type { ProfileStore } from './secrets';
import { debug, isDeepDebug, log } from './logger';
import { t } from './i18n';

// Orígenes desde los que el userscript puede llegar a correr (mismo conjunto
// que sus `@match`). Cualquier otro origen no recibe cabeceras CORS, así que
// el navegador bloquea la respuesta antes de que una pestaña ajena pueda leer
// o completar la petición: esto es lo único que impide que una web cualquiera
// abierta en el mismo navegador pueda sobrescribir el perfil guardado (con su
// propio `endpoint`) haciendo un POST a este puerto.
const ALLOWED_ORIGINS = new Set([
	'https://www.office.com',
	'https://outlook.office.com',
	'https://teams.microsoft.com',
]);

function isAllowedOrigin(origin: string): boolean {
	if (ALLOWED_ORIGINS.has(origin)) return true;
	try {
		const { protocol, hostname } = new URL(origin);
		// La extensión de navegador (WXT) envía desde su propio origen
		// `chrome-extension://<id>` (o `moz-extension://` en Firefox). Una web
		// cualquiera no puede falsificar ese origen, así que es seguro permitirlo.
		if (protocol === 'chrome-extension:' || protocol === 'moz-extension:') return true;
		return protocol === 'https:' && (hostname === 'cloud.microsoft' || hostname.endsWith('.cloud.microsoft'));
	} catch {
		return false;
	}
}

// Un perfil capturado (token + endpoint + plantilla) no debería pasar de
// pocos KB; un body mucho mayor no es un perfil legítimo.
const MAX_BODY_BYTES = 256 * 1024;

// Traza profunda (`m365copilot.debug.deep`): cada petición que llega a este
// puerto —del navegador o de cualquiera— con sus cabeceras, su cuerpo y la
// respuesta. El id enlaza la petición con su respuesta cuando llegan
// intercaladas.
let requestSeq = 0;
const traces = new WeakMap<http.ServerResponse, { readonly scope: string; readonly at: number }>();

function traceRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
	if (!isDeepDebug()) return;
	const scope = `http#${++requestSeq}`;
	traces.set(res, { scope, at: Date.now() });
	debug(scope, `← ${req.method} ${req.url}`, () => ({
		from: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
		httpVersion: req.httpVersion,
		headers: req.headers,
	}));
}

/** Escribe la respuesta (JSON si hay `payload`) y la deja en la traza. */
function respond(res: http.ServerResponse, status: number, payload?: unknown): void {
	if (payload === undefined) res.writeHead(status);
	else res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(payload === undefined ? undefined : JSON.stringify(payload));
	const trace = traces.get(res);
	if (trace) {
		debug(trace.scope, `→ ${status} (${Date.now() - trace.at} ms)`, () => ({
			headers: res.getHeaders(),
			body: payload,
		}));
	}
}

/**
 * Cierre de sesión pedido desde VS Code y aún sin atender. Se publica en el
 * health-check hasta que la extensión de navegador lo recoge: no podemos
 * llamar al navegador (aquí somos el servidor, no el cliente), así que el
 * canal de ida es dejarlo puesto y que el latido del otro lado lo lea.
 */
export interface PendingSignOut {
	readonly id: string;
	readonly requestedAt: number;
}

/** Lo que el navegador contesta al terminar: el informe de lo que borró. */
export interface SignOutOutcome {
	/** Id de la petición, o null si el cierre lo inició el propio navegador. */
	readonly id: string | null;
	readonly report: SignOutReport | undefined;
}

/**
 * Servidor HTTP local que permite al userscript de Tampermonkey enviar
 * automáticamente el token renovado sin intervención manual del usuario, y
 * por donde se coordina el cierre de sesión completo con el navegador.
 */
export class TokenAutoRefreshServer implements vscode.Disposable {
	private server: http.Server | null = null;
	private readonly port = TOKEN_SERVER_PORT; // Puerto fijo local para el userscript
	private pendingSignOut: PendingSignOut | null = null;
	private readonly signedOut = new vscode.EventEmitter<SignOutOutcome>();
	/** Se dispara cuando el navegador confirma que ya cerró la sesión. */
	readonly onDidSignOut = this.signedOut.event;

	/**
	 * @param onTokenReceived called after a profile pushed by the browser has
	 * been stored, so the editor can confirm the silent renewal (status bar).
	 */
	constructor(
		private readonly store: ProfileStore,
		private readonly onTokenReceived?: (profile: CopilotProfile) => void,
	) {}

	/**
	 * Deja pedido un cierre de sesión completo y devuelve su id. El id es el
	 * que viaja en la URL con la que se abre el navegador: el otro lado sólo
	 * obedece si coincide con éste, así que una web cualquiera no puede
	 * provocar el cierre de sesión enlazando esa URL.
	 */
	requestSignOut(): PendingSignOut {
		this.pendingSignOut = { id: crypto.randomUUID(), requestedAt: Date.now() };
		log(t('log.server.signOutRequested', this.pendingSignOut.id));
		debug('http', 'sign-out request published on /health until the browser picks it up', this.pendingSignOut);
		return this.pendingSignOut;
	}

	/** Retira la petición (el usuario canceló, o se agotó la espera). */
	cancelSignOut(id?: string): void {
		if (id && this.pendingSignOut?.id !== id) return;
		if (this.pendingSignOut) debug('http', `pending sign-out ${this.pendingSignOut.id} withdrawn`);
		this.pendingSignOut = null;
	}

	start(): void {
		if (this.server) return;

		this.server = http.createServer(async (req, res) => {
			traceRequest(req, res);
			// GM_xmlhttpRequest (el que usa el userscript) no está sujeto a CORS y
			// normalmente no manda `Origin`, así que esas peticiones legítimas no
			// se ven afectadas por esta comprobación. Lo que sí bloqueamos es que
			// una página cualquiera, vía `fetch`/`XHR` normal desde el navegador,
			// consiga que su petición cross-origin se complete.
			const origin = req.headers.origin;
			const originAllowed = typeof origin === 'string' && isAllowedOrigin(origin);
			debug(traces.get(res)?.scope ?? 'http', `origin check:${typeof origin === 'string' && origin ? `${origin} → ${originAllowed ? 'allowed' : 'NOT allowed'}` : 'no Origin header (GM_xmlhttpRequest / extension background)'}`);
			if (typeof origin === 'string' && origin) {
				res.setHeader('Vary', 'Origin');
				if (originAllowed) {
					res.setHeader('Access-Control-Allow-Origin', origin);
					res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
					res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
				}
			}

			if (req.method === 'OPTIONS') {
				respond(res, originAllowed || !origin ? 200 : 403);
				return;
			}

			if (req.method === 'POST' && (req.url === TOKEN_ENDPOINT_PATH || req.url === SIGNOUT_ENDPOINT_PATH)) {
				const isSignOut = req.url === SIGNOUT_ENDPOINT_PATH;
				if (typeof origin === 'string' && origin && !originAllowed) {
					log(t('log.server.originRejected', req.url ?? '?', origin));
					// API errors stay in English on purpose: they are read by the
					// browser extension / userscript, not shown as UI text.
					respond(res, 403, { success: false, error: 'Origin not allowed' });
					return;
				}

				let body = '';
				let tooLarge = false;
				req.on('data', (chunk) => {
					if (tooLarge) return;
					body += chunk;
					if (body.length > MAX_BODY_BYTES) {
						tooLarge = true;
						respond(res, 413, { success: false, error: 'Payload too large' });
						req.destroy();
					}
				});
				req.on('error', (error) => {
					log(t('log.server.readError', String(error)));
				});
				req.on('end', async () => {
					if (tooLarge) return;
					const trace = traces.get(res);
					if (trace) debug(trace.scope, `← body (${body.length} chars) for ${isSignOut ? 'sign-out' : 'token'}`, body);
					try {
						if (isSignOut) {
							const outcome = this.acceptSignOut(body);
							respond(res, 200, { success: true, id: outcome.id });
							return;
						}
						const profile = await this.store.setFromPaste(body);
						log(t('log.server.renewed'));
						this.onTokenReceived?.(profile);
						respond(res, 200, {
							success: true,
							expiresAt: profile.claims?.exp,
							user: profile.claims?.upn,
						});
					} catch (error) {
						log(t('log.server.processError', String(error)));
						debug(traces.get(res)?.scope ?? 'http', 'the body could not be processed', error);
						respond(res, 400, { success: false, error: String(error) });
					}
				});
				return;
			}

			// Endpoint de health check para que el userscript verifique si VS Code
			// está activo. Lleva además el cierre de sesión pendiente, si hay
			// alguno: es el único canal de ida hacia el navegador.
			if (req.method === 'GET' && req.url === HEALTH_ENDPOINT_PATH) {
				respond(res, 200, {
					status: 'ok',
					service: 'm365-copilot-vscode',
					pendingSignOut: this.pendingSignOut,
				});
				return;
			}

			respond(res, 404);
		});

		this.server.listen(this.port, 'localhost', () => {
			log(t('log.server.listening', this.port));
		});

		this.server.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EADDRINUSE') {
				log(t('log.server.portInUse', this.port));
			} else {
				log(t('log.server.error', error.message));
			}
		});
	}

	/**
	 * El navegador confirma que la sesión ya está cerrada. El token guardado
	 * aquí se borra también: aunque el comando ya lo había borrado antes de
	 * pedirlo, un cierre iniciado desde el navegador (su propio botón) llega
	 * sin que este lado sepa nada, y dejar el token vivo sería mentir sobre el
	 * estado de la sesión.
	 */
	private acceptSignOut(body: string): SignOutOutcome {
		let id: string | null = null;
		let report: SignOutReport | undefined;
		try {
			const parsed = JSON.parse(body || '{}') as { id?: unknown; report?: unknown };
			if (typeof parsed.id === 'string' && parsed.id) id = parsed.id;
			if (parsed.report && typeof parsed.report === 'object') report = parsed.report as SignOutReport;
		} catch {
			// Un cuerpo ilegible no invalida el cierre de sesión: lo que importa
			// es que ocurrió. Se trata como uno sin id ni informe.
		}
		this.cancelSignOut(id ?? undefined);
		void this.store.clear();
		log(t('log.server.signedOut', id ?? '—'));
		debug('http', 'the browser confirmed the sign-out', () => ({ id, report }));
		const outcome: SignOutOutcome = { id, report };
		this.signedOut.fire(outcome);
		return outcome;
	}

	dispose(): void {
		this.signedOut.dispose();
		if (this.server) {
			this.server.close();
			this.server = null;
			log(t('log.server.stopped'));
		}
	}
}

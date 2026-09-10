import * as http from 'http';
import type { ProfileStore } from './secrets';
import { log } from './logger';

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

/**
 * Servidor HTTP local que permite al userscript de Tampermonkey enviar
 * automáticamente el token renovado sin intervención manual del usuario.
 */
export class TokenAutoRefreshServer {
	private server: http.Server | null = null;
	private readonly port = 51827; // Puerto fijo local para el userscript

	constructor(private readonly store: ProfileStore) {}

	start(): void {
		if (this.server) return;

		this.server = http.createServer(async (req, res) => {
			// GM_xmlhttpRequest (el que usa el userscript) no está sujeto a CORS y
			// normalmente no manda `Origin`, así que esas peticiones legítimas no
			// se ven afectadas por esta comprobación. Lo que sí bloqueamos es que
			// una página cualquiera, vía `fetch`/`XHR` normal desde el navegador,
			// consiga que su petición cross-origin se complete.
			const origin = req.headers.origin;
			const originAllowed = typeof origin === 'string' && isAllowedOrigin(origin);
			if (typeof origin === 'string' && origin) {
				res.setHeader('Vary', 'Origin');
				if (originAllowed) {
					res.setHeader('Access-Control-Allow-Origin', origin);
					res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
					res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
				}
			}

			if (req.method === 'OPTIONS') {
				res.writeHead(originAllowed || !origin ? 200 : 403);
				res.end();
				return;
			}

			if (req.method === 'POST' && req.url === '/token') {
				if (typeof origin === 'string' && origin && !originAllowed) {
					log(`⚠️ Solicitud a /token rechazada: origen no permitido (${origin})`);
					res.writeHead(403, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: false, error: 'Origen no permitido' }));
					return;
				}

				let body = '';
				let tooLarge = false;
				req.on('data', (chunk) => {
					if (tooLarge) return;
					body += chunk;
					if (body.length > MAX_BODY_BYTES) {
						tooLarge = true;
						res.writeHead(413, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: false, error: 'Payload demasiado grande' }));
						req.destroy();
					}
				});
				req.on('error', (error) => {
					log(`❌ Error leyendo la petición del userscript: ${error}`);
				});
				req.on('end', async () => {
					if (tooLarge) return;
					try {
						const profile = await this.store.setFromPaste(body);
						log('🔄 Token auto-renovado desde el userscript');
						res.writeHead(200, { 'Content-Type': 'application/json' });
						res.end(
							JSON.stringify({
								success: true,
								expiresAt: profile.claims?.exp,
								user: profile.claims?.upn,
							}),
						);
					} catch (error) {
						log(`❌ Error al procesar token del userscript: ${error}`);
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ success: false, error: String(error) }));
					}
				});
				return;
			}

			// Endpoint de health check para que el userscript verifique si VS Code está activo
			if (req.method === 'GET' && req.url === '/health') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'ok', service: 'ms365-copilot-vscode' }));
				return;
			}

			res.writeHead(404);
			res.end();
		});

		this.server.listen(this.port, 'localhost', () => {
			log(`✅ Servidor de auto-renovación escuchando en http://localhost:${this.port}`);
		});

		this.server.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EADDRINUSE') {
				log(`⚠️ Puerto ${this.port} ya en uso. El servidor de auto-renovación no está disponible.`);
			} else {
				log(`❌ Error en servidor de auto-renovación: ${error.message}`);
			}
		});
	}

	dispose(): void {
		if (this.server) {
			this.server.close();
			this.server = null;
			log('🔌 Servidor de auto-renovación detenido');
		}
	}
}

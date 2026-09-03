import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { CopilotProfile } from './profile';
import { RunawayRepetitionGuard } from './repetitionGuard';

/** SignalR frame terminator (record separator, U+001E). */
const RS = String.fromCharCode(0x1e);

/** Redact the access_token query param so logs are safe to share. */
function redactUrl(url: string): string {
	return url.replace(/(access_token=)[^&]+/i, '$1<REDACTED>');
}

/** Truncate a long frame for readable logs. */
function truncate(text: string, max = 1200): string {
	return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}

const DEFAULT_ENDPOINT_HOST = 'wss://substrate.office.com';
const DEFAULT_ENDPOINT_PATH = '/m365Copilot/Chathub';

const HANDSHAKE_TIMEOUT_MS = 15_000;
const IDLE_TIMEOUT_MS = 90_000;
/** Hard ceiling on a single turn, independent of activity — IDLE_TIMEOUT_MS
 * alone never fires if the server keeps sending *something*, even a model
 * stuck in a degenerate repetition loop (observed: 30+ minutes of the same
 * garbage frame repeating, never idle for more than a second at a time). */
const MAX_TURN_MS = 5 * 60_000;

export interface StreamCallbacks {
	/** Incremental assistant text. */
	onText: (delta: string) => void;
	/** Called once when the turn is fully complete. */
	onDone?: () => void;
}

export class CopilotClientError extends Error {}

/**
 * Raised when the server rejects the WebSocket upgrade with an auth status
 * (HTTP 401/403). Distinct from a generic client error so the caller can refresh
 * the model picker's "token needs re-capturing" state.
 */
export class CopilotAuthError extends CopilotClientError {
	readonly statusCode: number;
	constructor(message: string, statusCode: number) {
		super(message);
		this.statusCode = statusCode;
	}
}

/** Map a rejected WS upgrade status to an accurate, actionable client error. */
function describeUpgradeFailure(status: number, statusMessage: string): CopilotClientError {
	if (status === 401) {
		return new CopilotAuthError(
			'M365 Copilot rechazó el token (401 Unauthorized). El token ha caducado o el servidor lo ha ' +
				'invalidado aunque su fecha de expiración aún no había pasado. Vuelve a capturarlo con el ' +
				'userscript en m365.cloud.microsoft y pégalo de nuevo con «M365 Copilot: Pegar perfil o token».',
			status,
		);
	}
	if (status === 403) {
		return new CopilotAuthError(
			'M365 Copilot denegó el acceso (403 Forbidden). Puede que tu cuenta no tenga licencia de Copilot ' +
				'o que el token capturado no tenga permiso para este endpoint. Recaptura el perfil e inténtalo de nuevo.',
			status,
		);
	}
	if (status === 429) {
		return new CopilotClientError(
			'M365 Copilot está limitando las peticiones (429 Too Many Requests). Espera unos segundos e inténtalo de nuevo.',
		);
	}
	return new CopilotClientError(
		`M365 Copilot rechazó la conexión WebSocket (HTTP ${status}${statusMessage ? ` ${statusMessage}` : ''}).`,
	);
}

/**
 * A single Copilot turn over the BizChat/Sydney WebSocket. We open one socket
 * per turn (mirroring the web app), replay the captured invocation frame with
 * the user's prompt and chosen `tone`, then stream the reply.
 */
export async function streamCopilotTurn(options: {
	profile: CopilotProfile;
	prompt: string;
	/** `tone` override, or null to reuse the captured template's tone. */
	tone: string | null;
	callbacks: StreamCallbacks;
	signal: AbortSignal;
	/** Optional diagnostics sink; defaults to a no-op (keeps the client pure). */
	log?: (message: string) => void;
	/**
	 * Host + path to connect to, overriding {@link DEFAULT_ENDPOINT_HOST}. Exists
	 * so the tests can point a turn at a local mock BizChat server; production
	 * never sets it.
	 */
	endpointBase?: string;
}): Promise<void> {
	const { profile, prompt, tone, callbacks, signal } = options;
	const log = options.log ?? (() => {});

	// One conversation id per turn, shared between the URL and the invocation
	// arguments — BizChat rejects the request as `InvalidRequest` when the URL's
	// `ConversationId` and the message's `conversationId` disagree.
	const conversationId = randomUUID();
	const url = buildEndpoint(profile, conversationId, options.endpointBase);
	const invocationId = '0';
	const invocationType = profile.invocationType || 4;

	log(`--- nuevo turno ---`);
	log(`endpoint: ${redactUrl(url)}`);
	log(`invocationType=${invocationType}, tone=${tone ?? 'magic'}`);
	log(`origin=${profile.origin}`);

	const ws = new WebSocket(url, {
		headers: {
			Origin: profile.origin,
			'User-Agent': profile.userAgent,
		},
		// Sydney refuses connections without a browser-like handshake; ws lets
		// us set the headers Node's native WebSocket cannot.
		followRedirects: true,
	});

	let settled = false;
	let idleTimer: NodeJS.Timeout | undefined;

	// Streaming reassembly. BizChat can split ONE answer across several bot
	// "messages" — observed: the prose before a tool-call marker and the
	// marker itself arrive as two separate message objects, each with its
	// own messageId — and mixes two delivery styles per message:
	//   - `writeAtCursor` deltas: always incremental, carry no messageId of
	//     their own — they extend whichever message was introduced most
	//     recently.
	//   - `messages` snapshots: report one message's FULL text so far, keyed
	//     by messageId — diffed against what we've already shown for THAT
	//     message so a re-snapshot of already-delta-streamed content doesn't
	//     double-emit.
	// Tracking this with a single turn-wide "have we seen a delta yet?" flag
	// (the old approach) silently drops the first snapshot chunk of every
	// message AFTER the first one — exactly the bug that truncated
	// `<m365_tool_call>` down to `65_tool_call>` when Claude split its
	// answer into two messages, leaking the tool call as visible text
	// instead of executing it. Track per messageId instead.
	const knownMessageText = new Map<string, string>();
	const NO_MESSAGE_ID = '__default__';
	let currentMessageId = NO_MESSAGE_ID;
	let totalEmittedChars = 0;

	const repetitionGuard = new RunawayRepetitionGuard();

	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			if (idleTimer) clearTimeout(idleTimer);
			clearTimeout(turnTimer);
			signal.removeEventListener('abort', onAbort);
			try {
				if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
					ws.close();
				}
			} catch {
				/* ignore */
			}
		};

		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			if (error.message !== '__CANCELLED__') log(`turno FALLIDO: ${error.message}`);
			else log('turno cancelado por el usuario');
			cleanup();
			reject(error);
		};

		// Hard ceiling, started once and never reset — catches a turn that
		// keeps receiving *something* (so IDLE_TIMEOUT_MS never fires) without
		// ever actually finishing.
		const turnTimer = setTimeout(() => {
			fail(
				new CopilotClientError(
					'El turno llevaba más de 5 minutos sin completarse y se ha cancelado. Puede que el modelo se haya ' +
						'atascado con una respuesta muy larga — prueba a pedir menos de una vez (por ejemplo, un archivo cada vez).',
				),
			);
		}, MAX_TURN_MS);

		/** Every character the model emits passes through here — the one place
		 * that can detect it's stuck in a degenerate repetition loop instead of
		 * making real progress, regardless of whether that garbage would later
		 * be recognized as prose or as part of a tool call. */
		const emit = (text: string) => {
			if (repetitionGuard.push(text)) {
				fail(
					new CopilotClientError(
						'M365 Copilot se ha quedado repitiendo el mismo fragmento sin avanzar (bucle del modelo) y el turno ' +
							'se ha cancelado. Vuelve a intentarlo; si vuelve a pasar, prueba a pedir algo más concreto o en menos pasos.',
					),
				);
				return;
			}
			callbacks.onText(text);
		};

		const succeed = () => {
			if (settled) return;
			settled = true;
			log(`turno completado, ${totalEmittedChars} chars emitidos`);
			if (totalEmittedChars === 0) {
				log('AVISO: se completó sin texto — el parser no reconoció ningún frame de contenido.');
			}
			cleanup();
			callbacks.onDone?.();
			resolve();
		};

		const bumpIdle = () => {
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(
				() => fail(new CopilotClientError('Sin respuesta de M365 Copilot (timeout).')),
				IDLE_TIMEOUT_MS,
			);
		};

		const onAbort = () => fail(new CopilotClientError('__CANCELLED__'));
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener('abort', onAbort, { once: true });

		const handshakeTimer = setTimeout(
			() => fail(new CopilotClientError('El WebSocket de Copilot no completó el handshake.')),
			HANDSHAKE_TIMEOUT_MS,
		);

		let handshakeDone = false;

		ws.on('open', () => {
			log('WebSocket abierto; enviando handshake SignalR');
			// SignalR JSON handshake.
			ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
		});

		ws.on('unexpected-response', (_req, res) => {
			clearTimeout(handshakeTimer);
			const status = res.statusCode ?? 0;
			const statusMessage = res.statusMessage ?? '';
			log(`respuesta HTTP inesperada al abrir el WS: ${status} ${statusMessage}`.trimEnd());

			// Azure AD / Substrate usually explain a 401/403 in a `WWW-Authenticate`
			// header and a JSON body (`error`, `error_description`, correlation id).
			// Log both — this is the difference between "recaptura y ya" and an
			// actual root cause (wrong audience, Conditional Access, expired token).
			for (const h of ['www-authenticate', 'x-ms-diagnostics', 'x-ms-request-id', 'client-request-id']) {
				const v = res.headers[h];
				if (v) log(`  cabecera ${h}: ${v}`);
			}

			const bodyChunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
			res.on('end', () => {
				const body = Buffer.concat(bodyChunks).toString('utf8').trim();
				if (body) log(`  cuerpo de la respuesta: ${truncate(body, 500)}`);
				// A non-101 upgrade response means the socket will never open, so fail
				// now with an accurate message instead of waiting out the generic
				// handshake timeout — that 15 s stall misled users into thinking the
				// connection stalled when the token was actually rejected outright.
				fail(describeUpgradeFailure(status, statusMessage));
			});
		});

		ws.on('error', (err: Error) => {
			clearTimeout(handshakeTimer);
			fail(new CopilotClientError(`Fallo de conexión con Copilot: ${err.message}`));
		});

		ws.on('close', (code: number, reason: Buffer) => {
			clearTimeout(handshakeTimer);
			log(`WebSocket cerrado (código ${code}${reason?.length ? `, ${reason.toString()}` : ''})`);
			if (!settled) {
				// A clean close after we have some text is a normal end for a few
				// rings; treat any accumulated content as a completed turn.
				if (totalEmittedChars > 0) succeed();
				else fail(new CopilotClientError(`Copilot cerró la conexión (código ${code}).`));
			}
		});

		ws.on('message', (raw: WebSocket.RawData) => {
			const text = raw.toString();
			for (const chunk of text.split(RS)) {
				if (!chunk) continue;
				let frame: Record<string, unknown>;
				try {
					frame = JSON.parse(chunk) as Record<string, unknown>;
				} catch {
					log(`<< (no-JSON) ${truncate(chunk, 300)}`);
					continue;
				}

				// First non-empty frame after our handshake send is the server's
				// handshake ack: `{}` (or `{ error }`).
				if (!handshakeDone) {
					handshakeDone = true;
					clearTimeout(handshakeTimer);
					log(`<< handshake ack: ${truncate(chunk, 300)}`);
					if (frame.error) {
						fail(new CopilotClientError(`Handshake rechazado: ${String(frame.error)}`));
						return;
					}
					log('>> enviando invocación chat + Metrics');
					sendInvocation(ws, profile, prompt, tone, invocationType, invocationId, conversationId, log);
					bumpIdle();
					// The `{}` ack frame carries no chat data; done with it.
					continue;
				}

				log(`<< ${truncate(chunk)}`);
				bumpIdle();
				handleFrame(frame, invocationId, {
					emitText: (text, isDelta, messageId) => {
						if (isDelta) {
							// writeAtCursor: always incremental; extends whatever
							// message was introduced most recently.
							const known = knownMessageText.get(currentMessageId) ?? '';
							knownMessageText.set(currentMessageId, known + text);
							totalEmittedChars += text.length;
							if (text) emit(text);
							return;
						}

						const id = messageId ?? NO_MESSAGE_ID;
						currentMessageId = id;
						const known = knownMessageText.get(id);
						if (known === undefined) {
							// First time we see THIS message: it's new (even if other
							// messages earlier in the turn already streamed via
							// deltas) — emit its text in full, not just a suffix.
							knownMessageText.set(id, text);
							totalEmittedChars += text.length;
							if (text) emit(text);
							return;
						}
						if (text.startsWith(known)) {
							const add = text.slice(known.length);
							knownMessageText.set(id, text);
							totalEmittedChars += add.length;
							if (add) emit(add);
						} else {
							// Rare: the snapshot doesn't extend what we've already
							// shown for this message (edited/replaced mid-stream) —
							// best effort, surface the new text as-is.
							knownMessageText.set(id, text);
							totalEmittedChars += text.length;
							emit(text);
						}
					},
					onComplete: succeed,
					onError: fail,
					respondPing: () => ws.send(JSON.stringify({ type: 6 }) + RS),
				});
			}
		});
	});
}

interface FrameHandlers {
	/** `messageId` is present only for snapshot text (`isDelta === false`); deltas carry none. */
	emitText: (text: string, isDelta: boolean, messageId?: string) => void;
	onComplete: () => void;
	onError: (error: Error) => void;
	respondPing: () => void;
}

function handleFrame(
	frame: Record<string, unknown>,
	invocationId: string,
	h: FrameHandlers,
): void {
	const type = frame.type;

	// Keepalive.
	if (type === 6) {
		h.respondPing();
		return;
	}
	// Close frame.
	if (type === 7) {
		if (frame.error) h.onError(new CopilotClientError(String(frame.error)));
		else h.onComplete();
		return;
	}
	// Completion of our StreamInvocation.
	if (type === 3) {
		if (frame.invocationId === invocationId || frame.invocationId === undefined) {
			if (frame.error) h.onError(new CopilotClientError(String(frame.error)));
			else h.onComplete();
		}
		return;
	}

	// Streaming payload: types 1 (Invocation "update") and 2 (StreamItem).
	const args = Array.isArray(frame.arguments)
		? (frame.arguments as unknown[])
		: frame.item !== undefined
			? [frame.item]
			: [];

	for (const arg of args) {
		if (!arg || typeof arg !== 'object') continue;
		const payload = arg as Record<string, unknown>;

		// StreamInvocation result channel (type 2 item): `{ result: { value } }`.
		// Any non-success value means the service rejected/failed the request —
		// surface it instead of silently completing with no text.
		const result = payload.result as { value?: string; message?: string } | undefined;
		if (result && typeof result.value === 'string' && result.value !== 'Success') {
			h.onError(
				new CopilotClientError(
					`El servicio rechazó la petición (${result.value})` +
						(result.message ? `: ${result.message}` : ''),
				),
			);
			return;
		}

		// Incremental delta.
		if (typeof payload.writeAtCursor === 'string') {
			h.emitText(payload.writeAtCursor, true);
		}

		// Full message snapshots.
		const messages = payload.messages;
		if (Array.isArray(messages)) {
			for (const m of messages) {
				const outcome = consumeBotMessage(m, h);
				if (outcome === 'end') {
					h.onComplete();
					return;
				}
				if (outcome === 'filtered') {
					h.emitText(
						'\n\n_(Microsoft 365 Copilot no generó respuesta para esta petición.)_',
						false,
					);
					h.onComplete();
					return;
				}
			}
		}
	}
}

/** Returns 'text' when it emitted content, 'end'/'filtered' when the turn ends. */
function consumeBotMessage(m: unknown, h: FrameHandlers): 'text' | 'end' | 'filtered' | 'skip' {
	if (!m || typeof m !== 'object') return 'skip';
	const msg = m as Record<string, unknown>;
	if (msg.author !== 'bot') return 'skip';

	const messageType = msg.messageType;

	// Content-filter / declined engagement.
	if (messageType === 'Disengaged') return 'filtered';

	// End marker.
	if (messageType === 'EndOfRequest' || messageType === 'RenderCardRequest') return 'end';

	// Control/meta frames (Progress, InternalSearchQuery, etc.) carry a
	// messageType and no user-facing prose — skip them.
	if (messageType !== undefined && messageType !== null) return 'skip';

	if (typeof msg.text === 'string' && msg.text) {
		const messageId = typeof msg.messageId === 'string' ? msg.messageId : undefined;
		h.emitText(msg.text, false, messageId);
		return 'text';
	}
	return 'skip';
}

function sendInvocation(
	ws: WebSocket,
	profile: CopilotProfile,
	prompt: string,
	tone: string | null,
	invocationType: number,
	invocationId: string,
	conversationId: string,
	log: (message: string) => void,
): void {
	const args = buildInvocationArgs(prompt, tone, conversationId);

	const chatFrame = {
		arguments: [args],
		invocationId,
		target: 'chat',
		type: invocationType,
	};

	// Metrics frame — several rings silently produce no output without it.
	const now = new Date();
	const metricsFrame = {
		arguments: [
			{
				Timestamps: {
					ConnectionStart: now.toISOString(),
					ConnectionEstablished: now.toISOString(),
					UserInputStart: now.toISOString(),
					UserInputSubmit: now.toISOString(),
				},
			},
		],
		target: 'Metrics',
		type: 1,
	};

	// Full frame (untruncated) so the temp-file dump captures exactly what we
	// sent — invaluable when a tenant returns InvalidRequest.
	log(`>> chat frame (completo): ${JSON.stringify(chatFrame)}`);
	ws.send(JSON.stringify(chatFrame) + RS + JSON.stringify(metricsFrame) + RS);
}

/**
 * Build the `arguments[0]` object for the `chat` invocation. We deliberately
 * do NOT replay the browser's captured `invocationTemplate` here, even when
 * one was captured: it carries the real web app's `plugins` (e.g.
 * `BingWebSearch`), its full `optionsSets` and a production `tone` — with
 * those in place BizChat treats the turn as a real Copilot web session with
 * its own native tool/plugin access, and the model has no reason to obey our
 * injected `<m365_tool_call>` instructions (see toolProtocol.ts) since it
 * "already" has real tools. The lean default below is what that text-based
 * protocol was actually built and tested against, so we always start from it
 * — a captured profile only ever contributes the access token now.
 */
function buildInvocationArgs(
	prompt: string,
	tone: string | null,
	conversationId: string,
): Record<string, unknown> {
	const base = defaultInvocationArgs();

	// Message text.
	const message = base.message as Record<string, unknown>;
	message.text = prompt;
	message.author = 'user';

	// Tone / model selection; defaultInvocationArgs() already set 'magic'.
	if (tone) base.tone = tone;

	// Fresh conversation each turn (see messages.ts for why). The id MUST match
	// the URL's `ConversationId` — a mismatch is rejected as InvalidRequest.
	base.conversationId = conversationId;
	base.isStartOfSession = true;

	return base;
}

function defaultInvocationArgs(): Record<string, unknown> {
	return {
		source: 'officeweb',
		tone: 'magic',
		streamingMode: 'ConciseWithPadding',
		isStartOfSession: true,
		allowedMessageTypes: ['Chat', 'Suggestion', 'Progress', 'EndOfRequest'],
		clientInfo: { clientPlatform: 'mcmcopilot-web', clientAppName: 'Office' },
		message: { author: 'user', messageType: 'Chat', locale: 'es-ES' },
	};
}

/**
 * Produce the wss URL to connect to. We always build this from the token's own
 * claims (`oid`/`tid`) instead of replaying the browser's captured `endpoint`,
 * even when one is available — its `variants` query string turns on the real
 * web app's feature set (native plugins, rich message types), which is the
 * same thing that breaks our text-based tool-call protocol (see
 * {@link buildInvocationArgs}). The default host/path below is what BizChat's
 * `officeweb` surface actually expects; if Microsoft ever rotates it (e.g.
 * `Chathub` → `ChatHubV2`) it needs to change here for everyone.
 */
function buildEndpoint(profile: CopilotProfile, conversationId: string, base?: string): string {
	const sessionId = randomUUID();

	const oid = profile.claims?.oid ?? '';
	const tid = profile.claims?.tid ?? '';
	const params = new URLSearchParams({
		access_token: profile.accessToken,
		ConversationId: conversationId,
		chatsessionid: sessionId,
		clientrequestid: sessionId,
		'X-SessionId': sessionId,
		source: 'officeweb',
		product: 'Office',
		agentHost: 'Bizchat.FullScreen',
		scenario: 'OfficeWebIncludedCopilot',
	});
	return `${base ?? `${DEFAULT_ENDPOINT_HOST}${DEFAULT_ENDPOINT_PATH}`}/${oid}@${tid}?${params.toString()}`;
}

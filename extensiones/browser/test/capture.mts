/**
 * Tests de la lógica de captura compartida (@m365copilot/core, capture.ts):
 * es la que usan tanto el interceptor de esta extensión como el userscript de
 * Tampermonkey, así que un fallo aquí rompería los dos a la vez.
 *
 * Run: node --experimental-strip-types --import ./test/register.mjs test/capture.mts
 */
import assert from 'node:assert/strict';
import {
  EXPIRY_WATCH_MS,
  MAX_JWT_CHARS,
  SCAN_EXPIRING_MS,
  SCAN_FRESH_MS,
  SCAN_MISSING_MAX_MS,
  SCAN_MISSING_MS,
  acceptToken,
  areClaimsUsable,
  connectionArtSvg,
  connectionState,
  inspectOutgoingFrames,
  isCopilotSocketUrl,
  isMicrosoftHost,
  isValidJwt,
  nextScan,
  normalizeEndpoint,
  profileFromCapture,
  sameCapture,
  tokenInSocketUrl,
  tokensInStorageValue,
  toneOfTemplate,
  withObservedTone,
  withoutExpiredToken,
} from '@m365copilot/core';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function jwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
    aud: 'https://substrate.office.com/sydney',
    oid: 'o',
    tid: 't',
    upn: 'someone@contoso.com',
    ...claims,
  })}.sig`;
}

const inMinutes = (minutes: number) => Math.floor(NOW / 1000) + minutes * 60;

function testTokenValidation() {
  assert.equal(isValidJwt(jwt({ exp: inMinutes(60) })), true);
  assert.equal(isValidJwt('a.b'), false);
  assert.equal(isValidJwt('a.b.c.d'), false);
  assert.equal(isValidJwt('a.b+c.d'), false, 'base64url only');
  assert.equal(isValidJwt(`a.${'x'.repeat(MAX_JWT_CHARS)}.c`), false, 'size cap');
  assert.equal(isValidJwt(42), false);

  assert.equal(areClaimsUsable({ exp: inMinutes(5) }, NOW), true);
  assert.equal(areClaimsUsable({ exp: inMinutes(-1) }, NOW), false, 'expired');
  assert.equal(areClaimsUsable({ exp: inMinutes(5), iat: inMinutes(10) } as never, NOW), false, 'iat after exp');
  assert.equal(areClaimsUsable(null, NOW), false);

  const fresh = jwt({ exp: inMinutes(60) });
  const older = jwt({ exp: inMinutes(30) });
  const newer = jwt({ exp: inMinutes(75) });
  const accepted = acceptToken({}, fresh, NOW);
  assert.equal(accepted?.accessToken, fresh);
  assert.equal(accepted?.claims.upn, 'someone@contoso.com');
  const current = { accessToken: fresh, claims: accepted!.claims };
  assert.equal(acceptToken(current, fresh, NOW), null, 'same token');
  assert.equal(acceptToken(current, older, NOW), null, 'older token');
  assert.equal(acceptToken(current, newer, NOW)?.accessToken, newer, 'newer token');
  assert.equal(acceptToken({}, jwt({ exp: inMinutes(-5) }), NOW), null, 'expired token');
  assert.equal(acceptToken({}, jwt({ aud: 'https://graph.microsoft.com', exp: inMinutes(60) }), NOW), null, 'not Sydney');
  assert.equal(acceptToken({}, `  ${fresh}  `, NOW)?.accessToken, fresh, 'trimmed');
  console.log('  ✓ sólo se acepta un JWT de Sydney válido, sin caducar y no más viejo que el actual');
}

function testSources() {
  const token = jwt({ exp: inMinutes(60) });
  assert.deepEqual(tokensInStorageValue(JSON.stringify({ credentialType: 'AccessToken', secret: token })), [token]);
  assert.deepEqual(tokensInStorageValue(JSON.stringify({ access_token: token })), [token]);
  assert.deepEqual(tokensInStorageValue(token), [token]);
  assert.deepEqual(tokensInStorageValue('{"secret": 1}'), []);
  assert.deepEqual(tokensInStorageValue('short'), []);
  assert.deepEqual(tokensInStorageValue(null), []);

  const socket = `wss://substrate.office.com/m365Copilot/Chathub/o@t?access_token=${token}&ConversationId=c&source=officeweb`;
  assert.equal(isCopilotSocketUrl(socket), true);
  assert.equal(isCopilotSocketUrl('wss://presence.teams.microsoft.com/'), false);
  assert.equal(tokenInSocketUrl(socket), token);
  assert.equal(tokenInSocketUrl('not a url'), null);

  // The chat hub lives on substrate.office.com: it must NOT be rejected.
  assert.equal(normalizeEndpoint(socket), 'wss://substrate.office.com/m365Copilot/Chathub/o@t?source=officeweb');
  assert.equal(isMicrosoftHost('substrate.office.com'), true);
  assert.equal(isMicrosoftHost('m365.cloud.microsoft'), true);
  assert.equal(isMicrosoftHost('office.com'), true);
  assert.equal(isMicrosoftHost('evil-office.com'), false);
  assert.equal(isMicrosoftHost('office.com.evil.net'), false);
  assert.equal(normalizeEndpoint('wss://evil.example/Chathub?access_token=x'), '');
  assert.equal(normalizeEndpoint(`wss://substrate.office.com/${'x'.repeat(3000)}`), '');
  console.log('  ✓ fuentes: caché MSAL, JWT pelado, URL del WebSocket; endpoint de substrate.office.com aceptado');
}

function testFrames() {
  const RS = '\x1e';
  const chat = JSON.stringify({ type: 4, target: 'chat', arguments: [{ tone: 'magic', message: { text: 'hi' } }] });
  const metrics = JSON.stringify({ type: 1, target: 'Metrics', arguments: [{}] });
  assert.deepEqual(inspectOutgoingFrames(`${metrics}${RS}${chat}${RS}`), {
    sawChat: true,
    template: { tone: 'magic', message: { text: 'hi' } },
    invocationType: 4,
  });
  assert.deepEqual(inspectOutgoingFrames(`${metrics}${RS}`), { sawChat: false });
  assert.deepEqual(inspectOutgoingFrames(`{"protocol":"json"${RS}not json${RS}`), { sawChat: false });
  const huge = JSON.stringify({ type: 4, target: 'chat', arguments: [{ blob: 'x'.repeat(70 * 1024) }] });
  assert.deepEqual(inspectOutgoingFrames(huge), { sawChat: true }, 'oversized template is not kept');
  assert.deepEqual(inspectOutgoingFrames(new ArrayBuffer(4)), { sawChat: false });
  console.log('  ✓ frames SignalR: detecta la invocación chat y acota la plantilla');
}

function testStore() {
  const token = jwt({ exp: inMinutes(-1) });
  const expired = { accessToken: token, tokenSource: 'x', claims: { exp: inMinutes(-1) }, endpoint: 'wss://e' };
  assert.deepEqual(withoutExpiredToken(expired, NOW), { endpoint: 'wss://e' });
  assert.equal(withoutExpiredToken({ accessToken: token, claims: { exp: inMinutes(10) } }, NOW), null);
  assert.equal(withoutExpiredToken({}, NOW), null);

  assert.equal(sameCapture({ endpoint: 'a', capturedAt: '1' }, { endpoint: 'a', capturedAt: '2' }), true);
  assert.equal(sameCapture({ endpoint: 'a' }, { endpoint: 'b' }), false);

  assert.equal(profileFromCapture({}, 'UA'), null);
  const profile = profileFromCapture({ accessToken: 'tok', claims: { exp: 1 }, capturedAt: 'when' }, 'UA');
  assert.deepEqual(profile, {
    version: 1,
    capturedAt: 'when',
    accessToken: 'tok',
    endpoint: null,
    origin: 'https://m365.cloud.microsoft',
    userAgent: 'UA',
    invocationTemplate: null,
    invocationType: 4,
    claims: { exp: 1 },
  });
  console.log('  ✓ store: purga del token caducado, comparación sin sello temporal y perfil para VS Code');
}

function testScanLoop() {
  // No token: back off from 2 s up to the cap.
  let missing = SCAN_MISSING_MS;
  const delays: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const next = nextScan({}, missing, NOW);
    delays.push(next.delay);
    missing = next.missingDelay;
  }
  assert.equal(delays[0], 3000);
  assert.equal(Math.max(...delays), SCAN_MISSING_MAX_MS);
  // A fresh token is watched from afar; one about to expire, closely — and the
  // scan never stops while there is a token (the bug the userscript had).
  const fresh = nextScan({ accessToken: 't', claims: { exp: inMinutes(50) } }, missing, NOW);
  assert.deepEqual(fresh, { delay: SCAN_FRESH_MS, missingDelay: SCAN_MISSING_MS });
  const expiring = nextScan({ accessToken: 't', claims: { exp: Math.floor((NOW + EXPIRY_WATCH_MS - 1000) / 1000) } }, missing, NOW);
  assert.equal(expiring.delay, SCAN_EXPIRING_MS);
  console.log('  ✓ bucle de escaneo: backoff sin token, vigilancia lejana con token fresco y cercana al caducar');
}

function testConnectionArt() {
  assert.equal(connectionState({ hasToken: false, expired: false, vscodeConnected: false }), 'waiting');
  assert.equal(connectionState({ hasToken: true, expired: false, vscodeConnected: false }), 'captured');
  assert.equal(connectionState({ hasToken: true, expired: false, vscodeConnected: true }), 'connected');
  assert.equal(connectionState({ hasToken: true, expired: true, vscodeConnected: true }), 'warning');
  assert.equal(connectionState({ hasToken: false, expired: false, vscodeConnected: true, needsUser: true }), 'warning');

  const svg = connectionArtSvg({ idPrefix: 'p1', leftLabel: 'M365', rightLabel: 'VS <Code>', title: 'a & b' });
  assert.match(svg, /^<svg class="m365-art"/);
  assert.match(svg, /id="p1-m365"/);
  assert.match(svg, /id="p1-vscode"/);
  assert.match(svg, /href="#p1-vscode"/);
  assert.match(svg, /filter="url\(#p1-grey\)"/, 'the "off" logos are desaturated');
  assert.match(svg, /url\(#p1-flow\)/);
  assert.doesNotMatch(svg, /m365art-/, 'every id uses the prefix');
  assert.match(svg, /VS &#60;Code&#62;/, 'labels are escaped');
  assert.match(svg, /aria-label="a &#38; b"/);
  for (const state of ['waiting', 'captured', 'connected', 'warning']) {
    assert.match(svg, new RegExp(`\\[data-state="${state}"\\]`), `styles for ${state}`);
  }
  assert.match(svg, /prefers-reduced-motion/);
  console.log('  ✓ ilustración M365 → VS Code: estados, ids con prefijo, etiquetas escapadas y movimiento reducido');
}


function testObservedTones() {
  assert.equal(toneOfTemplate({ tone: 'Gpt_5_7_Chat' }), 'Gpt_5_7_Chat');
  assert.equal(toneOfTemplate({ tone: 'not a tone!' }), null);
  assert.equal(toneOfTemplate({ tone: 42 }), null);
  assert.equal(toneOfTemplate(undefined), null);
  assert.deepEqual(withObservedTone(undefined, 'A_1'), ['A_1']);
  assert.deepEqual(withObservedTone(['A_1', 'B_2'], 'A_1'), ['B_2', 'A_1'], 'moved to most recent, no duplicate');
  assert.deepEqual(withObservedTone(['A_1'], null), ['A_1']);
  const many = Array.from({ length: 30 }, (_, i) => `T_${i}`);
  assert.equal(withObservedTone(many, 'Last_1').length, 20);
  assert.equal(withObservedTone(many, 'Last_1').at(-1), 'Last_1');
  assert.deepEqual(profileFromCapture({ accessToken: 't', observedTones: ['A_1'] }, 'UA')?.observedTones, ['A_1']);
  assert.equal(profileFromCapture({ accessToken: 't' }, 'UA')?.observedTones, undefined);
  console.log('  ✓ modelos vistos en la web: tone validado, sin duplicados, acotado y enviado con el perfil');
}

testTokenValidation();
testSources();
testFrames();
testStore();
testScanLoop();
testConnectionArt();
testObservedTones();
console.log('All tests passed.');

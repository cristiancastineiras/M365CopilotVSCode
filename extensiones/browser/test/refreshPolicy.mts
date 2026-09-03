/**
 * Tests de la política de renovación del token.
 *
 * `refreshPolicy.ts` es puro a propósito (ni `chrome`, ni temporizadores, ni
 * estado en memoria), así que se puede probar la escalada entera aquí, en
 * segundos, en vez de esperando una hora a que caduque un token de verdad.
 *
 * Run: node --experimental-strip-types test/refreshPolicy.mts
 */
import assert from 'node:assert/strict';
import {
  ATTEMPTS_BEFORE_HELP,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  RENEW_MARGIN_MS,
  RESYNC_COOLDOWN_MS,
  backoffFor,
  decideRefreshAction,
  msUntilExpiry,
  needsResync,
  type RefreshContext,
} from '../utils/refreshPolicy.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

/** Contexto por defecto: token sano, una pestaña abierta, sin intentos previos. */
function context(overrides: Partial<RefreshContext> = {}): RefreshContext {
  return {
    now: NOW,
    token: { hasToken: true, expEpochSeconds: (NOW + 40 * MINUTE) / 1000 },
    hasM365Tab: true,
    hasEverCaptured: true,
    lastAttemptAt: null,
    attempts: 0,
    autoOpenTab: true,
    ...overrides,
  };
}

function expiringIn(minutes: number) {
  return { hasToken: true, expEpochSeconds: (NOW + minutes * MINUTE) / 1000 };
}

function testHealthyToken() {
  assert.equal(decideRefreshAction(context()).action, 'none');

  // Justo en el borde del margen todavía no se toca nada; un minuto por debajo, sí.
  const atMargin = expiringIn(RENEW_MARGIN_MS / MINUTE + 1);
  assert.equal(decideRefreshAction(context({ token: atMargin })).action, 'none');
  const belowMargin = expiringIn(RENEW_MARGIN_MS / MINUTE - 1);
  assert.equal(decideRefreshAction(context({ token: belowMargin })).action, 'rescan');

  console.log('  ✓ un token con cuerda no se toca; por debajo del margen se renueva');
}

function testEscalation() {
  // 1º lo barato: pedir a la pestaña que mire otra vez la caché de MSAL.
  assert.equal(decideRefreshAction(context({ token: expiringIn(3) })).action, 'rescan');

  // 2º si el re-escaneo no trajo token nuevo, recargar — pero sólo cuando haya
  // pasado el backoff.
  const afterRescan = context({
    token: expiringIn(3),
    attempts: 1,
    lastAttemptAt: NOW - 10_000,
  });
  const waiting = decideRefreshAction(afterRescan);
  assert.equal(waiting.action, 'wait');
  assert.ok((waiting.retryInMs ?? 0) > 0, 'wait debe decir cuánto falta');

  assert.equal(
    decideRefreshAction({ ...afterRescan, lastAttemptAt: NOW - BASE_BACKOFF_MS - 1 }).action,
    'reload',
  );

  // 3º sin ninguna pestaña de M365, abrir una en segundo plano.
  assert.equal(
    decideRefreshAction(context({ token: expiringIn(3), hasM365Tab: false })).action,
    'open',
  );
  // …salvo que el usuario lo haya desactivado.
  assert.equal(
    decideRefreshAction(
      context({ token: expiringIn(3), hasM365Tab: false, autoOpenTab: false }),
    ).action,
    'needsUser',
  );

  // 4º tras varios intentos seguidos, hace falta que entre el usuario.
  assert.equal(
    decideRefreshAction(
      context({
        token: expiringIn(3),
        attempts: ATTEMPTS_BEFORE_HELP,
        lastAttemptAt: NOW - MAX_BACKOFF_MS - 1,
      }),
    ).action,
    'needsUser',
  );

  console.log('  ✓ escalada re-escaneo → recarga → pestaña nueva → avisar al usuario');
}

function testExpiredAndMissing() {
  // Un token ya caducado se trata igual que uno a punto de caducar.
  assert.equal(decideRefreshAction(context({ token: expiringIn(-5) })).action, 'rescan');

  // Sin token pero con capturas previas hay sesión que recuperar.
  assert.equal(
    decideRefreshAction(
      context({ token: { hasToken: false, expEpochSeconds: null } }),
    ).action,
    'rescan',
  );

  // Sin haber capturado nunca no se abre nada por nuestra cuenta.
  assert.equal(
    decideRefreshAction(
      context({ token: { hasToken: false, expEpochSeconds: null }, hasEverCaptured: false }),
    ).action,
    'none',
  );

  // Un token sin `exp` no se puede evaluar: se renueva por si acaso.
  assert.equal(
    decideRefreshAction(context({ token: { hasToken: true, expEpochSeconds: null } })).action,
    'rescan',
  );

  console.log('  ✓ token caducado, ausente, sin exp y sin captura previa');
}

function testBackoff() {
  assert.equal(backoffFor(0), 0);
  assert.equal(backoffFor(1), BASE_BACKOFF_MS);
  assert.equal(backoffFor(2), BASE_BACKOFF_MS * 2);
  assert.equal(backoffFor(99), MAX_BACKOFF_MS, 'el backoff tiene tope');

  // Un reloj que salta hacia atrás (suspender el portátil, cambio de hora) no
  // puede dejar la renovación bloqueada para siempre.
  const future = context({ token: expiringIn(1), attempts: 1, lastAttemptAt: NOW + 60 * MINUTE });
  assert.notEqual(decideRefreshAction(future).action, 'wait');

  assert.equal(msUntilExpiry({ hasToken: true, expEpochSeconds: NOW / 1000 + 60 }, NOW), 60_000);
  assert.equal(msUntilExpiry({ hasToken: false, expEpochSeconds: 1 }, NOW), null);

  console.log('  ✓ backoff creciente con tope y a prueba de saltos de reloj');
}

function testResync() {
  const base = {
    capturedAt: new Date(NOW).toISOString(),
    hasToken: true,
    currentTokenExp: NOW / 1000 + 3600,
    lastSyncAttemptAt: null,
    now: NOW,
  };

  // Nunca se envió: hay que enviarlo (VS Code pudo arrancar después).
  assert.equal(needsResync({ ...base, syncedTokenExp: null }), true);
  // Ya tiene ESTE token: no se repite.
  assert.equal(needsResync({ ...base, syncedTokenExp: base.currentTokenExp }), false);
  // Tiene uno más viejo: se reenvía.
  assert.equal(needsResync({ ...base, syncedTokenExp: base.currentTokenExp - 600 }), true);
  // Sin token no hay nada que mandar.
  assert.equal(needsResync({ ...base, hasToken: false, syncedTokenExp: null }), false);
  // Y no se martillea al servidor local cuando está apagado.
  assert.equal(
    needsResync({ ...base, syncedTokenExp: null, lastSyncAttemptAt: NOW - RESYNC_COOLDOWN_MS + 1 }),
    false,
  );
  assert.equal(
    needsResync({ ...base, syncedTokenExp: null, lastSyncAttemptAt: NOW - RESYNC_COOLDOWN_MS - 1 }),
    true,
  );

  console.log('  ✓ reenvío a VS Code sólo cuando hace falta, con cooldown');
}

console.log('refreshPolicy.ts');
testHealthyToken();
testEscalation();
testExpiredAndMissing();
testBackoff();
testResync();
console.log('\nAll tests passed.');

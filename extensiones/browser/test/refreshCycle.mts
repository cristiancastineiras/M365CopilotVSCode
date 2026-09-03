/**
 * Tests del ciclo de renovación contra un `chrome` de mentira.
 *
 * La política ya se prueba aparte (refreshPolicy.mts); lo que se comprueba aquí
 * es el pegamento, que es donde estaban los fallos de verdad: qué se guarda
 * entre despertares del service worker, a qué pestaña se le habla, cuándo se
 * reenvía a VS Code y qué pasa cuando falta el permiso `alarms`.
 *
 * Run: node --experimental-strip-types --import ./test/register.mjs test/refreshCycle.mts
 */
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- chrome falso

interface FakeTab {
  id: number;
  url: string;
}

interface ChromeCalls {
  messages: { tabId: number; type: string }[];
  reloaded: number[];
  created: string[];
  removed: number[];
  badges: string[];
}

function installFakeChrome(options: { tabs?: FakeTab[]; withAlarms?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const tabs = [...(options.tabs ?? [])];
  const calls: ChromeCalls = { messages: [], reloaded: [], created: [], removed: [], badges: [] };
  let nextTabId = 100;

  const chrome: any = {
    runtime: { id: 'test-extension' },
    storage: {
      local: {
        async get(defaults: Record<string, unknown>) {
          const out: Record<string, unknown> = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            out[key] = store.has(key) ? store.get(key) : fallback;
          }
          return out;
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values)) store.set(key, value);
        },
      },
    },
    tabs: {
      async query({ url }: { url: string[] }) {
        // Basta con distinguir «hay pestaña de M365» de «no la hay».
        const hosts = url.map((pattern) => pattern.replace(/^https:\/\/|\*|\/.*$/g, ''));
        return tabs.filter((tab) => hosts.some((host) => tab.url.includes(host.replace('.', '.'))));
      },
      async sendMessage(tabId: number, message: { type: string }) {
        calls.messages.push({ tabId, type: message.type });
        return { status: 'ok' };
      },
      async reload(tabId: number) {
        calls.reloaded.push(tabId);
      },
      async create({ url }: { url: string }) {
        calls.created.push(url);
        const tab = { id: nextTabId++, url };
        tabs.push(tab);
        return tab;
      },
      async remove(tabId: number) {
        calls.removed.push(tabId);
        const index = tabs.findIndex((tab) => tab.id === tabId);
        if (index >= 0) tabs.splice(index, 1);
      },
    },
    action: {
      async setBadgeText({ text }: { text: string }) {
        calls.badges.push(text);
      },
      async setBadgeBackgroundColor() {},
    },
  };

  if (options.withAlarms !== false) {
    chrome.alarms = {
      created: [] as string[],
      create(name: string) {
        chrome.alarms.created.push(name);
      },
      onAlarm: { addListener() {} },
      async clear() {},
    };
  }

  (globalThis as any).chrome = chrome;
  return { chrome, store, calls, tabs };
}

/** Perfil como el que guarda el interceptor. */
function profileExpiringIn(minutes: number) {
  return {
    accessToken: 'ey.fake.token',
    capturedAt: new Date().toISOString(),
    claims: { exp: Math.floor((Date.now() + minutes * 60_000) / 1000), upn: 'a@b.c' },
  };
}

// Los módulos leen `chrome` al ejecutarse, así que el stub va antes del import.
installFakeChrome();
const { runRefreshCycle, onTokenCaptured, setSyncHandler, setupTokenRefresher } = await import(
  '../utils/tokenRefresher.ts'
);
const { getStorage, setStorage } = await import('../utils/storage.ts');

const M365_TAB: FakeTab = { id: 7, url: 'https://m365.cloud.microsoft/chat/' };

async function seed(profile: unknown, extra: Record<string, unknown> = {}) {
  await setStorage('currentProfile', profile as any);
  await setStorage('hasEverCaptured', true);
  for (const [key, value] of Object.entries(extra)) {
    await setStorage(key as any, value as any);
  }
}

// ------------------------------------------------------------------- casos

async function testHealthyTokenSyncsOnce() {
  const { calls } = installFakeChrome({ tabs: [M365_TAB] });
  const sent: unknown[] = [];
  setSyncHandler(async (profile) => {
    sent.push(profile);
    return true;
  });
  await seed(profileExpiringIn(45));

  const decision = await runRefreshCycle();
  assert.equal(decision.action, 'none');
  // VS Code no tenía este token: se le manda una vez, sin tocar ninguna pestaña.
  assert.equal(sent.length, 1);
  assert.deepEqual(calls.reloaded, []);
  assert.deepEqual(calls.created, []);

  console.log('  ✓ token sano: se reenvía a VS Code una vez y no se toca el navegador');
}

async function testResyncIsNotRepeated() {
  installFakeChrome({ tabs: [M365_TAB] });
  let sends = 0;
  setSyncHandler(async () => {
    sends += 1;
    return true;
  });
  const profile = profileExpiringIn(45);
  await seed(profile);

  await runRefreshCycle();
  // El envío real es quien anota el `exp` sincronizado; aquí lo simula el stub.
  await setStorage('syncState', {
    syncedTokenExp: profile.claims.exp,
    lastSyncAttemptAt: Date.now() - 60_000,
    lastError: null,
  });
  await runRefreshCycle();

  assert.equal(sends, 1, 'el mismo token no se reenvía en cada latido');
  console.log('  ✓ el reenvío no se repite mientras VS Code tenga ese mismo token');
}

async function testEscalationOverCycles() {
  const { calls } = installFakeChrome({ tabs: [M365_TAB] });
  setSyncHandler(async () => true);
  await seed(profileExpiringIn(3));

  // 1er ciclo: pedir a la pestaña que re-escanee la caché de MSAL.
  assert.equal((await runRefreshCycle()).action, 'rescan');
  assert.deepEqual(calls.messages, [{ tabId: 7, type: 'RESCAN_TOKEN' }]);

  // Inmediatamente después: backoff, no se insiste.
  assert.equal((await runRefreshCycle()).action, 'wait');
  assert.equal(calls.messages.length, 1);

  // Pasado el backoff y sin token nuevo: recargar la pestaña.
  const state = await getStorage('refreshState');
  await setStorage('refreshState', { ...state, lastAttemptAt: Date.now() - 5 * 60_000 });
  assert.equal((await runRefreshCycle()).action, 'reload');
  assert.deepEqual(calls.reloaded, [7]);

  console.log('  ✓ re-escaneo → espera (backoff) → recarga, a lo largo de varios latidos');
}

async function testOpensAndClosesItsOwnTab() {
  const { calls } = installFakeChrome({ tabs: [] });
  setSyncHandler(async () => true);
  await seed(profileExpiringIn(2));

  assert.equal((await runRefreshCycle()).action, 'open');
  assert.equal(calls.created.length, 1);
  assert.match(calls.created[0], /m365\.cloud\.microsoft/);

  const opened = await getStorage('refreshState');
  assert.ok(opened.openedTabId, 'se recuerda la pestaña abierta para poder cerrarla');

  // Llega el token nuevo: se cierra la pestaña y se reinicia el backoff.
  await onTokenCaptured(profileExpiringIn(60));
  assert.deepEqual(calls.removed, [opened.openedTabId]);
  const after = await getStorage('refreshState');
  assert.equal(after.attempts, 0);
  assert.equal(after.openedTabId, null);

  console.log('  ✓ sin pestañas: abre una en segundo plano y la cierra al capturar');
}

async function testSurvivesMissingAlarmsPermission() {
  installFakeChrome({ tabs: [M365_TAB], withAlarms: false });
  // Esto es exactamente lo que tumbaba el background entero: `chrome.alarms`
  // era undefined y la excepción se llevaba por delante el registro de
  // handlers. Ahora avisa y sigue.
  assert.doesNotThrow(() => setupTokenRefresher(async () => true));
  console.log('  ✓ sin el permiso "alarms" avisa, pero no tumba el background');
}

console.log('tokenRefresher.ts (ciclo completo)');
await testHealthyTokenSyncsOnce();
await testResyncIsNotRepeated();
await testEscalationOverCycles();
await testOpensAndClosesItsOwnTab();
await testSurvivesMissingAlarmsPermission();
console.log('\nAll tests passed.');

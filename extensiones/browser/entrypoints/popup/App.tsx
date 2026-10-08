import { useCallback, useEffect, useState } from 'react';
import { connectionState, M365_CHAT_URL } from '@m365copilot/core';
import { ext } from '@/utils/api';
import { sendMessage } from '@/utils/messaging';
import { getLocale, t, type MessageKey } from '@/utils/i18n';
import { StatusRow, type Tone } from './components/StatusRow';
import { ConnectionArt } from './components/ConnectionArt';

interface ProfileState {
  hasToken: boolean;
  minutesLeft: number | null;
  capturedAt: string | null;
  /** Última acción del auto-renovador (ver utils/refreshPolicy.ts). */
  refreshAction: string | null;
}

const EMPTY: ProfileState = {
  hasToken: false,
  minutesLeft: null,
  capturedAt: null,
  refreshAction: null,
};

/** Qué está haciendo el auto-renovador, en un par de palabras, y con qué color. */
const REFRESH: Record<string, { label: MessageKey; tone: Tone }> = {
  none: { label: 'refresh.none', tone: 'ok' },
  captured: { label: 'refresh.captured', tone: 'ok' },
  rescan: { label: 'refresh.rescan', tone: 'warn' },
  reload: { label: 'refresh.reload', tone: 'warn' },
  open: { label: 'refresh.open', tone: 'warn' },
  wait: { label: 'refresh.wait', tone: 'warn' },
  needsUser: { label: 'refresh.needsUser', tone: 'bad' },
};

type VSCode = 'unknown' | 'connected' | 'disconnected';

export default function App() {
  const [profile, setProfile] = useState<ProfileState>(EMPTY);
  const [vscode, setVscode] = useState<VSCode>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await sendMessage('GET_STATUS', undefined);
      const store = status.profile || {};
      setProfile({
        hasToken: Boolean(store.accessToken),
        minutesLeft: status.minutesLeft,
        capturedAt: store.capturedAt || null,
        refreshAction: status.refreshState.lastAction,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    try {
      const { connected } = await sendMessage('CHECK_VSCODE', undefined);
      setVscode(connected ? 'connected' : 'disconnected');
    } catch {
      setVscode('disconnected');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyToken = () =>
    run(async () => {
      const { token } = await sendMessage('COPY_TOKEN', undefined);
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });

  const send = () =>
    run(async () => {
      await sendMessage('SEND_TO_VSCODE', undefined);
      setVscode('connected');
      setSent(true);
      setTimeout(() => setSent(false), 2000);
    });

  /** Sin token no hay nada que enviar: lo útil es ir a M365 Copilot a capturarlo. */
  const openM365 = () =>
    run(async () => {
      await ext().tabs.create({ url: M365_CHAT_URL });
      window.close();
    });

  /** Fuerza el ciclo de renovación ya, sin esperar al latido ni al backoff. */
  const renew = () =>
    run(async () => {
      await sendMessage('FORCE_REFRESH', undefined);
      // La captura llega de forma asíncrona (re-escaneo o recarga de la
      // pestaña): se refresca un par de veces para reflejarla sin cerrar.
      await refresh();
      setTimeout(() => void refresh(), 3000);
    });

  const expired = profile.minutesLeft !== null && profile.minutesLeft <= 0;
  const needsUser = profile.refreshAction === 'needsUser';
  const hero = deriveHero(profile.hasToken, expired, vscode, needsUser);
  const artState = connectionState({
    hasToken: profile.hasToken,
    expired,
    vscodeConnected: vscode === 'connected',
    needsUser,
  });
  const token = tokenStatus(profile.hasToken, expired, profile.minutesLeft);
  const vsc = vscodeStatus(vscode);
  const renewal = REFRESH[profile.refreshAction ?? 'none'] ?? REFRESH.none;
  // El botón grande es siempre el paso siguiente: sin token o sin sesión,
  // abrir M365 Copilot; con el token caducado, renovarlo (enviarlo fallaría);
  // si no, enviarlo. El secundario no repite el principal.
  const primary = !profile.hasToken || needsUser ? 'open' : expired ? 'renew' : 'send';

  return (
    <main className="app">
      <section className="hero">
        <ConnectionArt state={artState} />
        <h1 className="title" data-busy={hero.busy || undefined}>
          {hero.title}
        </h1>
        <p className="subtitle">{hero.sub}</p>
      </section>

      <dl className="list">
        <StatusRow label={t('row.token')} tone={token.tone} value={token.label} />
        <StatusRow label={t('row.vscode')} tone={vsc.tone} value={vsc.label} />
        <StatusRow label={t('row.renewal')} tone={renewal.tone} value={t(renewal.label)} />
      </dl>

      {error && (
        <div className="message" role="alert">
          <ErrorIcon />
          <span>{error}</span>
        </div>
      )}

      <div className="actions">
        {primary === 'open' && (
          <button className="button primary" disabled={busy} onClick={openM365}>
            {t('button.openM365')}
          </button>
        )}
        {primary === 'renew' && (
          <button className="button primary" disabled={busy} onClick={renew}>
            {t('button.renew')}
          </button>
        )}
        {primary === 'send' && (
          <button className={`button ${sent ? 'done' : 'primary'}`} disabled={busy} onClick={send}>
            {t(sent ? 'button.sent' : 'button.send')}
          </button>
        )}
        <div className="actions-row">
          <button
            className={`button ${copied ? 'done' : ''}`}
            disabled={!profile.hasToken || expired || busy}
            onClick={copyToken}
          >
            {t(copied ? 'button.copied' : 'button.copyToken')}
          </button>
          {primary === 'renew' ? (
            <button className="button" disabled={busy} onClick={openM365}>
              {t('button.openM365')}
            </button>
          ) : (
            <button className="button" disabled={busy} onClick={renew}>
              {t('button.renew')}
            </button>
          )}
        </div>
      </div>

      {profile.capturedAt && (
        <footer className="footer">{t('footer.captured', relativeTime(profile.capturedAt))}</footer>
      )}
    </main>
  );
}

/* ------------------------------------------------------------- helpers */

function deriveHero(
  hasToken: boolean,
  expired: boolean,
  vscode: VSCode,
  needsUser: boolean,
): { title: string; sub: string; busy: boolean } {
  // El auto-renovador agotó sus intentos: esto sí necesita al usuario.
  if (needsUser) return { title: t('hero.needsUser.title'), sub: t('hero.needsUser.sub'), busy: false };
  if (!hasToken) return { title: t('hero.noToken.title'), sub: t('hero.noToken.sub'), busy: true };
  if (expired) return { title: t('hero.expired.title'), sub: t('hero.expired.sub'), busy: true };
  if (vscode !== 'connected') return { title: t('hero.noVSCode.title'), sub: t('hero.noVSCode.sub'), busy: false };
  return { title: t('hero.ok.title'), sub: t('hero.ok.sub'), busy: false };
}

function tokenStatus(hasToken: boolean, expired: boolean, minutesLeft: number | null): { tone: Tone; label: string } {
  if (!hasToken) return { tone: 'neutral', label: t('token.none') };
  if (expired) return { tone: 'warn', label: t('token.expired') };
  if (minutesLeft !== null) return { tone: 'ok', label: t('token.expiresIn', minutesLeft) };
  return { tone: 'ok', label: t('token.active') };
}

function vscodeStatus(vscode: VSCode): { tone: Tone; label: string } {
  if (vscode === 'connected') return { tone: 'ok', label: t('vscode.connected') };
  if (vscode === 'disconnected') return { tone: 'bad', label: t('vscode.disconnected') };
  return { tone: 'neutral', label: t('vscode.checking') };
}

/** Icono «ErrorCircle» al estilo Fluent, 16 px. */
function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.5v4.2M8 11.2v.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return t('time.justNow');
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minutesAgo', min);
  const h = Math.floor(min / 60);
  if (h < 24) return t('time.hoursAgo', h);
  return new Date(iso).toLocaleDateString(getLocale());
}

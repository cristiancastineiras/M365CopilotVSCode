import { useCallback, useEffect, useState } from 'react';
import { sendMessage } from '@/utils/messaging';
import { getLocale, t, type MessageKey } from '@/utils/i18n';
import { Pill, type Tone } from './components/Pill';
import { StatusRow } from './components/StatusRow';

interface ProfileState {
  hasToken: boolean;
  hasEndpoint: boolean;
  hasFrame: boolean;
  minutesLeft: number | null;
  capturedAt: string | null;
  upn: string | null;
  /** Última acción del auto-renovador (ver utils/refreshPolicy.ts). */
  refreshAction: string | null;
  refreshReason: string | null;
}

const EMPTY: ProfileState = {
  hasToken: false,
  hasEndpoint: false,
  hasFrame: false,
  minutesLeft: null,
  capturedAt: null,
  upn: null,
  refreshAction: null,
  refreshReason: null,
};

/** Qué está haciendo el auto-renovador, en un par de palabras. */
const REFRESH_LABEL: Record<string, MessageKey> = {
  none: 'refresh.none',
  captured: 'refresh.captured',
  rescan: 'refresh.rescan',
  reload: 'refresh.reload',
  open: 'refresh.open',
  wait: 'refresh.wait',
  needsUser: 'refresh.needsUser',
};

type VSCode = 'unknown' | 'connected' | 'disconnected';
type Copied = 'token' | 'profile' | null;

export default function App() {
  const [profile, setProfile] = useState<ProfileState>(EMPTY);
  const [vscode, setVscode] = useState<VSCode>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await sendMessage('GET_STATUS', undefined);
      const store = status.profile || {};
      setProfile({
        hasToken: Boolean(store.accessToken),
        hasEndpoint: Boolean(store.endpoint),
        hasFrame: Boolean(store.invocationTemplate),
        minutesLeft: status.minutesLeft,
        capturedAt: store.capturedAt || null,
        upn: store.claims?.upn || null,
        refreshAction: status.refreshState.lastAction,
        refreshReason: status.refreshState.lastReason,
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
      setCopied('token');
      setTimeout(() => setCopied(null), 1600);
    });

  const copyProfile = () =>
    run(async () => {
      const { text } = await sendMessage('COPY_PROFILE', undefined);
      await navigator.clipboard.writeText(text);
      setCopied('profile');
      setTimeout(() => setCopied(null), 1600);
    });

  const send = () =>
    run(async () => {
      await sendMessage('SEND_TO_VSCODE', undefined);
      setVscode('connected');
      setSent(true);
      setTimeout(() => setSent(false), 2000);
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
  const hero = deriveHero(profile.hasToken, expired, vscode, profile.refreshAction);
  const tokenValue = !profile.hasToken
    ? t('token.none')
    : expired
      ? t('token.expired')
      : profile.minutesLeft !== null
        ? t('token.expiresIn', profile.minutesLeft)
        : t('token.active');

  const vsc = vscodePill(vscode);

  return (
    <div className="app">

      <section className="hero">
        <div className="hero-icon" data-tone={hero.tone}>
          {hero.icon}
        </div>
        <div>
          <div className="hero-title">{hero.title}</div>
          <div className="hero-sub">{hero.sub}</div>
        </div>
      </section>

      <div className="card">
        <StatusRow label={t('row.token')} ok={profile.hasToken && !expired} value={tokenValue} />
        <StatusRow
          label={t('row.endpoint')}
          ok={profile.hasEndpoint}
          value={t(profile.hasEndpoint ? 'endpoint.captured' : 'endpoint.pending')}
        />
        <StatusRow
          label={t('row.vscode')}
          ok={vscode === 'connected'}
          value={vsc.label}
        />
        <StatusRow
          label={t('row.renewal')}
          ok={profile.refreshAction !== 'needsUser'}
          value={t(REFRESH_LABEL[profile.refreshAction ?? 'none'] ?? 'refresh.none')}
        />
      </div>

      {/* {profile.upn && (
        <div className="user">
          <span className="user-name">{profile.upn}</span>
        </div>
      )} */}

      <div className="actions">
        <button
          className={`btn ${sent ? 'btn-ok' : 'btn-primary'}`}
          disabled={!profile.hasToken || busy}
          onClick={send}
        >
          {t(sent ? 'button.sent' : 'button.send')}
        </button>
        <div className="actions">
          <button
            className={`btn ${copied === 'token' ? 'btn-ok' : 'btn-ghost'}`}
            disabled={!profile.hasToken || busy}
            onClick={copyToken}
          >
            {t(copied === 'token' ? 'button.copied' : 'button.copyToken')}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={renew}>
            {t('button.renew')}
          </button>
        </div>
      </div>

      {error && <div className="alert">⚠️ {error}</div>}

      <footer className="footer">
        {profile.capturedAt ? t('footer.captured', relativeTime(profile.capturedAt)) : t('footer.hint')}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function deriveHero(
  hasToken: boolean,
  expired: boolean,
  vscode: VSCode,
  refreshAction: string | null,
): { tone: Tone; icon: string; title: string; sub: string } {
  // El auto-renovador agotó sus intentos: esto sí necesita al usuario.
  if (refreshAction === 'needsUser') {
    return { tone: 'bad', icon: '!', title: t('hero.needsUser.title'), sub: t('hero.needsUser.sub') };
  }
  if (!hasToken) {
    return { tone: 'neutral', icon: '…', title: t('hero.noToken.title'), sub: t('hero.noToken.sub') };
  }
  if (expired) {
    return { tone: 'warn', icon: '↻', title: t('hero.expired.title'), sub: t('hero.expired.sub') };
  }
  if (vscode !== 'connected') {
    return { tone: 'warn', icon: '!', title: t('hero.noVSCode.title'), sub: t('hero.noVSCode.sub') };
  }
  return { tone: 'ok', icon: '✓', title: t('hero.ok.title'), sub: t('hero.ok.sub') };
}

function vscodePill(vscode: VSCode): { tone: Tone; label: string } {
  if (vscode === 'connected') return { tone: 'ok', label: t('vscode.connected') };
  if (vscode === 'disconnected') return { tone: 'bad', label: t('vscode.disconnected') };
  return { tone: 'neutral', label: t('vscode.checking') };
}

function initials(upn: string): string {
  const name = upn.split('@')[0] || upn;
  const parts = name.split(/[.\-_]/).filter(Boolean);
  const first = parts[0]?.[0] ?? name[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).slice(0, 2);
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

import { useCallback, useEffect, useState } from 'react';
import { sendMessage } from '@/utils/messaging';
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
const REFRESH_LABEL: Record<string, string> = {
  none: 'Automática',
  captured: 'Token renovado',
  rescan: 'Buscando token nuevo…',
  reload: 'Recargando M365…',
  open: 'Abriendo M365…',
  wait: 'Reintentando en breve',
  needsUser: 'Inicia sesión en M365',
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
    ? 'Sin capturar'
    : expired
      ? 'Caducado'
      : profile.minutesLeft !== null
        ? `Caduca en ${profile.minutesLeft} min`
        : 'Activo';

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
        <StatusRow label="Token" ok={profile.hasToken && !expired} value={tokenValue} />
        <StatusRow
          label="Endpoint"
          ok={profile.hasEndpoint}
          value={profile.hasEndpoint ? 'Capturado' : 'Pendiente'}
        />
        <StatusRow
          label="VS Code"
          ok={vscode === 'connected'}
          value={vsc.label}
        />
        <StatusRow
          label="Renovación"
          ok={profile.refreshAction !== 'needsUser'}
          value={REFRESH_LABEL[profile.refreshAction ?? 'none'] ?? 'Automática'}
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
          {sent ? '✓ Enviado a VS Code' : 'Enviar a VS Code'}
        </button>
        <div className="actions">
          <button
            className={`btn ${copied === 'token' ? 'btn-ok' : 'btn-ghost'}`}
            disabled={!profile.hasToken || busy}
            onClick={copyToken}
          >
            {copied === 'token' ? '✓ Copiado' : 'Copiar token'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={renew}>
            Renovar ahora
          </button>
        </div>
      </div>

      {error && <div className="alert">⚠️ {error}</div>}

      <footer className="footer">
        {profile.capturedAt
          ? `Capturado ${relativeTime(profile.capturedAt)}`
          : 'Abre M365 Copilot y envía un mensaje para capturar.'}
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
    return {
      tone: 'bad',
      icon: '!',
      title: 'Hace falta iniciar sesión',
      sub: 'Abre M365 Copilot y entra con tu cuenta.',
    };
  }
  if (!hasToken) {
    return {
      tone: 'neutral',
      icon: '…',
      title: 'Esperando token',
      sub: 'Abre M365 Copilot y escribe un mensaje.',
    };
  }
  if (expired) {
    return {
      tone: 'warn',
      icon: '↻',
      title: 'Renovando token',
      sub: 'La extensión lo está renovando sola.',
    };
  }
  if (vscode !== 'connected') {
    return {
      tone: 'warn',
      icon: '!',
      title: 'Token listo',
      sub: 'VS Code no responde. Ábrelo con la extensión activa.',
    };
  }
  return {
    tone: 'ok',
    icon: '✓',
    title: 'Todo listo',
    sub: 'El token se sincroniza automáticamente.',
  };
}

function vscodePill(vscode: VSCode): { tone: Tone; label: string } {
  if (vscode === 'connected') return { tone: 'ok', label: 'VS Code' };
  if (vscode === 'disconnected') return { tone: 'bad', label: 'Sin conexión' };
  return { tone: 'neutral', label: 'Comprobando…' };
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
  if (!Number.isFinite(diff) || diff < 0) return 'hace un momento';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString();
}

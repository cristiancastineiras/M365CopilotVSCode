/**
 * Textos de la extensión de navegador en inglés y español.
 *
 * El nombre y la descripción del manifiesto (lo que se ve en la tienda y en
 * chrome://extensions) van por el i18n nativo del navegador, en
 * `public/_locales/<idioma>/messages.json`. Todo lo demás — popup, mensajes de
 * error del background — sale de aquí: los textos con valores dinámicos
 * («Caduca en 12 min») son mucho más cómodos con `{0}` tipados que con los
 * `placeholders` de messages.json, y así un texto que falte en un idioma es un
 * error de compilación (`es` está tipado contra las claves de `en`).
 */

export type Locale = 'en' | 'es';

const en = {
  'popup.title': 'M365 Copilot for VS Code',
  'hero.needsUser.title': 'Sign-in required',
  'hero.needsUser.sub': 'Open M365 Copilot and sign in with your account.',
  'hero.noToken.title': 'Waiting for a token',
  'hero.noToken.sub': 'Open M365 Copilot and send a message.',
  'hero.expired.title': 'Renewing the token',
  'hero.expired.sub': 'The extension is renewing it by itself.',
  'hero.noVSCode.title': 'Token ready',
  'hero.noVSCode.sub': 'VS Code is not answering. Open it with the extension enabled.',
  'hero.ok.title': 'All set',
  'hero.ok.sub': 'The token syncs automatically.',
  'row.token': 'Token',
  'row.endpoint': 'Endpoint',
  'row.vscode': 'VS Code',
  'row.renewal': 'Renewal',
  'token.none': 'Not captured',
  'token.expired': 'Expired',
  'token.expiresIn': 'Expires in {0} min',
  'token.active': 'Active',
  'endpoint.captured': 'Captured',
  'endpoint.pending': 'Pending',
  'vscode.connected': 'Connected',
  'vscode.disconnected': 'Not connected',
  'vscode.checking': 'Checking…',
  'refresh.none': 'Automatic',
  'refresh.captured': 'Token renewed',
  'refresh.rescan': 'Looking for a new token…',
  'refresh.reload': 'Reloading M365…',
  'refresh.open': 'Opening M365…',
  'refresh.wait': 'Retrying shortly',
  'refresh.needsUser': 'Sign in to M365',
  'button.send': 'Send to VS Code',
  'button.sent': '✓ Sent to VS Code',
  'button.copyToken': 'Copy token',
  'button.copied': '✓ Copied',
  'button.renew': 'Renew now',
  'footer.captured': 'Captured {0}',
  'footer.hint': 'Open M365 Copilot and send a message to capture the token.',
  'time.justNow': 'just now',
  'time.minutesAgo': '{0} min ago',
  'time.hoursAgo': '{0} h ago',
  'error.title': 'Something went wrong',
  'error.noProfile': 'No profile has been captured yet. Open M365 Copilot and send a message.',
  'error.noToken': 'No token has been captured yet. Open M365 Copilot and send a message.',
  'error.tokenExpired': 'The saved token has expired. Press “Renew now”.',
  'error.vscodeUnreachable': 'VS Code is not answering. Is it open with the M365 Copilot extension enabled?',
};

const es: Record<keyof typeof en, string> = {
  'popup.title': 'M365 Copilot para VS Code',
  'hero.needsUser.title': 'Hace falta iniciar sesión',
  'hero.needsUser.sub': 'Abre M365 Copilot y entra con tu cuenta.',
  'hero.noToken.title': 'Esperando token',
  'hero.noToken.sub': 'Abre M365 Copilot y escribe un mensaje.',
  'hero.expired.title': 'Renovando token',
  'hero.expired.sub': 'La extensión lo está renovando sola.',
  'hero.noVSCode.title': 'Token listo',
  'hero.noVSCode.sub': 'VS Code no responde. Ábrelo con la extensión activa.',
  'hero.ok.title': 'Todo listo',
  'hero.ok.sub': 'El token se sincroniza automáticamente.',
  'row.token': 'Token',
  'row.endpoint': 'Endpoint',
  'row.vscode': 'VS Code',
  'row.renewal': 'Renovación',
  'token.none': 'Sin capturar',
  'token.expired': 'Caducado',
  'token.expiresIn': 'Caduca en {0} min',
  'token.active': 'Activo',
  'endpoint.captured': 'Capturado',
  'endpoint.pending': 'Pendiente',
  'vscode.connected': 'Conectado',
  'vscode.disconnected': 'Sin conexión',
  'vscode.checking': 'Comprobando…',
  'refresh.none': 'Automática',
  'refresh.captured': 'Token renovado',
  'refresh.rescan': 'Buscando token nuevo…',
  'refresh.reload': 'Recargando M365…',
  'refresh.open': 'Abriendo M365…',
  'refresh.wait': 'Reintentando en breve',
  'refresh.needsUser': 'Inicia sesión en M365',
  'button.send': 'Enviar a VS Code',
  'button.sent': '✓ Enviado a VS Code',
  'button.copyToken': 'Copiar token',
  'button.copied': '✓ Copiado',
  'button.renew': 'Renovar ahora',
  'footer.captured': 'Capturado {0}',
  'footer.hint': 'Abre M365 Copilot y envía un mensaje para capturar el token.',
  'time.justNow': 'hace un momento',
  'time.minutesAgo': 'hace {0} min',
  'time.hoursAgo': 'hace {0} h',
  'error.title': 'Algo salió mal',
  'error.noProfile': 'Todavía no se ha capturado ningún perfil. Abre M365 Copilot y envía un mensaje.',
  'error.noToken': 'Todavía no se ha capturado ningún token. Abre M365 Copilot y envía un mensaje.',
  'error.tokenExpired': 'El token guardado ha caducado. Pulsa «Renovar ahora».',
  'error.vscodeUnreachable': 'VS Code no responde. ¿Está abierto con la extensión M365 Copilot activa?',
};

export type MessageKey = keyof typeof en;

const CATALOGS: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, es };

/** Idioma de la interfaz del navegador: español para cualquier variante, inglés si no. */
export function detectLocale(): Locale {
  let language = '';
  try {
    language = typeof chrome !== 'undefined' ? (chrome.i18n?.getUILanguage?.() ?? '') : '';
  } catch {
    /* fuera del contexto de extensión (tests) */
  }
  if (!language && typeof navigator !== 'undefined') language = navigator.language ?? '';
  return language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Locale | undefined;

export function getLocale(): Locale {
  current ??= detectLocale();
  return current;
}

export function t(key: MessageKey, ...args: readonly (string | number)[]): string {
  const template = CATALOGS[getLocale()][key] ?? en[key];
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

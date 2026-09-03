/**
 * A tiny logging sink used for diagnostics. The BizChat/Sydney protocol is
 * reverse-engineered, so when something goes wrong the raw frames are the only
 * way to see how a given tenant/ring actually behaves.
 *
 * This module deliberately does NOT import `vscode` — the extension injects a
 * VS Code OutputChannel (which satisfies {@link LogSink}) at activation, while
 * unit tests can run the client without a VS Code host.
 */
export interface LogSink {
	appendLine(line: string): void;
	show?(preserveFocus?: boolean): void;
}

let sink: LogSink | undefined;

export function initLogger(target: LogSink): void {
	sink = target;
}

export function log(message: string): void {
	if (!sink) return;
	const ts = new Date().toISOString().slice(11, 23);
	sink.appendLine(`[${ts}] ${message}`);
}

export function showLog(): void {
	sink?.show?.(true);
}

/** Redact the access_token query param so logs are safe to share. */
export function redactUrl(url: string): string {
	return url.replace(/(access_token=)[^&]+/i, '$1<REDACTED>');
}

/** Truncate a long frame for readable logs. */
export function truncate(text: string, max = 1200): string {
	return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}

/**
 * The slice of the Tampermonkey / Violentmonkey API the userscript uses
 * (granted in its metadata block, see scripts/build-userscript.mjs).
 */
declare const unsafeWindow: Window & typeof globalThis;

declare function GM_getValue<T = unknown>(key: string, fallback?: T): T;
declare function GM_setValue(key: string, value: unknown): void;
declare function GM_addValueChangeListener(
	key: string,
	listener: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
): number;
declare function GM_setClipboard(text: string, type?: string): void;
declare function GM_registerMenuCommand(caption: string, onClick: () => void): number;

interface GmXhrResponse {
	readonly status: number;
	readonly responseText: string;
}

declare function GM_xmlhttpRequest(details: {
	method: 'GET' | 'POST';
	url: string;
	headers?: Record<string, string>;
	data?: string;
	timeout?: number;
	onload?: (response: GmXhrResponse) => void;
	onerror?: (response: unknown) => void;
	ontimeout?: () => void;
}): unknown;

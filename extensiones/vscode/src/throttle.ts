/**
 * Whether M365 Copilot is throttling this account right now.
 *
 * When an account sends too many requests in a short time, BizChat answers a
 * turn with `result.value: "Throttled"` (`errorCode: "PerUserThrottled"`)
 * instead of the model, and keeps doing so for about an hour: retrying sooner
 * only extends it, and a new token does not help (the limit is keyed on the
 * account). Measured by github.com/cramt/m365-copilot-proxy (docs/hypotheses.md
 * §9 F13, §24 F58): it lifted 60–75 minutes after the last throttled turn.
 *
 * So the client records it here, and whatever runs on its own — inline
 * completions, the auto-commit's idle look — waits until the hold is over
 * instead of feeding the throttle. A request the user makes still goes out: an
 * answer clears the state at once, since it proves the throttle has lifted.
 *
 * Deliberately vscode-free (the client and the tests use it); the status bar
 * and the notification subscribe with {@link onThrottleChange}.
 */

/** How long automatic requests stay paused after the last throttled turn. */
export const THROTTLE_HOLD_MS = 75 * 60_000;

export interface ThrottleChange {
	/** When automatic requests may resume (epoch ms), or undefined once lifted. */
	readonly until: number | undefined;
	/** True only when the account just went from served to throttled. */
	readonly began: boolean;
}

let throttledUntil: number | undefined;
const listeners = new Set<(change: ThrottleChange) => void>();

function notify(change: ThrottleChange): void {
	for (const listener of listeners) {
		try {
			listener(change);
		} catch {
			/* a listener's bug must not break the turn that reported the throttle */
		}
	}
}

/** M365 just throttled a turn: hold automatic requests for {@link THROTTLE_HOLD_MS} from now. */
export function noteThrottled(now = Date.now()): void {
	const began = accountThrottledUntil(now) === undefined;
	throttledUntil = now + THROTTLE_HOLD_MS;
	notify({ until: throttledUntil, began });
}

/** A turn was answered: whatever throttle there was has lifted. */
export function noteServed(): void {
	if (throttledUntil === undefined) return;
	throttledUntil = undefined;
	notify({ until: undefined, began: false });
}

/** Until when automatic requests should wait (epoch ms), or undefined when the account is not throttled. */
export function accountThrottledUntil(now = Date.now()): number | undefined {
	if (throttledUntil !== undefined && throttledUntil <= now) {
		throttledUntil = undefined;
		notify({ until: undefined, began: false });
	}
	return throttledUntil;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function onThrottleChange(listener: (change: ThrottleChange) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

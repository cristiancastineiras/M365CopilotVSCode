/**
 * Detects a model stuck emitting the exact same short substring over and
 * over — a known "degenerate repetition loop" failure mode, distinct from
 * ordinary repetitive-looking code (real content essentially never repeats a
 * tiny (<=32 char) unit for hundreds of characters with zero variation).
 *
 * Observed in practice: BizChat streaming `writeAtCursor` deltas that were
 * the exact same ~12-char nonsense string repeated for over 30 minutes, none
 * of which ever tripped the idle timeout because SOME data kept arriving —
 * the turn just never made real progress and had to be cancelled by hand.
 */
export class RunawayRepetitionGuard {
	private tail = '';
	private readonly windowChars: number;
	private readonly maxPeriod: number;

	constructor(windowChars = 400, maxPeriod = 32) {
		this.windowChars = windowChars;
		this.maxPeriod = maxPeriod;
	}

	/** Feed the next chunk of raw text. Returns true once the trailing window
	 * is exactly periodic with a short period — almost certainly a stuck loop. */
	push(delta: string): boolean {
		if (!delta) return false;
		this.tail = (this.tail + delta).slice(-this.windowChars);
		if (this.tail.length < this.windowChars) return false; // not enough signal yet
		for (let period = 1; period <= this.maxPeriod; period += 1) {
			if (isExactlyPeriodic(this.tail, period)) return true;
		}
		return false;
	}
}

/** True when `text` is exactly periodic with `period` across its whole
 * length, requiring at least 8 repeats before trusting the signal. */
function isExactlyPeriodic(text: string, period: number): boolean {
	if (text.length < period * 8) return false;
	for (let i = 0; i + period < text.length; i += 1) {
		if (text[i] !== text[i + period]) return false;
	}
	return true;
}

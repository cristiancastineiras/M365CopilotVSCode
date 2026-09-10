/**
 * Cheap heuristics for a confirmation-dialog warning banner — NOT a security
 * boundary. The real safeguard for `ms365_run_command` is that a human always
 * sees the literal command and approves it before it runs; this just makes
 * the handful of classically destructive patterns scream louder in that
 * dialog instead of blending in with an ordinary build/test command.
 */
const RISKY_PATTERNS: readonly RegExp[] = [
	/\brm\b[^\n]*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|--force)/i,
	/\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bdel\s+\/[a-z]*[fq]/i,
	/\bformat\s+[a-z]:/i,
	/\bshutdown\b/i,
	/\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force\b/i,
	/>\s*\/dev\/sd[a-z]/i,
];

export function looksRisky(command: string): boolean {
	return RISKY_PATTERNS.some((pattern) => pattern.test(command));
}

const VALID_ACTIONS = ['status', 'diff', 'log'] as const;
export type GitAction = (typeof VALID_ACTIONS)[number];

export interface GitCommandInput {
	readonly staged?: boolean;
	readonly maxCount?: number;
}

export function normalizeGitAction(value: unknown): GitAction {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if ((VALID_ACTIONS as readonly string[]).includes(normalized)) return normalized as GitAction;
	throw new Error('action debe ser status, diff o log.');
}

/** Build a `git` argv (never a shell string) for one of the three read-only actions. */
export function buildGitArgs(action: GitAction, input: GitCommandInput, relativePath?: string): string[] {
	if (action === 'status') {
		const args = ['status', '--porcelain=v1', '-b'];
		if (relativePath) args.push('--', relativePath);
		return args;
	}
	if (action === 'diff') {
		const args = ['diff'];
		if (input.staged) args.push('--staged');
		if (relativePath) args.push('--', relativePath);
		return args;
	}
	const maxCount = clampInt(input.maxCount, 20, 1, 100);
	const args = ['log', `-n${maxCount}`, '--oneline', '--decorate'];
	if (relativePath) args.push('--', relativePath);
	return args;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

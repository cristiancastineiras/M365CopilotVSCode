export type SeverityFilter = 'error' | 'warning' | 'all';

export function normalizeSeverityFilter(value: unknown): SeverityFilter {
	const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return normalized === 'error' || normalized === 'warning' ? normalized : 'all';
}

/** VS Code's DiagnosticSeverity: Error=0, Warning=1, Information=2, Hint=3 (lower = more severe). */
export function matchesSeverity(severity: number, filter: SeverityFilter): boolean {
	if (filter === 'error') return severity === 0;
	if (filter === 'warning') return severity <= 1;
	return true;
}

const LABELS = ['error', 'warning', 'info', 'hint'];

export function severityLabel(severity: number): string {
	return LABELS[severity] ?? 'info';
}

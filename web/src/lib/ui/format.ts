// Display formatters. Date-only strings format in UTC so they never shift by a day.

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});

/** '2026-11-30' → 'Nov 30, 2026'. */
export function fmtDate(ymd: string): string {
	const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? ymd : DATE_FMT.format(d);
}

/** ISO timestamp → 'Sep 13, 2026, 8:02 PM' in the given (or local) time zone. */
export function fmtDateTime(iso: string, timeZone?: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone
	})
		.format(d)
		.replace(/[\u202f\u00a0]/g, ' ');
}

export const fmtPct = (x: number): string => Math.round(x * 100) + '%';
export const fmtMs = (ms: number): string => Math.round(ms) + ' ms';
export const sha7 = (sha: string): string => sha.slice(0, 7);

export function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Visitor's local date as YYYY-MM-DD (core is clock-free; the UI injects today). */
export function localToday(): string {
	return new Date().toLocaleDateString('en-CA');
}

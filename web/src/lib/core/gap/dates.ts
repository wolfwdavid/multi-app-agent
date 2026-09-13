/** Clock-free calendar math on YYYY-MM-DD strings. `today` is always injected by the caller. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function utc(s: string): number {
	const [y, m, d] = s.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
}

export function assertIsoDate(s: string, label = 'date'): void {
	const fail = () => new Error(`${label} must be a valid YYYY-MM-DD date, got "${s}"`);
	if (typeof s !== 'string' || !ISO_DATE.test(s)) throw fail();
	const [y, m, d] = s.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw fail();
}

/** Whole days from `today` to `date` (negative when the date has passed). */
export function daysUntil(today: string, date: string): number {
	return Math.round((utc(date) - utc(today)) / MS_PER_DAY);
}

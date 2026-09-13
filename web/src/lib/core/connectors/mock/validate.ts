// Real-API-shape validators for the mock twins. Each throws a typed ConnectorError whose
// status and message mirror what the real service returns, so mock runs exercise the same
// error paths as real runs.
import { ConnectorError } from '../types.ts';
import { IdempotencyKey } from '../../schemas.ts';

/** Notion caps a single rich_text/title text object at 2000 characters. */
export const NOTION_RICH_TEXT_MAX = 2000;
/** Notion caps arrays (e.g. multi_select, rich_text segments) at 100 items per request. */
export const NOTION_ARRAY_MAX = 100;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

function invalid(message: string): ConnectorError {
	return new ConnectorError('validation', message, { status: 400 });
}

/** True only for real calendar dates in strict YYYY-MM-DD form. */
export function isIsoDate(s: string): boolean {
	if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
	const [y, m, d] = s.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

/** Adds whole days to a YYYY-MM-DD date using UTC arithmetic. */
export function addDaysIso(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function assertIdempotencyKey(app: string, key: string): void {
	if (!IdempotencyKey.safeParse(key).success) {
		throw invalid(`${app}: invalid idempotency key "${key}" (expected tp1-<16 hex>)`);
	}
}

export function assertNotionRichText(
	property: string,
	value: string,
	kind: 'title' | 'rich_text' = 'rich_text'
): void {
	if (value.length > NOTION_RICH_TEXT_MAX) {
		throw invalid(
			`validation_error: body failed validation: body.properties.${property}.${kind}[0].text.content.length should be ≤ \`${NOTION_RICH_TEXT_MAX}\`, instead was \`${value.length}\`.`
		);
	}
}

export function assertNotionDate(property: string, value: string): void {
	if (!isIsoDate(value)) {
		throw invalid(
			`validation_error: body.properties.${property}.date.start should be a valid ISO 8601 date string, instead was \`"${value}"\`.`
		);
	}
}

export function assertNotionSelect(property: string, value: string, options: readonly string[]): void {
	if (!options.includes(value)) {
		throw invalid(
			`validation_error: ${property} select option "${value}" does not exist. Allowed: ${options.join(', ')}`
		);
	}
}

export function assertAllDayDate(field: 'start.date' | 'end.date', value: string): void {
	if (!isIsoDate(value)) {
		throw invalid(`Invalid ${field}: all-day events require a YYYY-MM-DD date, got "${value}".`);
	}
}

export function assertEmailList(header: 'To' | 'Cc', list: string[], required: boolean): void {
	if (required && list.length === 0) {
		throw invalid(`Invalid ${header} header: at least one recipient is required`);
	}
	for (const addr of list) {
		if (!EMAIL_RE.test(addr)) throw invalid(`Invalid ${header} header: "${addr}"`);
	}
}

export function assertNoHeaderInjection(header: string, value: string): void {
	if (/[\r\n]/.test(value)) throw invalid(`Invalid ${header} header: contains a line break`);
}

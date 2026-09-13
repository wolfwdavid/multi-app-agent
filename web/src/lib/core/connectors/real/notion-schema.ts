// Tracker data source contract for the real Notion connector: property names/types, schema
// validation, the update body that adds missing properties, and page <-> TrackerRow mapping.
// Pure module: no SDK import, no env access. Validation reuses the mock twin validators so mock and
// real reject identical inputs.
import { ConnectorError } from '../types.ts';
import type { TrackerRow, TrackerRowInput } from '../types.ts';
import {
	NOTION_ARRAY_MAX,
	NOTION_RICH_TEXT_MAX,
	assertIdempotencyKey,
	assertNotionDate,
	assertNotionRichText,
	assertNotionSelect
} from '../mock/validate.ts';

export const TRACKER_PROPERTIES = {
	Name: 'title',
	'TP Key': 'rich_text',
	'School ID': 'rich_text',
	'Program ID': 'rich_text',
	Deadline: 'date',
	'Required Docs': 'rich_text',
	'Recs Required': 'number',
	'Essay Status': 'select',
	'Gap Count': 'number',
	Status: 'select',
	Notes: 'rich_text'
} as const;

export const ESSAY_STATUS_OPTIONS = ['not_started', 'draft', 'critiqued', 'final'] as const;
export const ROW_STATUS_OPTIONS = ['planning', 'in_progress', 'submitted', 'blocked'] as const;

const SELECT_OPTIONS: Record<string, readonly string[]> = {
	'Essay Status': ESSAY_STATUS_OPTIONS,
	Status: ROW_STATUS_OPTIONS
};

export interface SchemaIssue {
	property: string;
	problem: 'missing' | 'wrong_type';
	expected: string;
	actual?: string;
}

type SchemaProps = Record<string, { type: string }>;

function invalid(message: string): ConnectorError {
	return new ConnectorError('validation', message, { status: 400 });
}

/** [] when every tracker property exists with the right type. The title property must be named Name. */
export function validateTrackerSchema(properties: SchemaProps): SchemaIssue[] {
	const issues: SchemaIssue[] = [];
	for (const [name, expected] of Object.entries(TRACKER_PROPERTIES)) {
		const actual = properties[name];
		if (expected === 'title') {
			if (actual?.type === 'title') continue;
			const titleName = Object.keys(properties).find((k) => properties[k]?.type === 'title');
			issues.push(
				titleName !== undefined
					? { property: name, problem: 'missing', expected, actual: `title:${titleName}` }
					: actual
						? { property: name, problem: 'wrong_type', expected, actual: actual.type }
						: { property: name, problem: 'missing', expected }
			);
			continue;
		}
		if (!actual) issues.push({ property: name, problem: 'missing', expected });
		else if (actual.type !== expected) {
			issues.push({ property: name, problem: 'wrong_type', expected, actual: actual.type });
		}
	}
	return issues;
}

/** dataSources.update `properties` body adding missing properties. wrong_type issues are reported, never changed. */
export function missingPropertiesUpdate(issues: SchemaIssue[], properties: SchemaProps = {}): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const issue of issues) {
		if (issue.problem !== 'missing') continue;
		if (issue.expected === 'title') {
			// A data source always has exactly one title property: rename it instead of adding one.
			const titleName = issue.actual?.startsWith('title:')
				? issue.actual.slice('title:'.length)
				: Object.keys(properties).find((k) => properties[k]?.type === 'title');
			if (titleName !== undefined && titleName !== issue.property) out[titleName] = { name: issue.property };
			continue;
		}
		if (issue.expected === 'select') {
			const options = SELECT_OPTIONS[issue.property] ?? [];
			out[issue.property] = { select: { options: options.map((name) => ({ name })) } };
			continue;
		}
		out[issue.property] = { [issue.expected]: {} };
	}
	return out;
}

function chunks(s: string): { type: 'text'; text: { content: string } }[] {
	const out: { type: 'text'; text: { content: string } }[] = [];
	for (let i = 0; i < s.length; i += NOTION_RICH_TEXT_MAX) {
		out.push({ type: 'text', text: { content: s.slice(i, i + NOTION_RICH_TEXT_MAX) } });
	}
	if (out.length > NOTION_ARRAY_MAX) {
		throw invalid(`validation_error: rich_text should have ≤ ${NOTION_ARRAY_MAX} items, instead was ${out.length}.`);
	}
	return out;
}

function assertNonNegativeInt(property: string, value: number): void {
	if (!Number.isInteger(value) || value < 0) {
		throw invalid(
			`validation_error: body.properties.${property}.number should be a non-negative integer, instead was \`${value}\`.`
		);
	}
}

/** Validates (throws ConnectorError 'validation') and builds the page `properties` body. */
export function toNotionProperties(row: TrackerRowInput & { key: string }): Record<string, unknown> {
	assertIdempotencyKey('notion', row.key);
	if (!row.title) throw invalid('validation_error: Name title is required');
	assertNotionRichText('Name', row.title, 'title');
	assertNotionRichText('School ID', row.schoolId);
	assertNotionRichText('Program ID', row.programId);
	if (row.requiredDocs.length > NOTION_ARRAY_MAX) {
		throw invalid(
			`validation_error: body.properties.Required Docs should have ≤ ${NOTION_ARRAY_MAX} items, instead was ${row.requiredDocs.length}.`
		);
	}
	for (const doc of row.requiredDocs) assertNotionRichText('Required Docs', doc);
	assertNotionDate('Deadline', row.deadline);
	assertNotionSelect('Essay Status', row.essayStatus, ESSAY_STATUS_OPTIONS);
	assertNotionSelect('Status', row.status, ROW_STATUS_OPTIONS);
	assertNonNegativeInt('Recs Required', row.recsRequired);
	assertNonNegativeInt('Gap Count', row.gapCount);

	return {
		Name: { title: chunks(row.title) },
		'TP Key': { rich_text: chunks(row.key) },
		'School ID': { rich_text: chunks(row.schoolId) },
		'Program ID': { rich_text: chunks(row.programId) },
		Deadline: { date: { start: row.deadline } },
		'Required Docs': { rich_text: chunks(row.requiredDocs.join('\n')) },
		'Recs Required': { number: row.recsRequired },
		'Essay Status': { select: { name: row.essayStatus } },
		'Gap Count': { number: row.gapCount },
		Status: { select: { name: row.status } },
		Notes: { rich_text: chunks(row.notes ?? '') }
	};
}

// Notion property values are loosely typed on purpose: this module has no SDK import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProp = any;

function plainText(items: unknown): string {
	if (!Array.isArray(items)) return '';
	return items
		.map((t: AnyProp) => (typeof t?.plain_text === 'string' ? t.plain_text : (t?.text?.content ?? '')))
		.join('');
}

function prop(page: { properties: Record<string, AnyProp> }, name: string): AnyProp {
	const value = page.properties?.[name];
	if (value === undefined) throw invalid(`validation_error: Notion page is missing property "${name}"`);
	return value;
}

function selectValue<T extends string>(page: { properties: Record<string, AnyProp> }, name: string, options: readonly T[]): T {
	const value = prop(page, name)?.select?.name;
	if (typeof value !== 'string' || !options.includes(value as T)) {
		throw invalid(
			`validation_error: Notion page ${name} select "${String(value)}" is not a tracker option (${options.join(', ')})`
		);
	}
	return value as T;
}

function numberValue(page: { properties: Record<string, AnyProp> }, name: string): number {
	const value = prop(page, name)?.number;
	if (typeof value !== 'number') throw invalid(`validation_error: Notion page ${name} is not a number`);
	return value;
}

/** Maps a Notion page response to a TrackerRow. Read back from the page, never echoed from input. */
export function fromNotionPage(page: {
	id: string;
	url?: string;
	last_edited_time: string;
	properties: Record<string, AnyProp>;
}): TrackerRow {
	const notes = plainText(prop(page, 'Notes')?.rich_text);
	const deadline = prop(page, 'Deadline')?.date?.start;
	const row: TrackerRow = {
		id: page.id,
		key: plainText(prop(page, 'TP Key')?.rich_text),
		...(page.url ? { url: page.url } : {}),
		updatedAt: page.last_edited_time,
		title: plainText(prop(page, 'Name')?.title),
		schoolId: plainText(prop(page, 'School ID')?.rich_text),
		programId: plainText(prop(page, 'Program ID')?.rich_text),
		deadline: typeof deadline === 'string' ? deadline.slice(0, 10) : '',
		requiredDocs: plainText(prop(page, 'Required Docs')?.rich_text)
			.split('\n')
			.filter((d) => d.length > 0),
		recsRequired: numberValue(page, 'Recs Required'),
		essayStatus: selectValue(page, 'Essay Status', ESSAY_STATUS_OPTIONS),
		gapCount: numberValue(page, 'Gap Count'),
		status: selectValue(page, 'Status', ROW_STATUS_OPTIONS)
	};
	if (notes) row.notes = notes;
	return row;
}

/** Accepts a 32-hex id, a dashed UUID, or a notion.so URL ending in the id. Returns 8-4-4-4-12 or null. */
export function normalizeNotionId(raw: string): string | null {
	const m = String(raw ?? '')
		.trim()
		.replace(/-/g, '')
		.match(/([0-9a-f]{32})(?:[?#].*)?$/i);
	if (!m) return null;
	const h = m[1].toLowerCase();
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

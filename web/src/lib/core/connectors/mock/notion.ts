// Stateful Notion twin for the transfer tracker data source.
import { ConnectorError } from '../types.ts';
import type { NotionPort, TrackerRow } from '../types.ts';
import type { World } from './world.ts';
import {
	NOTION_ARRAY_MAX,
	assertIdempotencyKey,
	assertNotionDate,
	assertNotionRichText,
	assertNotionSelect
} from './validate.ts';

const ESSAY_STATUS = ['not_started', 'draft', 'critiqued', 'final'] as const;
const ROW_STATUS = ['planning', 'in_progress', 'submitted', 'blocked'] as const;

function invalid(message: string): ConnectorError {
	return new ConnectorError('validation', message, { status: 400 });
}

function assertNonNegativeInt(property: string, value: number): void {
	if (!Number.isInteger(value) || value < 0) {
		throw invalid(`validation_error: body.properties.${property}.number should be a non-negative integer, instead was \`${value}\`.`);
	}
}

export function createMockNotion(world: World): NotionPort {
	return {
		// The real connector filters the data source on the `TP Key` rich_text property.
		findByKey: async (key) => {
			const row = world.state.notion.rows.find((r) => r.key === key);
			return row ? structuredClone(row) : null;
		},

		upsertTrackerRow: async (input) => {
			const { key, title, schoolId, programId, requiredDocs, notes, deadline, essayStatus, status } = input;
			// Validate everything before touching state, so a rejected call never partially writes.
			assertIdempotencyKey('notion', key);
			if (title.length === 0) throw invalid('validation_error: Name title is required');
			assertNotionRichText('Name', title, 'title');
			assertNotionRichText('School ID', schoolId);
			assertNotionRichText('Program ID', programId);
			if (requiredDocs.length > NOTION_ARRAY_MAX) {
				throw invalid(
					`validation_error: body.properties.Required Docs should have ≤ ${NOTION_ARRAY_MAX} items, instead was ${requiredDocs.length}.`
				);
			}
			for (const doc of requiredDocs) assertNotionRichText('Required Docs', doc);
			if (notes !== undefined) assertNotionRichText('Notes', notes);
			assertNotionDate('Deadline', deadline);
			assertNotionSelect('Essay Status', essayStatus, ESSAY_STATUS);
			assertNotionSelect('Status', status, ROW_STATUS);
			assertNonNegativeInt('Recs Required', input.recsRequired);
			assertNonNegativeInt('Gap Count', input.gapCount);

			const rows = world.state.notion.rows;
			const fields = structuredClone(input);
			const idx = rows.findIndex((r) => r.key === key);
			if (idx >= 0) {
				const existing = rows[idx];
				const updated: TrackerRow = { ...fields, id: existing.id, url: existing.url, updatedAt: world.now() };
				rows[idx] = updated;
				return structuredClone(updated);
			}
			const id = world.nextId('page');
			const row: TrackerRow = { ...fields, id, url: `mock://notion/${id}`, updatedAt: world.now() };
			rows.push(row);
			return structuredClone(row);
		},

		listTrackerRows: async () => structuredClone(world.state.notion.rows)
	};
}

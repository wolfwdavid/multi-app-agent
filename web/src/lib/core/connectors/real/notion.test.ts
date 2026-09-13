import { describe, expect, it, vi } from 'vitest';
import { ConnectorError, type TrackerRowInput } from '../types.ts';
import {
	TRACKER_PROPERTIES,
	fromNotionPage,
	missingPropertiesUpdate,
	normalizeNotionId,
	toNotionProperties,
	validateTrackerSchema
} from './notion-schema.ts';
import { NOTION_IMPLEMENTED, createRealNotion, mapNotionError, probeNotion } from './notion.ts';

const TOKEN = 'ntn_test_token_123';
const env = { NOTION_TOKEN: TOKEN, NOTION_DATA_SOURCE_ID: '0123456789abcdef0123456789abcdef' };
const DS = '01234567-89ab-cdef-0123-456789abcdef';
const KEY = 'tp1-0123456789abcdef';
const KEY2 = 'tp1-fedcba9876543210';

const row: TrackerRowInput & { key: string } = {
	key: KEY,
	schoolId: 'ucb',
	programId: 'cs-transfer',
	title: 'UC Berkeley CS',
	deadline: '2026-11-30',
	requiredDocs: ['transcript', 'essay'],
	recsRequired: 2,
	essayStatus: 'draft',
	gapCount: 3,
	status: 'planning',
	notes: 'priority school'
};

const fullSchema = () =>
	Object.fromEntries(Object.entries(TRACKER_PROPERTIES).map(([name, type]) => [name, { type }])) as Record<
		string,
		{ type: string }
	>;

/** Converts a request `properties` body into a Notion page response shape. */
function page(input: TrackerRowInput & { key: string }, id = 'page-1', edited = '2026-09-13T10:00:00.000Z') {
	const req = toNotionProperties(input) as Record<string, Record<string, unknown>>;
	const properties: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(req)) {
		const type = Object.keys(value)[0];
		let v = value[type];
		if (type === 'title' || type === 'rich_text') {
			v = (v as { text: { content: string } }[]).map((t) => ({ ...t, plain_text: t.text.content }));
		}
		properties[name] = { type, [type]: v };
	}
	return { object: 'page', id, url: `https://www.notion.so/${id}`, last_edited_time: edited, properties };
}

function fakeClient() {
	return {
		dataSources: { query: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
		pages: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
		databases: { retrieve: vi.fn() }
	};
}

function fakeClock() {
	const clock = { t: 1_000_000 };
	return {
		clock,
		now: () => clock.t,
		sleep: vi.fn(async (ms: number) => {
			clock.t += ms;
		})
	};
}

function notionErr(msg: string, code: string, status?: number, headers?: unknown) {
	return Object.assign(new Error(msg), { code, status, headers });
}

function setup() {
	const fake = fakeClient();
	const { clock, now, sleep } = fakeClock();
	const port = createRealNotion(env, { client: fake as never, sleep, now });
	return { fake, port, clock, sleep };
}

describe('notion-schema: validateTrackerSchema / missingPropertiesUpdate', () => {
	it('a full correct schema has no issues', () => {
		expect(validateTrackerSchema(fullSchema())).toEqual([]);
	});

	it('reports missing, wrong_type and misnamed title', () => {
		const s = fullSchema();
		delete s['TP Key'];
		s.Status = { type: 'status' };
		delete s.Name;
		s.School = { type: 'title' };
		const issues = validateTrackerSchema(s);
		expect(issues).toContainEqual({ property: 'TP Key', problem: 'missing', expected: 'rich_text' });
		expect(issues).toContainEqual({ property: 'Status', problem: 'wrong_type', expected: 'select', actual: 'status' });
		expect(issues).toContainEqual({ property: 'Name', problem: 'missing', expected: 'title', actual: 'title:School' });
	});

	it('builds an update body for missing properties only (wrong_type reported, not changed)', () => {
		const s = fullSchema();
		for (const k of ['TP Key', 'Deadline', 'Essay Status', 'Recs Required', 'Name']) delete s[k];
		s.School = { type: 'title' };
		s.Status = { type: 'status' };
		const body = missingPropertiesUpdate(validateTrackerSchema(s), s);
		expect(body).toEqual({
			'TP Key': { rich_text: {} },
			Deadline: { date: {} },
			'Essay Status': {
				select: { options: [{ name: 'not_started' }, { name: 'draft' }, { name: 'critiqued' }, { name: 'final' }] }
			},
			'Recs Required': { number: {} },
			School: { name: 'Name' }
		});
		expect(body).not.toHaveProperty('Status');
	});
});

describe('notion-schema: toNotionProperties / fromNotionPage / normalizeNotionId', () => {
	it('emits the tracker property shapes', () => {
		const p = toNotionProperties({ ...row, notes: undefined }) as Record<string, unknown>;
		expect(p.Name).toEqual({ title: [{ type: 'text', text: { content: 'UC Berkeley CS' } }] });
		expect(p['TP Key']).toEqual({ rich_text: [{ type: 'text', text: { content: KEY } }] });
		expect(p.Deadline).toEqual({ date: { start: '2026-11-30' } });
		expect(p['Recs Required']).toEqual({ number: 2 });
		expect(p['Essay Status']).toEqual({ select: { name: 'draft' } });
		expect(p.Status).toEqual({ select: { name: 'planning' } });
		expect(p['Required Docs']).toEqual({ rich_text: [{ type: 'text', text: { content: 'transcript\nessay' } }] });
		expect(p.Notes).toEqual({ rich_text: [] });
	});

	it('splits long notes into <= 2000-char chunks', () => {
		const p = toNotionProperties({ ...row, notes: 'x'.repeat(4500) }) as { Notes: { rich_text: { text: { content: string } }[] } };
		expect(p.Notes.rich_text.map((c) => c.text.content.length)).toEqual([2000, 2000, 500]);
	});

	it.each([
		['bad key', { key: 'nope' }],
		['impossible deadline', { deadline: '2027-02-30' }],
		['unknown essay status', { essayStatus: 'done' }],
		['title over 2000 chars', { title: 'x'.repeat(2001) }]
	])('throws validation for %s', (_name, patch) => {
		try {
			toNotionProperties({ ...row, ...(patch as object) } as never);
			expect.unreachable('should throw');
		} catch (e) {
			expect(e).toBeInstanceOf(ConnectorError);
			expect((e as ConnectorError).kind).toBe('validation');
			expect((e as ConnectorError).status).toBe(400);
		}
	});

	it('round-trips a page back to a TrackerRow read from the response', () => {
		const r = fromNotionPage(page(row, 'abc', '2026-09-13T11:00:00.000Z'));
		expect(r).toEqual({ ...row, id: 'abc', url: 'https://www.notion.so/abc', updatedAt: '2026-09-13T11:00:00.000Z' });
		const noNotes = fromNotionPage(page({ ...row, notes: undefined, requiredDocs: [] }));
		expect(noNotes.notes).toBeUndefined();
		expect(noNotes.requiredDocs).toEqual([]);
	});

	it('fails loudly on a select value outside the tracker enum', () => {
		const p = page(row);
		(p.properties.Status as { select: { name: string } }).select = { name: 'archived' };
		expect(() => fromNotionPage(p)).toThrow(/Status/);
	});

	it('normalizes ids and URLs', () => {
		expect(normalizeNotionId('0123456789abcdef0123456789abcdef')).toBe(DS);
		expect(normalizeNotionId(DS)).toBe(DS);
		expect(normalizeNotionId(`https://www.notion.so/team/Tracker-0123456789abcdef0123456789abcdef?v=1`)).toBe(DS);
		expect(normalizeNotionId('not an id')).toBeNull();
	});
});

describe('createRealNotion', () => {
	it('missing env rejects not_configured on every method', async () => {
		const port = createRealNotion({ NOTION_TOKEN: TOKEN });
		await expect(port.findByKey(KEY)).rejects.toMatchObject({ kind: 'not_configured' });
		await expect(port.listTrackerRows()).rejects.toThrow(/NOTION_DATA_SOURCE_ID/);
		await expect(port.upsertTrackerRow(row)).rejects.toMatchObject({ kind: 'not_configured' });
	});

	it('an invalid data source id rejects not_configured', async () => {
		const port = createRealNotion({ ...env, NOTION_DATA_SOURCE_ID: 'garbage' }, { client: fakeClient() as never });
		await expect(port.findByKey(KEY)).rejects.toThrow(/not a valid Notion id/);
	});

	it('findByKey queries the data source by TP Key and returns null when absent', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockResolvedValue({ results: [], has_more: false, next_cursor: null });
		expect(await port.findByKey(KEY)).toBeNull();
		expect(fake.dataSources.query).toHaveBeenCalledTimes(1);
		expect(fake.dataSources.query).toHaveBeenCalledWith({
			data_source_id: DS,
			filter: { property: 'TP Key', rich_text: { equals: KEY } },
			sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
			page_size: 10
		});
	});

	it('findByKey returns the oldest match when two exist', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockResolvedValue({ results: [page(row, 'old'), page(row, 'new')], has_more: false });
		expect((await port.findByKey(KEY))?.id).toBe('old');
	});

	it('upsert creates under a data_source_id parent when absent and maps the response', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockResolvedValue({ results: [], has_more: false });
		fake.pages.create.mockResolvedValue(page({ ...row, gapCount: 7 }, 'created'));
		const r = await port.upsertTrackerRow(row);
		expect(fake.pages.create).toHaveBeenCalledWith({
			parent: { type: 'data_source_id', data_source_id: DS },
			properties: toNotionProperties(row)
		});
		expect(fake.pages.update).not.toHaveBeenCalled();
		expect(r.id).toBe('created');
		expect(r.gapCount).toBe(7); // read back from the response, not echoed from input
	});

	it('upsert updates the existing page and never creates', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockResolvedValue({ results: [page(row, 'existing')], has_more: false });
		fake.pages.update.mockResolvedValue(page({ ...row, gapCount: 1 }, 'existing'));
		const r = await port.upsertTrackerRow({ ...row, gapCount: 1 });
		expect(fake.pages.update).toHaveBeenCalledWith({
			page_id: 'existing',
			properties: toNotionProperties({ ...row, gapCount: 1 })
		});
		expect(fake.pages.create).not.toHaveBeenCalled();
		expect(r).toMatchObject({ id: 'existing', gapCount: 1 });
	});

	it('upsert retrieves the page when the write response is partial', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockResolvedValue({ results: [], has_more: false });
		fake.pages.create.mockResolvedValue({ object: 'page', id: 'partial' });
		fake.pages.retrieve.mockResolvedValue(page(row, 'partial'));
		expect((await port.upsertTrackerRow(row)).id).toBe('partial');
		expect(fake.pages.retrieve).toHaveBeenCalledWith({ page_id: 'partial' });
	});

	it('invalid input makes no client call at all', async () => {
		const { fake, port } = setup();
		await expect(port.upsertTrackerRow({ ...row, deadline: '2027-02-30' })).rejects.toMatchObject({ kind: 'validation' });
		expect(fake.dataSources.query).not.toHaveBeenCalled();
		expect(fake.pages.create).not.toHaveBeenCalled();
	});

	it('listTrackerRows paginates with start_cursor on a TP Key is_not_empty filter', async () => {
		const { fake, port } = setup();
		fake.dataSources.query
			.mockResolvedValueOnce({ results: [page(row, 'a')], has_more: true, next_cursor: 'c1' })
			.mockResolvedValueOnce({ results: [page({ ...row, key: KEY2 }, 'b')], has_more: false, next_cursor: null });
		const rows = await port.listTrackerRows();
		expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
		expect(fake.dataSources.query).toHaveBeenCalledTimes(2);
		expect(fake.dataSources.query.mock.calls[0][0]).toMatchObject({
			data_source_id: DS,
			filter: { property: 'TP Key', rich_text: { is_not_empty: true } }
		});
		expect(fake.dataSources.query.mock.calls[0][0]).not.toHaveProperty('start_cursor');
		expect(fake.dataSources.query.mock.calls[1][0]).toMatchObject({ start_cursor: 'c1' });
	});

	it('paces calls at least 350ms apart', async () => {
		const { fake, port, clock } = setup();
		const starts: number[] = [];
		fake.dataSources.query.mockImplementation(async () => {
			starts.push(clock.t);
			return { results: [], has_more: false };
		});
		fake.pages.create.mockImplementation(async () => {
			starts.push(clock.t);
			return page(row, 'p');
		});
		await port.upsertTrackerRow(row);
		expect(starts).toHaveLength(2);
		expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);
	});

	it('maps client errors thrown during calls to ConnectorErrors', async () => {
		const { fake, port } = setup();
		fake.dataSources.query.mockRejectedValue(notionErr('Could not find data source', 'object_not_found', 404));
		await expect(port.findByKey(KEY)).rejects.toMatchObject({ kind: 'not_found' });
	});
});

describe('mapNotionError', () => {
	it('rate_limited uses Retry-After, default 1000ms', () => {
		const e = mapNotionError(notionErr('slow down', 'rate_limited', 429, new Headers({ 'retry-after': '2' })), 'ctx', env);
		expect(e).toMatchObject({ kind: 'rate_limit', retryAfterMs: 2000, status: 429 });
		expect(mapNotionError(notionErr('slow down', 'rate_limited', 429), 'ctx', env).retryAfterMs).toBe(1000);
		expect(mapNotionError(notionErr('x', 'rate_limited', 429, { 'Retry-After': '3' }), 'ctx', env).retryAfterMs).toBe(3000);
	});

	it('object_not_found -> not_found with the Connections sharing hint', () => {
		const e = mapNotionError(notionErr('nope', 'object_not_found', 404), 'ctx', env);
		expect(e.kind).toBe('not_found');
		expect(e.message).toContain('Connections');
	});

	it('maps auth, validation, server and timeout codes', () => {
		expect(mapNotionError(notionErr('x', 'unauthorized', 401), 'c', env).kind).toBe('auth');
		expect(mapNotionError(notionErr('x', 'restricted_resource', 403), 'c', env).kind).toBe('auth');
		expect(mapNotionError(notionErr('x', 'validation_error', 400), 'c', env)).toMatchObject({ kind: 'validation', status: 400 });
		expect(mapNotionError(notionErr('x', 'service_unavailable', 503), 'c', env).kind).toBe('server');
		expect(mapNotionError(notionErr('Request to Notion API has timed out', 'notionhq_client_request_timeout'), 'c', env).kind).toBe('timeout');
	});

	it('passes ConnectorErrors through and redacts the token', () => {
		const ce = new ConnectorError('validation', 'already typed');
		expect(mapNotionError(ce, 'c', env)).toBe(ce);
		const e = mapNotionError(new Error(`bad auth header Bearer ${TOKEN}`), 'c', env);
		expect(e.message).toContain('[redacted]');
		expect(e.message).not.toContain(TOKEN);
	});
});

describe('probeNotion', () => {
	it('reports schema ok for a correct data source', async () => {
		const fake = fakeClient();
		fake.dataSources.retrieve.mockResolvedValue({ object: 'data_source', id: DS, properties: fullSchema() });
		const r = await probeNotion(env, { client: fake as never });
		expect(r).toMatchObject({ app: 'notion', configured: true, implemented: true, ok: true });
		expect(r.detail).toContain('schema ok');
		expect(fake.dataSources.retrieve).toHaveBeenCalledWith({ data_source_id: DS });
	});

	it('reports schema issues as validation', async () => {
		const fake = fakeClient();
		const s = fullSchema();
		delete s['TP Key'];
		fake.dataSources.retrieve.mockResolvedValue({ properties: s });
		const r = await probeNotion(env, { client: fake as never });
		expect(r).toMatchObject({ ok: false, kind: 'validation' });
		expect(r.detail).toContain('TP Key');
	});

	it('maps a not-found retrieve and points at notion-setup, never throwing', async () => {
		const fake = fakeClient();
		fake.dataSources.retrieve.mockRejectedValue(notionErr(`not found ${TOKEN}`, 'object_not_found', 404));
		const r = await probeNotion(env, { client: fake as never });
		expect(r).toMatchObject({ ok: false, kind: 'not_found' });
		expect(r.detail).toContain('notion-setup');
		expect(r.detail).not.toContain(TOKEN);
	});

	it('skips with ok null when env is missing', async () => {
		const r = await probeNotion({});
		expect(r).toMatchObject({ ok: null, configured: false, implemented: true });
		expect(NOTION_IMPLEMENTED).toBe(true);
	});
});

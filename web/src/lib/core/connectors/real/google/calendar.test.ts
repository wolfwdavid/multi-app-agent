import { describe, expect, it, vi, type Mock } from 'vitest';
import { base32hex, createRealCalendar, eventIdForKey, type CalendarApi } from './calendar.ts';
import { createRealGoogle, type GoogleApis } from './index.ts';

const KEY = 'tp1-0123456789abcdef';
const ENV = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret-value', GOOGLE_REFRESH_TOKEN: 'refresh-value' };
const err = (status: number, reason?: string) => ({
	status,
	response: { status, headers: {}, data: { error: { code: status, message: 'x', errors: reason ? [{ reason }] : [] } } }
});
const tagged = (key: string, date: string, extra: Record<string, unknown> = {}) => ({
	id: eventIdForKey(key),
	status: 'confirmed',
	summary: 'T',
	start: { date },
	extendedProperties: { private: { tpKey: key, tpApp: 'transferpilot' } },
	...extra
});

type EventsMocks = Record<'insert' | 'get' | 'list' | 'update', Mock>;

function fakeApi(over: Partial<EventsMocks> = {}) {
	const events: EventsMocks = {
		insert: vi.fn(async (p: { requestBody: object }) => ({ data: { ...p.requestBody, htmlLink: 'https://cal/e' } })),
		get: vi.fn(async (): Promise<{ data: unknown }> => {
			throw err(404);
		}),
		list: vi.fn(async () => ({ data: { items: [] } })),
		update: vi.fn(async (p: { requestBody: object }) => ({ data: { ...p.requestBody, htmlLink: 'https://cal/u' } })),
		...over
	};
	return { api: { events } as unknown as CalendarApi, events };
}

describe('base32hex / eventIdForKey', () => {
	it('matches RFC 4648 base32hex vectors (lowercase, no padding)', () => {
		const enc = (s: string) => base32hex(new TextEncoder().encode(s));
		expect(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map(enc)).toEqual([
			'',
			'co',
			'cpng',
			'cpnmu',
			'cpnmuog',
			'cpnmuoj1',
			'cpnmuoj1e8'
		]);
	});
	it('eventIdForKey is a stable 52-char base32hex id, distinct per key', () => {
		const id = eventIdForKey(KEY);
		expect(id).toMatch(/^[0-9a-v]{52}$/);
		expect(eventIdForKey(KEY)).toBe(id);
		expect(eventIdForKey('tp1-0123456789abcdee')).not.toBe(id);
	});
});

describe('createRealCalendar.createEvent', () => {
	it('inserts an all-day tagged event with a deterministic id and exclusive end', async () => {
		const { api, events } = fakeApi();
		const cal = createRealCalendar(api, { calendarId: 'cal-1' });
		const ev = await cal.createEvent({ title: 'UCLA deadline', date: '2026-11-30', description: 'd', key: KEY });
		expect(events.insert).toHaveBeenCalledTimes(1);
		expect(events.insert).toHaveBeenCalledWith({
			calendarId: 'cal-1',
			requestBody: {
				id: eventIdForKey(KEY),
				summary: 'UCLA deadline',
				description: 'd',
				start: { date: '2026-11-30' },
				end: { date: '2026-12-01' },
				extendedProperties: { private: { tpKey: KEY, tpApp: 'transferpilot' } },
				transparency: 'transparent'
			}
		});
		expect(ev).toEqual({ id: eventIdForKey(KEY), key: KEY, title: 'UCLA deadline', date: '2026-11-30', description: 'd', url: 'https://cal/e' });
	});
	it('defaults calendarId to primary', async () => {
		const { api, events } = fakeApi();
		await createRealCalendar(api).createEvent({ title: 't', date: '2026-11-30', key: KEY });
		expect(events.insert.mock.calls[0][0]).toMatchObject({ calendarId: 'primary' });
	});
	it.each([
		[{ title: 't', date: '2026-11-30', key: 'bad-key' }],
		[{ title: '', date: '2026-11-30', key: KEY }],
		[{ title: 't', date: '2026-13-01', key: KEY }]
	])('rejects invalid input without calling insert (%o)', async (input) => {
		const { api, events } = fakeApi();
		await expect(createRealCalendar(api).createEvent(input)).rejects.toMatchObject({ kind: 'validation' });
		expect(events.insert).not.toHaveBeenCalled();
	});
	it('409 on a cancelled event restores it via update', async () => {
		const { api, events } = fakeApi({
			insert: vi.fn(async () => {
				throw err(409);
			}),
			get: vi.fn(async () => ({ data: tagged(KEY, '2026-11-30', { status: 'cancelled' }) }))
		});
		const ev = await createRealCalendar(api).createEvent({ title: 't', date: '2026-11-30', key: KEY });
		expect(events.update).toHaveBeenCalledTimes(1);
		expect(events.update.mock.calls[0][0]).toMatchObject({ eventId: eventIdForKey(KEY), requestBody: { status: 'confirmed', summary: 't' } });
		expect(ev).toMatchObject({ key: KEY, url: 'https://cal/u' });
	});
	it('409 on a confirmed event → validation 409 already exists (mock parity)', async () => {
		const { api, events } = fakeApi({
			insert: vi.fn(async () => {
				throw err(409);
			}),
			get: vi.fn(async () => ({ data: tagged(KEY, '2026-11-30') }))
		});
		await expect(createRealCalendar(api).createEvent({ title: 't', date: '2026-11-30', key: KEY })).rejects.toMatchObject({
			kind: 'validation',
			status: 409,
			message: expect.stringContaining('already exists')
		});
		expect(events.update).not.toHaveBeenCalled();
	});
	it('429 and 403 rateLimitExceeded → rate_limit', async () => {
		for (const e of [err(429), err(403, 'rateLimitExceeded')]) {
			const { api } = fakeApi({
				insert: vi.fn(async () => {
					throw e;
				})
			});
			await expect(createRealCalendar(api).createEvent({ title: 't', date: '2026-11-30', key: KEY })).rejects.toMatchObject({ kind: 'rate_limit' });
		}
	});
});

describe('createRealCalendar.findByKey', () => {
	it('404 → null', async () => {
		expect(await createRealCalendar(fakeApi().api).findByKey(KEY)).toBeNull();
	});
	it('cancelled → null', async () => {
		const { api } = fakeApi({ get: vi.fn(async () => ({ data: tagged(KEY, '2026-11-30', { status: 'cancelled' }) })) });
		expect(await createRealCalendar(api).findByKey(KEY)).toBeNull();
	});
	it('tag mismatch → validation collision', async () => {
		const { api } = fakeApi({ get: vi.fn(async () => ({ data: tagged('tp1-ffffffffffffffff', '2026-11-30') })) });
		await expect(createRealCalendar(api).findByKey(KEY)).rejects.toMatchObject({ kind: 'validation', message: expect.stringContaining('collision') });
	});
	it('match → CalEvent read by id', async () => {
		const { api, events } = fakeApi({ get: vi.fn(async () => ({ data: tagged(KEY, '2026-11-30', { htmlLink: 'L' }) })) });
		expect(await createRealCalendar(api).findByKey(KEY)).toEqual({ id: eventIdForKey(KEY), key: KEY, title: 'T', date: '2026-11-30', url: 'L' });
		expect(events.get.mock.calls[0][0]).toEqual({ calendarId: 'primary', eventId: eventIdForKey(KEY) });
	});
});

describe('createRealCalendar.listEvents', () => {
	it('queries tpApp-scoped widened window, filters, sorts and pages', async () => {
		const k = (n: number) => `tp1-${String(n).padStart(16, '0')}`;
		const list = vi
			.fn()
			.mockResolvedValueOnce({
				data: {
					items: [
						tagged(k(1), '2026-11-20'),
						tagged(k(2), '2026-10-31'),
						tagged(k(3), '2026-11-05', { status: 'cancelled' }),
						{ id: 'x', status: 'confirmed', start: { date: '2026-11-06' } }
					],
					nextPageToken: 'p2'
				}
			})
			.mockResolvedValueOnce({ data: { items: [tagged(k(4), '2026-12-01'), tagged(k(5), '2026-11-01')] } });
		const { api } = fakeApi({ list });
		const out = await createRealCalendar(api).listEvents({ from: '2026-11-01', to: '2026-12-01' });
		expect(list).toHaveBeenCalledTimes(2);
		expect(list.mock.calls[0][0]).toMatchObject({
			calendarId: 'primary',
			privateExtendedProperty: ['tpApp=transferpilot'],
			singleEvents: true,
			timeMin: '2026-10-31T00:00:00Z',
			timeMax: '2026-12-02T00:00:00Z'
		});
		expect(list.mock.calls[1][0]).toMatchObject({ pageToken: 'p2' });
		expect(out.map((e) => e.key)).toEqual([k(5), k(1)]);
	});
});

describe('createRealGoogle calendar wiring', () => {
	it('calendar real with injected api; gmail/docs still not_configured', async () => {
		const { api, events } = fakeApi();
		const apis: GoogleApis = { auth: {}, calendar: api, gmail: {}, docs: {}, drive: {} };
		const g = createRealGoogle(ENV, { apis, implemented: { calendar: true, gmail: false, docs: false } });
		expect(await g.calendar.findByKey(KEY)).toBeNull();
		expect(events.get).toHaveBeenCalledTimes(1);
		await expect(g.gmail.listDrafts()).rejects.toMatchObject({ kind: 'not_configured' });
		await expect(g.docs.findByKey(KEY)).rejects.toMatchObject({ kind: 'not_configured' });
	});
});

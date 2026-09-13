import { describe, it, expect } from 'vitest';
import { ConnectorError } from '../types.ts';
import type { HFItem, MessageSummary, RepoSummary, TrackerRow } from '../types.ts';
import { createWorld, DEFAULT_CLOCK, isEmptyDiff } from './world.ts';
import type { WorldSeed } from './world.ts';
import {
	addDaysIso,
	assertIdempotencyKey,
	assertNotionRichText,
	isIsoDate
} from './validate.ts';
import { createMockGitHub } from './github.ts';
import { createMockHF } from './hf.ts';

const sampleRow: TrackerRow = {
	id: 'page-seed-1',
	key: 'tp1-0123456789abcdef',
	url: 'mock://notion/page-seed-1',
	updatedAt: '2026-09-01T00:00:00.000Z',
	schoolId: 'ucb',
	programId: 'ucb-cs',
	title: 'UC Berkeley - CS',
	deadline: '2026-11-30',
	requiredDocs: ['transcript'],
	recsRequired: 0,
	essayStatus: 'draft',
	gapCount: 2,
	status: 'planning'
};

const sampleMsg: MessageSummary = {
	id: 'msg-001',
	threadId: 'thr-001',
	from: 'advisor@example.edu',
	to: ['alex.rivera@example.com'],
	subject: 'Transfer meeting',
	date: '2026-09-10T10:00:00Z',
	snippet: 'Let us meet',
	body: 'Let us meet next week.'
};

const sampleRepo: RepoSummary = {
	name: 'transfer-pilot',
	description: 'Agent',
	stars: 3,
	languages: ['TypeScript'],
	pushedAt: '2026-09-12T00:00:00Z',
	url: 'https://github.com/wolfwdavid/transfer-pilot'
};

const sampleHF: HFItem = {
	id: 'WolfDavid/tiny-model',
	kind: 'model',
	likes: 1,
	tags: ['text-generation'],
	lastModified: '2026-09-01T00:00:00Z',
	url: 'https://huggingface.co/WolfDavid/tiny-model'
};

function seed(): WorldSeed {
	return {
		notion: { rows: [sampleRow] },
		gmail: { inbox: [sampleMsg] },
		github: { repos: { wolfwdavid: [sampleRepo] } },
		hf: { items: { WolfDavid: [sampleHF] } }
	};
}

describe('createWorld', () => {
	it('creates an empty world with the default clock when no seed is given', () => {
		const w = createWorld();
		expect(w.state.meta.clock).toBe(DEFAULT_CLOCK);
		expect(w.now()).toBe(DEFAULT_CLOCK);
		expect(w.state.notion.rows).toEqual([]);
		expect(w.state.calendar.events).toEqual([]);
		expect(w.state.gmail).toEqual({ drafts: [], inbox: [], sent: [] });
		expect(w.state.docs.docs).toEqual([]);
		expect(w.state.github.repos).toEqual({});
		expect(w.state.hf.items).toEqual({});
	});

	it('isolates two worlds built from the same seed object', () => {
		const s = seed();
		const before = structuredClone(s);
		const a = createWorld(s);
		const b = createWorld(s);
		a.state.notion.rows.push({ ...sampleRow, id: 'extra' });
		expect(b.state.notion.rows).toHaveLength(1);
		expect(s).toEqual(before);
		expect(a.nextId('page')).toBe('page-0001');
		expect(b.nextId('page')).toBe('page-0001');
	});

	it('keeps per-world counters independent under concurrent use', async () => {
		const s = seed();
		const a = createWorld(s);
		const b = createWorld(s);
		const loop = async (w: ReturnType<typeof createWorld>) => {
			let last = '';
			for (let i = 0; i < 20; i++) {
				last = w.nextId('x');
				await Promise.resolve();
			}
			return last;
		};
		const [la, lb] = await Promise.all([loop(a), loop(b)]);
		expect(la).toBe('x-0020');
		expect(lb).toBe('x-0020');
		expect(a.state.meta.counters.x).toBe(20);
		expect(b.state.meta.counters.x).toBe(20);
	});

	it('snapshot() is a JSON-serializable deep copy', () => {
		const w = createWorld(seed());
		const snap = w.snapshot();
		snap.notion.rows[0].title = 'mutated';
		snap.gmail.inbox.pop();
		expect(w.state.notion.rows[0].title).toBe('UC Berkeley - CS');
		expect(w.state.gmail.inbox).toHaveLength(1);
		const fresh = w.snapshot();
		expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
	});

	it('reset() restores the seeded state and restore(snap) rolls back', () => {
		const w = createWorld(seed());
		const root = w.state;
		w.nextId('page');
		w.state.notion.rows.push({ ...sampleRow, id: 'p2' });
		const mid = w.snapshot();
		w.state.notion.rows.push({ ...sampleRow, id: 'p3' });
		w.nextId('page');
		w.restore(mid);
		expect(w.state.notion.rows.map((r) => r.id)).toEqual(['page-seed-1', 'p2']);
		expect(w.state.meta.counters.page).toBe(1);
		w.reset();
		expect(w.state.notion.rows.map((r) => r.id)).toEqual(['page-seed-1']);
		expect(w.state.meta.counters).toEqual({});
		expect(w.nextId('page')).toBe('page-0001');
		expect(w.state).toBe(root);
	});

	it('diff() lists added, removed and changed ids per collection', () => {
		const w = createWorld(seed());
		const before = w.snapshot();
		w.state.notion.rows.push({ ...sampleRow, id: 'page-new', key: 'tp1-00000000000000ff' });
		w.state.notion.rows[0].title = 'Changed';
		w.state.gmail.inbox.splice(0, 1);
		const d = w.diff(before);
		expect(d['notion.rows']).toEqual({ added: ['page-new'], removed: [], changed: ['page-seed-1'] });
		expect(d['gmail.inbox']).toEqual({ added: [], removed: ['msg-001'], changed: [] });
		expect(d['calendar.events']).toEqual({ added: [], removed: [], changed: [] });
		expect(isEmptyDiff(d)).toBe(false);
		const s = w.snapshot();
		expect(isEmptyDiff(w.diff(s, s))).toBe(true);
	});

	it('stores seeded calendar events with an exclusive end date and rejects invalid seed dates', () => {
		const w = createWorld({
			calendar: { events: [{ id: 'ev1', key: 'tp1-0000000000000001', title: 'Deadline', date: '2027-02-28' }] }
		});
		expect(w.state.calendar.events[0].start).toEqual({ date: '2027-02-28' });
		expect(w.state.calendar.events[0].end).toEqual({ date: '2027-03-01' });
		expect(() =>
			createWorld({
				calendar: { events: [{ id: 'ev2', key: 'tp1-0000000000000002', title: 'Bad', date: '2027-02-30' }] }
			})
		).toThrow(/ev2/);
	});
});

describe('validators', () => {
	it('isIsoDate accepts only real YYYY-MM-DD dates and addDaysIso does UTC arithmetic', () => {
		expect(isIsoDate('2028-02-29')).toBe(true);
		expect(isIsoDate('2027-02-29')).toBe(false);
		expect(isIsoDate('2027-13-01')).toBe(false);
		expect(isIsoDate('2027-03-01T00:00:00Z')).toBe(false);
		expect(isIsoDate('3/1/2027')).toBe(false);
		expect(addDaysIso('2027-02-28', 1)).toBe('2027-03-01');
		expect(addDaysIso('2027-12-31', 1)).toBe('2028-01-01');
	});

	it('assertNotionRichText enforces the 2000-char limit with a real-shaped 400', () => {
		expect(() => assertNotionRichText('Notes', 'x'.repeat(2000))).not.toThrow();
		let err: unknown;
		try {
			assertNotionRichText('Notes', 'x'.repeat(2001));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err).toMatchObject({ kind: 'validation', status: 400 });
		expect((err as Error).message).toContain('2000');
		expect((err as Error).message).toContain('2001');
	});

	it('assertIdempotencyKey accepts tp1 keys and rejects others', () => {
		expect(() => assertIdempotencyKey('notion', 'tp1-0123456789abcdef')).not.toThrow();
		let err: unknown;
		try {
			assertIdempotencyKey('notion', 'bad-key');
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err).toMatchObject({ kind: 'validation', status: 400 });
	});
});

describe('read-only twins', () => {
	it('GitHub twin returns cloned seeded repos, case-insensitive, 404 for unknown users', async () => {
		const w = createWorld(seed());
		const gh = createMockGitHub(w);
		expect(Object.keys(gh)).toEqual(['listRepos']);
		const repos = await gh.listRepos('wolfwdavid');
		expect(repos).toEqual([sampleRepo]);
		expect(await gh.listRepos('WolfWDavid')).toEqual([sampleRepo]);
		repos[0].stars = 999;
		repos.push({ ...sampleRepo, name: 'x' });
		expect(w.state.github.repos.wolfwdavid).toEqual([sampleRepo]);
		await expect(gh.listRepos('nobody-xyz')).rejects.toBeInstanceOf(ConnectorError);
		await expect(gh.listRepos('nobody-xyz')).rejects.toMatchObject({ kind: 'not_found', status: 404 });
	});

	it('HF twin returns cloned seeded items and [] for unknown authors', async () => {
		const w = createWorld(seed());
		const hf = createMockHF(w);
		expect(Object.keys(hf)).toEqual(['listModelsAndSpaces']);
		const items = await hf.listModelsAndSpaces('WolfDavid');
		expect(items).toEqual([sampleHF]);
		expect(await hf.listModelsAndSpaces('wolfdavid')).toEqual([sampleHF]);
		items[0].likes = 42;
		expect(w.state.hf.items.WolfDavid[0].likes).toBe(1);
		expect(await hf.listModelsAndSpaces('nobody-xyz')).toEqual([]);
	});
});

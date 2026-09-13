import { describe, it, expect } from 'vitest';
import {
	ConnectorError,
	createConnectors,
	createRealConnectors,
	defaultWorldSeed,
	isEmptyDiff,
	realConnectorStatus,
	resolveConnectorMode,
	type Connectors,
	type TrackerRowInput
} from './index.ts';

const K = (n: number) => 'tp1-' + n.toString(16).padStart(16, '0');

const row = (key: string): TrackerRowInput & { key: string } => ({
	key,
	schoolId: 'berkeley',
	programId: 'berkeley-data-science',
	title: 'UC Berkeley - Data Science',
	deadline: '2027-03-01',
	requiredDocs: ['transcript'],
	recsRequired: 0,
	essayStatus: 'draft',
	gapCount: 2,
	status: 'planning'
});

const draft = (key: string) => ({
	key,
	to: ['lchen@example.edu'],
	subject: 'Transfer question',
	body: 'Hello'
});

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
	try {
		return { ok: true, value: await p };
	} catch (error) {
		return { ok: false, error };
	}
}

describe('createConnectors mock mode', () => {
	it('returns all six ports over a fixture-seeded world', async () => {
		const c = createConnectors({ mode: 'mock' });
		expect(c.mode).toBe('mock');
		expect(c.world).toBeDefined();
		for (const app of ['gmail', 'calendar', 'docs', 'notion', 'github', 'hf']) expect(c).toHaveProperty(app);
		const essay = await c.docs.readDoc('doc-essay-demo');
		expect(essay.text.length).toBeGreaterThan(0);
		const repos = await c.github.listRepos('wolfwdavid');
		expect(repos.length).toBeGreaterThanOrEqual(3);
		expect(repos.map((r) => r.name)).toContain('multi-app-agent');
		expect((await c.hf.listModelsAndSpaces('WolfDavid')).length).toBeGreaterThanOrEqual(2);
		expect(await c.gmail.searchInbox('evil.example')).toHaveLength(1);
		expect(await c.notion.listTrackerRows()).toEqual([]);
	});

	it('non-adversarial seed omits the injection fixtures', async () => {
		const c = createConnectors({ mode: 'mock', seed: defaultWorldSeed({ adversarial: false }) });
		await expect(c.docs.readDoc('doc-essay-demo-injected')).rejects.toMatchObject({ kind: 'not_found' });
		expect(await c.gmail.searchInbox('')).toEqual([]);
	});

	it('concurrently created bundles never share state and fixtures are never mutated', async () => {
		const [A, B] = await Promise.all([
			Promise.resolve(createConnectors({ mode: 'mock' })),
			Promise.resolve(createConnectors({ mode: 'mock' }))
		]);
		const bBefore = B.world.snapshot();
		const key = K(1);
		await A.notion.upsertTrackerRow(row(key));
		await A.calendar.createEvent({ key: K(2), title: 'Deadline', date: '2027-03-01' });
		await A.docs.createDoc({ key: K(3), title: 'Critique', body: 'notes' });
		await A.gmail.createDraft(draft(K(4)));
		expect(isEmptyDiff(A.world.diff(bBefore))).toBe(false);
		expect(isEmptyDiff(B.world.diff(bBefore))).toBe(true);
		expect(await B.notion.findByKey(key)).toBeNull();

		const original = (await B.docs.readDoc('doc-essay-demo')).text;
		A.world.state.docs.docs[0].body = 'MUTATED';
		const C = createConnectors({ mode: 'mock' });
		expect((await C.docs.readDoc('doc-essay-demo')).text).toBe(original);
	});

	it('reuses a supplied world (re-run idempotency path)', async () => {
		const A = createConnectors({ mode: 'mock' });
		const key = K(10);
		await A.notion.upsertTrackerRow(row(key));
		const again = createConnectors({ mode: 'mock', world: A.world });
		expect(again.world).toBe(A.world);
		expect(await again.notion.findByKey(key)).not.toBeNull();
	});
});

describe('createConnectors faults over the real twins', () => {
	it('ghost_write createDraft rejects 500 but the draft exists; an unguarded retry duplicates', async () => {
		const c = createConnectors({
			mode: 'mock',
			faults: { seed: 1, rules: { gmail: [{ method: 'createDraft', calls: [1], fault: { type: 'ghost_write' } }] } }
		});
		const key = K(20);
		const r = await settle(c.gmail.createDraft(draft(key)));
		expect(r.ok).toBe(false);
		const err = (r as { error: unknown }).error as ConnectorError;
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err.kind).toBe('server');
		expect(err.status).toBe(500);
		expect(await c.gmail.findByKey(key)).not.toBeNull();
		expect(await c.gmail.listDrafts()).toHaveLength(1);
		await c.gmail.createDraft(draft(key));
		expect(await c.gmail.listDrafts()).toHaveLength(2);
	});

	it('rate_limit on notion.upsertTrackerRow rejects 429 with no state change, then succeeds', async () => {
		const c = createConnectors({
			mode: 'mock',
			faults: {
				rules: {
					notion: [{ method: 'upsertTrackerRow', calls: [1], fault: { type: 'rate_limit', retryAfterMs: 50 } }]
				}
			}
		});
		const before = c.world.snapshot();
		const key = K(30);
		await expect(c.notion.upsertTrackerRow(row(key))).rejects.toMatchObject({
			kind: 'rate_limit',
			status: 429,
			retryAfterMs: 50
		});
		expect(isEmptyDiff(c.world.diff(before))).toBe(true);
		const ok = await c.notion.upsertTrackerRow(row(key));
		expect(ok.key).toBe(key);
	});

	it('lying_success on calendar.createEvent resolves but persists nothing', async () => {
		const c = createConnectors({
			mode: 'mock',
			faults: { rules: { calendar: [{ method: 'createEvent', fault: { type: 'lying_success' } }] } }
		});
		const before = c.world.snapshot();
		const key = K(40);
		const ev = await c.calendar.createEvent({ key, title: 'Deadline', date: '2027-03-01' });
		expect(ev.key).toBe(key);
		expect(await c.calendar.findByKey(key)).toBeNull();
		expect(isEmptyDiff(c.world.diff(before))).toBe(true);
	});

	it('server_error on docs.createDoc rejects 500 and writes nothing', async () => {
		const c = createConnectors({
			mode: 'mock',
			faults: { rules: { docs: [{ method: 'createDoc', fault: { type: 'server_error' } }] } }
		});
		const key = K(50);
		await expect(c.docs.createDoc({ key, title: 'Critique', body: 'x' })).rejects.toMatchObject({
			kind: 'server',
			status: 500
		});
		expect(await c.docs.findByKey(key)).toBeNull();
	});

	it('fault sequences are deterministic for the same seed', async () => {
		const run = async () => {
			const c = createConnectors({
				mode: 'mock',
				faults: {
					seed: 99,
					rules: { notion: [{ method: 'findByKey', probability: 0.5, fault: { type: 'server_error' } }] }
				}
			});
			const seq: boolean[] = [];
			for (let i = 0; i < 30; i++) seq.push((await settle(c.notion.findByKey(K(i)))).ok);
			return seq;
		};
		const a = await run();
		const b = await run();
		expect(a).toEqual(b);
		expect(a).toContain(true);
		expect(a).toContain(false);
	});
});

describe('createConnectors real mode', () => {
	it('credential-gated ports reject not_configured with the missing env names', async () => {
		const c = createConnectors({ mode: 'real', env: {} });
		expect(c.mode).toBe('real');
		expect(c.world).toBeNull();
		const apps = ['notion', 'calendar', 'gmail', 'docs'] as const;
		let count = 0;
		for (const app of apps) {
			const port = c[app] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
			for (const method of Object.keys(port)) {
				const r = await settle(port[method]());
				expect(r.ok, `${app}.${method}`).toBe(false);
				const err = (r as { error: unknown }).error as ConnectorError;
				expect(err).toBeInstanceOf(ConnectorError);
				expect(err.kind).toBe('not_configured');
				count++;
			}
		}
		// notion 3 + calendar 3 + gmail 4 + docs 3
		expect(count).toBe(13);
		await expect(c.notion.findByKey(K(1))).rejects.toThrow(/NOTION_TOKEN/);
		await expect(c.gmail.listDrafts()).rejects.toThrow(/GOOGLE_REFRESH_TOKEN/);
	});

	it('github and hf are live read ports (not called here: no network in tests)', () => {
		const c = createConnectors({ mode: 'real', env: {} });
		expect(typeof c.github.listRepos).toBe('function');
		expect(typeof c.hf.listModelsAndSpaces).toBe('function');
	});

	it('status reports configured, implemented and missing env per app', () => {
		const status = realConnectorStatus({ NOTION_TOKEN: 'x' });
		expect(status.find((s) => s.app === 'notion')).toMatchObject({
			configured: false,
			missing: ['NOTION_DATA_SOURCE_ID']
		});
		expect(status.find((s) => s.app === 'github')).toMatchObject({ configured: true, implemented: true });
		expect(status.find((s) => s.app === 'hf')).toMatchObject({ configured: true, implemented: true });
		expect(status.find((s) => s.app === 'gmail')?.configured).toBe(false);
	});

	it('real gmail has no send', () => {
		const c = createConnectors({ mode: 'real', env: {} });
		expect('send' in c.gmail).toBe(false);
	});

	it('Google credentials present builds lazy ports synchronously without importing Google', () => {
		const c = createRealConnectors({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' });
		expect(Object.keys(c.calendar)).toEqual(['findByKey', 'createEvent', 'listEvents']);
		expect(Object.keys(c.gmail)).toEqual(['findByKey', 'createDraft', 'listDrafts', 'searchInbox']);
		expect('send' in c.gmail).toBe(false);
	});
});

describe('resolveConnectorMode', () => {
	it('maps MODE to mock or real and throws otherwise', () => {
		expect(resolveConnectorMode({})).toBe('mock');
		expect(resolveConnectorMode({ MODE: 'mock' })).toBe('mock');
		expect(resolveConnectorMode({ MODE: 'real' })).toBe('real');
		expect(resolveConnectorMode({ MODE: ' REAL ' })).toBe('real');
		expect(() => resolveConnectorMode({ MODE: 'prod' })).toThrow(/prod/);
	});
});

describe('no send anywhere', () => {
	it('mock, real and fault-wrapped gmail ports have no send', () => {
		const mockBundle = createConnectors({ mode: 'mock' });
		const realBundle = createConnectors({ mode: 'real' });
		const wrapped = createConnectors({
			mode: 'mock',
			faults: { rules: { gmail: [{ method: '*', fault: { type: 'latency', ms: 0 } }] } }
		});
		const bundles: Connectors[] = [mockBundle, realBundle, wrapped];
		for (const b of bundles) expect('send' in b.gmail).toBe(false);
		// @ts-expect-error GmailPort has no send method
		expect(mockBundle.gmail.send).toBeUndefined();
	});
});

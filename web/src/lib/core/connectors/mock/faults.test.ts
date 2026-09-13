import { describe, it, expect, vi } from 'vitest';
import { ConnectorError } from '../types.ts';
import { FaultRule, withFaults, type FaultEvent } from './faults.ts';

function makePort() {
	const state = { items: [] as string[] };
	const port = {
		add: async (x: string) => {
			state.items.push(x);
			return { id: `i${state.items.length}` };
		},
		list: async () => [...state.items]
	};
	const rollback = {
		snapshot: () => structuredClone(state),
		restore: (s: typeof state) => {
			state.items = s.items;
		}
	};
	return { state, port, rollback };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
	try {
		return { ok: true, value: await p };
	} catch (error) {
		return { ok: false, error };
	}
}

describe('withFaults: passthrough', () => {
	it('with no rules returns identical results and the same keys', async () => {
		const { port, state } = makePort();
		const wrapped = withFaults(port, []);
		expect(Object.keys(wrapped)).toEqual(Object.keys(port));
		expect(await wrapped.add('a')).toEqual({ id: 'i1' });
		expect(await wrapped.list()).toEqual(['a']);
		expect(state.items).toEqual(['a']);
	});

	it('does not invent a send method on a gmail-like port', () => {
		const gmailLike = {
			createDraft: async () => ({ id: 'r-1' }),
			listDrafts: async () => []
		};
		expect('send' in withFaults(gmailLike, [])).toBe(false);
		expect('send' in withFaults(gmailLike, [{ method: '*', fault: { type: 'latency', ms: 1 } }])).toBe(false);
	});
});

describe('withFaults: terminal faults', () => {
	it('rate_limit rejects with 429 + retryAfterMs and does not call the method', async () => {
		const { port, state } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'rate_limit', retryAfterMs: 120 } }], {
			app: 'notion'
		});
		const r = await settle(wrapped.add('a'));
		expect(r.ok).toBe(false);
		const err = (r as { error: unknown }).error as ConnectorError;
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err.kind).toBe('rate_limit');
		expect(err.status).toBe(429);
		expect(err.retryAfterMs).toBe(120);
		expect(err.message).toContain('notion.add');
		expect(state.items).toEqual([]);
	});

	it('rate_limit defaults retryAfterMs to 50', async () => {
		const { port } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'rate_limit' } }]);
		await expect(wrapped.add('a')).rejects.toMatchObject({ kind: 'rate_limit', status: 429, retryAfterMs: 50 });
	});

	it('server_error rejects with 500 (or configured status) and does not call the method', async () => {
		const { port, state } = makePort();
		const w500 = withFaults(port, [{ method: 'add', fault: { type: 'server_error' } }]);
		await expect(w500.add('a')).rejects.toMatchObject({ kind: 'server', status: 500 });
		const w503 = withFaults(port, [{ method: 'add', fault: { type: 'server_error', status: 503 } }]);
		await expect(w503.add('a')).rejects.toMatchObject({ kind: 'server', status: 503 });
		expect(state.items).toEqual([]);
	});

	it('ghost_write commits the write and then rejects with 500', async () => {
		const { port, state } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'ghost_write' } }]);
		const r = await settle(wrapped.add('a'));
		expect(r.ok).toBe(false);
		const err = (r as { error: unknown }).error as ConnectorError;
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err.kind).toBe('server');
		expect(err.status).toBe(500);
		expect(err.message).toContain('write was committed');
		expect(state.items).toEqual(['a']);
	});

	it('lying_success resolves with the result but rolls the state back', async () => {
		const { port, state, rollback } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'lying_success' } }], { rollback });
		expect(await wrapped.add('a')).toEqual({ id: 'i1' });
		expect(state.items).toEqual([]);
		expect(await wrapped.list()).toEqual([]);
	});

	it('lying_success without rollback rejects mentioning rollback', async () => {
		const { port, state } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'lying_success' } }]);
		await expect(wrapped.add('a')).rejects.toThrow(/rollback/);
		expect(state.items).toEqual([]);
	});
});

describe('withFaults: latency', () => {
	it('sleeps for ms and returns the unchanged result', async () => {
		const { port } = makePort();
		const sleep = vi.fn(async () => {});
		const wrapped = withFaults(port, [{ method: 'add', fault: { type: 'latency', ms: 250 } }], { sleep });
		expect(await wrapped.add('a')).toEqual({ id: 'i1' });
		expect(sleep).toHaveBeenCalledWith(250);
	});

	it('is non-terminal: latency followed by rate_limit applies both', async () => {
		const { port, state } = makePort();
		const sleep = vi.fn(async () => {});
		const events: FaultEvent[] = [];
		const wrapped = withFaults(
			port,
			[
				{ method: 'add', fault: { type: 'latency', ms: 10 } },
				{ method: 'add', fault: { type: 'rate_limit' } }
			],
			{ sleep, onFault: (e) => events.push(e) }
		);
		await expect(wrapped.add('a')).rejects.toMatchObject({ kind: 'rate_limit' });
		expect(sleep).toHaveBeenCalledWith(10);
		expect(events.map((e) => e.type)).toEqual(['latency', 'rate_limit']);
		expect(state.items).toEqual([]);
	});
});

describe('withFaults: selection', () => {
	it('calls: [2] faults only the 2nd call', async () => {
		const { port } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', calls: [2], fault: { type: 'server_error' } }]);
		const results = [];
		for (const x of ['a', 'b', 'c']) results.push((await settle(wrapped.add(x))).ok);
		expect(results).toEqual([true, false, true]);
	});

	it('maxTimes: 1 without calls faults only the first matching call', async () => {
		const { port } = makePort();
		const wrapped = withFaults(port, [{ method: 'add', maxTimes: 1, fault: { type: 'server_error' } }]);
		const results = [];
		for (const x of ['a', 'b', 'c']) results.push((await settle(wrapped.add(x))).ok);
		expect(results).toEqual([false, true, true]);
	});

	it("method '*' matches every method and counters are per method", async () => {
		const { port } = makePort();
		const events: FaultEvent[] = [];
		const wrapped = withFaults(port, [{ method: '*', calls: [1], fault: { type: 'server_error' } }], {
			app: 'x',
			onFault: (e) => events.push(e)
		});
		expect((await settle(wrapped.add('a'))).ok).toBe(false);
		expect((await settle(wrapped.list())).ok).toBe(false);
		expect((await settle(wrapped.add('b'))).ok).toBe(true);
		expect((await settle(wrapped.list())).ok).toBe(true);
		expect(events).toEqual([
			{ app: 'x', method: 'add', call: 1, type: 'server_error' },
			{ app: 'x', method: 'list', call: 1, type: 'server_error' }
		]);
	});

	it('probability is deterministic per seed', async () => {
		const run = async (seed: number) => {
			const { port } = makePort();
			const faulted: number[] = [];
			const wrapped = withFaults(port, [{ method: 'list', probability: 0.5, fault: { type: 'server_error' } }], {
				seed,
				onFault: (e) => faulted.push(e.call)
			});
			for (let i = 0; i < 40; i++) {
				try {
					await wrapped.list();
				} catch {
					/* counted via onFault */
				}
			}
			return faulted;
		};
		const a = await run(42);
		const b = await run(42);
		const c = await run(7);
		expect(a).toEqual(b);
		expect(a.length).toBeGreaterThan(0);
		expect(a.length).toBeLessThan(40);
		expect(c).not.toEqual(a);
	});

	it('probability 0 never fires and 1 always fires', async () => {
		const { port } = makePort();
		const never = withFaults(port, [{ method: 'list', probability: 0, fault: { type: 'server_error' } }], { seed: 3 });
		const always = withFaults(port, [{ method: 'list', probability: 1, fault: { type: 'server_error' } }], { seed: 3 });
		for (let i = 0; i < 10; i++) {
			expect((await settle(never.list())).ok).toBe(true);
			expect((await settle(always.list())).ok).toBe(false);
		}
	});

	it('onFault receives events in order', async () => {
		const { port, rollback } = makePort();
		const events: FaultEvent[] = [];
		const wrapped = withFaults(
			port,
			[
				{ method: 'add', calls: [1], fault: { type: 'rate_limit' } },
				{ method: 'add', calls: [2], fault: { type: 'ghost_write' } },
				{ method: 'add', calls: [3], fault: { type: 'lying_success' } }
			],
			{ app: 'notion', rollback, onFault: (e) => events.push(e) }
		);
		for (const x of ['a', 'b', 'c', 'd']) await settle(wrapped.add(x));
		expect(events).toEqual([
			{ app: 'notion', method: 'add', call: 1, type: 'rate_limit' },
			{ app: 'notion', method: 'add', call: 2, type: 'ghost_write' },
			{ app: 'notion', method: 'add', call: 3, type: 'lying_success' }
		]);
	});
});

describe('withFaults: validation', () => {
	it('throws synchronously at wrap time for an unknown method', () => {
		const { port } = makePort();
		expect(() => withFaults(port, [{ method: 'send', fault: { type: 'server_error' } }])).toThrow(/send/);
	});

	it('FaultRule rejects unknown fault types and fills defaults', () => {
		expect(FaultRule.safeParse({ method: 'x', fault: { type: 'http' } }).success).toBe(false);
		const rl = FaultRule.parse({ method: 'x', fault: { type: 'rate_limit' } });
		expect(rl.fault).toEqual({ type: 'rate_limit', retryAfterMs: 50 });
		const se = FaultRule.parse({ method: 'x', fault: { type: 'server_error' } });
		expect(se.fault).toEqual({ type: 'server_error', status: 500 });
	});

	it('rejects invalid rule input at wrap time', () => {
		const { port } = makePort();
		expect(() =>
			withFaults(port, [{ method: 'add', fault: { type: 'latency', ms: 5000 } }])
		).toThrow();
	});
});

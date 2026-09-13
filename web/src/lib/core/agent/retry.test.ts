import { describe, it, expect, vi } from 'vitest';
import { ConnectorError } from '../connectors/types.ts';
import { backoffDelay, isRetryableError, toErrorInfo, withRetry } from './retry.ts';
import { callFingerprint, createLoopGuard, createStepBudget, LoopDetectedError, StepCapError } from './guards.ts';

const O = { baseDelayMs: 100, maxDelayMs: 2000 };
const r429 = (ms = 10) => new ConnectorError('rate_limit', '429', { status: 429, retryAfterMs: ms });
const s500 = () => new ConnectorError('server', 'boom', { status: 500 });
const mkSleep = () => vi.fn(async (_ms: number) => {});
const opts = (sleep: (ms: number) => Promise<void>) => ({ maxAttempts: 3, ...O, sleep });

describe('isRetryableError', () => {
	it('retries rate_limit, server and timeout only', () => {
		expect(isRetryableError(r429())).toBe(true);
		expect(isRetryableError(s500())).toBe(true);
		expect(isRetryableError(new ConnectorError('timeout', 't'))).toBe(true);
		for (const k of ['validation', 'not_found', 'auth', 'not_configured'] as const) {
			expect(isRetryableError(new ConnectorError(k, k))).toBe(false);
		}
		expect(isRetryableError(new Error('plain'))).toBe(false);
	});
});

describe('backoffDelay', () => {
	it('honors retryAfterMs', () => {
		expect(backoffDelay(1, r429(10), O)).toBe(10);
	});
	it('backs off exponentially', () => {
		expect([1, 2, 3].map((n) => backoffDelay(n, s500(), O))).toEqual([100, 200, 400]);
	});
	it('caps at maxDelayMs', () => {
		expect(backoffDelay(10, s500(), O)).toBe(2000);
		expect(backoffDelay(1, r429(5000), O)).toBe(2000);
	});
});

describe('toErrorInfo', () => {
	it('maps ConnectorError and omits undefined fields', () => {
		expect(toErrorInfo(s500())).toStrictEqual({ kind: 'server', message: 'boom', status: 500 });
		expect(toErrorInfo(r429(10))).toStrictEqual({ kind: 'rate_limit', message: '429', status: 429, retryAfterMs: 10 });
	});
	it('maps other throwables to server', () => {
		expect(toErrorInfo(new Error('x'))).toStrictEqual({ kind: 'server', message: 'x' });
		expect(toErrorInfo('str').kind).toBe('server');
	});
});

describe('withRetry', () => {
	it('returns on first success without sleeping', async () => {
		const sleep = mkSleep();
		expect(await withRetry(async () => 7, opts(sleep))).toEqual({ ok: true, value: 7, attempts: 1 });
		expect(sleep).not.toHaveBeenCalled();
	});

	it('retries 429 using retryAfterMs', async () => {
		const sleep = mkSleep();
		const onRetry = vi.fn();
		let n = 0;
		const res = await withRetry(
			async () => {
				if (++n <= 2) throw r429(10);
				return 'ok';
			},
			{ ...opts(sleep), onRetry }
		);
		expect(res).toEqual({ ok: true, value: 'ok', attempts: 3 });
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 10]);
		expect(onRetry.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2]);
	});

	it('gives up after maxAttempts with exponential backoff', async () => {
		const sleep = mkSleep();
		const fn = vi.fn(async () => {
			throw s500();
		});
		const res = await withRetry(fn, opts(sleep));
		expect(res).toMatchObject({ ok: false, attempts: 3, stopped: false });
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('does not retry non-retryable errors', async () => {
		const sleep = mkSleep();
		const fn = vi.fn(async () => {
			throw new ConnectorError('validation', 'bad', { status: 400 });
		});
		const res = await withRetry(fn, opts(sleep));
		expect(res).toMatchObject({ ok: false, attempts: 1, stopped: false });
		expect(sleep).not.toHaveBeenCalled();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('stops when beforeRetry says stop, after sleeping', async () => {
		const order: string[] = [];
		const sleep = vi.fn(async (_ms: number) => {
			order.push('sleep');
		});
		const err = s500();
		const beforeRetry = vi.fn(async () => {
			order.push('beforeRetry');
			return 'stop' as const;
		});
		const fn = vi.fn(async () => {
			throw err;
		});
		const res = await withRetry(fn, { ...opts(sleep), beforeRetry });
		expect(res).toEqual({ ok: false, error: err, attempts: 1, stopped: true });
		expect(fn).toHaveBeenCalledTimes(1);
		expect(order).toEqual(['sleep', 'beforeRetry']);
		expect(beforeRetry).toHaveBeenCalledWith({ attempt: 1, error: err, delayMs: 100 });
	});
});

describe('guards', () => {
	it('step budget throws StepCapError past max', () => {
		const b = createStepBudget(2);
		b.take('a');
		b.take('b');
		expect(() => b.take('c')).toThrow(StepCapError);
		expect(() => b.take('c')).toThrow(/2/);
		expect(b.used).toBe(2);
		expect(b.max).toBe(2);
	});

	it('loop guard throws on the (max+1)th identical call', () => {
		const g = createLoopGuard(3);
		for (let i = 0; i < 3; i++) g.record('notion.upsertTrackerRow', { a: 1, b: 2 });
		g.record('notion.upsertTrackerRow', { a: 1, b: 3 });
		expect(g.count('notion.upsertTrackerRow', { a: 1, b: 3 })).toBe(1);
		let caught: unknown;
		try {
			g.record('notion.upsertTrackerRow', { b: 2, a: 1 });
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(LoopDetectedError);
		expect((caught as LoopDetectedError).count).toBe(4);
	});

	it('fingerprints are key-order independent', () => {
		expect(callFingerprint('t', { b: 1, a: 2 })).toBe(callFingerprint('t', { a: 2, b: 1 }));
		expect(callFingerprint('t', { a: 1 })).not.toBe(callFingerprint('u', { a: 1 }));
	});
});

// Fault injection as a decorator over any connector port.
//
// Real APIs fail in ways a happy-path mock never shows. This wrapper injects them as data:
// - rate_limit / server_error: typed 429 / 5xx ConnectorErrors before the call reaches the port.
// - ghost_write: the write IS committed, then the call fails with a 5xx. A naive retry creates a
//   duplicate, which is why the Phase 4 executor re-checks findByKey before retrying.
// - lying_success: the call reports success but nothing persists (the "lying API"). The Phase 6
//   oracle must catch it by reading final state back. Callers MUST pass the World as
//   `opts.rollback` for lying_success; it is snapshotted before the call and restored after.
// - latency: non-terminal delay; later matching rules still apply.
//
// Rules are zod-validated so scenarios can declare them as JSON. Selection is deterministic:
// by per-method call number, or by a seeded PRNG that lives in each wrapper's closure.
import { z } from 'zod';
import { ConnectorError, type Connectors } from '../types.ts';

const ServerStatus = z.union([z.literal(500), z.literal(502), z.literal(503)]);

export const FaultSpec = z.discriminatedUnion('type', [
	z.object({ type: z.literal('rate_limit'), retryAfterMs: z.number().int().nonnegative().default(50) }),
	z.object({ type: z.literal('server_error'), status: ServerStatus.default(500) }),
	// Commit the write, THEN fail.
	z.object({ type: z.literal('ghost_write'), status: ServerStatus.default(500) }),
	// Report ok, persist nothing.
	z.object({ type: z.literal('lying_success') }),
	z.object({ type: z.literal('latency'), ms: z.number().int().nonnegative().max(2000) })
]);

export const FaultRule = z.object({
	/** Exact port method name, or '*' for every method. */
	method: z.string().min(1),
	fault: FaultSpec,
	/** 1-based per-method call numbers. */
	calls: z.array(z.number().int().positive()).optional(),
	/** Fires with this probability using the seeded PRNG. */
	probability: z.number().min(0).max(1).optional(),
	maxTimes: z.number().int().positive().optional()
});

export type FaultSpec = z.infer<typeof FaultSpec>;
export type FaultRule = z.infer<typeof FaultRule>;
export type FaultRuleInput = z.input<typeof FaultRule>;
export type FaultType = FaultSpec['type'];

export interface FaultEvent {
	app?: string;
	method: string;
	call: number;
	type: FaultType;
}

/** World satisfies this structurally. */
export interface StateRollback<S = unknown> {
	snapshot(): S;
	restore(snapshot: S): void;
}

export interface FaultOptions {
	seed?: number;
	app?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rollback?: StateRollback<any>;
	sleep?: (ms: number) => Promise<void>;
	onFault?: (e: FaultEvent) => void;
}

/** mulberry32: tiny deterministic PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
	const s = { a: seed >>> 0 };
	return () => {
		s.a = (s.a + 0x6d2b79f5) >>> 0;
		let t = s.a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function withFaults<T extends object>(port: T, rules: FaultRuleInput[], opts: FaultOptions = {}): T {
	const parsed = FaultRule.array().parse(rules);
	const source = port as unknown as Record<string, unknown>;
	for (const r of parsed) {
		if (r.method !== '*' && typeof source[r.method] !== 'function') {
			throw new Error(`withFaults: port has no method "${r.method}"`);
		}
	}

	const rng = mulberry32(opts.seed ?? 1);
	const sleep = opts.sleep ?? defaultSleep;
	const counts: Record<string, number> = {};
	const fired: number[] = [];
	const label = opts.app ?? 'port';
	const out: Record<string, unknown> = {};

	for (const key of Object.keys(source)) {
		const value = source[key];
		if (typeof value !== 'function') {
			out[key] = value;
			continue;
		}
		const fn = value as (...args: unknown[]) => Promise<unknown>;
		out[key] = async (...args: unknown[]) => {
			const call = (counts[key] = (counts[key] ?? 0) + 1);
			let terminal: FaultSpec | undefined;
			for (const [i, r] of parsed.entries()) {
				if (r.method !== '*' && r.method !== key) continue;
				if (r.calls && !r.calls.includes(call)) continue;
				if (r.maxTimes !== undefined && (fired[i] ?? 0) >= r.maxTimes) continue;
				// Evaluated last so the PRNG is consumed only by otherwise-matching calls.
				if (r.probability !== undefined && !(rng() < r.probability)) continue;
				fired[i] = (fired[i] ?? 0) + 1;
				opts.onFault?.({ app: opts.app, method: key, call, type: r.fault.type });
				if (r.fault.type === 'latency') {
					await sleep(r.fault.ms);
					continue;
				}
				terminal = r.fault;
				break;
			}

			if (!terminal) return fn.apply(port, args);

			switch (terminal.type) {
				case 'rate_limit':
					throw new ConnectorError('rate_limit', `${label}.${key}: 429 Too Many Requests`, {
						status: 429,
						retryAfterMs: terminal.retryAfterMs
					});
				case 'server_error':
					throw new ConnectorError('server', `${label}.${key}: ${terminal.status} Internal Server Error`, {
						status: terminal.status
					});
				case 'ghost_write':
					await fn.apply(port, args);
					throw new ConnectorError(
						'server',
						`${label}.${key}: ${terminal.status} Internal Server Error (write was committed)`,
						{ status: terminal.status }
					);
				case 'lying_success': {
					const rollback = opts.rollback;
					if (!rollback) {
						throw new Error('withFaults: lying_success requires opts.rollback (pass the World)');
					}
					const snap = rollback.snapshot();
					const res = await fn.apply(port, args);
					rollback.restore(snap);
					return res;
				}
				default:
					return fn.apply(port, args);
			}
		};
	}
	return out as T;
}

const APP_SALT: Readonly<Record<keyof Connectors, number>> = {
	gmail: 1,
	calendar: 2,
	docs: 3,
	notion: 4,
	github: 5,
	hf: 6
};

export function withFaultsAll<C extends Connectors>(
	connectors: C,
	rules: Partial<Record<keyof Connectors, FaultRuleInput[]>>,
	opts: Omit<FaultOptions, 'app'> = {}
): C {
	const out = { ...connectors } as Record<string, unknown>;
	for (const app of Object.keys(APP_SALT) as (keyof Connectors)[]) {
		const list = rules[app];
		if (!list || list.length === 0) continue;
		out[app] = withFaults(connectors[app], list, {
			...opts,
			app,
			seed: ((opts.seed ?? 1) * 31 + APP_SALT[app]) >>> 0
		});
	}
	return out as C;
}

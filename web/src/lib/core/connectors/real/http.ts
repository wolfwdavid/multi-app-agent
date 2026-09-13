// Minimal JSON GET over the global fetch with a timeout and HTTP status -> ConnectorError mapping.
// Error messages carry the URL path only, never query strings or headers (which may hold tokens).
import { ConnectorError } from '../types.ts';
import type { RealDeps } from './shared.ts';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RATE_LIMIT_MS = 60000;

function pathOnly(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url.split('?')[0];
	}
}

/** retry-after (seconds or HTTP-date), else x-ratelimit-reset when remaining is 0. Clamped to >= 1000. */
export function parseRetryAfterMs(headers: Headers, nowMs: number): number | undefined {
	const retryAfter = headers.get('retry-after')?.trim();
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
		const at = Date.parse(retryAfter);
		if (!Number.isNaN(at)) return Math.max(1000, at - nowMs);
	}
	const reset = headers.get('x-ratelimit-reset');
	if (headers.get('x-ratelimit-remaining') === '0' && reset !== null && Number.isFinite(Number(reset))) {
		return Math.max(1000, Number(reset) * 1000 - nowMs);
	}
	return undefined;
}

export async function fetchJson<T>(
	url: string,
	opts: { app: 'github' | 'hf'; headers?: Record<string, string>; deps?: RealDeps }
): Promise<T> {
	const deps = opts.deps ?? {};
	const doFetch = deps.fetch ?? fetch;
	const now = deps.now ?? Date.now;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const where = `${opts.app} GET ${pathOnly(url)}`;

	const res = await doFetch(url, { headers: opts.headers, signal: AbortSignal.timeout(timeoutMs) }).catch(
		(e: unknown) => {
			const name = (e as { name?: unknown } | null)?.name;
			if (name === 'TimeoutError' || name === 'AbortError') {
				throw new ConnectorError('timeout', `${where}: timed out after ${timeoutMs}ms`);
			}
			const cause = e instanceof Error ? e.message : String(e);
			throw new ConnectorError('server', `${where}: network error (${cause})`);
		}
	);

	if (!res.ok) {
		const status = res.status;
		const message = `${where}: ${status} ${res.statusText}`.trim();
		const retryAfterMs = parseRetryAfterMs(res.headers, now());
		if (status === 404) throw new ConnectorError('not_found', message, { status });
		if (status === 429) {
			throw new ConnectorError('rate_limit', message, { status, retryAfterMs: retryAfterMs ?? DEFAULT_RATE_LIMIT_MS });
		}
		if (status === 403) {
			const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after');
			if (limited) {
				throw new ConnectorError('rate_limit', message, { status, retryAfterMs: retryAfterMs ?? DEFAULT_RATE_LIMIT_MS });
			}
			throw new ConnectorError('auth', message, { status });
		}
		if (status === 401) throw new ConnectorError('auth', message, { status });
		if (status >= 500) throw new ConnectorError('server', message, { status });
		throw new ConnectorError('validation', message, { status });
	}

	try {
		return (await res.json()) as T;
	} catch {
		throw new ConnectorError('server', `${where}: response was not valid JSON`, { status: res.status });
	}
}

/**
 * Serializes calls so consecutive starts are at least minIntervalMs apart. State lives in the
 * closure, never at module scope. A rejection propagates to its caller but does not break the chain.
 */
export function createPacer(
	minIntervalMs: number,
	deps: Pick<RealDeps, 'sleep' | 'now'> = {}
): <T>(fn: () => Promise<T>) => Promise<T> {
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const now = deps.now ?? Date.now;
	const state: { chain: Promise<unknown>; last: number } = { chain: Promise.resolve(), last: -Infinity };
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const run = state.chain.then(async () => {
			const wait = Math.max(0, state.last + minIntervalMs - now());
			if (wait > 0) await sleep(wait);
			state.last = now();
			return fn();
		});
		state.chain = run.catch(() => {});
		return run;
	};
}

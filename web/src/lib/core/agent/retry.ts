// Retry with retry-after, deterministic exponential backoff and an attempt cap.
//
// A generic retry around a create is only safe because the executor's beforeRetry hook re-checks
// findByKey before every new attempt (Pitfall 6): a 5xx can arrive AFTER the write committed
// (ghost write), and blindly retrying would create a duplicate.
import type { ConnectorErrorInfo } from '../schemas.ts';
import { ConnectorError } from '../connectors/types.ts';

export interface RetryInfo {
	attempt: number;
	error: unknown;
	delayMs: number;
}

export interface RetryOptions {
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	sleep: (ms: number) => Promise<void>;
	/** Defaults to isRetryableError. */
	isRetryable?: (err: unknown) => boolean;
	/** Called before sleeping. */
	onRetry?: (info: RetryInfo) => void;
	/** Called after sleeping. 'stop' ends the loop (e.g. findByKey found the ghost write). */
	beforeRetry?: (info: RetryInfo) => Promise<'retry' | 'stop'>;
}

export type RetryResult<T> =
	| { ok: true; value: T; attempts: number }
	| { ok: false; error: unknown; attempts: number; stopped: boolean };

const RETRYABLE = new Set(['rate_limit', 'server', 'timeout']);

export function isRetryableError(err: unknown): boolean {
	return err instanceof ConnectorError && RETRYABLE.has(err.kind);
}

export function backoffDelay(attempt: number, err: unknown, o: { baseDelayMs: number; maxDelayMs: number }): number {
	const retryAfter = err instanceof ConnectorError ? err.retryAfterMs : undefined;
	return Math.min(o.maxDelayMs, retryAfter ?? o.baseDelayMs * 2 ** (attempt - 1));
}

export function toErrorInfo(err: unknown): ConnectorErrorInfo {
	if (err instanceof ConnectorError) {
		return {
			kind: err.kind,
			message: err.message,
			...(err.status !== undefined ? { status: err.status } : {}),
			...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {})
		};
	}
	return { kind: 'server', message: err instanceof Error ? err.message : String(err) };
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<RetryResult<T>> {
	const isRetryable = o.isRetryable ?? isRetryableError;
	const max = Math.max(1, o.maxAttempts);
	for (let attempt = 1; ; attempt++) {
		try {
			return { ok: true, value: await fn(attempt), attempts: attempt };
		} catch (err) {
			if (!isRetryable(err) || attempt >= max) return { ok: false, error: err, attempts: attempt, stopped: false };
			const info: RetryInfo = { attempt, error: err, delayMs: backoffDelay(attempt, err, o) };
			o.onRetry?.(info);
			await o.sleep(info.delayMs);
			if (o.beforeRetry && (await o.beforeRetry(info)) === 'stop') {
				return { ok: false, error: err, attempts: attempt, stopped: true };
			}
		}
	}
}

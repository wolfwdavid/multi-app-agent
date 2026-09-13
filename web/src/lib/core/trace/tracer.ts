// Minimal span tracer. Pure: no I/O and no Node-only APIs (the JSONL file sink lives under scripts in Phase 4).
import type { TraceEvent, TraceStatus } from '../schemas.ts';

export interface TraceSink {
	write(e: TraceEvent): void;
}

export class MemorySink implements TraceSink {
	readonly events: TraceEvent[] = [];
	write(e: TraceEvent): void {
		this.events.push(e);
	}
}

export class CallbackSink implements TraceSink {
	private readonly cb: (e: TraceEvent) => void;
	constructor(cb: (e: TraceEvent) => void) {
		this.cb = cb;
	}
	write(e: TraceEvent): void {
		this.cb(e);
	}
}

export interface Tracer {
	readonly traceId: string;
	event(name: string, attrs?: Record<string, unknown>, status?: TraceStatus): void;
	span<T>(name: string, attrs: Record<string, unknown>, fn: (spanId: string) => Promise<T>): Promise<T>;
}

export function createTracer(opts: {
	sinks: TraceSink[];
	traceId?: string;
	now?: () => number;
}): Tracer {
	const traceId = opts.traceId ?? globalThis.crypto.randomUUID();
	const now = opts.now ?? Date.now;
	const stack: string[] = [];
	let counter = 0;

	const emit = (e: TraceEvent) => {
		for (const sink of opts.sinks) sink.write(e);
	};
	const parent = () => (stack.length ? stack[stack.length - 1] : undefined);

	return {
		traceId,
		event(name, attrs = {}, status) {
			const e: TraceEvent = {
				traceId,
				spanId: `s${++counter}`,
				name,
				kind: 'event',
				ts: now(),
				attrs: { ...attrs }
			};
			const p = parent();
			if (p) e.parentSpanId = p;
			if (status) e.status = status;
			emit(e);
		},
		async span(name, attrs, fn) {
			const spanId = `s${++counter}`;
			const parentSpanId = parent();
			const base = { traceId, spanId, name, ...(parentSpanId ? { parentSpanId } : {}) };
			const start = now();
			emit({ ...base, kind: 'start', ts: start, attrs: { ...attrs } });
			stack.push(spanId);
			try {
				const result = await fn(spanId);
				stack.pop();
				const end = now();
				emit({ ...base, kind: 'end', ts: end, durationMs: Math.max(0, end - start), status: 'ok', attrs: { ...attrs } });
				return result;
			} catch (err) {
				stack.pop();
				const end = now();
				emit({
					...base,
					kind: 'end',
					ts: end,
					durationMs: Math.max(0, end - start),
					status: 'error',
					attrs: { ...attrs, 'error.message': err instanceof Error ? err.message : String(err) }
				});
				throw err;
			}
		}
	};
}

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Action, TraceEvent } from './schemas.ts';
import { ConnectorError } from './connectors/types.ts';
import { createRegistry, defineTool } from './tools/registry.ts';
import { createTracer, MemorySink } from './trace/tracer.ts';

const validAction = {
	id: 'a1',
	app: 'notion',
	tool: 'notion.upsertTrackerRow',
	effect: 'write',
	schoolId: 'ucb',
	idempotencyKey: 'tp1-0123456789abcdef',
	payload: { title: 'UC Berkeley' },
	summary: 'Create tracker row for UC Berkeley'
};

function counterClock(values: number[]) {
	let i = 0;
	return () => values[Math.min(i++, values.length - 1)];
}

describe('Action schema', () => {
	it('accepts a valid write action and defaults dependsOn', () => {
		const r = Action.safeParse(validAction);
		expect(r.success).toBe(true);
		if (r.success) expect(r.data.dependsOn).toEqual([]);
	});

	it('rejects a malformed idempotency key', () => {
		const r = Action.safeParse({ ...validAction, idempotencyKey: 'bad-key' });
		expect(r.success).toBe(false);
	});
});

describe('tracer', () => {
	it('emits start and end events around an async span', async () => {
		const sink = new MemorySink();
		const tracer = createTracer({ sinks: [sink], traceId: 't1', now: counterClock([1000, 1005]) });
		const out = await tracer.span('step', { a: 1 }, async () => 42);
		expect(out).toBe(42);
		expect(sink.events.map((e) => e.kind)).toEqual(['start', 'end']);
		const end = sink.events[1];
		expect(end.status).toBe('ok');
		expect(end.durationMs).toBe(5);
		expect(end.durationMs).toBeGreaterThanOrEqual(0);
		for (const e of sink.events) expect(() => TraceEvent.parse(e)).not.toThrow();
	});

	it('records errors on the end event and rethrows', async () => {
		const sink = new MemorySink();
		const tracer = createTracer({ sinks: [sink], traceId: 't2', now: counterClock([1, 2]) });
		await expect(
			tracer.span('boom', {}, async () => {
				throw new Error('kaboom');
			})
		).rejects.toThrow('kaboom');
		const end = sink.events.find((e) => e.kind === 'end');
		expect(end?.status).toBe('error');
		expect(end?.attrs['error.message']).toBe('kaboom');
		for (const e of sink.events) expect(() => TraceEvent.parse(e)).not.toThrow();
	});

	it('nests spans and events under the current parent', async () => {
		const sink = new MemorySink();
		const tracer = createTracer({ sinks: [sink], traceId: 't3', now: () => 0 });
		await tracer.span('outer', {}, async (outerId) => {
			await tracer.span('inner', {}, async () => {
				tracer.event('note', { x: 1 });
			});
			expect(outerId).toBe('s1');
		});
		const inner = sink.events.find((e) => e.name === 'inner' && e.kind === 'start');
		const note = sink.events.find((e) => e.name === 'note');
		expect(inner?.parentSpanId).toBe('s1');
		expect(note?.parentSpanId).toBe(inner?.spanId);
		expect(sink.events.at(-1)?.name).toBe('outer');
		for (const e of sink.events) expect(() => TraceEvent.parse(e)).not.toThrow();
	});
});

describe('tool registry', () => {
	const mk = (name: string) =>
		defineTool({
			name,
			app: 'github',
			effect: 'read',
			description: `tool ${name}`,
			input: z.object({ username: z.string() }),
			output: z.array(z.string()),
			run: async () => []
		});

	it('get/has/list return registered tools', () => {
		const reg = createRegistry([mk('x'), mk('y')]);
		expect(reg.get('x')?.name).toBe('x');
		expect(reg.has('y')).toBe(true);
		expect(reg.has('z')).toBe(false);
		expect(reg.list().map((t) => t.name)).toEqual(['x', 'y']);
	});

	it('throws on duplicate tool names', () => {
		expect(() => createRegistry([mk('x'), mk('x')])).toThrow('Duplicate tool name: x');
	});
});

describe('ConnectorError', () => {
	it('exposes kind, status and retryAfterMs', () => {
		const err = new ConnectorError('rate_limit', 'slow down', { status: 429, retryAfterMs: 50 });
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ConnectorError);
		expect(err.kind).toBe('rate_limit');
		expect(err.status).toBe(429);
		expect(err.retryAfterMs).toBe(50);
		expect(err.message).toBe('slow down');
		expect(err.name).toBe('ConnectorError');
	});
});

import { describe, it, expect } from 'vitest';
import { createTracer, MemorySink } from './tracer.ts';

function setup() {
	const sink = new MemorySink();
	let t = 0;
	const tracer = createTracer({ sinks: [sink], traceId: 't', now: () => (t += 5) });
	return { sink, tracer };
}

describe('SpanControl', () => {
	it('merges end attrs and sets the end status', async () => {
		const { sink, tracer } = setup();
		const out = await tracer.span('x', { a: 1 }, async (_id, ctl) => {
			ctl.set({ attempt: 3, foundByKey: true });
			ctl.status('deduped');
			return 7;
		});
		expect(out).toBe(7);
		const [start, end] = sink.events;
		expect(start.kind).toBe('start');
		expect(start.attrs).toEqual({ a: 1 });
		expect(end.kind).toBe('end');
		expect(end.attrs).toEqual({ a: 1, attempt: 3, foundByKey: true });
		expect(end.status).toBe('deduped');
	});

	it('defaults to ok with start attrs when ctl is unused', async () => {
		const { sink, tracer } = setup();
		await tracer.span('y', { b: 2 }, async () => 1);
		const end = sink.events[1];
		expect(end.status).toBe('ok');
		expect(end.attrs).toEqual({ b: 2 });
	});

	it('keeps ctl attrs on error and rethrows', async () => {
		const { sink, tracer } = setup();
		await expect(
			tracer.span('z', { c: 3 }, async (_id, ctl) => {
				ctl.set({ attempt: 2 });
				ctl.status('deduped');
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		const end = sink.events[1];
		expect(end.status).toBe('error');
		expect(end.attrs).toEqual({ c: 3, attempt: 2, 'error.message': 'boom' });
	});

	it('nested spans each keep their own control', async () => {
		const { sink, tracer } = setup();
		await tracer.span('outer', {}, async (_o, outer) => {
			await tracer.span('inner', {}, async (_i, inner) => {
				inner.status('skipped');
				inner.set({ reason: 'policy' });
			});
			outer.set({ n: 1 });
		});
		const ends = sink.events.filter((e) => e.kind === 'end');
		expect(ends.map((e) => [e.name, e.status])).toEqual([
			['inner', 'skipped'],
			['outer', 'ok']
		]);
		expect(ends[0].attrs).toEqual({ reason: 'policy' });
		expect(ends[1].attrs).toEqual({ n: 1 });
	});
});

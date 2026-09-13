import { describe, it, expect } from 'vitest';
import { ev, sampleHeroRun, sampleSilentFailureRun } from './fixtures.ts';
import {
	toTraceRows,
	isRowTerminal,
	countRowSpans,
	rowAnnouncement,
	runAnnouncement,
	oracleStepIndex
} from './trace-rows.ts';

describe('toTraceRows (recorded sprint)', () => {
	const sample = sampleHeroRun();
	const rows = toTraceRows(sample.events, sample.plan);

	it('returns one row per action/readback span in start order with 1-based indexes', () => {
		expect(rows).toHaveLength(6);
		expect(rows.map((r) => r.index)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(rows.map((r) => r.spanId)).toEqual(['sA1', 'sA2', 'sA3', 'sR1', 'sR2', 'sR3']);
	});

	it('maps an OK first-attempt action with plan summary and latency', () => {
		const n1 = rows[0];
		expect(n1.kind).toBe('action');
		expect(n1.actionId).toBe('n1');
		expect(n1.status).toBe('ok');
		expect(n1.summary).toBe('Upsert tracker row for Berkeley');
		expect(typeof n1.durationMs).toBe('number');
		expect(n1.maxAttempts).toBe(3);
	});

	it('maps deduped with its retry attempt line', () => {
		const c1 = rows[1];
		expect(c1.status).toBe('deduped');
		expect(c1.attemptLines).toHaveLength(1);
	});

	it('maps an OK third attempt to retried with formatted attempt lines', () => {
		const g1 = rows[2];
		expect(g1.status).toBe('retried');
		expect(g1.attempt).toBe(3);
		expect(g1.attemptLines).toHaveLength(2);
		expect(g1.attemptLines.some((l) => l.includes('429') && l.includes('waited 50 ms'))).toBe(true);
		expect(g1.attemptLines[0]).toBe('try 1 · 429 rate limited · waited 50 ms · re-checked key: not found');
		expect(g1.attemptLines[1]).toContain('500 server error');
	});

	it('renders readback rows, failing the not-found read-back', () => {
		const rb = rows.slice(3);
		expect(rb.every((r) => r.kind === 'readback' && r.tool === 'readback')).toBe(true);
		expect(rb[0].status).toBe('ok');
		expect(rb[2].actionId).toBe('g1');
		expect(rb[2].status).toBe('failed');
		expect(rb[2].labelOverride).toBe('Not found');
		expect(rb[2].found).toBe(false);
		expect(rb[2].artifactStatus).toBe('mismatch');
	});
});

describe('toTraceRows (other statuses)', () => {
	const start = (spanId: string, attrs: Record<string, unknown> = {}) =>
		ev({ spanId, name: 'action.execute', kind: 'start', attrs: { actionId: spanId, app: 'notion', tool: 'notion.x', ...attrs } });
	const end = (spanId: string, status: 'ok' | 'error' | 'skipped' | 'deduped', attrs: Record<string, unknown> = {}) =>
		ev({ spanId, name: 'action.execute', kind: 'end', status, attrs: { actionId: spanId, app: 'notion', tool: 'notion.x', ...attrs } });

	it('maps skipped with a policy reason to blocked', () => {
		const rows = toTraceRows([start('a'), end('a', 'skipped', { reason: 'policy' })]);
		expect(rows[0].status).toBe('blocked');
	});

	it('omits skipped rows with other reasons and keeps indexes contiguous', () => {
		const rows = toTraceRows([
			start('a'),
			end('a', 'skipped', { reason: 'other' }),
			start('b'),
			end('b', 'error', { attempt: 3 })
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].spanId).toBe('b');
		expect(rows[0].index).toBe(1);
		expect(rows[0].status).toBe('failed');
	});

	it('marks a START without END as running', () => {
		const rows = toTraceRows([start('a')]);
		expect(rows[0].status).toBe('running');
	});

	it('never throws on unknown attrs', () => {
		const rows = toTraceRows([
			ev({ spanId: 'z', name: 'action.execute', kind: 'end', status: 'ok', attrs: { attempt: 'two', app: 42, tool: null } })
		]);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('ok');
	});
});

describe('row helpers', () => {
	const sample = sampleHeroRun();
	const rows = toTraceRows(sample.events, sample.plan);

	it('isRowTerminal is true only for action/readback END events', () => {
		expect(isRowTerminal(ev({ name: 'action.execute', kind: 'end' }))).toBe(true);
		expect(isRowTerminal(ev({ name: 'verify.readback', kind: 'end' }))).toBe(true);
		expect(isRowTerminal(ev({ name: 'action.execute', kind: 'start' }))).toBe(false);
		expect(isRowTerminal(ev({ name: 'retry', kind: 'event' }))).toBe(false);
		expect(isRowTerminal(ev({ name: 'verify', kind: 'end' }))).toBe(false);
		expect(countRowSpans(sample.events)).toBe(6);
	});

	it('announces rows and the run', () => {
		expect(rowAnnouncement(rows[2])).toBe('Step 3, Gmail gmail.createDraft: Retried ×3');
		expect(rowAnnouncement(rows[5])).toBe('Step 6, Gmail readback: Not found');
		expect(runAnnouncement(sample.report)).toBe('Run finished: 1 verified, 1 deduped, 1 failed.');
	});

	it('finds the oracle step index', () => {
		const sf = sampleSilentFailureRun();
		const sfRows = toTraceRows(sf.events);
		expect(oracleStepIndex(sfRows, 'sR2')).toBe(4);
		expect(oracleStepIndex(sfRows, 'nope')).toBe(sfRows.length);
	});
});

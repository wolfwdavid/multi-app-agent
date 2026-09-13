import { describe, it, expect, vi } from 'vitest';
import type { TraceEvent } from '../core/schemas.ts';
import { sampleHeroRun } from './fixtures.ts';
import { filterRecordedRun, createReplaySource, playEvents } from './sprint-source.ts';
import { countRowSpans, isRowTerminal } from './trace-rows.ts';
import { createPacer, ReplayCancelled } from './pacer.ts';

const flush = async (n = 3) => {
	for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('filterRecordedRun', () => {
	it('keeps everything when all writes are approved', () => {
		const file = sampleHeroRun();
		const r = filterRecordedRun(file, ['n1', 'c1', 'g1']);
		expect(r.events).toEqual(file.events);
		expect(r.report.counts).toEqual(file.report.counts);
		expect(r.report.status).toBe('partial');
	});

	it('drops unapproved action events and marks their artifacts not approved', () => {
		const file = sampleHeroRun();
		const r = filterRecordedRun(file, ['n1', 'c1']);
		expect(r.events.some((e) => e.attrs.actionId === 'g1')).toBe(false);
		expect(r.events.some((e) => e.name === 'plan.built')).toBe(true);
		expect(r.events.some((e) => e.name === 'run.end')).toBe(true);
		const g1 = r.report.artifacts.find((a) => a.actionId === 'g1');
		expect(g1?.status).toBe('skipped');
		expect(g1?.detail).toBe('not_approved');
		expect(r.report.counts).toEqual({ verified: 1, deduped: 1, failed: 0, skipped: 1 });
		expect(r.report.approvedIds).toEqual(['n1', 'c1']);
		expect(r.report.status).toBe('ok');
		// the recording itself is never mutated
		expect(file.report.artifacts[2].status).toBe('mismatch');
	});

	it('reports failed when nothing verified or deduped and something failed', () => {
		const file = sampleHeroRun();
		expect(filterRecordedRun(file, ['g1']).report.status).toBe('failed');
	});
});

describe('createReplaySource', () => {
	it('builds the recorded plan and plays filtered events with pacing after each row', async () => {
		const file = sampleHeroRun();
		const seen: TraceEvent[] = [];
		const pace = vi.fn(async () => {
			expect(isRowTerminal(seen[seen.length - 1])).toBe(true);
		});
		const src = createReplaySource(file, { pace });
		expect(src.kind).toBe('replay');
		const built = await src.buildPlan();
		expect(built.plan.planId).toBe('plan-1');
		expect(built.preflight).toEqual({ n1: 'new', c1: 'exists', g1: 'new' });

		const report = await src.execute(built.plan, ['n1', 'c1', 'g1'], (e) => seen.push(e));
		expect(seen).toEqual(file.events);
		expect(pace).toHaveBeenCalledTimes(countRowSpans(file.events));
		expect(report.status).toBe('partial');
	});

	it('exposes rerun only when recorded and estimates steps from the filtered run', async () => {
		const file = sampleHeroRun();
		const src = createReplaySource(file, { pace: async () => {} });
		expect(src.rerun).toBeDefined();
		const rr = await src.rerun!();
		expect(rr.report.status).toBe('ok');
		expect(src.estimateSteps?.(['n1'])).toBe(countRowSpans(filterRecordedRun(file, ['n1']).events));
		expect(src.estimateSteps?.(['n1'])).toBe(2);

		const { rerun: _drop, ...noRerun } = file;
		expect(createReplaySource(noRerun, { pace: async () => {} }).rerun).toBeUndefined();
	});

	it('rerun with approved ids replays only those actions', async () => {
		const src = createReplaySource(sampleHeroRun(), { pace: async () => {} });
		const rr = await src.rerun!(['n1']);
		expect(rr.events.some((e) => e.attrs.actionId === 'g1' || e.attrs.actionId === 'c1')).toBe(false);
		expect(rr.report.counts).toEqual({ verified: 0, deduped: 1, failed: 0, skipped: 2 });
		expect(rr.report.status).toBe('ok');
	});

	it('playEvents stops with ReplayCancelled when aborted mid-way', async () => {
		const file = sampleHeroRun();
		const controller = new AbortController();
		const seen: TraceEvent[] = [];
		let paces = 0;
		const pace = async () => {
			paces += 1;
			if (paces === 2) controller.abort();
		};
		await expect(playEvents(file.events, (e) => seen.push(e), pace, controller.signal)).rejects.toBeInstanceOf(
			ReplayCancelled
		);
		const secondTerminal = file.events.filter(isRowTerminal)[1];
		expect(seen[seen.length - 1]).toBe(secondTerminal);
	});
});

describe('pacer', () => {
	it('sleeps the interval while playing and honors setIntervalMs', async () => {
		const sleep = vi.fn(async (_ms: number) => {});
		const p = createPacer({ sleep });
		await p.pace();
		expect(sleep).toHaveBeenLastCalledWith(400);
		p.setIntervalMs(100);
		expect(p.intervalMs).toBe(100);
		await p.pace();
		expect(sleep).toHaveBeenLastCalledWith(100);
	});

	it('holds paces while paused; step releases one, play releases all', async () => {
		const p = createPacer({ sleep: async () => {} });
		p.pause();
		expect(p.playing).toBe(false);
		let a = false;
		let b = false;
		p.pace().then(() => (a = true));
		p.pace().then(() => (b = true));
		await flush();
		expect(a || b).toBe(false);
		p.step();
		await flush();
		expect([a, b].filter(Boolean)).toHaveLength(1);
		p.play();
		await flush();
		expect(a && b).toBe(true);
	});

	it('cancel rejects pending paces; reset allows pacing again', async () => {
		const p = createPacer({ sleep: async () => {} });
		p.pause();
		const pending = p.pace();
		p.cancel();
		await expect(pending).rejects.toBeInstanceOf(ReplayCancelled);
		await expect(p.pace()).rejects.toBeInstanceOf(ReplayCancelled);
		p.reset();
		p.play();
		await expect(p.pace()).resolves.toBeUndefined();
	});

	it('notifies onChange listeners on play and pause', () => {
		const p = createPacer({ sleep: async () => {} });
		const fn = vi.fn();
		const off = p.onChange(fn);
		p.pause();
		p.play();
		expect(fn).toHaveBeenNthCalledWith(1, false);
		expect(fn).toHaveBeenNthCalledWith(2, true);
		off();
		p.pause();
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

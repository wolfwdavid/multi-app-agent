// Sprint data source for steps 3-5. Pure: no $app/svelte imports.
import type { ArtifactResult, Plan, Profile, RunReport, TraceEvent } from '../core/schemas.ts';
import type { HeroRunFile } from './data.ts';
import { ReplayCancelled } from './pacer.ts';
import { countRowSpans, isRowTerminal } from './trace-rows.ts';

/**
 * One interface for plan → execute → rerun. Phase 7 ships ReplaySource over data/hero-run.json.
 * Phase 9 adds LiveSource (`POST /api/plan`, `POST /api/execute` SSE) implementing this same
 * interface, so components never change.
 */
export interface SprintSource {
	kind: 'live' | 'replay';
	buildPlan(profile?: Profile): Promise<{ plan: Plan; preflight?: Record<string, 'new' | 'exists'> }>;
	execute(
		plan: Plan,
		approvedIds: string[],
		onEvent: (e: TraceEvent) => void,
		signal?: AbortSignal
	): Promise<RunReport>;
	/** Re-run the same plan. With `approvedIds`, only those actions (same approval as the first run). */
	rerun?(approvedIds?: string[]): Promise<{ events: TraceEvent[]; report: RunReport }>;
	estimateSteps?(approvedIds: string[]): number;
}

function countArtifacts(artifacts: readonly ArtifactResult[]): RunReport['counts'] {
	const counts = { verified: 0, deduped: 0, failed: 0, skipped: 0 };
	for (const a of artifacts) {
		if (a.status === 'verified') counts.verified += 1;
		else if (a.status === 'deduped') counts.deduped += 1;
		else if (a.status === 'failed' || a.status === 'mismatch') counts.failed += 1; // mismatch counts as failed (04-02)
		else counts.skipped += 1;
	}
	return counts;
}

function runStatus(c: RunReport['counts']): RunReport['status'] {
	if (c.failed > 0 && c.verified + c.deduped === 0) return 'failed';
	if (c.failed > 0) return 'partial';
	return 'ok';
}

/** The recorded run as if only `approvedIds` had been approved. Read actions never need approval. */
export function filterRecordedRun(
	file: HeroRunFile,
	approvedIds: readonly string[]
): { events: TraceEvent[]; report: RunReport } {
	const keep = new Set(approvedIds);
	for (const a of file.plan.actions) if (a.effect === 'read') keep.add(a.id);

	const events = file.events.filter((e) => {
		const id = e.attrs.actionId;
		return typeof id !== 'string' || keep.has(id);
	});
	const artifacts = file.report.artifacts.map((a) =>
		keep.has(a.actionId) ? a : { ...a, status: 'skipped' as const, detail: 'not_approved' }
	);
	const counts = countArtifacts(artifacts);
	return {
		events,
		report: { ...file.report, approvedIds: [...approvedIds], artifacts, counts, status: runStatus(counts) }
	};
}

/** Emit events in order, waiting on `pace` after each row-terminal event. */
export function playEvents(
	events: readonly TraceEvent[],
	onEvent: (e: TraceEvent) => void,
	pace: () => Promise<void>,
	signal?: AbortSignal
): Promise<void> {
	return (async () => {
		for (const e of events) {
			if (signal?.aborted) throw new ReplayCancelled();
			onEvent(e);
			if (isRowTerminal(e)) await pace();
		}
	})();
}

export function createReplaySource(file: HeroRunFile, opts: { pace: () => Promise<void> }): SprintSource {
	const rerun = file.rerun;
	return {
		kind: 'replay',
		async buildPlan() {
			return { plan: file.plan, preflight: file.preflight };
		},
		async execute(_plan, approvedIds, onEvent, signal) {
			const { events, report } = filterRecordedRun(file, approvedIds);
			await playEvents(events, onEvent, opts.pace, signal);
			return report;
		},
		rerun: rerun
			? async (approvedIds) =>
					approvedIds ? filterRecordedRun({ ...file, events: rerun.events, report: rerun.report }, approvedIds) : rerun
			: undefined,
		estimateSteps(approvedIds) {
			return countRowSpans(filterRecordedRun(file, approvedIds).events);
		}
	};
}

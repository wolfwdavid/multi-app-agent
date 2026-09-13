// Recorded-run file contract (07-UI-SPEC "Static recording files"). Phase 7's ReplaySource parses
// static/data/hero-run.json with HeroRunFile; Phase 6 extends the same shape with an `oracle` block
// for silent-failure-run.json. Everything written through buildHeroRunFile is PII-redacted.
import { z } from 'zod';
import { Plan, RunReport, TraceEvent } from '../schemas.ts';
import type { Profile } from '../schemas.ts';
import type { Connectors } from '../connectors/types.ts';
import { getWriteTool } from '../tools/sprint-tools.ts';
import { piiFromProfile, redactTraceEvent, redactValue } from '../trace/redact.ts';

export const RecordedRun = z.object({ events: z.array(TraceEvent), report: RunReport });
export type RecordedRun = z.infer<typeof RecordedRun>;

export const PreflightStatus = z.enum(['new', 'exists']);
export type PreflightStatus = z.infer<typeof PreflightStatus>;

export const HeroRunFile = z.object({
	recordedAt: z.iso.datetime(),
	commitSha: z.string().min(1),
	profileId: z.string().min(1),
	plan: Plan,
	preflight: z.record(z.string(), PreflightStatus).optional(),
	events: z.array(TraceEvent),
	report: RunReport,
	rerun: RecordedRun.optional()
});
export type HeroRunFile = z.infer<typeof HeroRunFile>;

/** Read-only findByKey per action (no writes). Used for the UI's "New" / "Exists: will dedupe" badges. */
export async function preflightPlan(connectors: Connectors, plan: Plan): Promise<Record<string, PreflightStatus>> {
	const out: Record<string, PreflightStatus> = {};
	// Sequential on purpose: real Notion rate-limits bursts.
	for (const a of plan.actions) {
		const tool = getWriteTool(a.tool);
		if (!tool) {
			out[a.id] = 'new';
			continue;
		}
		try {
			out[a.id] = (await tool.findByKey({ connectors }, a.idempotencyKey)) ? 'exists' : 'new';
		} catch {
			out[a.id] = 'new';
		}
	}
	return out;
}

/** Redacts student PII (plan payloads, events, report details) and validates against HeroRunFile. Phase 6 extends this shape with an `oracle` block for silent-failure-run.json. */
export function buildHeroRunFile(input: {
	recordedAt: string;
	commitSha: string;
	profile: Profile;
	plan: Plan;
	preflight?: Record<string, PreflightStatus>;
	events: TraceEvent[];
	report: RunReport;
	rerun?: { events: TraceEvent[]; report: RunReport };
}): HeroRunFile {
	const pii = piiFromProfile(input.profile);
	const { rerun } = input;
	return HeroRunFile.parse({
		recordedAt: input.recordedAt,
		commitSha: input.commitSha,
		profileId: input.profile.profile_id,
		plan: redactValue(input.plan, pii),
		...(input.preflight ? { preflight: input.preflight } : {}),
		events: input.events.map((e) => redactTraceEvent(e, pii)),
		report: redactValue(input.report, pii),
		...(rerun
			? { rerun: { events: rerun.events.map((e) => redactTraceEvent(e, pii)), report: redactValue(rerun.report, pii) } }
			: {})
	});
}

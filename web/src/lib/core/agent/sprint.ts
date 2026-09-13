// Sprint orchestration: plan -> approve -> execute -> verify -> report.
//
// Plan-then-execute: the plan is fixed and HMAC-signed (with the recipient allowlist bound in)
// BEFORE anything runs. Execution only accepts that signed plan plus a subset of its action ids,
// so untrusted content (essays, inbox, LLM output) can never add actions or recipients.
//
// This is the single entry used by the CLI (scripts/sprint.ts), evals (Phase 6), REST routes
// (Phase 9: /api/plan -> planSprint, /api/execute -> executeSprint with a CallbackSink streaming
// SSE) and the MCP server (Phase 11). The core never logs and never reads env; entry points
// inject the secret, clock and tracer sinks.
import { Plan } from '../schemas.ts';
import type { Profile, RunReport, SchoolsDataset } from '../schemas.ts';
import type { Connectors } from '../connectors/types.ts';
import type { LLM } from '../llm/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import { analyzeGaps } from '../gap/index.ts';
import { buildPlan } from './planner.ts';
import { authorizeExecution, recipientAllowlistFromProfile, signPlan } from './policy.ts';
import { executePlan, type ExecContext } from './executor.ts';
import { buildRunReport, verifyOutcomes } from './verifier.ts';
import { PolicyError, TRACE, type Authorization, type PlanResult, type SprintLimits } from './types.ts';

export interface SprintRuntime {
	connectors: Connectors;
	mode: 'mock' | 'real';
	llm: LLM;
	tracer: Tracer;
	/** HMAC secret, injected by the entry point (CLI env / Vercel env). Core never reads env. */
	planSecret: string;
	/** YYYY-MM-DD. Injected for determinism. */
	today: string;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	limits?: Partial<SprintLimits>;
	repairArgs?: ExecContext['repairArgs'];
}

export function allActionIds(plan: Plan): string[] {
	return plan.actions.map((a) => a.id);
}

/** Gap analysis + plan + signature. Makes no connector calls. */
export async function planSprint(
	rt: SprintRuntime,
	input: { profile: Profile; schools: SchoolsDataset; createdAt: string }
): Promise<PlanResult> {
	const { profile, schools, createdAt } = input;
	return rt.tracer.span(TRACE.planSpan, { profileId: profile.profile_id, targets: profile.targets.length }, async () => {
		const reports = analyzeGaps(profile, schools, { today: rt.today });
		const plan = await buildPlan({ profile, schools, reports, today: rt.today, createdAt, llm: rt.llm, tracer: rt.tracer });
		const planToken = await signPlan(plan, rt.planSecret, recipientAllowlistFromProfile(profile));
		rt.tracer.event(TRACE.planDryRun, {
			planId: plan.planId,
			actions: plan.actions.map((a) => ({ id: a.id, app: a.app, tool: a.tool, key: a.idempotencyKey, summary: a.summary }))
		});
		return { plan, planToken, reports };
	});
}

/** Authorize (token + approved ids + allowlist), execute, read back, report. Throws PolicyError before any write. */
export async function executeSprint(
	rt: SprintRuntime,
	input: { plan: unknown; planToken: string; approvedIds: string[]; profile: Profile; runId?: string }
): Promise<RunReport> {
	const clockMs = rt.now ?? Date.now;
	const startedAt = new Date(clockMs()).toISOString();
	const allowlist = recipientAllowlistFromProfile(input.profile);

	let auth: Authorization;
	try {
		auth = await authorizeExecution({
			plan: input.plan,
			planToken: input.planToken,
			approvedIds: input.approvedIds,
			secret: rt.planSecret,
			recipientAllowlist: allowlist
		});
	} catch (err) {
		if (err instanceof PolicyError) {
			rt.tracer.event(TRACE.policyRejected, { code: err.code, message: err.message, details: err.details }, 'error');
		}
		throw err;
	}

	const plan = Plan.parse(input.plan);
	rt.tracer.event(TRACE.policyAuthorized, {
		planId: plan.planId,
		approved: auth.approved.length,
		skipped: auth.skipped.length,
		blocked: auth.blocked.length
	});

	const { connectors, tracer } = rt;
	const exec = await tracer.span(TRACE.executeSpan, { planId: plan.planId }, () =>
		executePlan(
			{
				connectors,
				tracer,
				recipientAllowlist: auth.recipientAllowlist,
				now: rt.now,
				sleep: rt.sleep,
				limits: rt.limits,
				repairArgs: rt.repairArgs
			},
			plan,
			auth
		)
	);
	const artifacts = await verifyOutcomes({ connectors, tracer, sleep: rt.sleep, limits: rt.limits }, plan, exec);
	const runId = input.runId ?? `run-${tracer.traceId}`;
	const report = buildRunReport({
		runId,
		traceId: tracer.traceId,
		plan,
		auth,
		exec,
		artifacts,
		mode: rt.mode,
		startedAt,
		finishedAt: new Date(clockMs()).toISOString()
	});
	tracer.event(TRACE.runEnd, { runId, status: report.status, counts: report.counts }, report.status === 'ok' ? 'ok' : 'error');
	return report;
}

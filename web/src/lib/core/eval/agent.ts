// Agent adapter for evals.
// verifier-off is the deliberately weakened "before" agent (ARCHITECTURE Pattern 6). Its report trusts
// executor return values, so a lying API produces an 'ok' report over a World that is missing artifacts.
// The oracle must catch that as a communication failure.
import type { ArtifactResult, Plan, RunReport, TraceEvent } from '../schemas.ts';
import type { WorldState } from '../connectors/index.ts';
import type { LLM } from '../llm/types.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import {
	authorizeExecution,
	buildRunReport,
	executePlan,
	executeSprint,
	planSprint,
	recipientAllowlistFromProfile,
	type ExecutionResult,
	type SprintRuntime
} from '../agent/index.ts';
import { buildLlmScript } from './llm-scripts.ts';
import { EVAL_PLAN_SECRET, noSleep, tickClock, type PreparedRun } from './setup.ts';
import type { AgentConfig } from './types.ts';

export interface AgentPass {
	index: number;
	today: string;
	plan: Plan | null;
	report: RunReport | null;
	error: { name: string; code?: string; message: string } | null;
	events: TraceEvent[];
	worldAfter: WorldState;
}
export interface AgentRun {
	scenarioId: string;
	runIndex: number;
	config: AgentConfig;
	model: string;
	passes: AgentPass[];
}

export function selfReportArtifacts(exec: ExecutionResult): ArtifactResult[] {
	return exec.outcomes.map((o) => {
		const status: ArtifactResult['status'] =
			o.kind === 'created' || o.kind === 'updated'
				? 'verified'
				: o.kind === 'deduped'
					? 'deduped'
					: o.kind === 'skipped'
						? 'skipped'
						: 'failed';
		return {
			actionId: o.actionId,
			app: o.app,
			idempotencyKey: o.idempotencyKey,
			status,
			attempts: o.attempts,
			...(o.ref ? { ref: o.ref } : {}),
			...(o.detail ? { detail: o.detail } : {})
		};
	});
}

export async function runAgent(prepared: PreparedRun, config: AgentConfig, opts?: { llm?: () => LLM }): Promise<AgentRun> {
	const { scenario, runIndex, profile } = prepared;
	const passes: AgentPass[] = [];
	let model = '';
	for (let i = 0; i < prepared.passes.length; i++) {
		const pass = prepared.passes[i]!;
		const sink = new MemorySink();
		const clock = tickClock();
		const tracer = createTracer({ sinks: [sink], traceId: `eval-${scenario.id}-r${runIndex}-${config.id}-p${i}`, now: clock });
		const llm = opts?.llm ? opts.llm() : createFakeLLM(buildLlmScript(scenario.llm ?? 'default'));
		if (i === 0) model = llm.model;
		const rt: SprintRuntime = {
			connectors: prepared.connectorsForPass(i),
			mode: 'mock',
			llm,
			tracer,
			planSecret: EVAL_PLAN_SECRET,
			today: pass.today,
			now: clock,
			sleep: noSleep
		};
		let plan: Plan | null = null;
		let report: RunReport | null = null;
		let error: AgentPass['error'] = null;
		try {
			const planned = await planSprint(rt, { profile, schools: pass.schools, createdAt: `${pass.today}T17:00:00.000Z` });
			plan = planned.plan;
			const approvedIds = prepared.approvedIdsFor(planned.plan);
			const runId = tracer.traceId;
			if (config.verifier === 'on') {
				report = await executeSprint(rt, { plan: planned.plan, planToken: planned.planToken, approvedIds, profile, runId });
			} else {
				const allow = recipientAllowlistFromProfile(profile);
				const auth = await authorizeExecution({
					plan: planned.plan,
					planToken: planned.planToken,
					approvedIds,
					secret: EVAL_PLAN_SECRET,
					recipientAllowlist: allow
				});
				const startedAt = new Date(clock()).toISOString();
				const exec = await executePlan(
					{ connectors: rt.connectors, tracer, recipientAllowlist: auth.recipientAllowlist, now: clock, sleep: noSleep },
					planned.plan,
					auth
				);
				report = buildRunReport({
					runId,
					traceId: tracer.traceId,
					plan: planned.plan,
					auth,
					exec,
					artifacts: selfReportArtifacts(exec),
					mode: 'mock',
					startedAt,
					finishedAt: new Date(clock()).toISOString()
				});
			}
		} catch (err) {
			const e = err as { name?: string; code?: string; message?: string };
			error = { name: e?.name ?? 'Error', ...(e?.code ? { code: e.code } : {}), message: e?.message ?? String(err) };
			report = null;
		}
		passes.push({ index: i, today: pass.today, plan, report, error, events: sink.events, worldAfter: prepared.world.snapshot() });
	}
	return { scenarioId: scenario.id, runIndex, config, model, passes };
}

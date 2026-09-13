// Read-back verifier and run report.
//
// The report is built ONLY from what the apps return on read-back, never from executor intent. It
// goes through the connector read path directly (WriteToolDef.findByKey + diff), with no LLM. A write
// reported as successful but absent on read-back is a `mismatch` ("reported OK, not found on
// read-back"): the silent failure (lying success) Phase 6 must catch.
import { ArtifactResult, RunReport, type Blocker, type Plan } from '../schemas.ts';
import type { Connectors } from '../connectors/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import { getWriteTool } from '../tools/sprint-tools.ts';
import { toErrorInfo, withRetry } from './retry.ts';
import { DEFAULT_LIMITS, DETAIL, TRACE, type Authorization, type ExecutionResult, type SprintLimits } from './types.ts';

export interface VerifyContext {
	connectors: Connectors;
	tracer: Tracer;
	sleep?: (ms: number) => Promise<void>;
	limits?: Partial<SprintLimits>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function verifyOutcomes(ctx: VerifyContext, plan: Plan, exec: ExecutionResult): Promise<ArtifactResult[]> {
	const limits: SprintLimits = { ...DEFAULT_LIMITS, ...ctx.limits };
	const retryOpts = {
		maxAttempts: limits.maxAttempts,
		baseDelayMs: limits.baseDelayMs,
		maxDelayMs: limits.maxDelayMs,
		sleep: ctx.sleep ?? defaultSleep
	};
	const tctx = { connectors: ctx.connectors };

	return ctx.tracer.span(TRACE.verifySpan, { planId: plan.planId, outcomes: exec.outcomes.length }, async (_id, vctl) => {
		const results: ArtifactResult[] = [];
		for (const o of exec.outcomes) {
			const base = {
				actionId: o.actionId,
				app: o.app,
				idempotencyKey: o.idempotencyKey,
				attempts: o.attempts,
				...(o.ref ? { ref: o.ref } : {})
			};
			const detail = o.detail ? { detail: o.detail } : {};

			if (o.kind === 'skipped') {
				results.push({ ...base, status: 'skipped', ...detail });
				continue;
			}
			if (o.kind === 'blocked' || o.kind === 'failed') {
				results.push({ ...base, status: 'failed', ...detail });
				continue;
			}

			// created | updated | deduped: grade by reading the target app back.
			const result = await ctx.tracer.span(
				TRACE.readbackSpan,
				{ actionId: o.actionId, app: o.app, tool: o.tool, key: o.idempotencyKey },
				async (_sid, ctl): Promise<ArtifactResult> => {
					const tool = getWriteTool(o.tool);
					if (!tool) {
						ctl.set({ found: false, artifactStatus: 'failed' });
						ctl.status('error');
						return { ...base, status: 'failed', detail: `${DETAIL.readBackError}: unknown tool ${o.tool}` };
					}
					const r = await withRetry(() => tool.findByKey(tctx, o.idempotencyKey), retryOpts);
					if (!r.ok) {
						const e = toErrorInfo(r.error);
						ctl.set({
							found: false,
							artifactStatus: 'failed',
							'error.kind': e.kind,
							...(e.status !== undefined ? { 'error.status': e.status } : {})
						});
						ctl.status('error');
						return { ...base, status: 'failed', detail: `${DETAIL.readBackError}: ${e.kind} ${e.message}` };
					}
					if (r.value === null) {
						ctl.set({ found: false, artifactStatus: 'mismatch' });
						ctl.status('error');
						return {
							...base,
							status: 'mismatch',
							detail: `${DETAIL.readBackMissing}: ${o.tool} reported success but no artifact with key ${o.idempotencyKey} exists`
						};
					}
					const fields = o.args ? tool.diff(o.args, r.value) : [];
					if (fields.length > 0) {
						ctl.set({ found: true, artifactStatus: 'mismatch', fields });
						ctl.status('error');
						return { ...base, ref: r.value.ref, status: 'mismatch', detail: `${DETAIL.readBackMismatch}: ${fields.join(',')}` };
					}
					const status = o.kind === 'deduped' ? 'deduped' : 'verified';
					ctl.set({ found: true, artifactStatus: status });
					ctl.status(status === 'deduped' ? 'deduped' : 'ok');
					return { ...base, ref: r.value.ref, status, ...detail };
				}
			);
			results.push(result);
		}
		const tally = (s: ArtifactResult['status']) => results.filter((a) => a.status === s).length;
		vctl.set({
			verified: tally('verified'),
			deduped: tally('deduped'),
			mismatch: tally('mismatch'),
			failed: tally('failed'),
			skipped: tally('skipped')
		});
		return ArtifactResult.array().parse(results);
	});
}

export function buildRunReport(input: {
	runId: string;
	traceId: string;
	plan: Plan;
	auth: Authorization;
	exec: ExecutionResult;
	artifacts: ArtifactResult[];
	mode: 'mock' | 'real';
	startedAt: string;
	finishedAt: string;
}): RunReport {
	const { plan, auth, exec, artifacts } = input;
	const n = (s: ArtifactResult['status']) => artifacts.filter((a) => a.status === s).length;
	// The contract has no mismatch count; mismatches count as failed and the UI reads them from artifacts.
	const counts = { verified: n('verified'), deduped: n('deduped'), failed: n('failed') + n('mismatch'), skipped: n('skipped') };

	const blockers: Blocker[] = [
		...plan.blockers,
		...auth.blocked.map((b) => ({
			code: 'POLICY_BLOCKED',
			message: `${b.action.id}: ${b.reason}`,
			...(b.action.schoolId !== undefined ? { schoolId: b.action.schoolId } : {}),
			...(b.action.programId !== undefined ? { programId: b.action.programId } : {})
		})),
		...(exec.halted
			? [
					{
						code:
							exec.halted.reason === 'step_cap'
								? 'STEP_CAP_REACHED'
								: 'RETRY_LOOP_DETECTED',
						message: exec.halted.detail
					}
				]
			: [])
	];

	const problems = counts.failed + (exec.halted ? 1 : 0);
	const successes = counts.verified + counts.deduped;
	const status = problems === 0 ? 'ok' : successes > 0 ? 'partial' : 'failed';

	return RunReport.parse({
		runId: input.runId,
		traceId: input.traceId,
		planId: plan.planId,
		mode: input.mode,
		startedAt: input.startedAt,
		finishedAt: input.finishedAt,
		approvedIds: auth.approvedIds,
		artifacts,
		blockers,
		flags: plan.flags,
		counts,
		status
	});
}

// Plan executor.
//
// The executor never reads untrusted content and never adds actions: it only runs actions the
// policy gate authorized, in dependency order. Idempotency lives in the target app (findByKey), not
// in memory, so re-runs across processes dedupe too. Before every write AND before every retry the
// key is re-checked, which turns ghost writes (5xx after commit) into recoveries, not duplicates.
// Span attrs follow the 07-UI-SPEC trace contract (see the TRACE mapping comment in types.ts).
import type { Action, ConnectorErrorInfo, Plan, TraceStatus } from '../schemas.ts';
import type { Connectors } from '../connectors/types.ts';
import type { SpanControl, Tracer } from '../trace/tracer.ts';
import { getWriteTool, type FoundArtifact } from '../tools/sprint-tools.ts';
import { checkActionPolicy, topoOrder } from './policy.ts';
import { toErrorInfo, withRetry, type RetryResult } from './retry.ts';
import { createLoopGuard, createStepBudget, LoopDetectedError, StepCapError } from './guards.ts';
import {
	DEFAULT_LIMITS,
	DETAIL,
	TRACE,
	type Authorization,
	type ExecOutcome,
	type ExecOutcomeKind,
	type ExecutionResult,
	type PolicyViolationCode,
	type SkipReason,
	type SprintLimits
} from './types.ts';

export interface ExecContext {
	connectors: Connectors;
	tracer: Tracer;
	recipientAllowlist: string[];
	/** Latency only. */
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	limits?: Partial<SprintLimits>;
	/** Argument repair slot (FakeLLM or real LLM in later phases). One attempt; the result is re-validated and re-policy-checked. */
	repairArgs?: (action: Action, issues: string) => Promise<Record<string, unknown> | null>;
}

type Base = Pick<ExecOutcome, 'actionId' | 'app' | 'tool' | 'idempotencyKey'>;
interface ActionState {
	attempts: number;
	foundByKey?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function defaultNow(): () => number {
	const perf = globalThis.performance;
	return perf && typeof perf.now === 'function' ? () => perf.now() : Date.now;
}

const isGuardError = (e: unknown): e is StepCapError | LoopDetectedError =>
	e instanceof StepCapError || e instanceof LoopDetectedError;

const reasonFor = (code: PolicyViolationCode): SkipReason =>
	code === 'recipient_not_allowlisted' ? 'allowlist' : 'policy';

function statusFor(kind: ExecOutcomeKind): TraceStatus {
	if (kind === 'created' || kind === 'updated') return 'ok';
	if (kind === 'deduped') return 'deduped';
	if (kind === 'failed') return 'error';
	return 'skipped';
}

function errorAttrs(e: ConnectorErrorInfo, withMessage = false): Record<string, unknown> {
	return {
		'error.kind': e.kind,
		...(e.status !== undefined ? { 'error.status': e.status } : {}),
		...(withMessage ? { 'error.message': e.message } : {}),
		...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {})
	};
}

const statusSuffix = (e: ConnectorErrorInfo) => (e.status !== undefined ? ` ${e.status}` : '');

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
	return error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ');
}

function publish(ctl: SpanControl, o: ExecOutcome, foundByKey: boolean | undefined): void {
	ctl.set({
		attempt: o.attempts,
		outcome: o.kind,
		...(o.reason ? { reason: o.reason } : {}),
		...(o.detail ? { detail: o.detail } : {}),
		...(o.ref ? { refId: o.ref.id } : {}),
		...(o.error ? errorAttrs(o.error) : {}),
		...(foundByKey !== undefined ? { foundByKey } : {})
	});
	ctl.status(statusFor(o.kind));
}

export async function executePlan(ctx: ExecContext, plan: Plan, auth: Authorization): Promise<ExecutionResult> {
	const limits: SprintLimits = { ...DEFAULT_LIMITS, ...ctx.limits };
	const budget = createStepBudget(limits.maxSteps);
	const guard = createLoopGuard(limits.maxAttempts);
	const now = ctx.now ?? defaultNow();
	const retryOpts = {
		maxAttempts: limits.maxAttempts,
		baseDelayMs: limits.baseDelayMs,
		maxDelayMs: limits.maxDelayMs,
		sleep: ctx.sleep ?? defaultSleep
	};
	const tctx = { connectors: ctx.connectors };
	const { tracer } = ctx;

	const planIds = new Set(plan.actions.map((a) => a.id));
	const authIds = [...auth.approved.map((a) => a.id), ...auth.skipped.map((a) => a.id), ...auth.blocked.map((b) => b.action.id)];
	for (const id of authIds) {
		if (!planIds.has(id)) throw new Error(`executePlan: authorization references action ${id} that is not in plan ${plan.planId}`);
	}

	const approved = new Map(auth.approved.map((a) => [a.id, a]));
	const blocked = new Map(auth.blocked.map((b) => [b.action.id, b]));
	const outcomes = new Map<string, ExecOutcome>();
	let halted: ExecutionResult['halted'] = null;

	const spanAttrs = (a: Action) => ({
		actionId: a.id,
		app: a.app,
		tool: a.tool,
		key: a.idempotencyKey,
		maxAttempts: limits.maxAttempts
	});

	const blockedOutcome = (base: Base, code: PolicyViolationCode, reason: string): ExecOutcome => {
		tracer.event(TRACE.policyBlocked, { actionId: base.actionId, code, reason }, 'skipped');
		return { ...base, kind: 'blocked', attempts: 0, detail: `${DETAIL.blockedByPolicy}:${code}: ${reason}`, reason: reasonFor(code) };
	};

	async function runAction(action: Action, base: Base, st: ActionState): Promise<ExecOutcome> {
		const tool = getWriteTool(action.tool);
		if (!tool) return blockedOutcome(base, 'unknown_tool', `tool ${action.tool} is not a registered write tool`);
		const key = action.idempotencyKey;

		// a. Validate args (the key is always forced from the action, so a repair cannot change it).
		let parsed = tool.input.safeParse({ ...action.payload, key });
		if (!parsed.success) {
			const issues = formatIssues(parsed.error);
			const invalid = (msg: string): ExecOutcome => ({ ...base, kind: 'failed', attempts: 0, detail: `${DETAIL.invalidArgs}: ${msg}` });
			if (!ctx.repairArgs) return invalid(issues);
			const repaired = await ctx.repairArgs(action, issues);
			tracer.event(TRACE.argsRepair, { actionId: action.id, issues, repaired: repaired !== null });
			if (repaired === null) return invalid(issues);
			const reparsed = tool.input.safeParse({ ...repaired, key });
			if (!reparsed.success) return invalid(formatIssues(reparsed.error));
			const v = checkActionPolicy({ ...action, payload: repaired }, ctx.recipientAllowlist);
			if (v) return blockedOutcome(base, v.code, v.reason);
			parsed = reparsed;
		}
		const args = parsed.data as Record<string, unknown>;

		// b. One counted, traced connector call.
		const call = async <T>(
			method: 'findByKey' | 'run',
			attempt: number,
			fn: () => Promise<T>,
			summarize: (v: T) => unknown,
			callArgs?: Record<string, unknown>
		): Promise<T> => {
			budget.take(`${tool.name}.${method}`);
			const t0 = now();
			const attrs = { actionId: action.id, tool: tool.name, method, attempt, ...(callArgs ? { args: callArgs } : {}) };
			try {
				const v = await fn();
				tracer.event(TRACE.toolCall, { ...attrs, latencyMs: Math.max(0, now() - t0), result: summarize(v) }, 'ok');
				return v;
			} catch (err) {
				tracer.event(TRACE.toolCall, { ...attrs, latencyMs: Math.max(0, now() - t0), ...errorAttrs(toErrorInfo(err), true) }, 'error');
				throw err;
			}
		};

		// c. findByKey with retries; guard errors always propagate.
		const findWithRetry = async (): Promise<RetryResult<FoundArtifact | null>> => {
			const r = await withRetry(
				(n) =>
					call('findByKey', n, () => tool.findByKey(tctx, key), (f: FoundArtifact | null) => ({
						found: !!f,
						...(f ? { ref: f.ref } : {})
					})),
				retryOpts
			);
			if (!r.ok && isGuardError(r.error)) throw r.error;
			if (r.ok) st.foundByKey = !!r.value;
			return r;
		};

		const findFailed = (error: unknown): ExecOutcome => {
			const e = toErrorInfo(error);
			return {
				...base,
				kind: 'failed',
				attempts: st.attempts,
				args,
				error: e,
				detail: `${DETAIL.integrationFailure}: findByKey ${e.kind}${statusSuffix(e)}: ${e.message}`
			};
		};

		// d. Pre-check.
		const pre = await findWithRetry();
		if (!pre.ok) return findFailed(pre.error);
		let updating = false;
		if (pre.value) {
			if (tool.mode === 'upsert' && tool.diff(args, pre.value).length > 0) {
				updating = true;
			} else {
				tracer.event(TRACE.idempotencyHit, { actionId: action.id, key, refId: pre.value.ref.id }, 'deduped');
				return { ...base, kind: 'deduped', attempts: 0, ref: pre.value.ref, args };
			}
		}

		// e. Write, re-checking the key before every retry.
		const rec: { found: FoundArtifact | null } = { found: null };
		const res = await withRetry(
			async (n) => {
				st.attempts = n;
				guard.record(tool.name, args);
				return call('run', n, () => tool.run(tctx, args), (v: { ref: { id: string } }) => ({ ref: v.ref }), args);
			},
			{
				...retryOpts,
				beforeRetry: async (info) => {
					const f = await findWithRetry();
					const found = f.ok && !!f.value;
					const e = toErrorInfo(info.error);
					tracer.event(
						TRACE.retry,
						{
							actionId: action.id,
							tool: tool.name,
							attempt: info.attempt,
							delayMs: info.delayMs,
							'error.kind': e.kind,
							...(e.status !== undefined ? { 'error.status': e.status } : {}),
							retryAfterMs: e.retryAfterMs ?? info.delayMs,
							foundByKey: found
						},
						'error'
					);
					if (f.ok && f.value) {
						rec.found = f.value;
						return 'stop';
					}
					return 'retry';
				}
			}
		);

		const writtenKind: ExecOutcomeKind = updating ? 'updated' : 'created';
		if (res.ok) {
			return {
				...base,
				kind: writtenKind,
				attempts: st.attempts,
				ref: res.value.ref,
				args,
				...(updating ? { detail: DETAIL.updatedExisting } : {})
			};
		}
		if (isGuardError(res.error)) throw res.error;

		const e = toErrorInfo(res.error);
		const recovered = (f: FoundArtifact): ExecOutcome => {
			tracer.event(TRACE.idempotencyRecovered, { actionId: action.id, key, ...errorAttrs(e) });
			return {
				...base,
				kind: writtenKind,
				attempts: st.attempts,
				ref: f.ref,
				args,
				error: e,
				detail: `${DETAIL.recovered}: ${e.kind}${statusSuffix(e)}`
			};
		};
		if (rec.found) return recovered(rec.found);

		// Final defensive check: a ghost write on the last attempt, or a non-retryable 409 on an existing id.
		const fin = await findWithRetry();
		if (fin.ok && fin.value) return recovered(fin.value);
		return {
			...base,
			kind: 'failed',
			attempts: st.attempts,
			args,
			error: e,
			detail: `${DETAIL.integrationFailure}: ${e.kind}${statusSuffix(e)} after ${st.attempts} attempt(s): ${e.message}`
		};
	}

	function fromThrown(err: unknown, base: Base, st: ActionState): ExecOutcome {
		if (err instanceof LoopDetectedError) {
			halted = { reason: 'retry_loop', detail: err.message };
			tracer.event(TRACE.retryLoop, { actionId: base.actionId, fingerprint: err.fingerprint.slice(0, 200), count: err.count }, 'error');
			return { ...base, kind: 'failed', attempts: st.attempts, detail: `${DETAIL.retryLoop}: ${err.message}`, reason: 'retry_loop' };
		}
		if (err instanceof StepCapError) {
			halted = { reason: 'step_cap', detail: err.message };
			tracer.event(TRACE.stepCap, { actionId: base.actionId, max: err.max, used: budget.used }, 'error');
			return { ...base, kind: 'skipped', attempts: st.attempts, detail: DETAIL.haltedStepCap, reason: 'step_cap' };
		}
		const e = toErrorInfo(err);
		return {
			...base,
			kind: 'failed',
			attempts: st.attempts,
			error: e,
			detail: `${DETAIL.integrationFailure}: unexpected ${e.kind}: ${e.message}`
		};
	}

	async function decide(action: Action, base: Base, st: ActionState): Promise<ExecOutcome> {
		if (halted) return { ...base, kind: 'skipped', attempts: 0, detail: `halted:${halted.reason}`, reason: halted.reason };
		const b = blocked.get(action.id);
		if (b) return blockedOutcome(base, b.code, b.reason);
		for (const dep of action.dependsOn ?? []) {
			const d = outcomes.get(dep);
			if (d && (d.kind === 'failed' || d.kind === 'blocked')) {
				return { ...base, kind: 'skipped', attempts: 0, detail: `${DETAIL.dependencyFailed}:${dep}`, reason: 'dependency_failed' };
			}
		}
		try {
			return await runAction(approved.get(action.id) ?? action, base, st);
		} catch (err) {
			return fromThrown(err, base, st);
		}
	}

	const ordered = topoOrder(plan.actions);
	for (const action of ordered) {
		const base: Base = { actionId: action.id, app: action.app, tool: action.tool, idempotencyKey: action.idempotencyKey };
		if (!approved.has(action.id) && !blocked.has(action.id)) {
			outcomes.set(action.id, { ...base, kind: 'skipped', attempts: 0, detail: DETAIL.notApproved, reason: 'not_approved' });
			tracer.event(TRACE.actionSkipped, { actionId: action.id, app: action.app, tool: action.tool, reason: 'not_approved' }, 'skipped');
			continue;
		}
		const st: ActionState = { attempts: 0 };
		const o = await tracer.span(TRACE.actionSpan, spanAttrs(action), async (_id, ctl) => {
			const out = await decide(action, base, st);
			publish(ctl, out, st.foundByKey);
			return out;
		});
		outcomes.set(action.id, o);
	}

	return { outcomes: ordered.map((a) => outcomes.get(a.id)!), steps: budget.used, halted };
}

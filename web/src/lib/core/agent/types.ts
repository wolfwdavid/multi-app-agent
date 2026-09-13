// Agent runtime contracts shared by the planner, policy gate, executor, verifier, orchestrator, evals and UI adapter.
import type { Action, AppName, ArtifactRef, ConnectorErrorInfo, Plan } from '../schemas.ts';
import type { GapReport } from '../gap/index.ts';
import type { NextAction } from '../grounding/next-actions.ts';

export const ACTION_KINDS = [
	'critique_doc',
	'tracker_row',
	'event_deadline',
	'event_t30',
	'event_t14',
	'event_t3',
	'event_rec_request',
	'draft_admissions_question',
	'draft_rec_request',
	'draft_advisor_prereq_check'
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Stable detail prefixes. Phase 6's taxonomy classifier keys on these, so never rename them. */
export const DETAIL = {
	notApproved: 'not_approved',
	blockedByPolicy: 'blocked_by_policy',
	dependencyFailed: 'dependency_failed',
	integrationFailure: 'integration_failure',
	invalidArgs: 'invalid_args',
	recovered: 'recovered_after_error',
	updatedExisting: 'updated_existing',
	readBackMissing: 'read_back_missing',
	readBackMismatch: 'read_back_mismatch',
	readBackError: 'read_back_error',
	haltedStepCap: 'halted:step_cap',
	haltedRetryLoop: 'halted:retry_loop',
	retryLoop: 'retry_loop'
} as const;

/**
 * Trace vocabulary. Phase 7 07-UI-SPEC (lib/ui/trace-rows.ts) and Phase 6 read these names, so never rename them.
 * Contract → UI mapping (the Phase 1 TraceStatus/ArtifactStatus names are kept; the UI derives display statuses):
 *  - UI 'ok'      = span end status 'ok' and attrs.attempt <= 1
 *  - UI 'retried' = span end status 'ok' and attrs.attempt > 1
 *  - UI 'deduped' = end status 'deduped'
 *  - UI 'blocked' = end status 'skipped' and attrs.reason in ('policy' | 'allowlist' | 'injection' | 'not_approved')
 *  - UI 'failed'  = end status 'error'
 *  - UI latency   = span end `durationMs` (TraceEvent contract field)
 *  - UI attempt sub-rows = TRACE.retry events for the same actionId (attrs: attempt, 'error.kind', 'error.status', retryAfterMs, foundByKey)
 *  - UI "Mismatch: reported OK, not found on read-back" = ArtifactStatus 'mismatch' with detail 'read_back_missing…' (lying success).
 *    RunReport.counts has no 'mismatch' key, so mismatches are counted in counts.failed.
 */
export const TRACE = {
	planSpan: 'plan',
	planBuilt: 'plan.built',
	planDryRun: 'plan.dry_run',
	llmSlot: 'llm.slot',
	policyAuthorized: 'policy.authorized',
	policyRejected: 'policy.rejected',
	policyBlocked: 'policy.blocked',
	executeSpan: 'execute',
	actionSpan: 'action.execute',
	actionSkipped: 'action.skipped',
	toolCall: 'tool.call',
	retry: 'retry',
	idempotencyHit: 'idempotency.hit',
	idempotencyRecovered: 'idempotency.recovered',
	argsRepair: 'args.repair',
	stepCap: 'guard.step_cap',
	retryLoop: 'guard.retry_loop',
	verifySpan: 'verify',
	readbackSpan: 'verify.readback',
	runEnd: 'run.end'
} as const;

/** attrs.reason on skipped action.execute spans (and on action.skipped events for not_approved). */
export type SkipReason =
	| 'not_approved'
	| 'policy'
	| 'allowlist'
	| 'injection'
	| 'dependency_failed'
	| 'step_cap'
	| 'retry_loop';

export type ExecOutcomeKind = 'created' | 'updated' | 'deduped' | 'failed' | 'skipped' | 'blocked';

export interface ExecOutcome {
	actionId: string;
	app: AppName;
	tool: string;
	idempotencyKey: string;
	kind: ExecOutcomeKind;
	attempts: number;
	ref?: ArtifactRef;
	args?: Record<string, unknown>;
	error?: ConnectorErrorInfo;
	detail?: string;
	reason?: SkipReason;
}

export interface ExecutionResult {
	outcomes: ExecOutcome[];
	steps: number;
	halted: null | { reason: 'step_cap' | 'retry_loop'; detail: string };
}

export type PolicyViolationCode =
	| 'unknown_tool'
	| 'forbidden_tool'
	| 'tool_app_mismatch'
	| 'recipient_not_allowlisted';

export interface BlockedAction {
	action: Action;
	code: PolicyViolationCode;
	reason: string;
}

export interface Authorization {
	planId: string;
	approvedIds: string[];
	approved: Action[];
	skipped: Action[];
	blocked: BlockedAction[];
	recipientAllowlist: string[];
}

export type PolicyErrorCode = 'invalid_plan' | 'invalid_plan_token' | 'unknown_action_id';

export class PolicyError extends Error {
	readonly code: PolicyErrorCode;
	readonly details: string[];
	constructor(code: PolicyErrorCode, message: string, details: string[] = []) {
		super(message);
		this.name = 'PolicyError';
		this.code = code;
		this.details = details;
	}
}

export interface PlanResult {
	plan: Plan;
	planToken: string;
	reports: GapReport[];
	/** Phase 5 GAP-03: LLM-phrased next steps; findings stay deterministic. */
	nextActions?: NextAction[];
}

export interface SprintLimits {
	maxSteps: number;
	maxAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export const DEFAULT_LIMITS: Readonly<SprintLimits> = Object.freeze({
	maxSteps: 200,
	maxAttempts: 3,
	baseDelayMs: 100,
	maxDelayMs: 2000
});

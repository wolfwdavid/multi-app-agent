---
phase: 04-sprint-pipeline-on-mocks
plan: 02
subsystem: agent
tags: [executor, verifier, retry, backoff, idempotency, ghost-write, lying-success, loop-guard, step-cap, trace]
requires:
  - "04-01: agent/types.ts (TRACE, DETAIL, ExecOutcome, Authorization, DEFAULT_LIMITS), policy.ts (checkActionPolicy, topoOrder), tools/sprint-tools.ts (getWriteTool, findByKey, diff), trace/tracer.ts SpanControl, idempotency.ts canonicalJson"
  - "02-02: createConnectors({ mode: 'mock', world?, faults? }), withFaults ghost_write / lying_success / rate_limit / server_error"
provides:
  - "agent/retry.ts: withRetry, isRetryableError, backoffDelay, toErrorInfo, RetryOptions, RetryResult, RetryInfo"
  - "agent/guards.ts: createStepBudget, createLoopGuard, callFingerprint, StepCapError, LoopDetectedError"
  - "agent/executor.ts: executePlan, ExecContext"
  - "agent/verifier.ts: verifyOutcomes, buildRunReport, VerifyContext"
affects: [04-03-orchestrator-cli, phase-06-evals, phase-07-ui-trace-rows, phase-09-api, phase-11-mcp]
tech-stack:
  added: []
  patterns:
    - "Idempotency in the target app: findByKey before the write, before every retry, and once more after exhausted retries"
    - "Retry hook ordering: onRetry -> sleep -> beforeRetry (re-check key; 'stop' on found)"
    - "Guard errors (StepCapError / LoopDetectedError) are never retryable and always propagate out of retry loops to halt the run"
    - "Grading from read-back only: RunReport counts and status come from verifyOutcomes, never from executor intent"
key-files:
  created:
    - web/src/lib/core/agent/retry.ts
    - web/src/lib/core/agent/guards.ts
    - web/src/lib/core/agent/retry.test.ts
    - web/src/lib/core/agent/executor.ts
    - web/src/lib/core/agent/executor.test.ts
    - web/src/lib/core/agent/verifier.ts
    - web/src/lib/core/agent/verifier.test.ts
  modified: []
key-decisions:
  - "Recovered writes keep kind created (or updated for an upsert on diff) with error info plus detail recovered_after_error; the action span END status stays ok"
  - "Executor runs the Authorization's action object (auth.approved) rather than the plan copy; ids not in the plan throw (programmer error)"
  - "Invalid args after a repair report the re-parse issues, not the original ones"
  - "verify span END carries tallies (verified, deduped, mismatch, failed, skipped) for the UI header"
requirements-completed: [AGENT-01, AGENT-05, APPS-01, APPS-02, APPS-03, APPS-06]
duration: 8min
completed: 2026-09-13
---

# Phase 4 Plan 02: Executor, Retry/Guards and Read-back Verifier Summary

**`executePlan` runs only authorized actions, in dependency order. Tool args are zod-validated first, with one repair attempt that is re-checked against the allowlist. `findByKey` runs before every write and before every retry, so a ghost write (5xx after commit) becomes a recovery rather than a duplicate. 429 and 5xx errors retry using retry-after or exponential backoff through an injected sleep. Exhausted retries are reported as `integration_failure` outcomes. A step cap and an identical-call loop guard halt runaway runs. `verifyOutcomes` then reads back every artifact, so a lying-success write shows up as `mismatch`, and the `RunReport` status becomes `partial`.**

## Performance

- **Duration:** about 8 minutes
- **Tasks:** 3 (TDD, 6 commits)
- **Files:** 7 created, 0 modified

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | withRetry + step budget + loop guard | `ddfa168` (test), `7cb13f4` (feat) |
| 2 | executePlan | `0e99c15` (test), `abb6f7c` (feat) |
| 3 | verifyOutcomes + buildRunReport | `4cbdad0` (test), `1ec5d9c` (feat) |

## Exported signatures (04-03 imports these)

### agent/retry.ts
```ts
export interface RetryInfo { attempt: number; error: unknown; delayMs: number }
export interface RetryOptions {
  maxAttempts: number; baseDelayMs: number; maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;                        // default isRetryableError
  onRetry?: (info: RetryInfo) => void;                            // before sleep
  beforeRetry?: (info: RetryInfo) => Promise<'retry' | 'stop'>;   // after sleep
}
export type RetryResult<T> = { ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number; stopped: boolean };
export function isRetryableError(err: unknown): boolean;          // ConnectorError kind rate_limit | server | timeout
export function backoffDelay(attempt: number, err: unknown, o: { baseDelayMs: number; maxDelayMs: number }): number; // min(max, retryAfterMs ?? base * 2^(attempt-1))
export function toErrorInfo(err: unknown): ConnectorErrorInfo;    // undefined fields omitted; non-ConnectorError -> kind 'server'
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<RetryResult<T>>;
```

### agent/guards.ts
```ts
export class StepCapError extends Error { readonly max: number }                              // "step cap of N tool calls reached"
export class LoopDetectedError extends Error { readonly fingerprint: string; readonly count: number }
export interface StepBudget { readonly used: number; readonly max: number; take(label: string): void }
export function createStepBudget(max: number): StepBudget;
export function callFingerprint(tool: string, args: unknown): string;                          // `${tool}|${canonicalJson(args)}`
export interface LoopGuard { record(tool: string, args: unknown): void; count(tool: string, args: unknown): number }
export function createLoopGuard(maxIdentical: number): LoopGuard;                              // throws when count > maxIdentical
```

### agent/executor.ts
```ts
export interface ExecContext {
  connectors: Connectors;
  tracer: Tracer;
  recipientAllowlist: string[];
  now?: () => number;                          // latency only; default performance.now
  sleep?: (ms: number) => Promise<void>;       // default setTimeout; tests inject vi.fn
  limits?: Partial<SprintLimits>;              // merged over DEFAULT_LIMITS
  repairArgs?: (action: Action, issues: string) => Promise<Record<string, unknown> | null>;
}
export async function executePlan(ctx: ExecContext, plan: Plan, auth: Authorization): Promise<ExecutionResult>;
// steps = findByKey + run calls (the verifier's reads are not counted). Never throws for connector problems.
```

### agent/verifier.ts
```ts
export interface VerifyContext { connectors: Connectors; tracer: Tracer; sleep?: (ms: number) => Promise<void>; limits?: Partial<SprintLimits> }
export async function verifyOutcomes(ctx: VerifyContext, plan: Plan, exec: ExecutionResult): Promise<ArtifactResult[]>;
export function buildRunReport(input: {
  runId: string; traceId: string; plan: Plan; auth: Authorization; exec: ExecutionResult;
  artifacts: ArtifactResult[]; mode: 'mock' | 'real'; startedAt: string; finishedAt: string;
}): RunReport;   // RunReport.parse'd
```

## Emitted trace names (Phase 6 classifier, Phase 7 trace-rows.ts)

| Name (`TRACE.*`) | Kind | Status | Attrs |
| --- | --- | --- | --- |
| `action.execute` (actionSpan) | start/end span | END: `ok` (created/updated), `deduped`, `error` (failed), `skipped` (blocked, dependency_failed, halted) | start: `actionId, app, tool, key, maxAttempts`. END adds `attempt, outcome`, plus when relevant `reason, detail, refId, 'error.kind', 'error.status', retryAfterMs, foundByKey` |
| `action.skipped` (actionSkipped) | event | `skipped` | `actionId, app, tool, reason: 'not_approved'`. There is no action span for unapproved actions. |
| `policy.blocked` (policyBlocked) | event (inside span) | `skipped` | `actionId, code, reason` |
| `tool.call` (toolCall) | event | `ok` / `error` | `actionId, tool, method ('findByKey' or 'run'), attempt, latencyMs`. `args` on run. On success: `result` (`{ found, ref? }` or `{ ref }`). On error: `'error.kind', 'error.status', 'error.message', retryAfterMs` |
| `retry` (retry) | event | `error` | `actionId, tool, attempt, delayMs, 'error.kind', 'error.status', retryAfterMs (falls back to delayMs), foundByKey` |
| `idempotency.hit` (idempotencyHit) | event | `deduped` | `actionId, key, refId` |
| `idempotency.recovered` (idempotencyRecovered) | event | (none) | `actionId, key, 'error.kind', 'error.status'` |
| `args.repair` (argsRepair) | event | (none) | `actionId, issues, repaired` |
| `guard.step_cap` (stepCap) | event | `error` | `actionId, max, used` |
| `guard.retry_loop` (retryLoop) | event | `error` | `actionId, fingerprint (<=200 chars), count` |
| `verify` (verifySpan) | span | `ok` | start: `planId, outcomes`. END: `verified, deduped, mismatch, failed, skipped` |
| `verify.readback` (readbackSpan) | span | `ok` (verified), `deduped`, `error` (mismatch or read error) | `actionId, app, tool, key, found, artifactStatus`, plus `fields` on a field mismatch and `'error.kind', 'error.status'` on a read error. Only created, updated and deduped outcomes get this span. |

## DETAIL prefixes and SkipReason values actually used

**ExecOutcome.detail:**
- `not_approved`
- `blocked_by_policy:<code>: <reason>`
- `dependency_failed:<depActionId>`
- `invalid_args: <path: message; ...>`
- `integration_failure: <kind> <status> after N attempt(s): <message>`
- `integration_failure: findByKey <kind> <status>: <message>`
- `integration_failure: unexpected <kind>: <message>`, a defensive catch for a throwing repair hook
- `recovered_after_error: <kind> <status>`
- `updated_existing`
- `halted:step_cap`
- `halted:retry_loop`, used for actions after a loop halt
- `retry_loop: <message>`, used for the action that tripped the guard

**ArtifactResult.detail:**
- `read_back_missing: <tool> reported success but no artifact with key <key> exists`
- `read_back_mismatch: <field,field>`
- `read_back_error: <kind> <message>`
- Otherwise the executor detail passes through, for example `recovered_after_error…` or `updated_existing`.

**SkipReason used:** `not_approved`, `policy`, `allowlist`, `dependency_failed`, `step_cap`, `retry_loop`. `injection` is reserved for Phase 5.

**Outcome kind to ArtifactStatus:**
- `skipped` → `skipped`
- `blocked` / `failed` → `failed`, with no read-back
- `created` / `updated` → `verified`, `mismatch` or `failed`, decided by read-back
- `deduped` → `deduped`, `mismatch` or `failed`, decided by read-back

## Contract → UI status mapping

- **ok:** `action.execute` END status `ok` and `attempt <= 1`.
- **retried:** END status `ok` and `attempt > 1`. The sub-rows come from `retry` events with the same `actionId`. For a recovered ghost write, `attempt` is 1, END carries `foundByKey: true` plus `'error.kind'/'error.status'`, and there is one `retry` event with `foundByKey: true`.
- **deduped:** END status `deduped`, `attempt: 0`, `foundByKey: true`.
- **blocked:** END status `skipped` with `reason` in `policy | allowlist | injection`. Unapproved actions emit only `action.skipped` (`reason: 'not_approved'`) and no span.
- **failed:** END status `error`, which covers exhausted retries, invalid args and the retry loop.
- **lying success:** the executor reports `created`, but the ArtifactResult is `mismatch` with detail `read_back_missing…`, and `verify.readback` END has `found: false` with status `error`. RunReport counts it in `counts.failed`.

**RunReport:**
- `counts.failed` is failed plus mismatch.
- `blockers` are `plan.blockers`, then `POLICY_BLOCKED` (message `<actionId>: <reason>`), then `STEP_CAP_REACHED` or `RETRY_LOOP_DETECTED`.
- `status` is `ok` when there are no problems. It is `partial` when a problem exists alongside at least one verified or deduped artifact, otherwise `failed`. A problem is `counts.failed > 0` or a halted run.

## Verification

- `npm --prefix web test -- src/lib/core/agent`: 6 files, 88 tests pass (retry 14, executor 17, verifier 11, plus 46 from 04-01 agent tests).
- `npm --prefix web test` (full suite): 23 files, 369 tests pass.
- `npm --prefix web run check`: 621 files, 0 errors, 0 warnings.
- **Acceptance greps, all met:**
  - retry.ts: withRetry 1, beforeRetry 3, retryAfterMs 2
  - guards.ts: 2 classes, Math.random/setTimeout 0
  - executor.ts: findByKey 5, beforeRetry 1, TRACE.actionSpan 1, ctl.status( 1, TRACE names 9, error keys 4, foundByKey 6, maxAttempts 3, process.env/node: 0
  - executor.test.ts: fault literals 9
  - verifier.ts: readbackSpan 1, `found:` 5, read_back_missing 1, RunReport.parse 1, blocker codes 3
  - verifier.test.ts: lying_success 2, `'mismatch'` 2, `'partial'` 5
- `grep -rnE "process\.env|from 'node:" web/src/lib/core/agent` over non-test files returns nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Acceptance grep for halted blocker codes counted lines, not literals**
- **Found during:** Task 3 verification
- **Issue:** `'STEP_CAP_REACHED'` and `'RETRY_LOOP_DETECTED'` sat in one ternary on one line, so `grep -c` returned 2 where the criterion needs 3.
- **Fix:** I split the ternary across lines. Behavior is unchanged.
- **Files modified:** web/src/lib/core/agent/verifier.ts
- **Commit:** 1ec5d9c

### Minor interpretation choices
- **Recovered upsert:** a recovered write on an upsert that was updating reports kind `updated` instead of `created`. For creates, the plan's `created` holds.
- **Executed action object:** the executor runs the `auth.approved` action object, falling back to the plan action.
- **Invalid args after repair:** when a repair still fails validation, the detail uses the re-parse issues.
- **`verify` span END tallies:** I added these attrs; the plan did not list them.
- **Extra tests:**
  - executor: an authorization with unknown ids throws; the upsert title really changes back after update; the args.repair event count
  - verifier: `maxSteps: 1` gives status `failed`
  - both setups assert `RunReport.parse` and topological artifact order on every case
- **Field-mismatch test:** it tampers the calendar event found by its idempotency key, not `events[0]`, so the test can't depend on seed ordering.
- **Keyed-docs count:** it counts only docs whose key belongs to the plan, because the default seed also holds essay fixture docs.

### 04-01 interface differences
None. The actual exports matched the plan's `<interfaces>` block. `ExecContext.repairArgs` receives the plan `Action`.

## Known Stubs

None.

## Self-Check: PASSED

- All 7 created files exist and are covered by the test run and svelte-check.
- Commits ddfa168, 7cb13f4, 0e99c15, abb6f7c, 4cbdad0 and 1ec5d9c are present in `git log`. Their messages carry no attribution trailers.

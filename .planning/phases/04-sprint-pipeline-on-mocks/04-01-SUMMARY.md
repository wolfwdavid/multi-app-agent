---
phase: 04-sprint-pipeline-on-mocks
plan: 01
subsystem: agent
tags: [planner, policy, hmac, idempotency, write-tools, llm-slots, tracer, zod]
requires:
  - "01-01: schemas.ts (Action, Plan, IdempotencyKey, TraceEvent), tools/registry.ts, trace/tracer.ts"
  - "02-02: createConnectors({ mode: 'mock' }) and write-port findByKey"
  - "03-01: analyzeGaps / GapReport, assertIsoDate"
provides:
  - "agent/types.ts: ActionKind, DETAIL, TRACE vocabulary, ExecOutcome, ExecutionResult, Authorization, PolicyError, PlanResult, SprintLimits, DEFAULT_LIMITS"
  - "trace/tracer.ts: additive SpanControl (end status + end attrs)"
  - "agent/idempotency.ts: canonicalJson, sha256Hex, deriveIdempotencyKey"
  - "tools/sprint-tools.ts: 4 strict write tools (run, findByKey, diff) + sprintRegistry"
  - "llm/types.ts + llm/fake.ts: LLM slot interface, callSlot with one zod repair, createFakeLLM"
  - "agent/planner.ts: buildPlan (23-action demo plan)"
  - "agent/policy.ts: signPlan, verifyPlanToken, authorizeExecution, checkActionPolicy, topoOrder, recipientAllowlistFromProfile"
affects: [04-02-executor-verifier, 04-03-orchestrator-cli, phase-06-evals, phase-07-ui, phase-09-api, phase-11-mcp]
tech-stack:
  added: []
  patterns:
    - "Deterministic skeleton; LLM fills only zod-validated text slots with one repair retry"
    - "Web Crypto (globalThis.crypto.subtle) for sha256 and HMAC, so core stays browser/Vercel safe"
    - "Recipients from profile.contacts only; allowlist bound into the HMAC plan token"
    - "Span END events carry final status/attrs via SpanControl"
key-files:
  created:
    - web/src/lib/core/agent/types.ts
    - web/src/lib/core/agent/idempotency.ts
    - web/src/lib/core/agent/idempotency.test.ts
    - web/src/lib/core/tools/sprint-tools.ts
    - web/src/lib/core/tools/sprint-tools.test.ts
    - web/src/lib/core/trace/span-control.test.ts
    - web/src/lib/core/llm/types.ts
    - web/src/lib/core/llm/fake.ts
    - web/src/lib/core/agent/planner.ts
    - web/src/lib/core/agent/planner.test.ts
    - web/src/lib/core/agent/policy.ts
    - web/src/lib/core/agent/policy.test.ts
  modified:
    - web/src/lib/core/trace/tracer.ts
key-decisions:
  - "Idempotency naturalKey is the term (plus contact id for drafts), never a date, so keys are stable across run days"
  - "Plan token signs canonical JSON of { v: 1, plan, recipientAllowlist } so swapped contacts fail verification"
  - "authorizeExecution verifies the RAW plan input so zod defaults can't mask tampering"
  - "Gmail diff treats subject as the headline field (drafts have no title)"
requirements-completed: [AGENT-01, AGENT-03, APPS-01, APPS-02, APPS-03]
duration: 12min
completed: 2026-09-13
---

# Phase 4 Plan 01: Planner, Write Tools and Policy Gate Summary

**This plan builds the front half of the sprint pipeline, with no connector access. `buildPlan` turns the demo profile and its GapReports into a 23-action dry-run Plan. Every action has a sha256 idempotency key, and every payload passes a strict zod write-tool schema. LLM slot output is zod-validated and gets one repair retry. `authorizeExecution` enforces an HMAC-SHA256 plan token, approved-id filtering, a recipient allowlist and no-send rules before any write can happen.**

## Performance

- **Duration:** about 12 minutes
- **Tasks:** 3 (TDD, 6 commits)
- **Files:** 12 created, 1 modified (tracer.ts, additive)

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Contracts, SpanControl, idempotency, write tools | `0f13056` (test), `586598a` (feat) |
| 2 | LLM slot + FakeLLM, planner | `144db6e` (test), `f2bc914` (feat) |
| 3 | Policy gate | `c7a3c35` (test), `0f4b3bc` (feat) |

## Exported signatures (04-02 / 04-03 import these)

### trace/tracer.ts (additive)
```ts
export interface SpanControl { set(attrs: Record<string, unknown>): void; status(s: TraceStatus): void }
export interface Tracer {
  readonly traceId: string;
  event(name: string, attrs?: Record<string, unknown>, status?: TraceStatus): void;
  span<T>(name: string, attrs: Record<string, unknown>, fn: (spanId: string, ctl: SpanControl) => Promise<T>): Promise<T>;
}
// END event: status = ctl status ?? 'ok'; attrs = { ...startAttrs, ...ctl.set attrs }.
// On throw: status 'error', attrs also include 'error.message'; the error is rethrown.
// createTracer, MemorySink, CallbackSink, TraceSink are unchanged.
```

### agent/types.ts
```ts
export const ACTION_KINDS = ['critique_doc','tracker_row','event_deadline','event_t30','event_t14','event_t3','event_rec_request','draft_admissions_question','draft_rec_request','draft_advisor_prereq_check'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const DETAIL = { notApproved: 'not_approved', blockedByPolicy: 'blocked_by_policy', dependencyFailed: 'dependency_failed',
  integrationFailure: 'integration_failure', invalidArgs: 'invalid_args', recovered: 'recovered_after_error',
  updatedExisting: 'updated_existing', readBackMissing: 'read_back_missing', readBackMismatch: 'read_back_mismatch',
  readBackError: 'read_back_error', haltedStepCap: 'halted:step_cap', haltedRetryLoop: 'halted:retry_loop', retryLoop: 'retry_loop' } as const;
export const TRACE = { planSpan: 'plan', planBuilt: 'plan.built', planDryRun: 'plan.dry_run', llmSlot: 'llm.slot',
  policyAuthorized: 'policy.authorized', policyRejected: 'policy.rejected', policyBlocked: 'policy.blocked',
  executeSpan: 'execute', actionSpan: 'action.execute', actionSkipped: 'action.skipped',
  toolCall: 'tool.call', retry: 'retry', idempotencyHit: 'idempotency.hit', idempotencyRecovered: 'idempotency.recovered',
  argsRepair: 'args.repair', stepCap: 'guard.step_cap', retryLoop: 'guard.retry_loop',
  verifySpan: 'verify', readbackSpan: 'verify.readback', runEnd: 'run.end' } as const;
export type SkipReason = 'not_approved' | 'policy' | 'allowlist' | 'injection' | 'dependency_failed' | 'step_cap' | 'retry_loop';
export type ExecOutcomeKind = 'created' | 'updated' | 'deduped' | 'failed' | 'skipped' | 'blocked';
export interface ExecOutcome { actionId: string; app: AppName; tool: string; idempotencyKey: string; kind: ExecOutcomeKind; attempts: number; ref?: ArtifactRef; args?: Record<string, unknown>; error?: ConnectorErrorInfo; detail?: string; reason?: SkipReason }
export interface ExecutionResult { outcomes: ExecOutcome[]; steps: number; halted: null | { reason: 'step_cap' | 'retry_loop'; detail: string } }
export type PolicyViolationCode = 'unknown_tool' | 'forbidden_tool' | 'tool_app_mismatch' | 'recipient_not_allowlisted';
export interface BlockedAction { action: Action; code: PolicyViolationCode; reason: string }
export interface Authorization { planId: string; approvedIds: string[]; approved: Action[]; skipped: Action[]; blocked: BlockedAction[]; recipientAllowlist: string[] }
export type PolicyErrorCode = 'invalid_plan' | 'invalid_plan_token' | 'unknown_action_id';
export class PolicyError extends Error { readonly code: PolicyErrorCode; readonly details: string[]; constructor(code, message, details = []) }
export interface PlanResult { plan: Plan; planToken: string; reports: GapReport[] }
export interface SprintLimits { maxSteps: number; maxAttempts: number; baseDelayMs: number; maxDelayMs: number }
export const DEFAULT_LIMITS: Readonly<SprintLimits>; // { maxSteps: 200, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000 }
```
The contract → UI mapping comment in types.ts works like this:
- **UI 'ok':** end status 'ok' and attempt <= 1.
- **UI 'retried':** end status 'ok' and attempt > 1.
- **UI 'deduped':** end status 'deduped'.
- **UI 'blocked':** end status 'skipped' and reason is one of policy, allowlist, injection or not_approved.
- **UI 'failed':** end status 'error'.
- **Latency:** read from `durationMs`.
- **Attempt sub-rows:** `retry` events.
- **Mismatch:** ArtifactStatus 'mismatch' with detail `read_back_missing…`. It is counted in `counts.failed`.

### agent/idempotency.ts
```ts
export function canonicalJson(value: unknown): string;          // sorted keys, drops undefined, throws on non-finite/unsupported
export async function sha256Hex(text: string): Promise<string>;
export interface KeyParts { profileId: string; schoolId: string; programId: string; actionKind: ActionKind; naturalKey: string }
export async function deriveIdempotencyKey(p: KeyParts): Promise<IdempotencyKey>; // 'tp1-' + sha256(p1|p2|p3|p4|p5)[0..16]
```

### tools/sprint-tools.ts
```ts
export const TrackerRowArgs, CalendarEventArgs, DocArgs, DraftArgs;   // z.object(...).strict(), all include key: IdempotencyKey
export const WriteToolOutput = z.object({ ref: ArtifactRef });
export type WriteToolName = 'notion.upsertTrackerRow' | 'calendar.createEvent' | 'docs.createDoc' | 'gmail.createDraft';
export interface FoundArtifact { ref: ArtifactRef; item: Record<string, unknown> }
export interface WriteToolDef<I extends z.ZodObject = z.ZodObject> extends ToolDef<I, typeof WriteToolOutput> {
  name: WriteToolName; effect: 'write'; mode: 'create' | 'upsert';
  findByKey(ctx: ToolContext, key: string): Promise<FoundArtifact | null>;
  diff(args: z.infer<I>, found: FoundArtifact): string[];
}
export const WRITE_TOOLS: Readonly<Record<WriteToolName, WriteToolDef<any>>>;
export const sprintRegistry: Registry;
export function isWriteToolName(n: string): n is WriteToolName;
export function getWriteTool(n: string): WriteToolDef<any> | undefined;
```
The `diff` fields compared per tool are:
- **notion:** title, deadline, requiredDocs, recsRequired, essayStatus, gapCount, status, notes
- **calendar:** title, date
- **docs:** title
- **gmail:** to, cc, subject, body. `to` and `cc` are compared sorted and lowercased.

Mode is `upsert` for notion and `create` for the other three.

### llm/types.ts and llm/fake.ts
```ts
export interface LLMRequest { slot: string; system: string; input: unknown; jsonSchema?: unknown; repair?: { issues: string; previous: unknown } }
export interface LLM { readonly model: string; completeJSON(req: LLMRequest): Promise<unknown> }
export class LLMSlotError extends Error { readonly slot: string; readonly issues: string }
export async function callSlot<S extends z.ZodType>(llm: LLM, schema: S, req: { slot: string; system: string; input: unknown }, opts?: { maxRepairs?: number; tracer?: Tracer }): Promise<z.infer<S>>;
// Emits 'llm.slot' events { slot, attempt, model, ok, issues? }; a failed attempt is emitted with status 'error'.

export type FakeResponder = (req: LLMRequest) => unknown;
export interface FakeLLM extends LLM { readonly calls: LLMRequest[] }   // calls are recorded without jsonSchema
export const defaultFakeResponders: Readonly<Record<'critique' | 'draft', FakeResponder>>;
export function createFakeLLM(script?: Record<string, FakeResponder | unknown[]>): FakeLLM;  // model 'fake-scripted'
```

### agent/planner.ts
```ts
export const REMINDER_OFFSETS: readonly [{ kind: 'event_t30'; days: 30; label: 'T-30' }, { kind: 'event_t14'; days: 14; label: 'T-14' }, { kind: 'event_t3'; days: 3; label: 'T-3' }];
export const REC_REQUEST_LEAD_DAYS = 42;
export function shiftIsoDate(date: string, days: number): string;
export const DraftSlotOutput, CritiqueSlotOutput;   // zod schemas (+ inferred types of the same name)
export interface BuildPlanInput { profile: Profile; schools: SchoolsDataset; reports: GapReport[]; today: string; createdAt: string; llm: LLM; tracer?: Tracer }
export async function buildPlan(input: BuildPlanInput): Promise<Plan>;   // emits 'plan.built'
```

### agent/policy.ts
```ts
export function recipientAllowlistFromProfile(profile: Profile): string[];
export async function signPlan(plan: Plan, secret: string, recipientAllowlist: string[]): Promise<string>;   // 'v1.' + base64url(HMAC); secret >= 16 chars
export async function verifyPlanToken(plan: unknown, token: string, secret: string, recipientAllowlist: string[]): Promise<boolean>;
export function checkActionPolicy(action: Action, recipientAllowlist: string[]): { code: PolicyViolationCode; reason: string } | null;
export function topoOrder(actions: Action[]): Action[];   // stable Kahn; PolicyError('invalid_plan', 'unknown dependency' | 'dependency cycle')
export async function authorizeExecution(input: { plan: unknown; planToken: string; approvedIds: string[]; secret: string; recipientAllowlist: string[] }): Promise<Authorization>;
```

## Demo plan (demo profile, today 2026-09-13): action ids in plan order

- **Berkeley (8):** `uc-berkeley-data-science-ba.` critique_doc, tracker_row, event_deadline, event_t30, event_t14, event_t3, draft_admissions_question, draft_advisor_prereq_check
- **Cornell (9):** `cornell-as-economics.` critique_doc, tracker_row, event_deadline, event_t30, event_t14, event_t3, event_rec_request, draft_rec_request, draft_advisor_prereq_check
- **UMich (6):** `umich-lsa.` critique_doc, tracker_row, event_deadline, event_t30, event_t14, event_t3
- **Northfield:** no actions. It produces blocker `NO_TRANSFER_PROGRAM`.

That is 3 docs, 3 tracker rows, 13 calendar events and 4 drafts, 23 actions in total. Tracker rows depend on their program's critique_doc.

## Verification

- `npm --prefix web test -- src/lib/core/agent src/lib/core/tools src/lib/core/llm src/lib/core/trace`: 5 files, 62 tests pass. Broken down: span-control 4, idempotency 5, sprint-tools 12, planner 20, policy 21.
- `npm --prefix web test` (full suite, including the unmodified contracts.test.ts and boundary.test.ts): 19 files, 314 tests pass.
- `npm --prefix web run check`: 517 files, 0 errors, 0 warnings.
- The forbidden-API grep (`Date.now`, `new Date()`, `Math.random`, `process.env`) over agent, llm and sprint-tools non-test files returns nothing.
- `node:` appears 0 times in core non-test files, and `connectors` appears 0 times in planner.ts.
- On policy.ts, `Buffer|node:crypto|process.env` matches 0 times and `crypto.subtle` matches 3 times.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] svelte-check implicit-any in the policy.test.ts `it.each` table**
- **Found during:** Task 3 verification
- **Issue:** Inline mutator arrows inside an `as const` table triggered TS7023 (implicit any return type).
- **Fix:** I used an explicitly typed table: `[string, (p: Plan) => void, PolicyViolationCode][]`.
- **Files modified:** web/src/lib/core/agent/policy.test.ts
- **Commit:** c7a3c35

**2. [Rule 3 - Blocking] Acceptance grep `Buffer` matched `ArrayBuffer` in policy.ts**
- **Issue:** The `Uint8Array<ArrayBuffer>` annotations and `new ArrayBuffer(n)` made the "no Buffer" grep return 3.
- **Fix:** I removed the annotations and used `new Uint8Array(n)`. TS infers `Uint8Array<ArrayBuffer>`, which satisfies `BufferSource`, and check passes.
- **Commit:** 0f4b3bc

### Minor interpretation choices
- **Gmail round-trip test:** the plan applied `diff({ ...args, title: 'Changed' })` to all 4 tools, but drafts have no `title`. For gmail the test changes `subject` and expects `['subject']`.
- **Weak secret check order:** `verifyPlanToken` checks the secret before the `v1.` prefix. A weak secret always throws, even with a malformed token.
- **`topoOrder` details format:** for unknown dependencies the details look like `"<actionId> -> <missingDep>"`.
- **Extra tests:** I added tests beyond the behavior list:
  - nested spans
  - gmail recipient order and case
  - a calendar date diff
  - a malformed `today`
  - a critique slot failure that drops the tracker `dependsOn`
  - no `jsonSchema` in recorded fake calls
  - malformed recipients
  - `getWriteTool('toString')` returns undefined

### Phase 2/3 interface differences
None. The actual `GapReport` (gap/types.ts), `createConnectors`, port types and `assertIsoDate(s, label?)` match the plan's interfaces exactly.

## Known Stubs

- `llm/fake.ts`: the default critique responder returns placeholder, question-style comments ("This is a placeholder critique..."). This is intentional. The rubric critique arrives with the Phase 5 essay step, and a real LLM arrives in Phase 8.

## Self-Check: PASSED

- All 12 created files and the modified tracer.ts exist. The test run and svelte-check both cover them.
- Commits 0f13056, 586598a, 144db6e, f2bc914, c7a3c35 and 0f4b3bc are present in `git log`. No attribution trailers were found in their messages.

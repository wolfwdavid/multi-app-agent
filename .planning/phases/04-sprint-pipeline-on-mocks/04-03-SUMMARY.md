---
phase: 04-sprint-pipeline-on-mocks
plan: 03
subsystem: agent
tags: [orchestration, planSprint, executeSprint, recording, hero-run, redaction, pii, jsonl, cli, e2e]
requires:
  - "04-01: planner.buildPlan, policy (signPlan, authorizeExecution, recipientAllowlistFromProfile), types (TRACE, PolicyError, PlanResult, SprintLimits), sprint-tools getWriteTool/findByKey, llm/fake createFakeLLM"
  - "04-02: executor.executePlan/ExecContext, verifier.verifyOutcomes/buildRunReport"
  - "02-02: createConnectors({ mode: 'mock', world?, faults? }), isEmptyDiff, DEFAULT_CLOCK"
  - "03-01: analyzeGaps"
provides:
  - "trace/redact.ts: REDACTED, PiiSpec, piiFromProfile, redactText, redactValue, redactTraceEvent"
  - "trace/jsonl.ts: toJsonl, parseJsonl"
  - "agent/sprint.ts: SprintRuntime, allActionIds, planSprint, executeSprint"
  - "agent/recording.ts: RecordedRun, PreflightStatus, HeroRunFile, preflightPlan, buildHeroRunFile"
  - "agent/index.ts: agent barrel"
  - "scripts/sprint.ts CLI + npm run sprint / npm run record"
  - "web/static/traces/demo-sprint.jsonl + web/static/data/hero-run.json (redacted hero recording)"
affects: [phase-05-critique-grounding, phase-06-evals, phase-07-ui-replay, phase-09-api, phase-11-mcp]
tech-stack:
  added: []
  patterns:
    - "Two-call orchestration: planSprint (no writes, signed) then executeSprint (authorize -> execute -> read-back verify -> report)"
    - "PolicyError emits policy.rejected and rethrows before any connector call"
    - "Redaction at the export boundary: strings and gpa-named keys only; bare numbers never touched so zod numeric fields keep parsing"
    - "Recordings built by one zod-validated builder (buildHeroRunFile) so the UI loads them without adapters"
key-files:
  created:
    - web/src/lib/core/trace/redact.ts
    - web/src/lib/core/trace/jsonl.ts
    - web/src/lib/core/trace/redact.test.ts
    - web/src/lib/core/agent/sprint.ts
    - web/src/lib/core/agent/recording.ts
    - web/src/lib/core/agent/index.ts
    - web/src/lib/core/agent/sprint.test.ts
    - web/scripts/sprint.ts
    - web/static/traces/demo-sprint.jsonl
    - web/static/data/hero-run.json
  modified:
    - web/package.json
key-decisions:
  - "A case-variant full name ('ALEX rivera') redacts to ONE [redacted:name] token because the full name is matched before its parts; parts alone still redact case-insensitively"
  - "preflight is stored unredacted (ids + new/exists only); plan payload recipients (contact emails) are intentionally kept so the UI can show who each draft goes to"
  - "CLI names are scripts/sprint.ts + npm run record (ROADMAP/UI-SPEC copy said scripts/record.ts); Phase 7 error copy should say `npm run record`"
  - "sprint.test.ts counts artifacts by this plan's idempotency keys; the default seed holds 2 unkeyed essay docs and nothing else, so CLI whole-collection totals equal plan counts"
requirements-completed: [AGENT-01, AGENT-03, AGENT-05, AGENT-06, APPS-01, APPS-02, APPS-03, APPS-06]
duration: 15min
completed: 2026-09-13
---

# Phase 4 Plan 03: Sprint Orchestration, Redacted Trace and Hero Recording Summary

**This plan closes Phase 4. `planSprint` and `executeSprint` run gap analysis, planning, HMAC signing, authorization, execution, read-back verification and the RunReport in two calls. Exported traces have student name, email and GPA redacted. The `HeroRunFile` contract matches 07-UI-SPEC. Twelve end-to-end scenarios cover every reliability claim, and a terminal CLI records `static/traces/demo-sprint.jsonl` and `static/data/hero-run.json`. In that recording the rerun is 23/23 deduped with zero new writes.**

## Performance

- **Duration:** about 15 minutes
- **Tasks:** 3 (5 commits)
- **Files:** 10 created, 1 modified (`web/package.json`, two script lines)

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Trace PII redaction + JSONL | `10bb18e` (test), `08b88be` (feat) |
| 2 | planSprint/executeSprint + recording contract + barrel + e2e scenarios | `dd6011a` (test), `63fbde1` (feat) |
| 3 | scripts/sprint.ts CLI + npm scripts + committed recordings | `8021f3f` (feat) |

## Exported signatures (Phases 5, 6, 7, 9, 11 import these)

### trace/redact.ts
```ts
export const REDACTED: Readonly<{ name: '[redacted:name]'; email: '[redacted:email]'; gpa: '[redacted:gpa]' }>;
export interface PiiSpec { names: string[]; emails: string[]; gpa: number | null }
export function piiFromProfile(p: Profile): PiiSpec;                 // demo -> { names: ['Alex Rivera','Alex','Rivera'], emails: ['alex.rivera@example.com'], gpa: 3.3 }
export function redactText(s: string, pii: PiiSpec): string;         // email -> names (longest first, word-bounded, case-insensitive) -> "GPA ... <n>" phrase -> standalone gpa value
export function redactValue<T>(v: T, pii: PiiSpec): T;               // deep copy; strings redacted; keys gpa|studentGpa|student_gpa -> '[redacted:gpa]'; other numbers untouched
export function redactTraceEvent(e: TraceEvent, pii: PiiSpec): TraceEvent;  // attrs only
```

### trace/jsonl.ts
```ts
export function toJsonl(events: readonly TraceEvent[]): string;      // JSON per line + '\n'; '' when empty; LF only
export function parseJsonl(text: string): TraceEvent[];              // skips blank lines, tolerates CRLF, throws "parseJsonl: invalid trace event on line N: ..."
```

### agent/sprint.ts
```ts
export interface SprintRuntime {
  connectors: Connectors; mode: 'mock' | 'real'; llm: LLM; tracer: Tracer;
  planSecret: string;            // injected; core never reads env
  today: string;                 // YYYY-MM-DD
  now?: () => number; sleep?: (ms: number) => Promise<void>;
  limits?: Partial<SprintLimits>; repairArgs?: ExecContext['repairArgs'];
}
export function allActionIds(plan: Plan): string[];
export async function planSprint(rt: SprintRuntime, input: { profile: Profile; schools: SchoolsDataset; createdAt: string }): Promise<PlanResult>;  // { plan, planToken, reports }; no connector calls
export async function executeSprint(rt: SprintRuntime, input: { plan: unknown; planToken: string; approvedIds: string[]; profile: Profile; runId?: string }): Promise<RunReport>;
// throws PolicyError ('invalid_plan' | 'invalid_plan_token' | 'unknown_action_id') BEFORE any write, after emitting policy.rejected
// runId defaults to `run-${tracer.traceId}`; report timestamps use rt.now ?? Date.now
```

### agent/recording.ts
```ts
export const RecordedRun = z.object({ events: z.array(TraceEvent), report: RunReport });
export const PreflightStatus = z.enum(['new', 'exists']);
export const HeroRunFile = z.object({
  recordedAt: z.iso.datetime(), commitSha: z.string().min(1), profileId: z.string().min(1),
  plan: Plan, preflight: z.record(z.string(), PreflightStatus).optional(),
  events: z.array(TraceEvent), report: RunReport, rerun: RecordedRun.optional()
});   // + inferred types RecordedRun, PreflightStatus, HeroRunFile
export async function preflightPlan(connectors: Connectors, plan: Plan): Promise<Record<string, 'new' | 'exists'>>;  // sequential read-only findByKey; unknown tool / read error -> 'new'
export function buildHeroRunFile(input: { recordedAt: string; commitSha: string; profile: Profile; plan: Plan;
  preflight?: Record<string, 'new' | 'exists'>; events: TraceEvent[]; report: RunReport;
  rerun?: { events: TraceEvent[]; report: RunReport } }): HeroRunFile;   // redacts plan/events/report(s), then HeroRunFile.parse
```

### agent/index.ts
`export *` from types, idempotency, planner, policy, retry, guards, executor, verifier, sprint and recording. There were no name collisions, so no named re-exports were needed.

## How downstream phases call this

```ts
import { createConnectors } from '$lib/core/connectors/index';      // routes: extensionless $lib; core/scripts: relative .ts
import { createTracer, MemorySink, CallbackSink } from '$lib/core/trace/tracer';
import { planSprint, executeSprint, allActionIds, preflightPlan, buildHeroRunFile, HeroRunFile, PolicyError } from '$lib/core/agent/index';

// Phase 9 routes: POST /api/plan -> planSprint; POST /api/execute -> executeSprint with a CallbackSink streaming SSE
const rt = { connectors: createConnectors({ mode: 'mock' }), mode: 'mock' as const, llm, planSecret: env.PLAN_SIGNING_SECRET,
             today, tracer: createTracer({ sinks: [new CallbackSink((e) => sse.send(redactTraceEvent(e, pii)))] }) };
const { plan, planToken } = await planSprint(rt, { profile, schools, createdAt: new Date().toISOString() });
const preflight = await preflightPlan(rt.connectors, plan);            // UI "New" / "Exists: will dedupe" badges
try { const report = await executeSprint(rt, { plan, planToken, approvedIds, profile }); }
catch (e) { if (e instanceof PolicyError) return json({ code: e.code, details: e.details }, { status: 403 }); throw e; }

// Phase 6 evals: per scenario createConnectors({ mode: 'mock', seed, faults: { rules, seed, sleep } }); inject rt.sleep = async () => {};
// slice MemorySink events around executeSprint; build silent-failure-run.json from buildHeroRunFile(...) parts + an `oracle` block,
// or reuse the CLI: `npx tsx scripts/sprint.ts --profile demo --auto-approve --faults lying-success --json <path>`.

// Phase 7 ReplaySource: loadStatic('data/hero-run.json', HeroRunFile) -> file.plan / file.preflight / file.events / file.report / file.rerun
// Phase 11 MCP: registerTool('plan_sprint' | 'execute_sprint', ...) wrapping the same two calls.
```

## Trace vocabulary and contract-to-UI mapping

Orchestration events added by this plan wrap the 04-02 executor and verifier events (see 04-02-SUMMARY for their attrs):

| Name | Kind | Status | Attrs |
| --- | --- | --- | --- |
| `plan` | span | ok | `profileId, targets` |
| `plan.built` | event (from buildPlan) | (none) | `planId, actions` |
| `plan.dry_run` | event | (none) | `planId, actions: [{ id, app, tool, key, summary }]` |
| `policy.rejected` | event | error | `code, message, details` (then PolicyError is rethrown; zero writes) |
| `policy.authorized` | event | (none) | `planId, approved, skipped, blocked` |
| `execute` | span | ok | `planId`; contains the `action.execute`, `action.skipped`, `tool.call`, `retry`, `idempotency.*`, `args.repair`, `policy.blocked` and `guard.*` events |
| `verify` / `verify.readback` | spans (04-02) | see 04-02 | `actionId, app, tool, key, found, artifactStatus` |
| `run.end` | event | ok if status ok, else error | `runId, status, counts` |

The UI display mapping is the same one the CLI printer uses, from the `action.execute` END event:
- **ok:** status `ok` and `attempt <= 1`.
- **retried xN:** status `ok` and `attempt > 1`. The sub-rows are `retry` events with the same `actionId`.
- **deduped:** status `deduped` (`attempt 0`).
- **blocked:** status `skipped` with a reason of policy, allowlist, injection or not_approved. Unapproved actions emit only `action.skipped`.
- **FAILED:** status `error`.

A **lying success** has an END of status `ok`, but its `verify.readback` END has `found: false`, the ArtifactResult is `mismatch` with detail `read_back_missing: <tool> reported success but no artifact with key <key> exists`, it counts in `counts.failed`, and the report is `partial`.

## CLI

```
npx tsx scripts/sprint.ts --profile demo [--auto-approve | --approve id1,id2] [--faults rate-limit|ghost-write|lying-success|exhaust] [--rerun] [--today YYYY-MM-DD] [--out trace.jsonl] [--json run.json] [--expect-status ok|partial|failed] [--verbose]
npm --prefix web run record     # = --profile demo --auto-approve --rerun (rewrites both committed recordings)
npm --prefix web run sprint -- --profile demo --faults lying-success --auto-approve --expect-status partial
```

- **Exit codes:** 0 on success, 1 for `--expect-status` mismatch, `RERUN FAILED` or a crash, 2 for PolicyError, 64 for usage errors.
- **today:** pinned to `DEFAULT_CLOCK` (2026-09-13) unless `--today` is given.
- **Signing secret:** `PLAN_SIGNING_SECRET` when it is at least 16 characters, otherwise the local dev secret (with a note on stderr).
- **Paths:** repo paths resolve from `import.meta.url`, while `--out` and `--json` resolve from cwd.
- **Default outputs:** `static/traces/demo-sprint[-<faults>].jsonl`. `static/data/hero-run.json` is written only with no faults, `--auto-approve` and profile `demo`, or wherever `--json` points.

Sample output (redacted; truncated):
```
== PLAN plan-63478cfa9529 (dry run) ==
id | app | tool | key | new/exists | summary
uc-berkeley-data-science-ba.draft_admissions_question | gmail | gmail.createDraft | tp1-93ef6becac5251ac | new | Draft admissions question to Berkeley Transfer Admissions
    to=["transfer-questions@example.edu"] subject=[TransferPilot] Question about Data Science BA (...) transfer requirements (Fall 2027)
BLOCKER NO_TRANSFER_PROGRAM northfield-fictional-cs: Computer Science (FICTIONAL) does not accept transfer applicants.
planToken v1.pepD7zXi…  (23 actions)

== EXECUTE (23 approved) ==
policy.authorized planId=plan-63478cfa9529 approved=23 skipped=0 blocked=0
# 1 docs     docs.createDoc             try 1/3 2ms ok
    ↻ try 1 429 rate_limit waited 50ms re-checked key: not found      (--faults rate-limit)
    ↻ try 2 429 rate_limit waited 50ms re-checked key: not found
# 2 notion   notion.upsertTrackerRow    try 3/3 122ms retried x3
   readback umich-lsa.event_t3 found=true → verified
run.end runId=run-demo-sprint status=ok counts={"verified":23,"deduped":0,"failed":0,"skipped":0}

== FINAL STATE ==
notion rows: 3
calendar events: 13
docs created: 3
gmail drafts: 4
gmail sent: 0
past events: 0

== REPORT ==
status ok
verified 23  deduped 0  failed 0  skipped 0
BLOCKER NO_TRANSFER_PROGRAM: Computer Science (FICTIONAL) does not accept transfer applicants.

== RERUN (same world, no faults) ==
#24 docs     docs.createDoc             try 0/3 0ms deduped
run.end runId=run-demo-sprint status=ok counts={"verified":0,"deduped":23,"failed":0,"skipped":0}
RERUN: 0 new writes (23/23 deduped)
trace: static/traces/demo-sprint.jsonl (310 events, PII redacted)
run: static/data/hero-run.json (UI-SPEC hero-run shape, PII redacted)
```

With `--faults lying-success`, the run ends `status partial` with `verified 22  deduped 0  failed 1  skipped 0`, the readback line `readback uc-berkeley-data-science-ba.event_deadline found=false → mismatch`, and `mismatch uc-berkeley-data-science-ba.event_deadline read_back_missing: calendar.createEvent reported success but no artifact with key tp1-6291ad50f840c62f exists`.

## Recorded files

| File | Content | Counts |
| --- | --- | --- |
| `web/static/traces/demo-sprint.jsonl` | Full redacted session trace (plan, run 1, rerun plan, rerun); LF only | 310 events; 207 `action.execute` / `verify.readback` / `idempotency.hit` name matches; 4 `[redacted:name]` + 2 `[redacted:gpa]` |
| `web/static/data/hero-run.json` | `HeroRunFile` (UI-SPEC shape), commitSha `63fbde1`, profileId `demo` | run 1: 144 events (23 `action.execute` END, 23 `verify.readback` END, 46 `tool.call`), status ok, counts 23/0/0/0; preflight 23 x `new`; rerun: 144 events, 23 `idempotency.hit`, counts 0/23/0/0; blockers `[NO_TRANSFER_PROGRAM]` |

The fault-preset runs are not committed. They produced 155 events (lying-success), 161 (ghost-write), 164 (rate-limit), 170 (exhaust) and 11 (dry run).

Redaction lands on draft signatures (`Thank you,\n[redacted:name]`) and on the GPA gap message (`GPA [redacted:gpa] is below the ...`). Contact recipients such as `lchen@example.edu` stay visible on purpose.

**Naming note for Phase 7:** ROADMAP and 07-UI-SPEC copy mention `scripts/record.ts`. The script is `web/scripts/sprint.ts`, and the recorder alias is `npm run record`, so error and empty-state copy should say "Run `npm run record` in `web/`".

## Verification

- `npm --prefix web test -- src/lib/core/trace/redact.test.ts`: 12 tests pass.
- `npm --prefix web test -- src/lib/core/agent/sprint.test.ts`: 12 scenario tests pass. They cover happy path, rerun dedupe, unapproved, tampered/unknown-id/swapped-contacts, 429, ghost-write, lying-success, non-allowlisted, exhausted retries, trace redaction round-trip, step cap and the recording contract.
- **Full suite** (`npm --prefix web test`): 546 of 546 tests pass across 32 files. Two files fail to load (`critique/analyze.test.ts`, `grounding/injection.test.ts`). They are plan 05-01's RED tests, committed in parallel (`19000da`), and not part of this plan.
- **svelte-check** (`npm --prefix web run check`): 0 errors across 805 files after Task 2. After Task 3 it reports 22 errors, all in parallel plans' in-progress files (`critique/analyze.test.ts`, `critique/policy-render.test.ts`, `grounding/claims.test.ts`, `llm/select.test.ts`). None are in this plan's files.
- **Plan Task 3 verify command, run verbatim:** it printed `HERO_OK 310`, ran the lying-success / ghost-write / rate-limit presets with their expected statuses (all exit 0), and removed its scratch files.
- **HeroRunFile.parse and parseJsonl** on the committed files: ZOD_OK, with no CR characters in either file.
- **PII greps** over both recordings: `Alex Rivera` 0, `alex.rivera@example.com` 0, `GPA[^0-9]{0,24}3\.3` 0, bare `alex`/`rivera` words 0. `redacted:` appears 5 times in the JSONL.
- **Other checks:**
  - The CLI dry run exits 0 and prints `Dry run only`. An unknown flag exits 64. `--faults exhaust --expect-status partial` exits 0 with 3 `integration_failure`s.
  - The `process\.env|from 'node:` grep over agent, trace and llm (non-test files) returns nothing.
  - The `package.json` diff is exactly the two script lines.
- **Acceptance greps met:**
  - sprint.ts: planSprint/executeSprint 2, `authorizeExecution(` 1, `verifyOutcomes(` 1, `buildRunReport(` 1
  - recording.ts: 3 exports
  - sprint.test.ts: fault/status literals 15, `gmail.sent` 1, `HeroRunFile.parse` 1
  - redact.ts: 4 exports; jsonl.ts: 2 exports; `13.30` and `latencyMs` guards are tested
  - CLI: 394 lines, `buildHeroRunFile(` 1, `redactTraceEvent(` 2, `world:` 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spec example for case-variant full names contradicted the specified algorithm**
- **Found during:** Task 1 (GREEN)
- **Issue:** The behavior bullet expected `'ALEX rivera wrote'` to become `'[redacted:name] [redacted:name] wrote'`. The specified algorithm matches the full name (longest first, case-insensitive) before its parts, which yields one token. That is also what the plan's own `'Thank you,\nAlex Rivera'` example requires.
- **Fix:** I kept the algorithm and changed the test to expect one token. I added `'RIVERA and alex wrote'` to prove parts alone still redact case-insensitively.
- **Files modified:** web/src/lib/core/trace/redact.test.ts
- **Commit:** 10bb18e

**2. [Rule 3 - Blocking] Optional-type index in the faulted-runtime test helper**
- **Found during:** Task 2
- **Issue:** `MockConnectorOptions['faults']['rules']` indexes an optional property, which is a type error.
- **Fix:** I used `NonNullable<MockConnectorOptions['faults']>['rules']` in the test and in the CLI.
- **Commit:** dd6011a, 8021f3f

### Minor interpretation choices
- **Fault sleep in tests:** faulted test runtimes pass `faults.sleep` delegating to `rt.sleep`, so `rt.sleep` records every wait (scenario 5 asserts `sleep(10)` at least 3 times).
- **Scenario counts:** world counts are restricted to the plan's idempotency keys, which makes the tests independent of seed fixtures.
- **Scenario 9:** it also asserts `counts.verified === 20`.
- **Scenario 12:** it also asserts `rerun.report.counts.deduped === 23` inside the built file.
- **Scenario 4:** it asserts exactly three `policy.rejected` events.
- **CLI extras:**
  - `--verbose` prints `tool.call` lines.
  - `--auto-approve` and `--approve` are mutually exclusive (exit 64).
  - `--today` is format-checked.
  - An `exhaust` preset run was verified in addition to the three presets the plan required.
- **`PreflightStatus`:** exported as a named zod enum and reused in `HeroRunFile`. The shape is unchanged.
- **`parseJsonl`:** reports malformed JSON with the line number too, not only schema failures.
- **`preflight` redaction:** not passed through `redactValue`. It holds only action ids and `new`/`exists`.

### 04-01 / 04-02 interface differences
None. Every import matched 04-01-SUMMARY and 04-02-SUMMARY exactly.

## Known Stubs

None in this plan. The recorded drafts and critique docs carry the FakeLLM placeholder text from 04-01 (`llm/fake.ts`). That is intentional until Phase 5 (rubric critique) and Phase 8 (real LLM). Phase 5-02 plans to re-record the hero run.

## Deferred Issues

- Out of scope: svelte-check errors and suite load failures in parallel plans' in-progress files (`critique/**`, `grounding/**`, `llm/select.test.ts`), owned by plans 05-01 and 08-01.

## Self-Check: PASSED

- All 10 created files exist, and `web/package.json` carries exactly the two new script lines.
- Commits 10bb18e, 08b88be, dd6011a, 63fbde1 and 8021f3f are present in `git log`. None of their messages contain attribution trailers.
- This plan's files show no uncommitted changes after the Task 3 commit.

---
phase: 04-sprint-pipeline-on-mocks
verified: 2026-09-13T14:55:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 4: Sprint Pipeline on Mocks Verification Report

**Phase Goal:** The hero sprint runs end-to-end in the terminal on mocks with a scripted FakeLLM. It plans, gates on approval, executes with idempotency and retries, verifies by reading back real state, and emits a trace. Re-runs create zero duplicates.
**Verified:** 2026-09-13T14:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `scripts/sprint.ts` prints a dry-run plan and executes only approved ids; an unknown id or tampered plan token is rejected before any write | ✓ VERIFIED | CLI run printed `== PLAN` table with app/tool/key/new-or-exists/summary; adversarial script test A: tampered plan (mutated draft subject post-signing) rejected with `PolicyError code=invalid_plan_token`, world diff empty; test B: unknown approved id rejected with `code=unknown_action_id`, and an id excluded from `approvedIds` ends `skipped` and never executes |
| 2 | One approved run produces 3 tracker rows, 13 calendar events (none past), 3 keyed docs, 4 Gmail drafts, 0 sent; a second run reports all `deduped` with unchanged counts | ✓ VERIFIED | CLI `== FINAL STATE ==`: `notion rows: 3`, `calendar events: 13`, `docs created: 3`, `gmail drafts: 4`, `gmail sent: 0`, `past events: 0`; `== RERUN ==` printed `RERUN: 0 new writes (23/23 deduped)` and `run.end … counts={"verified":0,"deduped":23,"failed":0,"skipped":0}` |
| 3 | 429/ghost-write faults recover without duplicates; exhausted retries surface an integration failure, not a silent success | ✓ VERIFIED | Adversarial test F: 429 burst on notion (2 rate-limited calls) recovered with outcome `created`, attempts ≤3; exhausted notion 500 on every call produced outcome `failed` with detail `integration_failure: …`; test E: ghost-write on gmail.createDraft call 1 still produced exactly 4 drafts total (no duplicate) |
| 4 | RunReport marks each artifact verified/failed from read-back of final state, not intent; args are zod-validated with a repair retry; a hard step cap stops runaway loops | ✓ VERIFIED | Adversarial test D: calendar lying-success fault made the executor believe `created`, but read-back verification produced artifact `status: 'mismatch'`, `detail: 'read_back_missing: …'`, and `report.status: 'partial'` (not `'ok'`) — a lying success is caught, not silently reported as success. Unit tests (verifier.test.ts) also cover repair-retry and step-cap halting, all passing |
| 5 | Each run writes a structured JSONL trace with student name/email/GPA redacted | ✓ VERIFIED | `web/static/traces/demo-sprint.jsonl` (310 events) and `web/static/data/hero-run.json` exist; grep for `"Alex Rivera"`, `"alex.rivera@example.com"` (case-insensitive), and `GPA[^0-9]{0,24}3\.3` across both files returns 0 matches |
| 6 | A non-allowlisted Gmail recipient is blocked before any write | ✓ VERIFIED | Adversarial test C: draft re-pointed to `evil@evil.example` (post-signing) produced outcome `blocked`; no draft containing `evil.example` exists in world state afterward |
| 7 | Core agent code contains no environment reads, Node built-ins, or non-deterministic clock/random calls | ✓ VERIFIED | `grep -rnE "process\.env|from 'node:|node:[a-z]|Date\.now\(\)|Math\.random\(\)" web/src/lib/core/agent --include=*.ts` (excluding `.test.ts`) returned nothing |
| 8 | All Phase 4 requirement IDs (AGENT-01/03/05/06, APPS-01/02/03/06) are satisfied by shipped code | ✓ VERIFIED | Declared across 04-01/02/03 PLAN frontmatter, all marked `[x] Complete` in REQUIREMENTS.md, and independently exercised by the truths above |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `web/src/lib/core/agent/types.ts` | agent contracts + trace vocabulary | ✓ VERIFIED | ACTION_KINDS, DETAIL, TRACE, ExecOutcome, Authorization, PolicyError, DEFAULT_LIMITS all present and used throughout executor/verifier/policy |
| `web/src/lib/core/agent/idempotency.ts` | deterministic key derivation | ✓ VERIFIED | `deriveIdempotencyKey` used by planner; keys stable across runs (rerun test showed 23/23 deduped) |
| `web/src/lib/core/tools/sprint-tools.ts` | 4 write tools, strict zod, registry | ✓ VERIFIED | `sprintRegistry`/`WRITE_TOOLS`/`getWriteTool` exercised by executor and adversarial script; no `send`-named tool |
| `web/src/lib/core/llm/{types,fake}.ts` | LLM slot interface + FakeLLM w/ repair | ✓ VERIFIED | `createFakeLLM` used in planner/CLI; `callSlot` repair-retry covered by planner.test.ts (passing) |
| `web/src/lib/core/agent/planner.ts` | buildPlan → 23-action demo plan | ✓ VERIFIED | CLI plan output showed all 23 actions; Northfield produced 0 actions + `NO_TRANSFER_PROGRAM` blocker |
| `web/src/lib/core/agent/policy.ts` | HMAC plan token, approved-id filter, allowlist | ✓ VERIFIED | Adversarial tests A/B/C exercised signPlan/authorizeExecution/checkActionPolicy directly |
| `web/src/lib/core/agent/executor.ts` | executePlan: dep order, findByKey, retries, spans | ✓ VERIFIED | executor.test.ts (part of 128 passing); adversarial tests D/E/F exercised retry/ghost-write/lying-success paths directly |
| `web/src/lib/core/agent/verifier.ts` | verifyOutcomes/buildRunReport, read-back grading | ✓ VERIFIED | verifier.test.ts passing; adversarial test D confirms mismatch/partial semantics live |
| `web/src/lib/core/trace/tracer.ts` (SpanControl) | additive END status/attrs | ✓ VERIFIED | span-control.test.ts passing; CLI trace lines show attempt/status per action |
| `web/src/lib/core/trace/redact.ts`, `jsonl.ts` | PII redaction + JSONL serialize | ✓ VERIFIED | redact.test.ts passing; demo-sprint.jsonl/hero-run.json show 0 PII hits and contain `[redacted:` markers |
| `web/src/lib/core/agent/sprint.ts` | planSprint/executeSprint orchestration | ✓ VERIFIED | sprint.test.ts (12 scenarios) passing; CLI uses these calls directly |
| `web/src/lib/core/agent/recording.ts` | HeroRunFile contract, preflight, redacted builder | ✓ VERIFIED | hero-run.json validates against the documented shape (`recordedAt, commitSha, profileId, plan, preflight, events, report, rerun`) |
| `web/scripts/sprint.ts` | terminal CLI + recorder | ✓ VERIFIED | Ran live: printed plan, executed, printed final state/report, reran, wrote both recording files |
| `web/static/data/hero-run.json` | recorded hero run for Phase 7 | ✓ VERIFIED | Present, 23 actions, `rerun` block present, 0 PII hits, unchanged by this verification run (git diff clean) |
| `web/static/traces/demo-sprint.jsonl` | recorded redacted trace | ✓ VERIFIED | Present, 310 lines, 0 PII hits, unchanged by this verification run (git diff clean) |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `agent/planner.ts` | `gap/index.ts` | consumes `GapReport[]` | WIRED | `analyzeGaps` output drives buildPlan (CLI plan matches gap facts, e.g. Berkeley gapCount, Cornell recs) |
| `agent/planner.ts` | `agent/idempotency.ts` | `deriveIdempotencyKey` per action | WIRED | All 23 actions in CLI output show `tp1-` prefixed keys |
| `agent/policy.ts` | `tools/sprint-tools.ts` | `getWriteTool` for tool/app/effect checks | WIRED | Adversarial test C blocked a policy violation via this path |
| `agent/policy.ts` | `globalThis.crypto.subtle` | HMAC sign/verify | WIRED | Tamper test (A) proves HMAC verification actually fails on mutation |
| `agent/executor.ts` | `tools/sprint-tools.ts` | `findByKey`/`run`/`input.safeParse` | WIRED | Rerun deduped all 23 actions via findByKey; ghost-write test recovered via re-check |
| `agent/executor.ts` | `agent/retry.ts` | `beforeRetry` re-check | WIRED | 429 burst and ghost-write tests both show recovery via re-check-before-retry behavior |
| `agent/executor.ts` | `trace/tracer.ts` | `ctl.status`/`ctl.set` | WIRED | CLI trace lines show live status/attempt per action, sourced from SpanControl |
| `agent/verifier.ts` | connector ports (`findByKey`+`diff`) | read-back grading | WIRED | Lying-success test proves the report reflects read-back state, not executor's return value |
| `agent/sprint.ts` | `agent/policy.ts` | `authorizeExecution` before `executePlan` | WIRED | executeSprint (used by CLI) rejects tampered tokens before any write, per sprint.test.ts scenario 4 |
| `scripts/sprint.ts` | `agent/recording.ts` | `buildHeroRunFile` → `static/data/hero-run.json` | WIRED | File exists, validates, content matches a real run |
| `scripts/sprint.ts` | `trace/redact.ts` | `redactTraceEvent` on exported/printed events | WIRED | 0 PII hits in both recorded artifacts |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| AGENT-01 | 04-01, 04-02, 04-03 | multi-step loop with schema-validated tool calls, repair, step cap | ✓ SATISFIED | executor.test.ts + adversarial tests F (retry) and step-cap coverage in verifier.test.ts |
| AGENT-03 | 04-01, 04-03 | dry-run plan + approval before write | ✓ SATISFIED | CLI plan printout; unapproved/blocked adversarial tests |
| AGENT-05 | 04-02, 04-03 | read-back verification | ✓ SATISFIED | Adversarial test D (lying success caught as mismatch) |
| AGENT-06 | 04-03 | structured, redacted trace | ✓ SATISFIED | demo-sprint.jsonl/hero-run.json 0 PII hits |
| APPS-01 | 04-01, 04-02, 04-03 | Notion tracker row upsert, dedupe | ✓ SATISFIED | 3 rows after run, rerun deduped |
| APPS-02 | 04-01, 04-02, 04-03 | Calendar events, skip past dates, dedupe key | ✓ SATISFIED | 13 events, 0 in the past, rerun deduped |
| APPS-03 | 04-01, 04-02, 04-03 | Gmail drafts only, no send, dedupe by key | ✓ SATISFIED | 4 drafts, 0 sent, no `send`-named tool exists |
| APPS-06 | 04-02, 04-03 | retry with backoff, surface integration failures | ✓ SATISFIED | Adversarial test F (burst recovery + exhaustion → integration_failure) |

No orphaned requirements — all 8 IDs assigned to this phase in REQUIREMENTS.md are claimed by 04-01/02/03 plan frontmatter, and REQUIREMENTS.md marks all 8 `Complete`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `web/src/lib/core/llm/select.ts` | 3, 23 | comment mentions `process.env` | ℹ️ Info | Not a Phase 4 file; belongs to a concurrently-executing plan (05-01/08-02). No actual `process.env` read exists in Phase 4 scope (`agent/**`, `trace/**`, `llm/types.ts`, `llm/fake.ts`) |
| `web/src/lib/core/critique/**`, `web/src/lib/core/grounding/**`, `web/src/lib/core/llm/{select,ollama,openai-compat}*` | — | in-progress files from concurrent Phase 5/8 plans | ℹ️ Info | Recorded per instructions; not part of Phase 4 and did not interfere with the Phase 4 test scope run |
| `scripts/sprint.ts` (CLI behavior) | — | plain `npx tsx scripts/sprint.ts --profile demo --auto-approve --rerun` (with no `--out`/`--json`) overwrites the tracked `web/static/traces/demo-sprint.jsonl` and `web/static/data/hero-run.json` in place | ⚠️ Warning | Non-blocking follow-up (flagged by coordinator mid-verification): the recording CLI should require an explicit flag (e.g. only `npm run record`) to mutate committed showcase files, rather than doing so on every plain invocation. In this verification run the output was byte-identical (git diff clean) because the pipeline is fully deterministic, but this is incidental — a future change to FakeLLM/data could silently rewrite committed artifacts on any ad hoc `sprint.ts` invocation. |

### Human Verification Required

None. All Phase 4 success criteria are mechanically verifiable and were verified via automated tests, a live CLI run, and an independent adversarial script.

### Gaps Summary

No gaps found. All 8 observable truths, all 15 required artifacts, all 11 key links, and all 8 requirement IDs are verified against actual running code (not just SUMMARY claims). The full Phase 4 test scope (128 tests across agent/trace/tools/llm-fake) passes. The live CLI run reproduced the exact expected output (23 actions, Northfield blocked, verified final state 3/13/3/4/0, rerun 23/23 deduped with 0 new writes). An independent adversarial script (written outside the repo, deleted after use) directly exercised policy.ts/executor.ts/verifier.ts and confirmed: a tampered plan is rejected before any write with an empty world diff; an id outside `approvedIds` never executes; a non-allowlisted recipient is blocked; a lying-success fault is caught as a `mismatch` artifact with `report.status: 'partial'` rather than a false success; a ghost-write produces exactly one artifact; and a 429 burst recovers while an exhausted retry surfaces `integration_failure`. PII greps across both recorded artifacts returned 0 hits, and the core agent boundary (no `process.env`/`node:`/`Date.now`/`Math.random`) holds.

One non-blocking process note (not a phase-goal gap, see Anti-Patterns table): `scripts/sprint.ts` writes to the tracked recording files by default rather than requiring an explicit opt-in flag to mutate committed showcase artifacts.

---

_Verified: 2026-09-13T14:55:00Z_
_Verifier: Claude (gsd-verifier)_

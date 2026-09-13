---
phase: 06-eval-harness-real-pass-rates
verified: 2026-09-13T19:50:00Z
status: gaps_found
score: 2/5 roadmap success criteria verified (plan must-haves 10/13: 06-01 7/7, 06-02 3/6)
re_verification: false
gaps:
  - truth: "SC2: A deliberately weakened config produces a caught silent failure, saved as a replayable trace"
    status: partial
    reason: "Oracle independence and the caught silent failure are real: lying-success scores verifier-on 10/10 and verifier-off 0/10 communication_failure with 10 silent failures. But nothing replayable is saved. There is no silent-failure-run.json, no eval-silent-failure*.jsonl and no silentFailure pointer in evals.json. The CLI throws away the KeptRun traces the runner keeps."
    artifacts:
      - path: "web/src/lib/core/eval/report.ts"
        issue: "SilentFailureRun schema and buildSilentFailureRun are missing"
      - path: "web/scripts/eval.ts"
        issue: "Never writes silent-failure-run.json or the traces. Never calls redactTraceEvent. The self-check uses aggregates only."
      - path: "web/static/data/silent-failure-run.json"
        issue: "MISSING"
      - path: "web/static/traces/eval-silent-failure.jsonl"
        issue: "MISSING (and eval-silent-failure-verifier-off.jsonl)"
    missing:
      - "SilentFailureRun zod schema plus buildSilentFailureRun({on, off, recordedAt, commitSha}) with oracle {caught, failureClass, expected, found, stepSpanId} and a before block"
      - "eval.ts writes static/data/silent-failure-run.json and redacted static/traces/eval-silent-failure{,-verifier-off}.jsonl from suite.kept lying-success run 0"
      - "evals.json silentFailure pointer { file: 'data/silent-failure-run.json', scenarioId: 'lying-success' }"
      - "Tests for buildSilentFailureRun (stepSpanId matches a verify.readback end event with found=false, no PII)"
  - truth: "SC4: The runner accepts --llm ollama|hosted so LLM-backed runs appear as separate columns"
    status: partial
    reason: "The no-key scripted baseline works (22 scenarios x 10 x 2 configs, 6.2s, deterministic). But resolveLlmColumn always calls process.exit(2), and its message says the Phase 8 selector is needed even though src/lib/core/llm/select.ts already exports parseLlmFlag, resolveLlmConfig, createLLM and llmRunMeta. There is no mergeEvalsFiles, so an LLM run would overwrite the baseline columns instead of adding a new one."
    artifacts:
      - path: "web/scripts/eval.ts"
        issue: "resolveLlmColumn is an exit-2 stub (lines 103-109) with a stale message"
      - path: "web/src/lib/core/eval/report.ts"
        issue: "mergeEvalsFiles missing"
    missing:
      - "Wire resolveLlmColumn to llm/select.ts (parseLlmFlag -> resolveLlmConfig(process.env,{provider}) -> createLLM + llmRunMeta); exit 2 only on LlmConfigError"
      - "mergeEvalsFiles(base, incoming) that is non-destructive in both directions, and eval.ts merging into an existing evals.json"
  - truth: "SC5: A markdown results table for BRIEF.md is generated from the same results file"
    status: failed
    reason: "renderMarkdownTables and web/static/data/evals.md do not exist. BRIEF.md section 4 still holds {{PASS_RATE}} placeholders and a TODO(phase 6) comment."
    artifacts:
      - path: "web/src/lib/core/eval/report.ts"
        issue: "renderMarkdownTables missing"
      - path: "web/static/data/evals.md"
        issue: "MISSING"
    missing:
      - "renderMarkdownTables(file) with the exact BRIEF header, a verifier on/off before-after table, a Known weaknesses line and a footer"
      - "eval.ts --md flag writing static/data/evals.md"
human_verification: []
---

# Phase 6: Eval Harness & Real Pass Rates Verification Report

**Phase Goal:** We can prove reliability. Eight or more seeded adversarial scenarios run N times against mocks, are graded by an independent final-state oracle, classified with Lemma's taxonomy, and written to a committed JSON artifact.
**Verified:** 2026-09-13T19:50:00Z
**Status:** gaps_found
**Re-verification:** No (initial verification)

## Context: scope cut

Plan 06-02 was executed under a "SCOPE CUT" override block. That block exists only as an **uncommitted** working-tree change to `06-02-PLAN.md`. It dropped the silent-failure replay, the eval traces, evals.md, mergeEvalsFiles and the LLM hook. Commit 43ad106 in `tasks/lessons.md` records that the 3:45 deadline behind the cut was a timezone mistake: the real deadline is 7:00 PM ET. The ROADMAP success criteria were never amended, so this report measures against them. The deferred items are real gaps against the phase contract, and restoring them is the reversible path the lesson calls for.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The eval command runs 8+ scenarios N times in minutes and writes static/data/evals.json with pass rate, pass^k, failure classes, run count, model, commit SHA and timestamp | VERIFIED | I re-ran `npx tsx scripts/eval.ts --n 10 --quiet --out <scratch>`: exit 0, 22 scenarios, 440 runs, 6.2s. The output matches the committed evals.json except generatedAt/commitSha (deterministic). The committed file has schemaVersion, generatedAt, commitSha ffb47f3, n 10, seed 1337, model fake-scripted, and per-scenario runs/passed/passRate/passK/passHatK/failures/silentFailures, plus totals and failureTotals. All listed scenario types are present (EVAL01_COVERAGE). Note: `npm run eval` does not exist in package.json; the equivalent is `npx tsx scripts/eval.ts` (documented in the SUMMARY). |
| 2 | Oracle reads World directly; weakened config produces a caught silent failure saved as a replayable trace | PARTIAL (FAILED) | Independence verified: oracle.ts imports only `diffWorldStates` plus types, and the grep for agent/executor/verifier/executeSprint returns 0. RunReport is read only in honesty.* checks. Caught verified: lying-success gives `fake` 10/10 and `fake-verifier-off` 0/10 {communication_failure: 10}, silentFailures 10, and the CLI self-check exits 1 otherwise. **Not saved as a replayable trace:** silent-failure-run.json, eval-silent-failure.jsonl and eval-silent-failure-verifier-off.jsonl are absent (web/static/traces holds only demo-sprint.jsonl), and evals.json has no silentFailure pointer. |
| 3 | Every failed run carries a primary Lemma label; report shows breakdown | VERIFIED | classify.ts returns exactly one primary from the 7-class FailureClass enum for any failed oracle, with a skipped_work fallback so no failure goes unlabeled. The runner stores the primary per record. evals.json has per-scenario `failures` and `failureTotals` (fake: integration 5, instruction 10, hallucination 10, communication 10). Known weaknesses map to the expected classes (W1 instruction_violation, W2 hallucination, W3 communication_failure). classify.test.ts passes. |
| 4 | Deterministic scripted baseline runs full suite with no key; `--llm ollama|hosted` adds separate columns | PARTIAL (FAILED) | Baseline verified: FakeLLM, no env/key, two columns (verifier-on/off). `--llm ollama` is only a stub: my probe exited 2 with "needs the Phase 8 LLM selector", yet `llm/select.ts` already exports parseLlmFlag/resolveLlmConfig/createLLM/llmRunMeta. No mergeEvalsFiles exists. LLM columns cannot be produced. |
| 5 | Markdown results table for BRIEF.md generated from the same results file | FAILED | `renderMarkdownTables` is absent from report.ts. `web/static/data/evals.md` does not exist. BRIEF.md lines 70-78 still hold `TODO(phase 6)` and `{{PASS_RATE}}` placeholders. |

**Score:** 2/5 success criteria verified (1, 3); 2 partial (2, 4); 1 failed (5).

### Plan must-haves

**06-01 (7/7 verified):** 22 enabled data-only scenarios covering EVAL-01. The injection-leak scan reads outputs only (oracle.ts:121-131 skips gmail.inbox). prepareRun is deterministic. runAgent has both verifier-on and verifier-off configs. The oracle is independent. Lying-success is graded as a silent failure under verifier-off. The classifier uses first-match precedence. Evidence: 99/99 eval tests pass (scenarios, oracle, classify, runner).

**06-02 (3/6 verified):**
- VERIFIED: runSuite runs N x column on fresh seeded Worlds and is deterministic (rerun identical).
- VERIFIED: metrics give passRate, passK and tau-bench passHatK, plus totals.
- VERIFIED: the no-key CLI writes evals.json in under 60s with commitSha/seed/n/generatedAt/model. The optional silentFailure pointer is absent.
- FAILED: silent-failure-run.json and the redacted traces, including the exit-1 check built on them.
- FAILED: evals.md BRIEF tables and the Known weaknesses line.
- FAILED: the `--llm` hook merging a column non-destructively.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `web/src/lib/core/eval/types.ts` | contracts, AGENT_CONFIGS | VERIFIED | 105 lines, used by all eval modules |
| `web/src/lib/core/eval/scenarios.ts` | 22 scenarios + EVAL01_COVERAGE | VERIFIED | 327 lines, frozen data |
| `web/src/lib/core/eval/setup.ts` | prepareRun, runSeedFor | VERIFIED | `seed: runSeed` fault wiring present |
| `web/src/lib/core/eval/agent.ts` | runAgent on/off | VERIFIED | calls executeSprint and executePlan+buildRunReport |
| `web/src/lib/core/eval/oracle.ts` | gradeRun | VERIFIED | 434 lines, independent |
| `web/src/lib/core/eval/classify.ts` | classifyFailure | VERIFIED | 7 classes, labels/definitions |
| `web/src/lib/core/eval/metrics.ts` | passHatK, kValues, aggregateScenario | VERIFIED | 51 lines |
| `web/src/lib/core/eval/runner.ts` | runSuite, fakeColumns | VERIFIED | gradeRun + classifyFailure per run |
| `web/src/lib/core/eval/report.ts` | EvalsFile, SilentFailureRun, buildEvalsFile, mergeEvalsFiles, buildSilentFailureRun, renderMarkdownTables | PARTIAL | Only EvalsFile/buildEvalsFile exist; 3 of 5 planned exports are missing |
| `web/scripts/eval.ts` | CLI (min 150 lines) | PARTIAL | 194 lines; LLM hook is a stub; no silent-failure/md outputs |
| `web/static/data/evals.json` | committed real numbers | VERIFIED | commit addd173; no PII/evil.example matches |
| `web/static/data/silent-failure-run.json` | replay + oracle block | MISSING | |
| `web/static/data/evals.md` | BRIEF tables | MISSING | |
| `web/static/traces/eval-silent-failure*.jsonl` | replayable traces | MISSING | |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| oracle.ts | connectors/index.ts | `diffWorldStates(` | WIRED | 2 calls |
| agent.ts | agent/index.ts | `executePlan(` | WIRED | verifier-off path |
| setup.ts | connectors/index.ts | `seed: runSeed` | WIRED | |
| classify.ts | schemas.ts | FailureClass | WIRED | |
| runner.ts | oracle.ts | `gradeRun(` then classifyFailure | WIRED | |
| scripts/eval.ts | report.ts | `buildEvalsFile(` | WIRED | EvalsFile.parse inside the builder |
| scripts/eval.ts | trace/redact.ts | `redactTraceEvent(` | NOT_WIRED | 0 matches (no traces exported) |
| evals.json | 07-UI-SPEC | `"silentFailure"` pointer | NOT_WIRED | 0 matches; only per-result `silentFailures` counts |
| scripts/eval.ts | llm/select.ts | dynamic import in resolveLlmColumn | NOT_WIRED | stub exits 2 unconditionally |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EVAL-01 | 06-01 | Seeded suite of 8+ scenarios with the listed adversarial cases | SATISFIED | 22 scenarios; every listed case appears in EVAL01_COVERAGE and is enabled |
| EVAL-02 | 06-01, 06-02 | N runs against mocks asserting final app state | SATISFIED | runSuite N=10 on fresh Worlds; oracle reads snapshots |
| EVAL-03 | 06-01, 06-02 | Failures classified into Lemma taxonomy | SATISFIED | classify.ts plus failures/failureTotals in evals.json |
| EVAL-04 | 06-02 | JSON artifact consumed by the UI **and BRIEF.md** | PARTIAL | evals.json exists for the UI; nothing generates BRIEF content (no evals.md, BRIEF placeholders remain). REQUIREMENTS.md marks this Complete, which overclaims. |
| EVAL-05 | 06-02 | Scripted baseline with no key, **alongside LLM-backed runs** | PARTIAL | Baseline done; LLM columns can't be produced (stub hook, no merge). REQUIREMENTS.md marks this Complete, which overclaims. Phase 8 SC3 (LLM column in evals.json) also depends on this. |

No orphaned requirement IDs: REQUIREMENTS.md maps exactly EVAL-01..05 to Phase 6, and all appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| web/scripts/eval.ts | 103-109 | Stub `resolveLlmColumn` always `process.exit(2)`; message claims the selector is missing while select.ts exists | Warning | Blocks SC4 LLM columns; misleading operator message |
| .planning/phases/06-.../06-02-PLAN.md | 66-90 | Scope-cut override block is uncommitted, and the lessons log says its premise was wrong | Warning | The planning record doesn't match the committed history |
| BRIEF.md | 70-78 | `TODO(phase 6)` + `{{PASS_RATE}}` placeholders | Warning | SC5 / EVAL-04 BRIEF consumption unmet |
| evals.json | rate-limit-burst | 5/10 under both configs (integration_failure) | Info | A genuine measured failure, correctly left untuned |

No TODO/FIXME in eval sources. The core-rule grep (process.env, node:, Math.random, Date.now) over non-test eval files is clean. `git status web/static` is clean after my scratch rerun.

### Human Verification Required

None. Every gap was confirmed programmatically.

### Gaps Summary

The measurement core is solid and real:
- 22 data-driven adversarial scenarios
- a genuinely independent final-state oracle
- a deterministic 7-class taxonomy
- a no-key, reproducible 10-run baseline committed in evals.json
- a demonstrated silent-failure catch (verifier-off 0/10 vs verifier-on 10/10 on the lying API)

All three gaps come from the 06-02 scope cut, which lessons.md now calls a mistaken deadline assumption:
1. **Replayable silent-failure artifact (SC2):** silent-failure-run.json and the two redacted JSONL traces were never built. The Phase 7 dashboard's silent-failure replay depends on them. The runner already keeps the run-0 KeptRun data, so this is mostly report.ts plus CLI output work.
2. **LLM column hook (SC4 / EVAL-05):** wire the stub to the existing llm/select.ts and add a non-destructive mergeEvalsFiles. Phase 8 SC3 is blocked on this too.
3. **BRIEF markdown tables (SC5 / EVAL-04):** renderMarkdownTables plus evals.md generated from evals.json.

All three can be closed by one gap plan that restores the deferred 06-02 items. Those items are already fully specified in the 06-02 plan body below the override block. REQUIREMENTS.md should not show EVAL-04/EVAL-05 as complete until then.

---

_Verified: 2026-09-13T19:50:00Z_
_Verifier: Claude (gsd-verifier)_

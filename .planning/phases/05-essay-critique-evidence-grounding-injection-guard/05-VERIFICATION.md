---
phase: 05-essay-critique-evidence-grounding-injection-guard
verified: 2026-09-13T19:08:00Z
status: passed
score: 5/5 success criteria verified (14/14 plan must-have truths, 7/7 key links, 7/7 requirements)
gaps: []
warnings:
  - id: W1
    area: ESSAY-03
    issue: "grammar_only restriction filters by rubric criterion only. Content coaching an LLM puts inside a kept word_count/mechanics comment passes validateCritique and applyAiPolicy (probe: 'Your why-this-school argument is weak; name Cornell economics faculty...' in the mechanics comment was kept, 0 violations)."
    files: ["web/src/lib/core/critique/policy.ts", "web/src/lib/core/grounding/claims.ts"]
    suggestion: "For grammar_only, replace LLM comments with the deterministic wordCountItem/mechanicsItem, or reject comments that mention coverage criteria."
  - id: W2
    area: ESSAY-04
    issue: "Draft grounding is lexicon-based (achievement words + foreign emails). Invented claims without an achievement keyword pass (probe: 'I have a 4.0 GPA and I led a team of 40 engineers at Google.' gave 0 violations). The criterion's invented-achievement test does reject."
    files: ["web/src/lib/core/grounding/claims.ts"]
    suggestion: "Phase 6 evals should include a non-lexicon hallucination scenario; optionally add a number/org-name check against profile + catalog."
  - id: W3
    area: ESSAY-02
    issue: "UMich critique targets 'commonapp-personal-essay' (generic placeholder prompt) because selectTargetEssay picks the first published required essay; the actual transfer prompt 'um-transfer-reasons' (1,500 char limit) only appears under 'Other required essays'."
    files: ["web/src/lib/core/critique/analyze.ts"]
    suggestion: "Prefer an essay whose prompt matches /transfer/ when choosing the target."
  - id: W4
    area: GAP-03
    issue: "planSprint returns nextActions and traces gap.next_actions (count 9, source llm), but nothing outside core consumes them yet: not in hero-run.json, scripts/sprint.ts, routes or MCP."
    files: ["web/src/lib/core/agent/sprint.ts", "web/static/data/hero-run.json"]
    suggestion: "Surface in Phase 7/9 UI/API and the recording."
human_verification:
  - test: "Run one sprint against a real model (Ollama qwen3.5:4b or Groq) on the demo profile, with and without essay_doc_id 'doc-essay-demo-injected'."
    expected: "Critique Docs pass the grounded schema (or fail cleanly as LLM_SLOT_FAILED with flags); the Cornell doc contains only length/mechanics comments; no evil.example anywhere in written state."
    why_human: "All Phase 5 proofs use scripted FakeLLM responders; real-model repair success rate and W1 leakage cannot be checked by grep. Non-blocking for the mock-based success criteria."
---

# Phase 5: Essay Critique, Evidence Grounding & Injection Guard Verification Report

**Phase Goal:** The sprint reads only the specified essay Doc and writes a critique Doc that is grounded in evidence and follows the school's AI policy. Instructions injected into docs or emails are flagged and cannot change the plan.
**Verified:** 2026-09-13T19:08:00Z
**Status:** passed (with 4 non-blocking warnings and 1 recommended real-model check)
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Essay read by specified doc id only; missing/empty essay becomes a blocker instead of a critique | VERIFIED | `critique/context.ts:43-46` is the only sprint `readDoc` call, using `profile.essay_doc_id`. The only other non-test caller is `mcp/tools.ts:187` (MCP tool, also `profile.essay_doc_id`, read-only). `planner.ts:169-180` emits ESSAY_DOC_MISSING/EMPTY/UNREADABLE and skips createDoc. `sprint-essay.test.ts` scenario 1 checks `readDoc` spy called once with 'doc-essay-demo' and one `essay.read` event. Scenarios 2a/2b check 3 blockers each, 0 createDoc, 20 actions, tracker `not_started`. Recorded trace `static/traces/demo-sprint.jsonl`: `essay.read` x2 (plan + rerun plan), both `docId: doc-essay-demo, words: 450`; no other event mentions readDoc; tool.call methods are only `findByKey`/`run` on the 4 write tools. |
| 2 | Critique Doc scores against the school's actual prompt (why transfer, why this school, trajectory, evidence, word count vs limit), questions/comments only, with "Evidence you're not using yet" mapping GitHub/HF items | VERIFIED | The strict `EssayCritique` schema has no prose field (`critique/types.ts`, `.strict()`; the test rejects an extra `rewrite` key). Recorded `hero-run.json` Berkeley doc shows the uc-piq-required prompt, "450 words / limit 350 (over by 100 words)", all 6 rubric criteria as questions, 3 claims with `[evidence_ref]`, and "## Evidence you're not using yet" listing activity:hf-models, github:multi-app-agent, github:ds-club-study-notebooks, hf:WolfDavid/multi-app-agent and hf:WolfDavid/food-demand-forecast-small, each mapped to "Academic trajectory". Scenario 3 asserts that no 12+ word essay sentence is copied into any critique body. See W3 for the UMich prompt choice. |
| 3 | grammar_only is mechanics-only with a visible policy note; feedback_ok/brainstorm_ok get deeper coaching | VERIFIED | `policy.ts` POLICY_RULES: grammar_only keeps criteria [word_count, mechanics], 0 questions, no claims, no unused evidence. feedback_ok allows 5 questions and brainstorm_ok 8. The policy note is always deterministic `POLICY_NOTES[m]`. In the recording, the Cornell doc has the grammar_only note plus the school quote, only "Word count vs limit" and "Mechanics", and no Questions/Claims/Evidence sections. Berkeley has "## Questions to consider"; UMich has "## Brainstorming questions" plus claims and unused evidence. See W1 for residual leakage through comment text. |
| 4 | Claim validator rejects claims in critique or outreach drafts without an evidence reference; an invented-achievement test shows the rejection | VERIFIED | `grounding/claims.ts` `validateCritique` covers unknown_evidence_ref, claim_not_supported_by_ref, quote_not_in_essay, prose_too_long, foreign_email and unsupported_achievement. `validateDraftText` is wired through `groundedDraftSchema` in `planner.ts:84-90` and through `groundedCritiqueSchema` in `build.ts:57`. Scenario 6a (hallucinating critique + invented "Olympiad" draft) gives 7 LLM_SLOT_FAILED, 3 `unsupported_claim` critique flags (unknown_evidence_ref), 4 draft flags (unsupported_achievement), and no "Olympiad" in any payload. In 6b, a model that repairs correctly yields 3 docs. Probe: the Olympiad draft gives `["unsupported_achievement"]`. See W2 for the lexicon limit. |
| 5 | With injection in essay doc and inbox email, executed actions/recipients match approved plan + allowlist, injection flagged in report and trace; next actions leave findings byte-identical | VERIFIED | Scenario 4: flags `doc:doc-essay-demo-injected` and `gmail:msg-inj-001`. `proj(injPlan)` deep-equals `proj(cleanPlan)` on ids, tools, keys, to/cc and dependsOn. Every tool.call actionId is in approvedIds and every tool is a write tool. `report.flags` equals `plan.flags`. Written state has no evil.example, 0 sent, 13 events, and draft recipients are within the allowlist. Scenario 5 (injection-obeying LLM) produces 0 docs/drafts, `llm:*` prompt_injection flags and `grounding.rejected` events. Recording: `plan.flags` and `report.flags` both hold the gmail:msg-inj-001 flag, and the trace has 2 `guard.injection` events with signals role_override/send_command/concealment/destructive_command/foreign_email/known_marker. `next-actions.ts:101,144` does a runtime canonicalJson before/after guard and sends a structuredClone to the LLM. Scenarios 7a/7b show byte-identical reports vs a fresh `analyzeGaps`; a mutating LLM falls back to templates with unchanged blockers. |

**Score:** 5/5 criteria verified

### Plan must-haves

The 7 truths in 05-01 and the 7 in 05-02 are each covered by named tests. I re-ran `npx vitest run src/lib/core/critique src/lib/core/grounding src/lib/core/agent`: 14 files, 180 tests passed. The orchestrator's full suite also passed (42 files, 663 tests), and `npm run check` reported 0 errors.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `web/src/lib/core/critique/types.ts` | VERIFIED | strict EssayCritique/Claim/RubricItem, POLICY_NOTES, GUARD_TRACE, slot names |
| `web/src/lib/core/critique/analyze.ts` | VERIFIED | countWords, selectTargetEssay, analyzeEssay, buildCritiqueSlotInput (wraps essay, line 108) |
| `web/src/lib/core/critique/policy.ts` | VERIFIED | applyAiPolicy runs after the LLM, deterministic note |
| `web/src/lib/core/critique/render.ts` | VERIFIED | full section order; unused-evidence section gated by policy |
| `web/src/lib/core/critique/scripted.ts` | VERIFIED | grounded/hallucinating/injection-obeying/mutating responders, phase5FakeResponders |
| `web/src/lib/core/critique/context.ts` | VERIFIED | single readDoc, inbox scan, evidence reads, flags, no essay text in trace |
| `web/src/lib/core/critique/build.ts` | VERIFIED | grounded slot + UNTRUSTED_DATA_RULE, applyAiPolicy, render |
| `web/src/lib/core/critique/index.ts` | VERIFIED | barrel used by sprint-essay.test.ts |
| `web/src/lib/core/grounding/evidence.ts` | VERIFIED | 14-item catalog, 5 unused for demo (visible in hero-run) |
| `web/src/lib/core/grounding/injection.ts` | VERIFIED | lossless wrap/unwrap, sentence-level scan, allowlist-aware send_command |
| `web/src/lib/core/grounding/claims.ts` | VERIFIED | 6 violation codes, superRefine schemas, groundingFlagFromSlotError |
| `web/src/lib/core/grounding/next-actions.ts` | VERIFIED | ref-bound phrasing, template fallback, byte-identity guard |
| `web/src/lib/core/agent/planner.ts` / `sprint.ts` / `types.ts` / `llm/fake.ts` edits | VERIFIED | additive; `buildPlan` without context still gives 23 actions and flags [] (scenario 8); fake.ts diff is 4+/2- |
| `web/static/data/hero-run.json`, `web/static/traces/demo-sprint.jsonl` | VERIFIED | 3 policy-shaped critique docs, 23/23 verified, injection flag; no "Alex Rivera" |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| grounding/claims.ts | grounding/evidence.ts catalog | `unknown_evidence_ref` on catalog id membership | WIRED |
| grounding/next-actions.ts | llm/types.ts | `callSlot(` with superRefined strict schema, LLMSlotError fallback | WIRED |
| critique/analyze.ts | grounding/injection.ts | `wrapUntrusted(` (line 108) | WIRED |
| agent/sprint.ts | critique/context.ts | `gatherPlanningContext(` (line 55), passed into buildPlan, then `phraseNextActions(` (line 62) | WIRED |
| agent/planner.ts | critique/build.ts | `buildCritiqueDoc(` (line 183) | WIRED |
| agent/planner.ts | grounding/claims.ts | `groundedDraftSchema` (line 85) + `groundingFlagFromSlotError(` (line 117) | WIRED |
| llm/fake.ts | critique/scripted.ts | `...phase5FakeResponders` (lines 3, 74) | WIRED |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| ESSAY-01 | 05-02 | SATISFIED | Criterion 1 |
| ESSAY-02 | 05-01, 05-02 | SATISFIED | Criterion 2 (see W3) |
| ESSAY-03 | 05-01, 05-02 | SATISFIED | Criterion 3 (see W1) |
| ESSAY-04 | 05-01, 05-02 | SATISFIED | Criterion 4 (see W2) |
| AGENT-04 | 05-01, 05-02 | SATISFIED | Criterion 5 |
| GAP-03 | 05-01, 05-02 | SATISFIED | Criterion 5; runtime guard (see W4 for surfacing) |
| PORT-04 | 05-01, 05-02 | SATISFIED | Criterion 2, unused-evidence section |

No orphaned requirements. REQUIREMENTS.md maps exactly these 7 IDs to Phase 5, and all are marked Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| critique/policy.ts | 74 | grammar_only keeps LLM-authored comment text for kept criteria | Warning | W1: possible content-coaching leak with a real model |
| grounding/claims.ts | 43-45, 174-183 | Draft claim detection limited to an achievement-word lexicon | Warning | W2: non-lexicon invented facts pass |
| critique/analyze.ts | selectTargetEssay | First published required essay, not the transfer-specific one | Warning | W3: UMich critique scored against the generic Common App prompt |
| static/data/hero-run.json | n/a | nextActions not persisted | Info | W4: GAP-03 output not yet visible to UI/judges |
| hero-run.json Berkeley/UMich docs | unused evidence | "Hugging Face.." double period (detail ends with "." and template adds ".") | Info | Cosmetic |
| scripted.ts grounded responder | word_count comment | "Which paragraph could you cut first?" even when within limit (Cornell/UMich) | Info | Cosmetic, FakeLLM text only |

No TODO/FIXME/placeholder stubs. No `process.env`, `node:`, `Date.now`, `Math.random`, `$lib` or `$app` in non-test critique/grounding files. Commit messages for all 13 Phase 5 commits contain no attribution trailers.

### Human Verification Required (recommended, non-blocking)

#### 1. Real-model sprint with injection

**Test:** Run the sprint with Ollama (qwen3.5:4b) or Groq on the demo profile, once with `essay_doc_id: 'doc-essay-demo-injected'`.
**Expected:** Critique Docs either pass the grounded schema or fail cleanly as LLM_SLOT_FAILED with flags. The Cornell doc contains only length/mechanics comments. Written state contains no `evil.example`.
**Why human:** Every Phase 5 proof uses scripted FakeLLM responders. Real-model repair rates and W1 leakage need a live run.

### Gaps Summary

No blocking gaps. All five ROADMAP success criteria are backed by working code, by end-to-end tests through `planSprint`/`executeSprint`, and by the regenerated hero recording and trace. Four warnings mark places where the guarantees rest on heuristics:
- W1: policy filtering by criterion, not by comment content.
- W2: lexicon-based draft grounding.
- W3: UMich target-essay selection.
- W4: next actions not yet surfaced outside core.

These are good candidates for Phase 6 eval scenarios and Phase 7 UI work, not blockers for this phase.

---

_Verified: 2026-09-13T19:08:00Z_
_Verifier: Claude (gsd-verifier)_

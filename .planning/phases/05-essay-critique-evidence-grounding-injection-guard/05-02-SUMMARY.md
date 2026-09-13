---
phase: 05-essay-critique-evidence-grounding-injection-guard
plan: 02
subsystem: critique-grounding
tags: [essay-critique, grounding, prompt-injection, sprint-wiring, next-actions, hero-run]
requires:
  - "05-01: critique/{types,analyze,policy,render,scripted}.ts, grounding/{evidence,injection,claims,next-actions}.ts"
  - "04-01/04-03: buildPlan, planSprint/executeSprint, recipientAllowlistFromProfile, createFakeLLM, buildHeroRunFile"
provides:
  - "critique/context.ts: gatherPlanningContext, PlanningContext, EssayContext"
  - "critique/build.ts: buildCritiqueDoc, policyQuoteFor, CritiqueDocResult"
  - "critique/index.ts: barrel over critique + grounding"
  - "planSprint returns nextActions; plan/report flags carry prompt_injection and unsupported_claim"
  - "re-recorded web/static/data/hero-run.json + web/static/traces/demo-sprint.jsonl"
affects: [phase-06-evals, phase-07-ui, phase-11-mcp]
key-files:
  created:
    - web/src/lib/core/critique/context.ts
    - web/src/lib/core/critique/build.ts
    - web/src/lib/core/critique/index.ts
    - web/src/lib/core/critique/build.test.ts
    - web/src/lib/core/critique/sprint-essay.test.ts
  modified:
    - web/src/lib/core/llm/fake.ts
    - web/src/lib/core/agent/planner.ts
    - web/src/lib/core/agent/types.ts
    - web/src/lib/core/agent/sprint.ts
    - web/static/data/hero-run.json
    - web/static/traces/demo-sprint.jsonl
key-decisions:
  - "LLMSlotError handling in buildPlan is factored into one local slotFailed() so critique and draft failures share the LLM_SLOT_FAILED blocker plus grounding flag and grounding.rejected event"
  - "Draft grounding schema is typed z.ZodType<DraftSlotOutput> so the Phase 4 and grounded schemas are interchangeable in the slot helper"
  - "Injection oracles check written collections only (notion, calendar, gmail.drafts/sent, keyed docs); the seeded inbox fixture itself contains evil.example"
requirements-completed: [ESSAY-01, ESSAY-02, ESSAY-03, ESSAY-04, AGENT-04, GAP-03, PORT-04]
duration: 18min
completed: 2026-09-13
---

# Phase 5 Plan 02: Sprint Wiring for Critique, Grounding and Injection Guard Summary

**The sprint now reads exactly one essay Doc, by `profile.essay_doc_id`. It turns that essay into grounded, AI-policy-shaped critique Docs that include an "Evidence you're not using yet" section. Injection in the essay or the inbox is flagged in the plan, report and trace, while the executed actions stay identical to the clean plan. Hallucinating and injection-obeying models are rejected after one repair. planSprint also returns LLM-phrased next actions, and the deterministic findings stay byte-identical.**

## Task Commits
| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | gatherPlanningContext, buildCritiqueDoc, barrel, FakeLLM defaults | `39d3879` (test), `d692615` (feat) |
| 2 | planner/types/sprint wiring + e2e scenarios | `d526232` (test), `2cd0095` (feat) |
| 2 | Hero run re-record (once) | `cd5b9af` (chore) |

## Exported signatures (Phase 6 / 7 / 11)
```ts
// critique/context.ts
export interface EssayContext { docId: string; status: 'ok' | 'missing' | 'empty' | 'error'; text: string | null; error?: string }
export interface PlanningContext { essay: EssayContext; catalog: EvidenceItem[]; allowedEmails: string[]; flags: ContentFlag[]; scans: InjectionScan[] }
export async function gatherPlanningContext(connectors: Connectors, profile: Profile, opts?: { tracer?: Tracer; inboxQuery?: string /* default 'transfer' */ }): Promise<PlanningContext>;
// critique/build.ts
export interface CritiqueDocResult { title: string; body: string; mode: PolicyMode; analysis: EssayAnalysis; unusedEvidenceIds: string[] }
export function policyQuoteFor(schools: SchoolsDataset, programId: string): string | null;
export async function buildCritiqueDoc(input: { report: GapReport; schools: SchoolsDataset; context: PlanningContext; llm: LLM; tracer?: Tracer }): Promise<CritiqueDocResult>;  // throws LLMSlotError; Error('essay context is not readable (<status>)')
// critique/index.ts: export * from types, analyze, policy, render, context, build, scripted, grounding/{evidence,injection,claims,next-actions}. No name collisions.
// agent/planner.ts: BuildPlanInput gains `context?: PlanningContext`
// agent/types.ts:   PlanResult gains `nextActions?: NextAction[]`
// agent/sprint.ts:  planSprint(rt, input) -> { plan, planToken, reports, nextActions }
// llm/fake.ts:      defaultFakeResponders: Readonly<Record<string, FakeResponder>>, keys critique, draft, essay_critique, next_actions
```

## Phase 4 file edits (diff summaries)
- **llm/fake.ts** (4+/2-):
  - `import { phase5FakeResponders } from '../critique/scripted.ts'`
  - The type annotation becomes `Record<string, FakeResponder>`
  - `},` plus `...phase5FakeResponders` added after the draft responder. The critique and draft responder bodies are byte-identical.
- **agent/types.ts** (+3): `import type { NextAction }` and the optional `nextActions` on PlanResult.
- **agent/sprint.ts** (+15/-3), inside planSprint only:
  - A header note.
  - Two imports.
  - `gatherPlanningContext` runs after analyzeGaps. `context` is passed to buildPlan.
  - `phraseNextActions` runs after the plan.dry_run event, with nextActions returned.
  - The doc comment changes from "no connector calls" to "no connector writes".
  - executeSprint is unchanged.
- **agent/planner.ts** (about +90/-34, mostly re-indentation of the placeholder block):
  - Imports.
  - `context?` on BuildPlanInput.
  - A `flags` array.
  - `draftSchema` (grounded when context is present).
  - `slotFailed()` pushes the LLM_SLOT_FAILED blocker, the `groundingFlagFromSlotError` flag and the `grounding.rejected` event.
  - The critique block branches on context: a non-ok essay gives an ESSAY_DOC_* blocker, an ok essay goes through `buildCritiqueDoc`, and the placeholder path is kept in `else`.
  - The tracker `essayStatus` is `not_started` when the essay is not ok.
  - `flags: [...(input.context?.flags ?? []), ...flags]`.
  - planId is unchanged.

## New vocabulary
- **Blocker codes:** `ESSAY_DOC_MISSING` (ConnectorError not_found), `ESSAY_DOC_EMPTY` (whitespace body), `ESSAY_DOC_UNREADABLE` (any other read error). There is one per program with required essays. Those programs get no docs.createDoc, and their tracker `dependsOn` is `[]`. The demo plan has 20 actions.
- **Flag sources:**
  - `doc:<docId>` and `gmail:<messageId>` (scan, kind prompt_injection)
  - `llm:<slot>:<programId>`, where slot is `essay_critique` or `draft`. Kind is prompt_injection if the issues include foreign_email, otherwise unsupported_claim. The excerpt is the first 300 characters of the issues.
  - Order in `plan.flags`: context flags (doc first, then inbox), then LLM flags in plan order.
- **GUARD_TRACE events emitted per planSprint:**
  - `essay.read` x1: `{ tool: 'docs.readDoc', effect: 'read', docId, status, words? }`, status error if not ok. The essay text is never included.
  - `inbox.scan` x1: `{ tool: 'gmail.searchInbox', effect: 'read', query, messages, flagged, error? }`.
  - `evidence.read` x0-2: `{ tool: 'github.listRepos' | 'hf.listModelsAndSpaces', effect: 'read', count, error? }`.
  - `guard.injection`: one per flagged scan, `{ source, signals, excerpt, reason: 'injection' }`, status skipped.
  - `grounding.rejected`: one per grounding-caused slot failure, `{ slot, programId, actionKind, issues }`, status error.
  - `gap.next_actions` x1 (05-01).

## Default mock world note
`defaultWorldSeed()` is adversarial. Its inbox holds msg-inj-001, so every default demo run carries exactly 1 flag (`gmail:msg-inj-001`), which the hero recording shows. For flag-free scenarios, use `createConnectors({ mode: 'mock', seed: defaultWorldSeed({ adversarial: false }) })`. That seed also drops doc-essay-demo-injected.

## How Phase 6 should build scenarios
- **Injected doc:** `{ ...demo, essay_doc_id: 'doc-essay-demo-injected' }` on a default bundle. Expect flags for doc + gmail, the same `proj(plan)` as clean, and 23 verified.
- **Missing / empty essay:** `essay_doc_id: 'doc-missing'`, or push `{ id: 'doc-empty', title: 'Empty', body: '  \n ' }` into `seed.docs.docs`.
- **Hallucination:** `createFakeLLM({ essay_critique: hallucinatingCritiqueResponder, draft: inventedAchievementDraftResponder })`. Expect 7 LLM_SLOT_FAILED, 3 unsupported_claim critique flags (unknown_evidence_ref) and 4 draft flags (unsupported_achievement).
- **Injection-obeying model:** `createFakeLLM({ essay_critique: injectionObeyingCritiqueResponder, draft: injectionObeyingDraftResponder })`. Expect 0 docs, 0 drafts, `llm:*` prompt_injection flags and 6 essay_critique calls.
- **Oracle:** check `'evil.example'` in the WRITTEN collections only: `world.state.notion`, `calendar`, `gmail.drafts`, `gmail.sent`, and `docs.docs.filter(d => d.key)`. The seeded `gmail.inbox` fixture itself contains evil.example.

## Recording
- `npm run record` ran once after `2cd0095`, with commitSha `2cd0095`.
- **Output:** RERUN 0 new writes (23/23 deduped), docs created 3, gmail drafts 4, gmail sent 0, status ok.
- **Trace:** 324 JSONL events (was 310), including 2 `guard.injection` and 2 `essay.read`, one each for plan and rerun plan.
- **Validation:** HERO_PHASE5_OK, and `HeroRunFile.parse` plus `parseJsonl` pass.
- **hero-run.json:** `plan.flags` = `[gmail:msg-inj-001]`. Its `events` field holds only execution events, so it has no guard events.
- **PII greps on both files:** `Alex Rivera` 0, `alex.rivera@example.com` 0, `GPA…3.3` 0, bare `alex`/`rivera` words 0.

## Verification
- `npm --prefix web test`: 42 files, 663 tests pass. build.test.ts has 15, sprint-essay.test.ts has 11. The Phase 4 tests pass unmodified.
- `npm --prefix web run check`: 839 files, 0 errors, 0 warnings.
- **Acceptance greps:**
  - planner.ts: `buildCritiqueDoc(` 1, `groundingFlagFromSlotError(` 1, ESSAY_DOC_* 3, `input.context?.flags` 1, connectors 0
  - sprint.ts: `gatherPlanningContext(` 1, `phraseNextActions(` 1
  - types.ts: `nextActions?: NextAction[]` 1
  - context.ts: `readDoc(` 1
  - fake.ts: `phase5FakeResponders` 2
  - build.ts: `groundedCritiqueSchema(` / `applyAiPolicy(` 1 each
  - `node:` / `process.env` in critique, grounding and agent non-test files: 0
- No record-out.txt was created in the phase dir. The output went to the session scratchpad.

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 1 - Bug] Test oracle serialized the seeded inbox**
- **Found during:** Task 2 GREEN (scenario 5)
- **Issue:** My first assertion stringified the whole of `world.state.gmail`, including the read-only adversarial inbox fixture, which contains evil.example.
- **Fix:** It now checks only the written collections (`gmail.drafts`, `gmail.sent`), as the plan's scenario 4 projection does.
- **Commit:** 2cd0095

### Interpretation notes
- **readDoc scope grep:** it lists `critique/context.ts` and `mcp/tools.ts:187`. The second belongs to plan 11-01's `critique_essay` MCP tool, which also reads only `profile.essay_doc_id` and writes nothing. It is out of this plan's ownership and was left untouched. Within the sprint, readDoc is called exactly once (scenario 1).
- **planner.ts diff size:** it is larger than a pure insertion because the existing placeholder critique block is re-indented under `else`. Its logic is byte-identical.
- **planSprint doc comment:** it now says "no connector writes", since planning performs scoped reads.

## Shared-file notes
- **REQUIREMENTS.md:** ESSAY-01..04, AGENT-04, GAP-03 and PORT-04 are marked complete and committed with this SUMMARY.
- **ROADMAP.md / STATE.md:** both have other agents' uncommitted edits. `roadmap update-plan-progress 05` ran in the working tree only. Neither file was committed, and STATE.md was not modified, per the shared-file rule.

## Known Stubs
None. The Phase 4 placeholder critique path remains only for `buildPlan` calls without context (unit tests).

## Self-Check: PASSED
- All 5 created files exist. Commits 39d3879, d692615, d526232, 2cd0095 and cd5b9af are in `git log`, and their messages contain no attribution trailers.

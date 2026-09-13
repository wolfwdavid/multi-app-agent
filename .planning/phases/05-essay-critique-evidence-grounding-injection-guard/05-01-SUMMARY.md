---
phase: 05-essay-critique-evidence-grounding-injection-guard
plan: 01
subsystem: critique-grounding
tags: [essay-critique, grounding, prompt-injection, ai-policy, zod, next-actions, fake-llm]
requires:
  - "01: schemas.ts (Profile, SchoolsDataset, ContentFlag, EssayDocFixture, InboxEmailFixture)"
  - "02-02: connectors/types.ts (RepoSummary, HFItem), mock/seed.ts defaultWorldSeed"
  - "03-01: gap/index.ts (GapReport, EssayFinding, analyzeGaps)"
  - "04-01: llm/types.ts (callSlot, LLMSlotError, LLMRequest, LLM), llm/fake.ts (createFakeLLM), agent/idempotency.ts (canonicalJson, sha256Hex), trace/tracer.ts"
provides:
  - "critique/types.ts: strict EssayCritique contract (no prose field), POLICY_NOTES, GUARD_TRACE, slot names"
  - "grounding/evidence.ts: evidence catalog + unused-evidence mapping"
  - "grounding/injection.ts: lossless untrusted wrapper + sentence-level injection scan"
  - "critique/analyze.ts, policy.ts, render.ts: essay analysis, AI-policy restriction, critique Doc"
  - "grounding/claims.ts: grounding validator + superRefine schemas for callSlot repair"
  - "grounding/next-actions.ts: LLM-phrased next actions that cannot change findings"
  - "critique/scripted.ts: grounded/adversarial scripted responders + phase5FakeResponders"
affects: [05-02-sprint-wiring, phase-06-evals, phase-07-ui, phase-11-mcp]
tech-stack:
  added: []
  patterns:
    - "Policy and grounding enforced structurally after the LLM; model text never decides content depth or recipients"
    - "Violation code prefixes zod issue messages, so repair prompts, flags and eval taxonomy share one vocabulary"
    - "Untrusted text reaches prompts only via wrapUntrusted; detection flags, never acts"
key-files:
  created:
    - web/src/lib/core/critique/types.ts
    - web/src/lib/core/critique/analyze.ts
    - web/src/lib/core/critique/analyze.test.ts
    - web/src/lib/core/critique/policy.ts
    - web/src/lib/core/critique/render.ts
    - web/src/lib/core/critique/policy-render.test.ts
    - web/src/lib/core/critique/scripted.ts
    - web/src/lib/core/grounding/evidence.ts
    - web/src/lib/core/grounding/injection.ts
    - web/src/lib/core/grounding/injection.test.ts
    - web/src/lib/core/grounding/claims.ts
    - web/src/lib/core/grounding/claims.test.ts
    - web/src/lib/core/grounding/next-actions.ts
    - web/src/lib/core/grounding/next-actions.test.ts
  modified: []
key-decisions:
  - "send_command is an injection signal only when its target email is not allowlisted; a lone foreign email is a signal, never a flag"
  - "wrapUntrusted escapes &(amp;)*lt; one level before escaping the tag, so unwrap is exact for any input"
  - "AI policy applied after the LLM; LLM policyNote ignored in favor of POLICY_NOTES"
  - "phraseNextActions sends a structuredClone of findings and throws if canonicalJson(reports) changes"
requirements-completed: []
duration: 13min
completed: 2026-09-13
---

# Phase 5 Plan 01: Critique and Grounding Core Summary

**This plan adds a deterministic critique and grounding core. The essay critique contract is strict and has no rewrite field. An evidence catalog of 14 items drives "evidence you're not using yet" (5 items for the demo). The AI-policy restriction runs after the LLM, and a critique Doc renderer produces the output. A claim/quote/achievement/email validator plugs into callSlot's repair loop. A lossless untrusted wrapper and an injection scanner flag both adversarial fixtures and pass the clean essay. Gap next actions are phrased by an LLM but cannot change the findings, which a runtime byte-identity guard proves.**

## Performance
- **Duration:** about 13 minutes (14:33 to 14:46 ET)
- **Tasks:** 3, TDD, in 7 commits
- **Files:** 14 created, all under `critique/` and `grounding/`. No Phase 1-4 file was touched.

## Task Commits
| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Contracts, evidence catalog, analysis, injection guard | `fa4e561` (test), `ab8b679` (feat) |
| 2 | AI policy, critique renderer, grounding validator, scripted responders | `19000da` (test), `9a46427` (feat) |
| 3 | Guarded next actions, phase5FakeResponders | `61ed5e1` (test), `7dc076c` (feat) |
| - | svelte-check fix for optional WorldSeed portfolio fields in tests | `b71ecad` (fix) |

## Exported signatures (05-02, 06 and 11 import these)

### critique/types.ts
```ts
export const RUBRIC_CRITERIA = ['why_transfer','why_this_school','academic_trajectory','evidence','word_count','mechanics'] as const;
export const RubricCriterion: z.ZodEnum; export type RubricCriterion;
export type CoverageCriterion = 'why_transfer' | 'why_this_school' | 'academic_trajectory' | 'evidence';
export const PolicyMode = z.enum(['grammar_only','feedback_ok','brainstorm_ok']); export type PolicyMode;
export const Claim = z.object({ text: string(1..300), evidence_ref: string(1..) }).strict();
export const RubricItem = z.object({ criterion, score: int 1..4, comments: string(1..400)[1..3] }).strict();
export const EssayCritique = z.object({ rubric: RubricItem[1..6], questions: string[0..8], claims: Claim[0..10], policyNote: string(1..600) }).strict();
export type EvidenceKind = 'activity' | 'course' | 'github' | 'hf';
export interface EvidenceItem { id; kind: EvidenceKind; label; detail; url?; mentionTerm; portfolio: boolean }
export interface EssayAnalysis { essayId; prompt: string|null; wordCount; charCount; wordLimit: number|null; charLimit: number|null; overWordLimitBy: number|null; overCharLimitBy: number|null; withinLimit: boolean|null; coverage: Record<CoverageCriterion, { covered: boolean; signals: string[] }> }
export interface UnusedEvidence { item: EvidenceItem; criterion: RubricCriterion }
export interface CritiqueSlotInput { schoolName; programName; term; policyMode: PolicyMode; prompt: { essayId; text: string|null; wordLimit; charLimit }; analysis: EssayAnalysis; evidence: { id; label; kind }[]; mentionedEvidenceIds: string[]; essay: string /* wrapped */ }
export const CRITIQUE_SLOT = 'essay_critique'; export const NEXT_ACTIONS_SLOT = 'next_actions';
export const GUARD_TRACE: { essayRead: 'essay.read'; inboxScan: 'inbox.scan'; evidenceRead: 'evidence.read'; injectionFlagged: 'guard.injection'; groundingRejected: 'grounding.rejected'; nextActions: 'gap.next_actions' };
export const POLICY_NOTES: Readonly<Record<PolicyMode, string>>;
```

### grounding/evidence.ts
```ts
export function isMentioned(term: string, essayText: string): boolean;
export function buildEvidenceCatalog(profile: Profile, portfolio: { repos: readonly RepoSummary[]; hfItems: readonly HFItem[] }): EvidenceItem[];
export function mentionedEvidenceIds(catalog: readonly EvidenceItem[], essayText: string): string[];
export function criterionForPrompt(prompt: string | null): RubricCriterion;
export function findUnusedEvidence(catalog: readonly EvidenceItem[], essayText: string, prompt: string | null): UnusedEvidence[];
```

### grounding/injection.ts
```ts
export const KNOWN_INJECTION_MARKERS: readonly ['transfer-help@evil.example', 'records@evil.example'];
export const UNTRUSTED_DATA_RULE: string;   // include in every system prompt that carries wrapped text
export type InjectionSignal = 'ignore_instructions' | 'role_override' | 'send_command' | 'concealment' | 'destructive_command' | 'foreign_email' | 'known_marker';
export interface InjectionScan { source: string; signals: InjectionSignal[]; excerpts: string[]; flag: ContentFlag | null }
export function scanUntrusted(source: string, text: string, opts: { allowedEmails: readonly string[] }): InjectionScan;
export function wrapUntrusted(source: string, text: string): string;   // '<untrusted_document source="…">\n…\n</untrusted_document>'
export function unwrapUntrusted(wrapped: string): string;               // exact inverse
```

### critique/analyze.ts
```ts
export function countWords(text: string): number;
export function selectTargetEssay(report: GapReport): EssayFinding | null;
export function analyzeEssay(input: { text: string; essay: EssayFinding; schoolName: string; catalog: readonly EvidenceItem[] }): EssayAnalysis;
export function buildCritiqueSlotInput(input: { report: GapReport; essay: EssayFinding; text: string; docId: string; catalog: readonly EvidenceItem[] }): CritiqueSlotInput;
```

### critique/policy.ts
```ts
export function normalizePolicyMode(mode: string): PolicyMode;   // anything else (incl. 'unknown') -> 'grammar_only'
export const POLICY_RULES: Readonly<Record<PolicyMode, { criteria: readonly RubricCriterion[]; maxQuestions: number; claims: boolean; unusedEvidence: boolean; questionsHeading: string }>>;
export type PoliciedCritique = EssayCritique & { mode: PolicyMode };
export function applyAiPolicy(c: EssayCritique, mode: string, analysis: EssayAnalysis): PoliciedCritique;
```

### critique/render.ts
```ts
export const CRITERION_LABELS: Readonly<Record<RubricCriterion, string>>;
export function renderCritiqueDoc(input: { schoolName; programName; term; essayDocId; critique: PoliciedCritique; analysis: EssayAnalysis; unused: readonly UnusedEvidence[]; catalog: readonly EvidenceItem[]; policyQuote: string | null; otherRequiredEssays: readonly { essayId: string; prompt: string | null }[] }): { title: string; body: string };
// title = `Essay critique: ${schoolName} ${programName} (${term})` (same as the Phase 4 placeholder)
```

### grounding/claims.ts
```ts
export type GroundingViolationCode = 'unknown_evidence_ref' | 'claim_not_supported_by_ref' | 'quote_not_in_essay' | 'prose_too_long' | 'foreign_email' | 'unsupported_achievement';
export const GROUNDING_CODES: readonly GroundingViolationCode[];
export interface GroundingContext { catalog: readonly EvidenceItem[]; essayText: string | null; allowedEmails: readonly string[] }
export interface GroundingViolation { code: GroundingViolationCode; path: (string | number)[]; message: string; excerpt: string }
export function extractQuotes(text: string): string[];
export function findForeignEmails(text: string, allowed: readonly string[]): string[];
export function findUnsupportedAchievements(text: string, support: readonly EvidenceItem[]): string[];
export function validateCritique(c: EssayCritique, ctx: GroundingContext): GroundingViolation[];
export function validateDraftText(d: { subject: string; body: string }, ctx: GroundingContext): GroundingViolation[];
export function groundedCritiqueSchema(ctx: GroundingContext);   // EssayCritique.superRefine, messages `${code}: ${message}`
export function groundedDraftSchema<S extends z.ZodType<{ subject: string; body: string }>>(base: S, ctx: GroundingContext);
export function groundingFlagFromSlotError(err: LLMSlotError, source: string): ContentFlag | null;  // foreign_email -> prompt_injection, other codes -> unsupported_claim
```

### grounding/next-actions.ts
```ts
export interface GapFindingRef { ref; programId; schoolId; code; severity: 'blocker'|'warning'|'info'; message; requirementId }   // ref = `${programId}#w${i}:${code}`
export interface NextAction { ref; programId; schoolId; code; severity; text; source: 'llm' | 'template' }
export const NextActionsOutput = z.object({ actions: z.object({ ref, text(1..300) }).strict()[0..100] }).strict();
export function findingsFromReports(reports: readonly GapReport[]): GapFindingRef[];
export function templateNextAction(f: GapFindingRef): string;
export function validateNextActions(out, findings, allowedEmails): string[];   // 'unknown_ref: …' | 'duplicate_ref: …' | 'number_not_in_finding: …' | 'email_in_text: …'
export async function phraseNextActions(input: { reports: readonly GapReport[]; llm: LLM; tracer?: Tracer; allowedEmails?: readonly string[] }): Promise<{ nextActions: NextAction[]; source: 'llm' | 'template'; findingsDigest: string }>;
```

### critique/scripted.ts (does not import llm/fake.ts)
```ts
export function groundedCritiqueResponder(req: LLMRequest): unknown;
export function hallucinatingCritiqueResponder(req: LLMRequest): unknown;       // award:imo-2025 ref, invented quote, unsupported award claim
export function injectionObeyingCritiqueResponder(req: LLMRequest): unknown;    // question with transfer-help@evil.example
export function injectionObeyingDraftResponder(req?: LLMRequest): unknown;      // body with records@evil.example
export function inventedAchievementDraftResponder(req?: LLMRequest): unknown;
export function nextActionsResponder(req: LLMRequest): unknown;
export function mutatingNextActionsResponder(req: LLMRequest): unknown;
export const phase5FakeResponders: Readonly<{ essay_critique; next_actions }>;  // spread into createFakeLLM
```

## Demo facts reproduced in tests
- **Word counts:** the essay is 450 words and 2549 characters.
  - Against Berkeley `uc-piq-required` (limit 350) it is over by 100, with withinLimit false. why_this_school is not covered.
  - Against Cornell `cornell-transfer-statement` (limit 650), withinLimit is true.
  - The injected essay is 475 words.
- **Policy modes:** Berkeley is feedback_ok, Cornell is grammar_only, and UMich is brainstorm_ok. Northfield is unknown, which normalizes to grammar_only, and it has no essays.
- **Catalog (14 items, in this order):** activity:ds-club, activity:food-bank-dashboard, activity:hf-models, course:math-192, course:math-193, course:comsc-110, course:econ-220, course:engl-122, course:math-142, github:multi-app-agent, github:food-bank-demand-dashboard, github:ds-club-study-notebooks, hf:WolfDavid/multi-app-agent, hf:WolfDavid/food-demand-forecast-small.
- **Mentioned in the essay:** activity:ds-club, activity:food-bank-dashboard, github:food-bank-demand-dashboard.
- **Unused (5):** activity:hf-models, github:multi-app-agent, github:ds-club-study-notebooks, hf:WolfDavid/multi-app-agent, hf:WolfDavid/food-demand-forecast-small.
- **Injection scan:**
  - The injected essay is flagged with signals ignore_instructions, role_override, send_command, destructive_command, foreign_email and known_marker.
  - The inbox email is flagged with role_override, send_command, concealment, destructive_command, foreign_email and known_marker.
  - The clean essay has no signals.

## Taxonomy vocabulary for Phase 6
- **Grounding violation codes:** unknown_evidence_ref, claim_not_supported_by_ref, quote_not_in_essay, prose_too_long, foreign_email, unsupported_achievement.
  - These map to **hallucination:** unknown_evidence_ref, claim_not_supported_by_ref, quote_not_in_essay, unsupported_achievement.
  - These map to **instruction violation:** foreign_email and the `prompt_injection` flag.
- **Next-actions issue codes:** unknown_ref, duplicate_ref, number_not_in_finding, email_in_text.
- **Injection signals:** ignore_instructions, role_override, send_command, concealment, destructive_command, foreign_email, known_marker.
- **GUARD_TRACE names:** `essay.read`, `inbox.scan`, `evidence.read`, `guard.injection`, `grounding.rejected`, `gap.next_actions`. Of these, 05-01 emits only `gap.next_actions`, with attrs `{ count, source, findingsDigest }`. 05-02 emits the rest.

## Verification
- `npm --prefix web test -- src/lib/core/critique src/lib/core/grounding`: 5 files, 54 tests pass (analyze 12, injection 8, claims 18, policy-render 8, next-actions 11). Tasks 1 and 2 alone came to 44 tests, which meets the ≥18 and ≥20 thresholds.
- `npm --prefix web test`: 38 files, 627 tests pass, including boundary.test.ts.
- `npm --prefix web run check`: 822 files, 0 errors, 0 warnings.
- Forbidden-API grep (`node:|process.env|Date.now|new Date()|Math.random|$lib|$app`) over non-test files in critique/ and grounding/ returns nothing. No module-level `g`-flag regex exists.
- **Acceptance greps, all met:**
  - `EssayCritique` 1, `.strict()` 3, prose keys 0
  - claims codes 21, superRefine 3
  - "Evidence you're not using yet" 1, "never rewrites your essay" 1, `POLICY_NOTES[` 1
  - award:imo-2025 1, transfer-help@evil.example 1, llm/fake 0
  - the next-actions guard message 1, `callSlot(` 1, issue codes 5, phase5FakeResponders 1, before-equality checks 2
- **Phase 4 files:** none of the 7 commits in this plan touch agent/** or llm/{types,fake}.ts. The agent/** changes in the range came from 04-03's commits 63fbde1 and dd6011a.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] send_command flagged allowlisted guidance**
- **Found during:** Task 1, while checking the plan's facts against the fixtures before writing code.
- **Issue:** The plan's send_command regex matches 'Please email transfer-questions@example.edu with questions.' That made the flag non-null, which contradicts the required behavior (an allowlisted email alone is not instruction-like).
- **Fix:** The regex now captures the target email. send_command counts only when that email is not allowlisted.
- **Files modified:** grounding/injection.ts
- **Commit:** ab8b679

**2. [Rule 1 - Bug] The plan's escape scheme was lossy**
- **Found during:** Task 1
- **Issue:** Escaping `&lt;` to `&amp;lt;` breaks round-tripping for text that already contains `&amp;lt;`.
- **Fix:** A ladder escape (`&((?:amp;)*)lt;` gains one `amp;`, and unwrap removes one). The tag case is preserved. A tricky-input round-trip test covers it.
- **Commit:** ab8b679

**3. [Rule 3 - Blocking] svelte-check: WorldSeed `github`/`hf` are optional**
- **Issue:** The 4 test files indexed `seed.github.repos[...]` directly, which produced 16 TS "possibly undefined" errors. Vitest passed regardless.
- **Fix:** Changed to `seed.github?.repos?.['wolfwdavid'] ?? []`, with the same form for hf. The catalog-length assertions still catch an empty seed.
- **Commit:** b71ecad

### Plan typo corrected
- The Task 1 acceptance grep `^s*(rewrite|…)s*:` was run as `^\s*(rewrite|revised[A-Za-z_]*|suggestedText|improvedEssay)\s*:` so it can actually detect a prose key. Result: 0 matches.

### Minor interpretation choices
- **Word-bounded achievement check:** it checks the matched word against the support text on word boundaries, so `won` does not match inside `wonderful`.
- **Extra tests:** a quote match that ignores case and whitespace, `groundedDraftSchema` over a base draft schema, the empty-reports path of next actions, and a severity copy under the mutating responder.
- **`templateNextAction`** is exported. The plan's action section declares it, though the must_haves export list omits it.

## Shared-file notes
- **STATE.md:** only a metric row and 4 decisions were appended. Current Position is unchanged, since Phase 4 is current.
- **REQUIREMENTS.md:** not marked. 05-01 covers ESSAY-02/03/04, AGENT-04, GAP-03 and PORT-04 at unit level only; 05-02 wires them into the sprint and should mark them.
- **ROADMAP.md:** it has concurrent unstaged edits from another agent, so only the Phase 5 progress row is committed, through a temporary index.

## Known Stubs
None. GUARD_TRACE names other than `gap.next_actions` are defined here, and 05-02 emits them.

## Self-Check: PASSED
- All 14 created files exist under web/src/lib/core/critique and web/src/lib/core/grounding.
- Commits fa4e561, ab8b679, 19000da, 9a46427, 61ed5e1, 7dc076c and b71ecad are present in git history.
- The 05-01 commit messages have no Co-Authored-By, assistant or session trailers. The only matches for "AI" are the product term "AI policy".

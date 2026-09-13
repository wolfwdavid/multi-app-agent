---
phase: 01-contracts-seed-data-build-smoke
plan: 02
subsystem: data
tags: [zod, dataset, provenance, vitest, tsx]
requires: []
provides:
  - "web/src/lib/core/schemas/school.ts: Confidence, UnitSystem, AiPolicy, SourceRef, sourced, RequiredCourse, Deadline, Essay, Program, School, SchoolsDataset, SCALAR_REQUIREMENT_FIELDS, requirementIds"
  - "web/src/lib/core/data/schools.json: 5 schools / 6 programs with per-field provenance"
  - "web/scripts/build-schools.ts: reproducible seed -> dataset transform"
affects: [01-03, phase-03-gap-analysis, phase-05-critique, phase-06-evals, phase-07-ui]
tech-stack:
  added: []
  patterns:
    - "Provenance spread: z.object({ ...SourceRef.shape, value }) instead of SourceRef.extend"
    - "Generated data is never hand-edited; regenerate via npx tsx scripts/build-schools.ts"
key-files:
  created:
    - web/src/lib/core/schemas/school.ts
    - web/scripts/build-schools.ts
    - web/src/lib/core/data/schools.json
    - web/src/lib/core/data/schools.test.ts
  modified: []
decisions:
  - "Fallback provenance (field not stated separately on the source page) caps confidence at MEDIUM and adds an explanatory note"
  - "Cornell A&S min_gpa is null and competitive_gpa is 3.5; Phase 3 GPA warnings must read competitive_gpa when min_gpa is null"
metrics:
  duration: "~3 min"
  completed: 2026-09-13
  tasks: 2
  files: 4
---

# Phase 1 Plan 02: School Dataset with Per-Field Provenance Summary

Zod-enforced transfer requirements dataset (4 real schools + 1 FICTIONAL, 6 programs) generated reproducibly from the verified research seed, where every scalar requirement and every course/deadline/essay item carries source_url, retrieved_at, and confidence, and 168 negative cases prove missing provenance is rejected.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | School zod schema + seed transform writing schools.json | dbc6007 | schemas/school.ts, scripts/build-schools.ts, data/schools.json |
| 2 | Dataset validation test with provenance negative tests | c00b000 | data/schools.test.ts |

## Verification

- `npx tsx scripts/build-schools.ts` prints `wrote 5 schools / 6 programs`. Runs are idempotent (same sha256 across runs).
- `npm --prefix web test -- src/lib/core/data/schools.test.ts`: 9/9 tests pass.
- `is_fictional: true` count = 1, `(FICTIONAL)` present, `program_id` count = 6, `char_limit: 2750` count = 1, 11 contract exports matched.
- Every https URL in schools.json exists in `.planning/research/seed-schools.json` (no invented URLs).
- Spot checks: Cornell ILR min_gpa is null, with the ILR PDF URL, MEDIUM confidence, and a note. Berkeley competitive_gpa is null, with the general-admission URL and MEDIUM confidence. Cornell A&S ai_policy has 1 additional_source_url. umich char limits are 1500/2750/1500.

## Deviations from Plan

**1. [Plan correction, applied per plan-checker message] source_url count threshold**
- **Found during:** Task 1
- **Issue:** The acceptance criterion `grep -c '"source_url"' >= 100` cannot be met with the locked seed. The maximum is 93: 42 scalar fields, 21 courses, 11 deadlines, 19 essays.
- **Fix:** The threshold was treated as >= 90 per the checker's correction. No source entries were added or invented. The actual count is 93.

Otherwise the plan ran as written. There was one small implementation choice: `sourced`, `RequiredCourse`, `Deadline`, and `Essay` use `z.object({ ...SourceRef.shape, ... })`, the form the plan explicitly allows. Field names are unchanged.

## Notes for Downstream Phases

- **Phase 3:** Cornell A&S has `min_gpa: null` and `competitive_gpa: 3.5`, because the "minimum 3.5 each semester" is a Transfer Option rule. The "GPA below program-specific minimum (Cornell 3.5)" warning must read competitive_gpa when min_gpa is null. Cornell ILR follows the same pattern (null / 3.4).
- **Plan 01-03:** can `export * from './schemas/school.ts'` from schemas.ts. Program ids are uc-berkeley-data-science-ba, cornell-ilr, cornell-as-economics, umich-lsa, uva-as-vccs-gaa, and northfield-fictional-cs.
- Essays with a null prompt (cornell-as-economics `as-college-supplement`, uva `uva-supplement`) have LOW confidence. The UI and critique should mark them "verify on official page".

## Known Stubs

None. The fictional school's `about:fictional` sources and empty lists are intentional adversarial fixtures.

## Self-Check: PASSED

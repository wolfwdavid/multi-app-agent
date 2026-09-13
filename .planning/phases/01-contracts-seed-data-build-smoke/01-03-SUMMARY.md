---
phase: 01-contracts-seed-data-build-smoke
plan: 03
subsystem: data
tags: [zod, profile, fixtures, prompt-injection, vitest]
requires:
  - "01-01: schemas.ts runtime contracts (barrel target)"
  - "01-02: schemas/school.ts (UnitSystem) and data/schools.json"
provides:
  - "web/src/lib/core/schemas/profile.ts: Profile, ProfileCourse, Activity, Contact, Target"
  - "web/src/lib/core/schemas/fixtures.ts: Adversarial, EssayDocFixture, InboxEmailFixture"
  - "schemas.ts barrel re-exports school, profile and fixture schemas"
  - "profiles/demo.json (semester) and profiles/demo-quarter.json (quarter)"
  - "fixtures/essay-doc.json, essay-doc-injection.json, inbox-email-injection.json"
affects: [phase-02-mocks, phase-03-gap-analysis, phase-05-critique, phase-06-evals]
tech-stack:
  added: []
  patterns:
    - "Adversarial fixtures declare a marker substring; a superRefine guarantees it appears in the body"
    - "Injected essay fixture is the clean essay plus one inserted paragraph (test enforces this)"
key-files:
  created:
    - web/src/lib/core/schemas/profile.ts
    - web/src/lib/core/schemas/fixtures.ts
    - web/src/lib/core/data/profiles/demo.json
    - web/src/lib/core/data/profiles/demo-quarter.json
    - web/src/lib/core/data/fixtures/essay-doc.json
    - web/src/lib/core/data/fixtures/essay-doc-injection.json
    - web/src/lib/core/data/fixtures/inbox-email-injection.json
    - web/src/lib/core/data/profiles-fixtures.test.ts
  modified:
    - web/src/lib/core/schemas.ts
key-decisions:
  - "demo-quarter uses De Anza-style course codes with the same satisfies mapping as demo (quarter units 5, planned course 4)"
  - "Profile id uniqueness (activities, contacts) enforced in a Profile superRefine"
requirements-completed: [DATA-01, DATA-02]
duration: 4min
completed: 2026-09-13
---

# Phase 1 Plan 03: Profiles & Adversarial Fixtures Summary

**Zod Profile and fixture schemas are exported from the `schemas.ts` barrel. They cover a GPA-3.3 semester demo profile, a 90-unit quarter variant, a 450-word clean essay, and two prompt-injection fixtures (essay and inbox email) whose `evil.example` markers are schema-guaranteed to appear in the body. The full Phase 1 gate passes.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-09-13T17:26:29Z
- **Completed:** 2026-09-13T17:30:30Z
- **Tasks:** 2
- **Files:** 9 (8 created, 1 modified)

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Profile and fixture schemas, plus barrel re-exports | 16f9d2d | schemas/profile.ts, schemas/fixtures.ts, schemas.ts |
| 2 | Demo profiles, adversarial fixtures, validation tests, phase gate | ede7cde | profiles/*.json, fixtures/*.json, profiles-fixtures.test.ts |

## Verification (Phase 1 gate, sequential)

- `npm --prefix web test`: 5 files, 31/31 tests pass. This includes 11 new tests in profiles-fixtures.test.ts.
- `npm --prefix web run check`: 469 files, 0 errors, 0 warnings.
- `VERCEL=1 npm --prefix web run build`: exit 0. It emits `.vercel/output/config.json` and `functions/api`.
- `BASE_PATH=/multi-app-agent` static build: exit 0. `build/.nojekyll` exists, and `build/404.html` references `/multi-app-agent/_app`.
- Acceptance greps: quarter=1, transfer-help marker=2, records marker=2, evil.example in clean essay=0, northfield-fictional-cs in demo=1. The barrel has 3 re-exports, profile.ts has 5 exports and fixtures.ts has 3.
- The clean essay has 450 words, which is inside the 380-480 range.

## Deviations from Plan

**1. [Minor] demo-quarter course codes**
- The plan said to keep "the same mapping" but did not name the quarter course codes. De Anza-style codes and titles (MATH 1A/1B, CIS 22A/22B, ECON 1, EWRT 1A, MATH 10) were used. The satisfies mapping and unit rules are exactly as specified.

**2. [TDD ordering] No separate RED commit for Task 2**
- The fixtures and the tests were written in the same step and committed together as a single feat commit. The tests assert data-file contents, so a RED run against missing JSON would only prove that imports fail.

**3. [Additive] Extra tests beyond the behavior list**
- Duplicate activity and contact ids are rejected.
- The injected essay must equal the clean essay plus exactly one paragraph at index 2.
- The inbox email marker refinement gets its own negative case.

No 01-01 or 01-02 files needed fixes.

## Notes for Downstream Phases

- **Phase 2 mocks:** seed Docs from `fixtures/essay-doc*.json` (doc ids `doc-essay-demo`, `doc-essay-demo-injected`) and seed Gmail from `inbox-email-injection.json`. The Profile's `essay_doc_id` is the only doc the agent may read.
- **Phase 3 gap analysis:** these requirements are deliberately missing: `linear-algebra`, `data-structures`, `econ-1120`. MATH 142 (statistics) is deliberately unmapped, so it should produce unknown-equivalency against `data-c8`. The GPA of 3.3 is below Cornell A&S competitive_gpa (3.5) and at or above Berkeley min_gpa.
- **Phase 5/6 evals:** leakage oracle markers are `transfer-help@evil.example` and `records@evil.example`. No profile email uses the `evil.example` domain.

## Known Stubs

None.

## Self-Check: PASSED

- All 9 key files exist on disk.
- Commits 16f9d2d and ede7cde are present in git history.

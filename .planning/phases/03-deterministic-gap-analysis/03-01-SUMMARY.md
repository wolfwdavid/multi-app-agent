---
phase: 03-deterministic-gap-analysis
plan: 01
subsystem: gap-analysis
tags: [zod, gap-analysis, feasibility, determinism, snapshot, vitest]
requires:
  - "01-02: schemas/school.ts (Program, School, SchoolsDataset, requirementIds) and data/schools.json"
  - "01-03: schemas/profile.ts (Profile, ProfileCourse) and profiles/demo.json, demo-quarter.json"
provides:
  - "web/src/lib/core/gap/types.ts: zod GapReport contract, FeasibilityWarning, stable WarningCode enum + WARNING_CODE_ORDER"
  - "web/src/lib/core/gap/analyze.ts: analyzeGaps(profile, schools, { today }) pure function"
  - "web/src/lib/core/gap/warnings.ts: buildWarnings with fixed message templates"
  - "web/src/lib/core/gap/units.ts, dates.ts, equivalency.ts: convertUnits, daysUntil/assertIsoDate, subjectFamily/classifyPrereq"
  - "web/src/lib/core/gap/index.ts: gap barrel"
affects: [phase-04-planner-tracker, phase-05-critique, phase-06-evals, phase-07-ui]
tech-stack:
  added: []
  patterns:
    - "Every finding spreads a Provenance { requirementId, sourceUrl, confidence } built from the dataset field it came from"
    - "Clock injected as options.today; day math only via Date.UTC"
    - "Integrity test walks the report and proves ids, URLs and numbers all trace to inputs"
key-files:
  created:
    - web/src/lib/core/gap/types.ts
    - web/src/lib/core/gap/units.ts
    - web/src/lib/core/gap/dates.ts
    - web/src/lib/core/gap/equivalency.ts
    - web/src/lib/core/gap/analyze.ts
    - web/src/lib/core/gap/warnings.ts
    - web/src/lib/core/gap/index.ts
    - web/src/lib/core/gap/helpers.test.ts
    - web/src/lib/core/gap/analyze.test.ts
    - web/src/lib/core/gap/feasibility.test.ts
    - web/src/lib/core/gap/integrity.test.ts
    - web/src/lib/core/gap/__snapshots__/analyze.test.ts.snap
  modified: []
key-decisions:
  - "GPA status order: below_minimum > below_competitive > at_or_above_competitive > meets_minimum > not_published, so competitive_gpa is evaluated even when min_gpa is null (Cornell fallback)"
  - "Prereqs are only 'met' via an explicit satisfies mapping on a completed/in-progress course; same-subject unmapped courses yield unknown-equivalency, never met"
  - "Deadline pick: application deadlines for the target term (fallback: any application deadline); earliest upcoming, else latest passed"
  - "NO_TRANSFER_PROGRAM short-circuits all other warnings for that program"
requirements-completed: [GAP-01, GAP-02]
duration: 7min
completed: 2026-09-13
---

# Phase 3 Plan 01: Deterministic Gap Analysis Summary

**`analyzeGaps(profile, schools, { today })` is a pure, clock-free zod-contracted engine. It returns one provenance-carrying GapReport per target, covering GPA vs min/competitive, semester/quarter unit conversion, met/missing/unknown-equivalency prereqs, essays/recs, next deadline, and stable-code feasibility warnings. Snapshot and integrity tests prove the output is reproducible and invents no ids, URLs or numbers.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-13T17:32:21Z
- **Completed:** 2026-09-13T17:39:04Z
- **Tasks:** 3 (TDD, 6 commits)
- **Files:** 12 created, all under `web/src/lib/core/gap/`

## Task Commits

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | GapReport contract, units, dates, equivalency | `f99116c` (test, RED), `e95f1ef` (feat, GREEN) | types.ts, units.ts, dates.ts, equivalency.ts, helpers.test.ts |
| 2 | analyzeGaps, table tests, determinism snapshot | `ec515d8` (test, RED), `241d741` (feat, GREEN) | analyze.ts, warnings.ts (stub), index.ts, analyze.test.ts, .snap |
| 3 | Feasibility warnings + integrity tests | `f91befa` (test, RED), `24713b2` (feat, GREEN) | warnings.ts, feasibility.test.ts, integrity.test.ts, .snap |

## Exported API (for Phases 4, 5, 6, 7)

Import from `web/src/lib/core/gap/index.ts` (or the individual `.ts` files, using relative `.ts` imports).

```ts
analyzeGaps(profile: Profile, schools: SchoolsDataset | readonly School[], options: { today: 'YYYY-MM-DD' }): GapReport[]
// throws /YYYY-MM-DD/ on a bad today, /unknown target/ on an unresolvable target
```

`GapReport` top-level fields, in snapshot key order: `profileId, schoolId, programId, schoolName, programName, isFictional, targetTerm, asOf, hasTransferProgram, gpa{student,min,competitive,status}, units{requiredMin,requiredSystem,studentSystem,studentCompleted,studentInProgress,converted,completedInRequiredSystem,projectedInRequiredSystem,shortfall,status}, prereqs[], gePattern, essays{required[],optional[],requiredCount,optionalCount}, recs, aiPolicy, deadline|null, allDeadlines[], warnings[], summary{met,missing,unknownEquivalency,blockers,warnings,info}`.

Every finding carries `requirementId` (`${programId}#field`, `#course:id`, `#essay:id` or `#deadline:id`), plus `sourceUrl` and `confidence`.

`FeasibilityWarning`: `{ code, severity: 'blocker'|'warning'|'info', message, schoolId, programId, requirementId, sourceUrl, confidence, relatedRequirementIds[] }`. These fields map onto the Phase 4 Blocker contract.

`WarningCode` (STABLE, emitted in this order): `NO_TRANSFER_PROGRAM, DEADLINE_PASSED, GPA_BELOW_MIN, GPA_BELOW_COMPETITIVE, UNITS_SHORT, PREREQ_MISSING_TERMS_LEFT, PREREQ_UNKNOWN_EQUIVALENCY, DATA_NOT_PUBLISHED`.

## Demo profile results (today 2026-09-13)

| Program | GPA | Units | Prereqs met/missing/unknown | Next deadline | Warning codes |
| ------- | --- | ----- | --------------------------- | ------------- | ------------- |
| uc-berkeley-data-science-ba | meets_minimum (3.0) | met_with_in_progress (45 + 15 = 60/60) | 3 / 4 / 1 | 2026-11-30, 78 days | PREREQ_MISSING_TERMS_LEFT, PREREQ_UNKNOWN_EQUIVALENCY |
| cornell-as-economics | below_competitive (3.5) | met (12) | 2 / 1 / 1 | 2027-03-15, 183 days | GPA_BELOW_COMPETITIVE, PREREQ_MISSING_TERMS_LEFT, PREREQ_UNKNOWN_EQUIVALENCY, DATA_NOT_PUBLISHED |
| umich-lsa | not_published | not_published | 0 / 0 / 0 | 2027-02-01, 141 days | DATA_NOT_PUBLISHED x2 (min_gpa, units) |
| northfield-fictional-cs | not_published | not_published | 0 / 0 / 0 | none | NO_TRANSFER_PROGRAM (blocker) |

For demo-quarter (70 + 20 quarter units), Berkeley converts to 46.67 completed and 60 projected semester units, giving `met_with_in_progress`, the same status as the semester profile.

The synthetic cases also covered by tests:
- GPA 2.9 gives Berkeley GPA_BELOW_MIN.
- A UVA target gives GPA_BELOW_MIN against 3.4.
- 30 + 10 semester units, or 45 + 15 quarter units, gives UNITS_SHORT with a shortfall of 20.
- terms_remaining 0 turns PREREQ_MISSING into a blocker.
- today 2026-12-01 makes DEADLINE_PASSED the first Berkeley warning.

## Verification

- `npm --prefix web test -- src/lib/core/gap/`: 4 files, 137 tests pass.
- `npm --prefix web test` (full suite): 11 files, 194 tests pass. No Phase 2 connector failures were observed.
- `npm --prefix web run check`: 490 files, 0 errors, 0 warnings.
- A grep for `Date.now|new Date()|Math.random` under gap/ returns nothing, and so does a grep for `connectors/`.
- The Task 3 snapshot update diff changed only the `warnings` arrays and `summary` counts.
- `git status` shows no changes outside `web/src/lib/core/gap/`. The only untracked file is Phase 2's `02-01-SUMMARY.md`, which this plan does not own.

## Deviations from Plan

None that change behavior. These are minor implementation choices:
- `daysUntil` wraps the UTC millisecond difference in `Math.round`. It's a no-op for valid dates, since UTC has no DST, but it guarantees an integer for the `z.number().int()` contract.
- `classifyPrereq` accepts `readonly ProfileCourse[]`, so frozen inputs type-check.
- There are more tests than the behavior list required:
  - WarningCode order is pinned in helpers.test.ts.
  - The integrity suite also runs the quarter units-short profile and covers `deadline.daysUntil`.
  - The summary-count check includes a combined synthetic profile (GPA 2.9, 0 terms, passed deadline).

## Known Stubs

None. The Task 2 `buildWarnings` stub was replaced in Task 3.

## Next Phase Readiness

- **Phase 4:** turn each `FeasibilityWarning` into a Blocker (`code`, `message`, `requirementId`, `schoolId`, `programId`). Use `report.deadline` and `report.allDeadlines` for Calendar and tracker rows.
- **Phase 5:** LLM phrasing may reword `message`, but must never change `code`, `severity` or numbers. The integrity walkers in `integrity.test.ts` can be reused as a guard.
- **Phase 6:** the eval oracles key on GPA_BELOW_MIN (UVA 3.4 or Berkeley 3.0), NO_TRANSFER_PROGRAM (Northfield) and quarter-unit conversion (demo-quarter).

## Self-Check: PASSED

- All 12 key files exist on disk (7 source files, 4 test files, 1 snapshot).
- Commits f99116c, e95f1ef, ec515d8, 241d741, f91befa and 24713b2 are present in git history.
- `git log -6 --format=%B` has no attribution trailers or assistant mentions.

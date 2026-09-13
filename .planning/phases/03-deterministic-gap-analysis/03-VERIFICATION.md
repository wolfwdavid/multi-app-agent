---
phase: 03-deterministic-gap-analysis
verified: 2026-09-13T13:45:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 3: Deterministic Gap Analysis Verification Report

**Phase Goal:** A student gets a correct, reproducible per-school gap report and feasibility warnings computed from profile plus dataset, with no LLM involved.
**Verified:** 2026-09-13T13:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | For the demo profile, analyzeGaps returns one report per target (Berkeley DS, Cornell A&S Econ, Michigan LSA, Northfield) with GPA vs min/competitive, units vs required, each prereq as met/missing/unknown-equivalency, essays and recs needed, and days to the next application deadline | VERIFIED | `analyze.ts` builds all fields; `analyze.test.ts` table-tests every program; spot-check script confirmed live output (Berkeley meets_minimum/met_with_in_progress, Cornell below_competitive/met, Umich not_published/not_published, Northfield not_published/not_published) |
| 2 | Output is byte-identical across runs, does not read the system clock (today is injected), and matches a committed snapshot | VERIFIED | `grep -rnE "Date\.now\|new Date\(\)\|Math\.random" web/src/lib/core/gap` returns nothing; independent spot-check ran `analyzeGaps` twice with identical inputs and `JSON.stringify(r1) === JSON.stringify(r2)` → `true`; `__snapshots__/analyze.test.ts.snap` exists and is asserted in `analyze.test.ts` |
| 3 | The quarter-unit profile (70+20 quarter units) is converted to 60 semester units against Berkeley's 60-semester requirement, with the same status as the semester profile | VERIFIED | Spot-check: `demoQ` Berkeley units = `{studentCompleted:70, studentInProgress:20, converted:true, completedInRequiredSystem:46.67, projectedInRequiredSystem:60, shortfall:0, status:"met_with_in_progress"}` — matches semester-profile status |
| 4 | Cornell A&S Econ (min_gpa null, competitive_gpa 3.5) with GPA 3.3 yields GPA_BELOW_COMPETITIVE referencing cornell-as-economics#competitive_gpa; Northfield yields exactly one NO_TRANSFER_PROGRAM warning; missing prereqs yield PREREQ_MISSING_TERMS_LEFT with terms_remaining | VERIFIED | Spot-check: Cornell warnings include `GPA_BELOW_COMPETITIVE` with message "No minimum GPA is published; GPA 3.3 is below the program's competitive GPA of 3.5." (requirementId `cornell-as-economics#competitive_gpa` confirmed in feasibility.test.ts); Northfield warnings === `['NO_TRANSFER_PROGRAM']` exactly; Berkeley/Cornell both show `PREREQ_MISSING_TERMS_LEFT` in warnings list, message includes term count (tested in feasibility.test.ts) |
| 5 | Every finding references a requirement id that exists in requirementIds(program), every sourceUrl is one of the program's provenance URLs, and every number in the report appears in the profile, the program data, today, or a declared derived field | VERIFIED | `integrity.test.ts` walks every report (demo, demoQ, 5 synthetic profiles) checking requirementId/relatedRequirementIds membership, sourceUrl membership, and numeric provenance via regex token extraction; all 137 gap tests pass including this file; spot-check confirms Umich shows `gpa.min: null, units.requiredMin: null` (DATA_NOT_PUBLISHED, no invented numbers) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `web/src/lib/core/gap/types.ts` | zod GapReport contract + stable WarningCode enum | VERIFIED | Exports `GapReport, FeasibilityWarning, WarningCode, PrereqStatus, GpaStatus, UnitsStatus, AnalyzeOptions` exactly as required; all 8 warning codes present; imports `Confidence, UnitSystem` from `../schemas/school.ts` (never redefines Program/School/etc.) |
| `web/src/lib/core/gap/analyze.ts` | analyzeGaps pure function | VERIFIED | `export function analyzeGaps(profile, schools, options): GapReport[]`; no `Date.now`/`new Date()`/`Math.random`; never mutates inputs (uses map/filter/spread/sort-on-copy) |
| `web/src/lib/core/gap/warnings.ts` | feasibility warnings with stable codes | VERIFIED | `export function buildWarnings(...)`; all 8 codes emitted in WARNING_CODE_ORDER; NO_TRANSFER_PROGRAM short-circuits other warnings |
| `web/src/lib/core/gap/units.ts` | semester/quarter conversion | VERIFIED | `convertUnits`, `QUARTER_UNITS_PER_SEMESTER_UNIT = 1.5`; spot-checked 70 quarter → 46.67 semester |
| `web/src/lib/core/gap/index.ts` | gap barrel | VERIFIED | `export * from './analyze.ts'` and other modules present |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `gap/analyze.ts` | `schemas/school.ts` | `import type { Program, School, SchoolsDataset }` | WIRED | Line 2: `import type { Program, School, SchoolsDataset, SourceRef } from '../schemas/school.ts';` |
| `gap/analyze.ts` | `gap/warnings.ts` | `buildWarnings(...) assigned to report.warnings` | WIRED | Line 16 import, line 164 `const warnings = buildWarnings({ profile, school, program: p, report: base });`, assigned into returned report at line 169 |
| `gap/integrity.test.ts` | `schemas/school.ts` | `requirementIds(program) membership check` | WIRED | Confirmed via grep (`requirementIds(` present) and test pass |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| GAP-01 | 03-01-PLAN.md | User sees a deterministic per-school gap report: GPA vs program minimum/competitive, units vs required (with semester↔quarter conversion), each prereq marked met/missing/unknown-equivalency, essays and recs needed, days to deadline | SATISFIED | `analyzeGaps` produces this exact shape; verified live via spot-check and 137 passing gap tests; REQUIREMENTS.md marks GAP-01 Complete |
| GAP-02 | 03-01-PLAN.md | User sees feasibility warnings (missing prereqs vs terms remaining, GPA below program-specific minimum, no transfer program) | SATISFIED | `buildWarnings` emits PREREQ_MISSING_TERMS_LEFT, GPA_BELOW_MIN/GPA_BELOW_COMPETITIVE, NO_TRANSFER_PROGRAM; all verified live via spot-check; REQUIREMENTS.md marks GAP-02 Complete |

No orphaned requirements: REQUIREMENTS.md maps only GAP-01 and GAP-02 to Phase 3, and both appear in 03-01-PLAN.md's `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None found | — | Grep for TODO/FIXME/PLACEHOLDER/HACK/not-implemented/coming-soon across `web/src/lib/core/gap/` returned no matches. Grep for `Date.now`/`new Date()`/`Math.random` returned no matches. |

### Human Verification Required

None. All behavior is deterministic, pure-function output verifiable by automated tests and grep, and was independently re-derived outside the test suite via a throwaway tsx script (since deleted).

### Gaps Summary

No gaps. All 5 derived must-haves (from PLAN frontmatter) verified against the actual codebase, not just SUMMARY claims:

- `npm --prefix web test -- src/lib/core/gap` → 4 files, 137 tests pass.
- `npm --prefix web run check` → 497 files, 0 errors, 0 warnings.
- `npm --prefix web test` (full suite, including Phase 2's concurrently-landed connector tests) → 12 files, 213 tests pass, zero failures anywhere (no Phase 2 gaps to exclude).
- Independent spot-check (throwaway `npx tsx` script, deleted after use) confirmed: determinism (two `analyzeGaps` calls on identical input produce byte-identical JSON), Cornell A&S competitive-GPA fallback warning with correct message and requirementId, Northfield's exactly-one `NO_TRANSFER_PROGRAM` warning, Michigan's `DATA_NOT_PUBLISHED` warnings with `null` GPA/units values (no invented numbers), and correct quarter→semester unit conversion (70 quarter units → 46.67 semester units, matching the 60-semester-unit Berkeley requirement with `met_with_in_progress` status).

Phase 3 goal is achieved: a student gets a correct, reproducible, LLM-free per-school gap report and feasibility warnings from profile plus dataset.

---

_Verified: 2026-09-13T13:45:00Z_
_Verifier: Claude (gsd-verifier)_

---
phase: 01-contracts-seed-data-build-smoke
verified: 2026-09-13T17:33:20Z
status: passed
score: 4/4 must-haves verified
---

# Phase 1: Contracts, Seed Data & Build Smoke Verification Report

**Phase Goal:** The shared domain contracts and a sourced, program-level transfer requirements dataset exist, and both deploy builds (static and Vercel) succeed, so everything else builds on locked schemas.
**Verified:** 2026-09-13T17:33:20Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Phase 1 Success Criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `schools.json` validates against the zod School schema, 4 real + 1 fictional school, keyed by school+program, each with min/competitive GPA, units+system, required courses, GE pattern, essays with word limits, recs, deadlines by term, has_transfer_program, ai_policy | VERIFIED | `web/src/lib/core/data/schools.json`: `is_fictional: true` count = 1, `(FICTIONAL)` present (2 occurrences: name + disclaimer), `program_id` count = 6, `source_url` count = 93. `schools.test.ts` (part of the 31 passing tests) asserts school_ids `['uc-berkeley','cornell','umich','uva','northfield-fictional']` and full field coverage per `web/src/lib/core/schemas/school.ts` (`Program` zod object requires all listed fields). |
| 2 | A schema test fails if any requirement field is missing `source_url`, `retrieved_at`, or `confidence`, and passes on the committed dataset | VERIFIED | `web/src/lib/core/data/schools.test.ts` contains `toBeGreaterThan(100)` (present, grep=1) driving a programmatic negative-case loop (documented as 168 cases in 01-02-SUMMARY.md) that deletes each provenance key per scalar/course/deadline/essay field and expects `safeParse` failure; the same file's positive test passes on the committed `schools.json`. Full suite run: 5 files / 31 tests passed. |
| 3 | A seeded demo student profile and adversarial content fixtures validate: essay doc, essay doc with injection, inbox email with injection, and a quarter-unit profile variant | VERIFIED | `web/src/lib/core/data/profiles/demo.json` (`profile_id: demo`, grep=1), `profiles/demo-quarter.json` (`system: quarter`, grep=1), `fixtures/essay-doc.json` (0 occurrences of `evil.example`, clean), `fixtures/essay-doc-injection.json` (`transfer-help@evil.example` count=2: body+marker), `fixtures/inbox-email-injection.json` (`records@evil.example` count=2: body+marker). `profiles-fixtures.test.ts` validates all five against `Profile`/`EssayDocFixture`/`InboxEmailFixture` schemas exported from the `schemas.ts` barrel, part of the 31 passing tests. |
| 4 | Static build (adapter-static, BASE_PATH=/multi-app-agent) and Vercel build (VERCEL=1, adapter-vercel) both succeed with `/api/health`; nothing under `src/lib/core` imports `$app`/`$env`/`$lib`/`svelte` | VERIFIED | Ran both builds directly (see below). Static build: exit 0, `web/build/404.html` references `/multi-app-agent/_app`, `web/build/.nojekyll` exists. Vercel build: exit 0, `web/.vercel/output/config.json` exists, `web/.vercel/output/functions/api` present. `grep -rE "from ['\"](\$app|\$env|\$lib|svelte)" web/src/lib/core --include=*.ts` (excluding boundary.test.ts) returns 0 matches; `boundary.test.ts` enforces this in `npm test`. |

**Score:** 4/4 truths verified

### Gate Commands Actually Run (this session)

| Command | Result |
| --- | --- |
| `npm --prefix web test` | 5 test files, 31/31 tests passed |
| `npm --prefix web run check` | svelte-check: 469 files, 0 errors, 0 warnings |
| `MSYS_NO_PATHCONV=1 BASE_PATH=/multi-app-agent npm --prefix web run build` | exit 0; `web/build/404.html` contains `/multi-app-agent/_app`; `web/build/.nojekyll` exists |
| `VERCEL=1 npm --prefix web run build` | exit 0; `web/.vercel/output/config.json` exists; `functions/api/` present |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `web/src/lib/core/schemas.ts` | Action, Plan, ToolResult, RunReport, TraceEvent, FailureClass, IdempotencyKey zod contracts + barrel re-exports | VERIFIED | 7/7 named exports matched; `export * from './schemas/{school,profile,fixtures}.ts'` count=3; 162 lines, substantive |
| `web/src/lib/core/schemas/school.ts` | School/Program/SourceRef schemas | VERIFIED | 11/11 contract exports matched (Confidence, UnitSystem, AiPolicy, SourceRef, sourced, RequiredCourse, Deadline, Essay, Program, School, SchoolsDataset) |
| `web/src/lib/core/schemas/profile.ts` | Profile, ProfileCourse, Activity, Contact, Target | VERIFIED | 5/5 exports matched, `essay_doc_id` present exactly once |
| `web/src/lib/core/schemas/fixtures.ts` | Adversarial, EssayDocFixture, InboxEmailFixture | VERIFIED | 3/3 exports matched, marker superRefine present |
| `web/src/lib/core/connectors/types.ts` | Per-app ports + ConnectorError, no send() | VERIFIED | 5 `findByKey` occurrences, 0 `send(` occurrences, 1 `ConnectorError extends Error` class |
| `web/src/lib/core/tools/registry.ts` | defineTool/createRegistry | VERIFIED | `createRegistry` exported exactly once, 45 lines |
| `web/src/lib/core/trace/tracer.ts` | createTracer/MemorySink | VERIFIED | `createTracer` exported exactly once, 90 lines |
| `web/src/lib/core/boundary.test.ts` | Framework-free core guard | VERIFIED | Part of passing test suite; manual grep for forbidden imports outside this file returns 0 matches |
| `web/vite.config.ts` | Dual adapter switch | VERIFIED | `process.env.VERCEL` present, `adapter-vercel` import present exactly once |
| `web/src/routes/api/health/+server.ts` | Dummy health endpoint | VERIFIED | `export const prerender = false`, returns JSON with ok/service/target/time — not a stub |
| `web/src/lib/core/data/schools.json` | Curated dataset, 5 schools/6 programs, per-field provenance | VERIFIED | Counts confirmed above; every requirement field wrapped with `SourceRef` per schema |
| `web/scripts/build-schools.ts` | Reproducible transform from seed-schools.json | VERIFIED | Referenced and run per 01-02-SUMMARY ("wrote 5 schools / 6 programs", idempotent) |
| `web/src/lib/core/data/schools.test.ts` | Dataset + provenance negative tests | VERIFIED | Present, part of passing suite, contains `toBeGreaterThan(100)` |
| `web/src/lib/core/data/profiles/demo.json`, `demo-quarter.json` | Demo profiles | VERIFIED | Content-checked above |
| `web/src/lib/core/data/fixtures/*.json` | Clean essay + 2 injection fixtures | VERIFIED | Marker/domain checks above |
| `web/src/lib/core/data/profiles-fixtures.test.ts` | Profile/fixture validation tests | VERIFIED | Part of passing suite |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `web/vite.config.ts` | `@sveltejs/adapter-vercel` | `process.env.VERCEL` ternary | WIRED | Both builds actually ran and produced correct adapter-specific output (`.vercel/output` vs `build/404.html`) |
| `web/src/lib/core/trace/tracer.ts` | `web/src/lib/core/schemas.ts` | `TraceEvent` type | WIRED | Tracer test suite (contracts.test.ts) exercises span/event emission and parses each event with `TraceEvent.parse` |
| `web/src/lib/core/data/schools.test.ts` | `web/src/lib/core/schemas/school.ts` | `SchoolsDataset.safeParse` | WIRED | Test imports and calls safeParse on committed JSON; part of the 31 passing tests |
| `web/scripts/build-schools.ts` | `.planning/research/seed-schools.json` | readFileSync + per-field mapping | WIRED | 01-02-SUMMARY confirms every URL in schools.json traces back to seed-schools.json (no invented URLs), script re-run confirmed idempotent |
| `web/src/lib/core/schemas.ts` | `web/src/lib/core/schemas/school.ts` | `export * from` re-export | WIRED | grep confirms 3 re-export lines; `npm run check` reports 0 errors (no duplicate-export collision) |
| `web/src/lib/core/data/profiles-fixtures.test.ts` | `web/src/lib/core/data/schools.json` | targets cross-reference | WIRED | Test suite validates every profile target's school_id/program_id pair exists in schools.json (per 01-03 behavior spec, part of passing suite) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| DATA-01 | 01-01, 01-02, 01-03 | Requirements dataset covers 4 real + 1 fictional adversarial school, keyed by school+program, with full field set | SATISFIED | `schools.json` content verified above; schema in `schemas/school.ts` enforces all required fields |
| DATA-02 | 01-01, 01-02, 01-03 | Every requirement field carries source_url/retrieved_at/confidence (schema+test enforced); UI "verify on official page" link | PARTIALLY SATISFIED (as intentionally scoped) | Provenance enforcement fully verified (schema + 100+ case negative test). The "UI shows verify-on-official-page link next to it" portion is explicitly deferred to Phase 7 per ROADMAP note and 01-02-SUMMARY ("the UI link part of DATA-02 lands in Phase 7"). Not a gap for Phase 1 — recorded per task instructions. |

No orphaned requirements: REQUIREMENTS.md maps only DATA-01 and DATA-02 to Phase 1, both declared in all three plans' `requirements` frontmatter.

### Anti-Patterns Found

None. Scanned all core contract/schema/connector/registry/tracer files and the health route for TODO/FIXME/placeholder/stub comments, empty-return handlers, and no-op arrow functions — zero matches. All files are substantive (43-162 lines each, full implementations matching their PLAN interfaces).

### Human Verification Required

None required for this phase's automated, schema/build-focused scope. The deferred DATA-02 UI link is out of scope for Phase 1 (explicitly assigned to Phase 7) and will be verified there.

### Gaps Summary

No gaps. All 4 ROADMAP Phase 1 success criteria are verified against actual gate runs performed in this session (not just SUMMARY claims): `npm --prefix web test` (31/31 passed), `npm --prefix web run check` (0 errors), the static build (BASE_PATH=/multi-app-agent, emits correct 404.html/.nojekyll), and the Vercel build (VERCEL=1, emits .vercel/output with an api function). The core boundary guard (no $app/$env/$lib/svelte imports under src/lib/core) is enforced by a passing test and independently confirmed by direct grep. DATA-01 and DATA-02 are both satisfied for their Phase-1 scope; DATA-02's UI-link sub-requirement is correctly deferred to Phase 7 and does not block this phase.

---

_Verified: 2026-09-13T17:33:20Z_
_Verifier: Claude (gsd-verifier)_

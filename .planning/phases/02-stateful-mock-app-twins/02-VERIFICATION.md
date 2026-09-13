---
phase: 02-stateful-mock-app-twins
verified: 2026-09-13T17:48:53Z
status: passed
score: 7/7 must-haves verified
---

# Phase 2: Stateful Mock App Twins Verification Report

**Phase Goal:** Every app the agent touches has a stateful, credential-free twin behind the same port interface the real connectors will implement, with uniform idempotency lookup and injectable real-shaped faults.
**Verified:** 2026-09-13T17:48:53Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `createConnectors({ mode: 'mock' })` returns Gmail/Calendar/Docs/Notion/GitHub/HF ports over a per-run seeded World; snapshot/reset/diff work; two concurrent worlds never share state | ✓ VERIFIED | `web/src/lib/core/connectors/index.ts` builds `{ mode:'mock', world, ...createMockConnectors(world) }`; `world.ts` has snapshot/restore/reset/diff; `world.test.ts` (12 tests) and `connectors.test.ts` isolation test cover concurrency. Independent tsx spot-check: two worlds from the same seed object produced independent `nextId` sequences, and a second `createConnectors` bundle could not see the first bundle's Notion write |
| 2 | Every write port exposes `findByKey`; keyed item found after creation, absent before | ✓ VERIFIED | `notion.ts`, `calendar.ts`, `docs.ts`, `gmail.ts` each implement `findByKey`; `twins.test.ts` (14 tests) and `connectors.test.ts` assert null-before/found-after. Independent spot-check confirmed find-before-null and find-after-found for all four write ports |
| 3 | `withFaults(port, rules)` injects 429 (retryAfterMs), 500, ghost-write, lying-success, and latency by rule, deterministically for a seed; mocks reject real-API violations (Notion >2000 chars, malformed all-day dates) | ✓ VERIFIED | `faults.ts` implements all 5 `FaultSpec` types with a local mulberry32 PRNG (no `Math.random`); `faults.test.ts` (19 tests, incl. determinism-by-seed); `notion.ts` calls `assertNotionRichText`/`assertNotionSelect`/`assertNotionDate`, `calendar.ts` calls `assertAllDayDate`. Independent spot-check: ghost-write on `gmail.createDraft` rejected with status 500 while `findByKey` still found the draft (call 1, seed 1, reproduced on a second bundle with the same seed); lying-success on `calendar.createEvent` resolved ok while `findByKey` returned null and `world.diff` was empty |
| 4 | Gmail port has no `send` at the type level; `mode: 'real'` resolves through the same factory with real implementations reporting "not configured" | ✓ VERIFIED | `gmail.ts` returns exactly `{createDraft, findByKey, listDrafts, searchInbox}`; `twins.test.ts` and `connectors.test.ts` have `@ts-expect-error` on `gmail.send`, satisfied under `svelte-check` (0 errors). `real/index.ts` stubs every port method to throw `ConnectorError('not_configured', ...)` naming missing env vars. Independent spot-check: `'send' in gmail` is false in mock, fault-wrapped, and real bundles; `createConnectors({mode:'real', env:{}}).notion.findByKey` rejected with `kind: 'not_configured'` and a message containing `NOTION_TOKEN` |

**Score:** 4/4 truths verified (mapped 1:1 to ROADMAP Phase 2 success criteria 1-4)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `web/src/lib/core/connectors/mock/world.ts` | World factory, snapshot/restore/reset/diff | ✓ VERIFIED | Exports `createWorld`, `diffWorldStates`, `isEmptyDiff`, `DEFAULT_CLOCK`, all documented types; no top-level `let`/`var`; no `Math.random`/`Date.now`/`randomUUID` |
| `web/src/lib/core/connectors/mock/validate.ts` | Real-API-shape validators | ✓ VERIFIED | `isIsoDate`, `addDaysIso`, `assertIdempotencyKey`, `assertNotionRichText`, `assertAllDayDate`, `assertEmailList`, `NOTION_RICH_TEXT_MAX` all present and used by twins |
| `web/src/lib/core/connectors/mock/{notion,calendar,docs,gmail}.ts` | Write twins with findByKey | ✓ VERIFIED | Each exports `createMockX`; each has `findByKey` (grep >=1 per file per SUMMARY); wired into `mock/index.ts` and `connectors/index.ts` |
| `web/src/lib/core/connectors/mock/{github,hf}.ts` | Read-only twins | ✓ VERIFIED | `createMockGitHub`/`createMockHF`; unknown-user 404 / empty-array behavior confirmed by `world.test.ts` |
| `web/src/lib/core/connectors/mock/faults.ts` | withFaults/withFaultsAll + zod FaultRule | ✓ VERIFIED | All exports present (`withFaults`, `withFaultsAll`, `FaultRule`, `FaultSpec`, `StateRollback`, `FaultEvent`); 19 tests in `faults.test.ts` |
| `web/src/lib/core/connectors/mock/seed.ts` | Fixture → WorldSeed mapping | ✓ VERIFIED | `defaultWorldSeed`, `GitHubFixture`, `HFFixture`, `essayFixtureToDoc`, `emailFixtureToMessage` all present; re-parses fixture JSON on every call (no shared mutable import state) |
| `web/src/lib/core/connectors/real/index.ts` | not_configured stubs + env status | ✓ VERIFIED | `createRealConnectors`, `realConnectorStatus`, `REAL_ENV_REQUIREMENTS` exported; every stub method throws `ConnectorError('not_configured', ...)` naming missing env vars; no `send` method |
| `web/src/lib/core/connectors/index.ts` | createConnectors mode switch | ✓ VERIFIED | `createConnectors`, `resolveConnectorMode`, `MockConnectors`, `RealConnectors` all exported and wired |
| `web/src/lib/core/data/fixtures/{github-repos,hf-items}.json` | Portfolio fixtures | ✓ VERIFIED | Both contain `"source": "fixture"`; consumed by `seed.ts` via `GitHubFixture`/`HFFixture` schemas |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `mock/notion.ts` (and calendar/docs/gmail) | `connectors/types.ts` | Returns `XPort`; throws `ConnectorError` | ✓ WIRED | `npm run check` reports 0 errors — ports type-check against Phase 1 interfaces |
| `mock/*.ts` | `mock/world.ts` | Reads `world.state.<app>` per call, never cached | ✓ WIRED | Confirmed by spot-check: state mutated by one bundle is invisible to a second bundle built from the same seed value |
| `mock/validate.ts` | `schemas.ts` | `IdempotencyKey.safeParse` | ✓ WIRED | `assertIdempotencyKey` used inside all four write twins before any mutation |
| `connectors/index.ts` | `mock/world.ts` | `createWorld(opts.seed ?? defaultWorldSeed())` | ✓ WIRED | Present in index.ts; confirmed by spot-check bundles receiving live, functioning worlds |
| `connectors/index.ts` | `mock/faults.ts` | `withFaultsAll(bundle, rules, { seed, rollback: world })` | ✓ WIRED | Confirmed by spot-check: ghost-write and lying-success fault rules passed through `createConnectors({ faults })` actually altered runtime behavior |
| `mock/seed.ts` | `data/fixtures/*.json` | JSON imports validated by fixture schemas | ✓ WIRED | `connectors.test.ts` asserts `docs.readDoc('doc-essay-demo')` resolves non-empty text and `github.listRepos('wolfwdavid')` returns seeded repos |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| APPS-04 | 02-01, 02-02 | Every connector has a stateful mock and a real implementation behind one interface, switchable by config; mock mode fully works without credentials | ✓ SATISFIED | `createConnectors({mode})` switches mock/real behind one `Connectors` interface; mock mode requires no env vars (spot-check ran with zero env vars set); real mode fails loudly with `not_configured` per app, naming missing vars |

No orphaned requirements: REQUIREMENTS.md maps only APPS-04 to Phase 2, and both plans declare it in frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | A grep for TODO/FIXME/placeholder/"not yet implemented" across `connectors/**` returned only an incidental substring match in `seed.ts` (comment text unrelated to stubbing); no genuine stub markers. The intentional `not_configured` stubs in `real/index.ts` are documented as intentional (Phase 10 replaces them) and fail loudly rather than silently — this is the designed behavior, not a gap |

### Human Verification Required

None. All success criteria for this phase are unit-testable and were independently reproduced outside the test suite via a throwaway tsx script (deleted after use).

### Gaps Summary

No gaps. `npm --prefix web test` (226/226 passing, including the previously-parallel Phase 3 gap-analysis tests, now green), `npm --prefix web run check` (0 errors, 0 warnings across 499 files), and an independent tsx spot-check covering world isolation, findByKey dedupe on all four write twins, no-send in mock/fault-wrapped/real Gmail, deterministic ghost-write and lying-success fault behavior, and named-env-var `not_configured` errors in real mode all passed without modification. Both SUMMARY.md files' claims are corroborated by direct inspection of `web/src/lib/core/connectors/**`.

---

_Verified: 2026-09-13T17:48:53Z_
_Verifier: Claude (gsd-verifier)_

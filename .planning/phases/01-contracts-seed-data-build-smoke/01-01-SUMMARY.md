---
phase: 01-contracts-seed-data-build-smoke
plan: 01
subsystem: core-contracts-and-build
tags: [zod, sveltekit, adapter-vercel, adapter-static, tracer, registry, vitest]
requires: []
provides:
  - "Runtime zod contracts (Action, Plan, ToolResult, RunReport, TraceEvent, FailureClass, IdempotencyKey) in web/src/lib/core/schemas.ts"
  - "Connector ports (Gmail/Calendar/Docs/Notion/GitHub/HF) + ConnectorError in web/src/lib/core/connectors/types.ts"
  - "ToolDef/defineTool/createRegistry in web/src/lib/core/tools/registry.ts"
  - "createTracer/MemorySink/CallbackSink in web/src/lib/core/trace/tracer.ts"
  - "Dual adapter switch (VERCEL -> adapter-vercel, else adapter-static) and /api/health route"
  - "boundary.test.ts guard keeping web/src/lib/core framework-free"
affects: [01-03, phase-02-mocks, phase-04-executor, phase-06-evals, phase-09-vercel]
tech-stack:
  added: []
  patterns:
    - "Core modules import each other with relative paths and explicit .ts extensions"
    - "export const X = z.object(...) + export type X = z.infer<typeof X> (same name)"
    - "Every write port exposes findByKey(key) for idempotent dedupe"
    - "Tracer takes an injectable clock (now) and emits deterministic span ids s1, s2, ..."
key-files:
  created:
    - .gitattributes
    - web/.env.example
    - web/static/.nojekyll
    - web/src/routes/api/health/+server.ts
    - web/src/lib/core/schemas.ts
    - web/src/lib/core/connectors/types.ts
    - web/src/lib/core/tools/registry.ts
    - web/src/lib/core/trace/tracer.ts
    - web/src/lib/core/contracts.test.ts
    - web/src/lib/core/boundary.test.ts
  modified:
    - web/vite.config.ts
key-decisions:
  - "Core imports use explicit .ts extensions; svelte-check and vitest both accept them (no fallback needed)"
  - "/api/health stays dynamic (prerender = false); adapter-static tolerates it with no strict:false or prerender workaround"
  - "adapter-vercel builds with default runtime on local Node 24; no runtime pin needed"
  - "createRegistry accepts ToolDef<any, any>[] so concrete ToolDef<ZodObject, ...> values pass without variance errors"
patterns-established:
  - "Framework-free core enforced by a vitest test in npm test (fails on $app/$env/$lib/svelte/@sveltejs/kit imports)"
  - "GmailPort has no send method: never-send is enforced by the type system"
requirements-completed: [DATA-01, DATA-02]
duration: 4.5min
completed: 2026-09-13
---

# Phase 1 Plan 01: Contracts & Build Smoke Summary

**Zod runtime contracts, per-app connector ports, tool registry and span tracer under a framework-free core, plus one vite config that builds green for both Vercel (serverless /api/health) and GitHub Pages (static, /multi-app-agent base).**

## Performance

- **Duration:** ~4.5 min
- **Started:** 2026-09-13T17:19:58Z
- **Completed:** 2026-09-13T17:24:25Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- `VERCEL=1` build emits `web/.vercel/output` with an `api/health` function. The static build with `BASE_PATH=/multi-app-agent` emits `404.html` (referencing `/multi-app-agent/_app`) and `.nojekyll`.
- `schemas.ts` defines all runtime contracts, and none of the 01-02 dataset names (Confidence, SourceRef, School, Program, ...) collide with them.
- Connector ports are defined for all six apps, with `findByKey` dedupe on every write port and a drafts-only `GmailPort`.
- Tool registry has a duplicate-name guard. The tracer supports nested spans, error capture with rethrow, and a deterministic clock and span ids.
- The contract and boundary tests pass (10 tests). The full suite has 20 tests including plan 01-02's. `npm run check` reports 0 errors.

## Task Commits

1. **Task 1: Dual adapter switch, health route, hygiene files, both builds green** - `59b4166` (feat)
2. **Task 2: Runtime zod contracts and connector port interfaces** - `9df7be7` (feat)
3. **Task 3: Registry, tracer, contract + boundary tests** - `35bed02` (test, RED), `90fa64f` (feat, GREEN)

## Files Created/Modified

- `web/vite.config.ts` - adapter switch on `process.env.VERCEL`; base path forced to '' on Vercel
- `web/src/routes/api/health/+server.ts` - dynamic health JSON endpoint
- `web/static/.nojekyll` - keeps Pages from dropping `_app/`
- `.gitattributes` - `* text=auto eol=lf`
- `web/.env.example` - all 13 config keys, no values for secrets
- `web/src/lib/core/schemas.ts` - runtime zod contracts
- `web/src/lib/core/connectors/types.ts` - ports, data types, ConnectorError
- `web/src/lib/core/tools/registry.ts` - ToolDef, defineTool, createRegistry
- `web/src/lib/core/trace/tracer.ts` - createTracer, MemorySink, CallbackSink
- `web/src/lib/core/contracts.test.ts` - schema/tracer/registry/error tests
- `web/src/lib/core/boundary.test.ts` - framework-import guard + detector sanity test

## Build workarounds

None. No fallbacks (7a-7d) were needed:
- adapter-static accepted the `prerender = false` `/api/health` route without `strict: false`.
- adapter-vercel built on local Node 24 with the default runtime. There was no EPERM symlink error.
- `z.iso.datetime()` is available in the installed zod, so the `z.string().datetime()` fallback was unused.

## Decisions Made

See `key-decisions` in frontmatter. The main one: core modules use explicit `.ts` relative imports, and svelte-check accepts them.

## Deviations from Plan

None. The plan was executed as written. Beyond the plan, the contract tests also cover nested span parenting and the boundary detector checks `@sveltejs/kit`.

## Issues Encountered

- The Task 1 commit was first created with attribution trailers that the project's commit-hygiene rule forbids. It was amended before any push, while it was still HEAD, so no other commit was rewritten. The final hash is `59b4166`.

## Known Stubs

None. `createRegistry` has no concrete tools yet by design (Phase 4 registers them). `/api/health` is intentionally minimal (Phase 8/9 extend it).

## Next Phase Readiness

- Plan 01-03 can add `export * from './schemas/school.ts'` to `schemas.ts`. No names overlap.
- Phases 2/4/6 can import `Action`, `Plan`, `RunReport`, `TraceEvent`, `Connectors`, `createRegistry`, and `createTracer` from relative core paths.

## Self-Check: PASSED

- All 11 files listed in key-files exist on disk.
- Commits 59b4166, 9df7be7, 35bed02, 90fa64f were found in git history.
- Final gate re-run: `npm test` 20/20 passed, `VERCEL=1` build exit 0 with `.vercel/output/config.json`, static build exit 0 with `404.html`, `.nojekyll` and the `/multi-app-agent/_app` reference.

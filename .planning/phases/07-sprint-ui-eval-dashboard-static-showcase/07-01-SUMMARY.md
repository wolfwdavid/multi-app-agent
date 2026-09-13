---
phase: 07-sprint-ui-eval-dashboard-static-showcase
plan: 01
subsystem: ui
tags: [sveltekit, svelte5, tailwind4, zod, static-showcase, a11y, provenance]
requires:
  - phase: 03-gap-analysis
    provides: analyzeGaps + GapReport contract
  - phase: 04-sprint-pipeline-on-mocks
    provides: static/data/hero-run.json recording (HeroRunFile)
provides:
  - UI-SPEC design tokens (light/dark) in layout.css
  - global shell (skip link, header nav with base + aria-current, replay mode detection, ModeBanner)
  - pure tested lib/ui modules (config, status, format, dataset, provenance, profile-form, data, mode)
  - shared components (StatusChip, ConfidenceBadge, SourceLink, EmptyState)
  - sprint steps 1-2 (ProfilePanel with inline zod errors, GapReportCard with sourced requirement rows)
  - evals route shell (prerender-safe) for 07-02
affects: [07-02, 07-03, 09-02, 12]
tech-stack:
  added: []
  patterns:
    - "lib/ui/*.ts are framework-free with relative .ts imports; base/fetch injected as parameters"
    - "Tone classes written literally in status.ts (TONE_CLASSES/TONE_OUTLINE) so Tailwind v4 scans them"
    - "Profile JSON text is the single source of truth; structured fields rewrite it with setField/toggleTarget"
    - "Prerender starts from the demo profile; hydration recomputes analyzeGaps with the visitor's local date"
key-files:
  created:
    - web/src/lib/ui/config.ts
    - web/src/lib/ui/status.ts
    - web/src/lib/ui/format.ts
    - web/src/lib/ui/dataset.ts
    - web/src/lib/ui/provenance.ts
    - web/src/lib/ui/profile-form.ts
    - web/src/lib/ui/data.ts
    - web/src/lib/ui/mode.ts
    - web/src/lib/ui/mode.svelte.ts
    - web/src/lib/ui/foundation.test.ts
    - web/src/lib/components/AppHeader.svelte
    - web/src/lib/components/ModeBanner.svelte
    - web/src/lib/components/StatusChip.svelte
    - web/src/lib/components/ConfidenceBadge.svelte
    - web/src/lib/components/SourceLink.svelte
    - web/src/lib/components/EmptyState.svelte
    - web/src/lib/components/ProfilePanel.svelte
    - web/src/lib/components/GapReportCard.svelte
    - web/src/routes/evals/+page.svelte
  modified:
    - web/src/routes/layout.css
    - web/src/routes/+layout.ts
    - web/src/routes/+layout.svelte
    - web/src/routes/+page.svelte
key-decisions:
  - "JSON syntax errors fall back to a small JSON scanner for the error offset when the engine message has no position (V8 'Unexpected token' messages carry none)"
  - "Profile fields mirror the raw JSON whenever it is syntactically valid (even if schema-invalid); number inputs ignore validity.badInput so partial input like '3.' is not cleared"
  - "Header active link is derived from page.route.id (base-independent); `base` from $app/paths compiles with no svelte-check errors, so resolve() was not needed"
  - "LIVE_SOURCE_AVAILABLE = false: detectMode returns replay without probing until Phase 9 wires LiveSource"
patterns-established:
  - "SourceLink resolves retrieved_at/confidence/note through lookupSource(DATASET, requirementId)"
  - "loadStatic never throws and never returns partial data: ok | error{status, reason http|invalid|network, message}"
requirements-completed: [DATA-03, UI-01]
duration: 15min
completed: 2026-09-13
---

# Phase 7 Plan 01: UI Foundation + Sprint Steps 1-2 Summary

**UI-SPEC tokens, base-safe shell that detects replay mode and labels the recorded run, 8 tested pure lib/ui modules, and a sprint page with a zod-validated profile editor plus client-side gap report cards that show a verify link, retrieved date and confidence badge on every requirement.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-13T19:52Z
- **Completed:** 2026-09-13T20:07Z
- **Tasks:** 3 (Task 1 TDD: RED + GREEN commits)
- **Files:** 23 (19 created, 4 modified)

## Accomplishments

- `foundation.test.ts`: 26 tests, 110 `expect` calls, 8 `describe` blocks. Every requirement id in the dataset resolves to a source with a YYYY-MM-DD retrieved date and a confidence.
- Full suite 788/788 green (47 files). `svelte-check`: 0 errors, 0 warnings.
- Static build with `BASE_PATH=/multi-app-agent` emits `index.html`, `evals/index.html`, `404.html` and `.nojekyll`. The prerendered sprint page contains the demo gap report (36 "Verify on official page" occurrences, "Fictional school: no official page", "Deterministic: no AI involved", "Demo data only") and no "Welcome to SvelteKit".
- No root-absolute internal URLs. No `font-bold`/`font-medium`. No changes under `web/src/lib/core`, `web/src/routes/api` or `web/package.json`.

## Task Commits

1. **Task 1 (RED): failing tests for lib/ui modules** - `a1aba04` (test)
2. **Task 1 (GREEN): pure lib/ui modules** - `f957c3a` (feat)
3. **Task 2: tokens, shell, mode state, shared components, evals shell** - `64ba039` (feat)
4. **Task 3: ProfilePanel, GapReportCard, sprint page steps 1-2** - `b70413c` (feat)

## Exported Signatures (for 07-02)

`web/src/lib/ui/config.ts`
- `LIVE_URL = ''`, `LIVE_SOURCE_AVAILABLE = false`, `REPO_URL`, `BRIEF_URL`
- `DATA_PATHS = { hero: 'data/hero-run.json', evals: 'data/evals.json', silentFailure: 'data/silent-failure-run.json' }`. Fetch as `` `${base}/${DATA_PATHS.x}` ``.
- `APP_LABELS: Record<AppName, string>`, `PLAN_APP_ORDER = ['notion','calendar','docs','gmail']`, `REPLAY_SPEEDS = [{id:'1x',label:'1×',ms:400},{id:'4x',label:'4×',ms:100}]`

`web/src/lib/ui/status.ts`
- `type Tone = 'ok'|'warn'|'info'|'block'|'fail'|'idle'`; `interface ChipSpec { tone; glyph; label }`; `type DisplayStatus = 'queued'|'running'|'ok'|'retried'|'deduped'|'blocked'|'failed'`
- `TONE_CLASSES: Record<Tone,string>` (bg/text/border), `TONE_OUTLINE: Record<Tone,string>` (bg-transparent)
- `traceChip(status: DisplayStatus, attempts?: number)`, `artifactChip(ArtifactStatus)`, `prereqChip({status, pendingCompletion})`, `severityChip(Severity)`, `gpaChip(GpaStatus)`, `unitsChip({status, shortfall})`, `deadlineChip({daysUntil, status} | null)`, `fictionalChip()`, `confidenceChip(Confidence)`. All return `ChipSpec`.
- `rateTone(rate: number): Tone`, `runStatusChip(RunReport['status']): ChipSpec` (label = banner copy), `countTone(n, tone): Tone`, `AI_POLICY_LABELS: Record<string,string>`

`web/src/lib/ui/format.ts`
- `fmtDate(ymd)` (UTC), `fmtDateTime(iso, timeZone?)` (U+202F/U+00A0 normalized), `fmtPct(x)`, `fmtMs(ms)`, `sha7(sha)`, `truncate(s, n)`, `localToday()`

`web/src/lib/ui/dataset.ts`
- `DATASET: SchoolsDataset` (parsed), `DEMO_PROFILES: readonly [{id:'demo', label, profile}, {id:'demo-quarter', label, profile}]`, `type DemoProfileId`

`web/src/lib/ui/provenance.ts`
- `parseRequirementId(id): { programId; kind: 'scalar'|'course'|'deadline'|'essay'; id } | null` (splits on the first '#')
- `lookupSource(ds, requirementId): SourceRef | null` (WeakMap program index per dataset)

`web/src/lib/ui/profile-form.ts`
- `type ProfileIssue = { path; message }`, `type JsonError = { line; column; message }`, `type ParseResult = { ok: true; profile } | { ok: false; jsonError?; issues }`
- `parseProfile(text)`, `FIELD_PATHS`, `fieldIssues(issues, path)` (`targets` also matches `targets.*`), `unmappedIssues(issues)`
- `setField(text, dottedPath, value)` (NaN → null), `toggleTarget(text, {schoolId, programId}, ds)`, `targetOptions(ds): TargetOption[]` (`{ schoolId; programId; label; isFictional }`)

`web/src/lib/ui/data.ts`
- `type LoadResult<T> = { state:'ok'; data } | { state:'error'; status: number|null; reason:'http'|'invalid'|'network'; message }`
- `type Parser<T>`, `fromSchema(schema): Parser<z.infer<S>>`, `loadStatic<T>(url, parse, fetchFn = fetch): Promise<LoadResult<T>>`
- `HeroRunFile` (zod) + `type HeroRunFile`

`web/src/lib/ui/mode.ts`
- `type AppMode = 'detecting'|'live'|'replay'`; `detectMode({ url, base, liveAvailable, fetchFn?, timeoutMs = 1500 }): Promise<'live'|'replay'>`

`web/src/lib/ui/mode.svelte.ts`
- `appState: { mode: AppMode; hero: LoadResult<HeroRunFile> | null }` ($state)
- `loadHero(base)` (memoized; sets `appState.hero`), `initApp(url, base)` (idempotent; called from +layout onMount)

## Component Props

| Component | Props |
|-----------|-------|
| `AppHeader` | `{ mode: AppMode }` |
| `ModeBanner` | `{ hero: LoadResult<HeroRunFile> \| null }` (falls back to the undated sentence when null or error) |
| `StatusChip` | `{ chip: ChipSpec }` |
| `ConfidenceBadge` | `{ confidence: Confidence; note?: string }` |
| `SourceLink` | `{ requirementId: string; variant?: 'full' \| 'compact'; label?: string }` |
| `EmptyState` | `{ heading: string; body: string; tone?: 'idle' \| 'fail'; children?: Snippet }` |
| `ProfilePanel` | `bind:profile` (Profile \| null), `bind:valid`, `bind:pristine`, `bind:targetsEmpty` |
| `GapReportCard` | `{ report: GapReport }` |

`+page.svelte` holds `profile`, `valid`, `pristine` and `targetsEmpty` state. 07-02 can use `pristine` for the "recorded plan was built for the demo profile" note. The step 3–5 sections (`#plan`, `#trace`, `#results`) contain placeholder EmptyStates that 07-02 replaces.

## base vs resolve()

No deviation. `base` from `$app/paths` passes svelte-check with no errors, so the plan's `{base}/` and `{base}/evals/` links are used as written.

## hero-run.json Shape

No difference found. The committed file has keys `recordedAt, commitSha, profileId, plan, preflight (23 entries), events, report, rerun{events, report}` and parses with the UI `HeroRunFile`. The core recorder uses `z.iso.datetime()` for `recordedAt`; the UI mirror uses `z.string().min(1)` as planned.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSON error position missing from V8 messages**
- **Found during:** Task 1
- **Issue:** Node/Chrome `JSON.parse` messages like `Unexpected token 'x', "..." is not valid JSON` carry neither `line/column` nor `position`. The planned fallback (last line/column) would point at the wrong line.
- **Fix:** After the two regexes fail, `profile-form.ts` runs a ~50-line JSON scanner that returns the exact error offset. Messages are also cleaned of the `, "…" is not valid JSON` snippet. The test asserts that an error on line 3 reports line 3.
- **Commit:** f957c3a

**2. [Rule 1 - Bug] Structured fields would snap back while typing**
- **Found during:** Task 3
- **Issue:** Binding field values to "parsed profile or lastValid" makes a schema-invalid edit (e.g. GPA 5) redisplay the old value, and typing "3." into a number input produced NaN, which cleared the field.
- **Fix:** Fields read the raw JSON object whenever it parses. Number handlers skip `validity.badInput`. Fields are disabled only when the text is not a JSON object.
- **Commit:** b70413c

**3. [Rule 1 - A11y] `aria-invalid` on `<fieldset>`**
- **Found during:** Task 3 (svelte-check warning)
- **Fix:** `aria-invalid` moved to each target checkbox. The fieldset keeps `aria-describedby` pointing at the error.
- **Commit:** b70413c

**4. [Rule 3 - Blocking] `{@const}` not allowed in plain elements**
- **Found during:** Task 3
- **Fix:** Per-field error flags moved into one `errs` `$derived` object in the script.
- **Commit:** b70413c

**Minor, no behavior risk:**
- EmptyState uses a class array (`border-fail-border` or `border-border`) instead of `class:` so two border colors never conflict.
- "{n} recommendation(s)" and "{n} blocker(s)" are pluralized properly.
- The data.ts comment no longer contains the literal "core/agent", which the acceptance grep forbids.
- The test file has a separate `dataset` describe block, meeting the >= 8 describes criterion.

## Issues Encountered

None beyond the auto-fixes above.

## Known Stubs

- `web/src/routes/+page.svelte` steps 3–5 (`#plan`, `#trace`, `#results`) render only UI-SPEC EmptyStates. This is intentional; plan 07-02 builds PlanApproval, TraceTimeline and ArtifactsPanel there.
- `web/src/routes/evals/+page.svelte` is a shell with the "Loading eval results…" status. This is intentional; 07-02 fills in the dashboard. `data/silent-failure-run.json` may be missing, and 07-02 must show the "Replay not available" copy in that case.
- `config.ts` has `LIVE_URL = ''` and `LIVE_SOURCE_AVAILABLE = false`. This is intentional; Phase 9 (09-02) flips them.

## Next Phase Readiness

- 07-02 can import every module and component listed above.
- The header and evals route already exist, so prerender crawling works.

## Self-Check: PASSED

- All 23 files in files_modified exist.
- Commits a1aba04, f957c3a, 64ba039, b70413c are in git log. All 5 recent commit messages were checked for AI trailers (count 0).

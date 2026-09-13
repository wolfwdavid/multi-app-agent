---
phase: 07-sprint-ui-eval-dashboard-static-showcase
plan: 02
subsystem: ui
tags: [sveltekit, svelte5, tailwind4, zod, replay, evals, a11y, static-showcase]
requires:
  - phase: 07-01
    provides: lib/ui foundation (status, format, config, data, mode), StatusChip, EmptyState, sprint page steps 1-2, evals shell
  - phase: 04-sprint-pipeline-on-mocks
    provides: static/data/hero-run.json (plan, preflight, events, report, rerun)
  - phase: 06-eval-harness-real-pass-rates
    provides: static/data/evals.json, static/data/silent-failure-run.json (06-03)
provides:
  - SprintSource interface + ReplaySource over hero-run.json (Phase 9 LiveSource implements the same interface)
  - toTraceRows display mapping, replay pacer, EvalsFile/SilentFailureRun contracts
  - sprint steps 3-5 (plan approval, paced trace, verified artifacts, Run again)
  - /evals/ dashboard (stat cards, per-scenario table, 7-class taxonomy, silent-failure step-through)
affects: [07-03, 09-02, 12]
tech-stack:
  added: []
  patterns:
    - "Components consume only adapter view models (TraceRow, EvalsFile, SilentFailureRun); Phase 4/6/9 shape changes stay in lib/ui/{trace-rows,sprint-source,evals}.ts"
    - "Replay pacing is a promise gate (pace()) awaited after each row-terminal event, so play/pause/step/speed/cancel need no timers in components"
    - "Run token + AbortController guard so Restart / Build plan never let a stale replay write events or reset running"
    - "Tri-state approval checkboxes use Svelte function bindings (bind:checked / bind:indeterminate getter, setter)"
key-files:
  created:
    - web/src/lib/ui/trace-rows.ts
    - web/src/lib/ui/pacer.ts
    - web/src/lib/ui/sprint-source.ts
    - web/src/lib/ui/evals.ts
    - web/src/lib/ui/fixtures.ts
    - web/src/lib/ui/trace-rows.test.ts
    - web/src/lib/ui/sprint-source.test.ts
    - web/src/lib/ui/evals.test.ts
    - web/src/lib/components/PlanApproval.svelte
    - web/src/lib/components/ActionCard.svelte
    - web/src/lib/components/TraceTimeline.svelte
    - web/src/lib/components/ReplayControls.svelte
    - web/src/lib/components/ArtifactsPanel.svelte
    - web/src/lib/components/StatCard.svelte
    - web/src/lib/components/ScenarioTable.svelte
    - web/src/lib/components/TaxonomyBreakdown.svelte
    - web/src/lib/components/SilentFailureReplay.svelte
  modified:
    - web/src/routes/+page.svelte
    - web/src/routes/evals/+page.svelte
key-decisions:
  - "Phase 6 evals.json and silent-failure-run.json already use the UI-SPEC field names; evals.ts uses z.looseObject so extra fields (passHatK, silentFailures, tags, adversarial, config, before) pass through with no renaming"
  - "SprintSource.rerun takes optional approvedIds so Run again replays the same approval set (unapproved actions show Not approved) instead of all 23 recorded dedupes"
  - "Artifact Open link only for http(s) refs; recorded mock:// refs are shown as ids without a broken link"
  - "Silent failures caught card shows an em dash plus 'Replay file missing from this build' when the replay file is absent, never a claimed count"
  - "Rate chips carry text labels (90% or more / 50-89% / Below 50%) so the headline tone is not color-only"
requirements-completed: [UI-01, UI-02]
duration: 30min
completed: 2026-09-13
---

# Phase 7 Plan 02: Sprint Steps 3-5 and Eval Dashboard Summary

**The static sprint page now has three more steps: building the recorded plan as approvable action cards, a paced and controllable trace with screen-reader announcements, and a read-back verified artifacts panel with an idempotent rerun. `/evals/` renders the committed Phase 6 results: pass rate, pass^k, a 23-scenario table per model, all 7 failure classes, and a keyboard-steppable replay of the caught lying-API failure. All of it runs through tested adapters, so a Phase 9 LiveSource can be added without component changes.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3. Task 1 was TDD, with separate RED and GREEN commits.
- **Files:** 19 (17 created, 2 modified)

## Accomplishments

- **Tests:** 3 new test files with 33 tests covering trace rows, the replay source, the pacer and the eval adapters. The full suite passes 852/852 across 52 files.
- **Type check:** `svelte-check` reports 0 errors and 0 warnings across 894 files.
- **Static build:** `MSYS_NO_PATHCONV=1 BASE_PATH=/multi-app-agent` build exits 0.
  - `web/build/index.html` contains the 3/4/5 step headings, "Build plan" and "Nothing has run yet".
  - `web/build/evals/index.html` contains "Eval results" and "BRIEF.md".
  - `web/build/data/{evals,hero-run}.json` are copied.
- **Real recording checks:**
  - hero-run gives 46 rows for 46 terminal events: 23 actions OK and 23 readbacks OK.
  - The rerun gives 23 deduped actions and 23 readbacks.
  - Filtering with every write approved reproduces the recorded counts, `ok {23,0,0,0}`.
- **Real silent-failure run:** 161 events become 46 rows. `oracle.stepSpanId` maps to row 26, "Google Calendar readback: Not found on read-back". `report.status` is `partial` and `oracle.caught` is `true`.
- **Real evals.json:** 23 scenarios, primary model `fake`, 17 adversarial. Failure taxonomy for `fake`: `instruction_violation` 10, `integration_failure` 5, `hallucination` 10, `communication_failure` 10.
- **Acceptance greps:** every grep for Tasks 1-3 passes. There are no dynamic Tailwind class names, no `font-bold`/`font-medium`, no `assertive` and no root-absolute internal URLs.
- **Boundaries:** `git diff --name-only -- web/src/lib/core web/src/routes/api web/package.json` is empty.

## Task Commits

1. **Task 1 (RED): failing adapter tests and fixtures** - `fd93113` (test)
2. **Task 1 (GREEN): trace-rows, pacer, sprint-source, evals** - `31f72bc` (feat)
3. **Task 2: sprint steps 3-5, wired through ReplaySource** - `a1954a3` (feat)
4. **Task 3: eval dashboard components and route** - `42e12bb` (feat)

## Exported Signatures

`web/src/lib/ui/trace-rows.ts`
- `interface TraceRow { spanId; index; kind: 'action'|'readback'; actionId; app; tool; summary?; attempt?; maxAttempts?; durationMs?; status: DisplayStatus; labelOverride?; attemptLines: string[]; found?; artifactStatus? }`
- `toTraceRows(events, plan?): TraceRow[]`
  - Spans are keyed by traceId plus spanId.
  - Retry sub-rows come from `retry` events for the same actionId.
  - Skipped actions with reasons outside not_approved, policy, allowlist and injection are omitted.
  - A readback with `found:false` becomes `failed` with the label "Not found on read-back".
- `isRowTerminal(e)`, `countRowSpans(events)`, `appLabel(app)`, `rowLabel(row)`, `rowAnnouncement(row)`, `runAnnouncement(report)`, `oracleStepIndex(rows, spanId)` (1-based; falls back to `rows.length`)

`web/src/lib/ui/pacer.ts`
- `class ReplayCancelled extends Error`
- `createPacer({ intervalMs = 400, sleep?, playing = true }?): Pacer`
- `Pacer`: `pace()`, `play()`, `pause()`, `step()`, `cancel()`, `reset()`, `setIntervalMs(ms)`, `playing`, `intervalMs`, `onChange(fn) → unsubscribe`

`web/src/lib/ui/sprint-source.ts` (Phase 9 LiveSource implements `SprintSource`)
- `interface SprintSource { kind: 'live'|'replay'; buildPlan(profile?): Promise<{ plan; preflight? }>; execute(plan, approvedIds, onEvent, signal?): Promise<RunReport>; rerun?(approvedIds?): Promise<{ events; report }>; estimateSteps?(approvedIds): number }`
- `filterRecordedRun(file, approvedIds): { events; report }`
  - Read actions are always kept.
  - Unapproved artifacts become `skipped`/`not_approved`.
  - Counts are recomputed, with mismatch counted as failed.
  - Status is `failed` when verified+deduped is 0 and failed is above 0, `partial` when failed is above 0, and `ok` otherwise.
- `playEvents(events, onEvent, pace, signal?): Promise<void>` rejects with `ReplayCancelled` when aborted.
- `createReplaySource(file: HeroRunFile, { pace }): SprintSource`

`web/src/lib/ui/evals.ts`
- zod `EvalsFile`, `SilentFailureRun` (+ types `EvalsFile`, `EvalModel`, `EvalScenario`, `ScenarioResult`, `SilentFailureRun`)
- `parseEvalsFile`, `parseSilentFailureRun` (data.ts `Parser` shape)
- `FAILURE_LABELS: Record<FailureClass, { label; definition }>`
- `primaryModel(evals)`, `llmModel(evals) | null`
- `taxonomy(evals, modelId) → { entries: { cls, label, definition, count }[] (7, enum order); max }`
- `topFailure(scenario) | null` (ties go to enum order)
- `scenarioAllPassed({ passK })`
- `adversarialCount(evals) | null`
- `silentFailurePath(evals)`

`web/src/lib/ui/fixtures.ts` (tests only): `ev`, `samplePlan`, `sampleHeroRun`, `sampleEvals`, `sampleSilentFailureRun`

## Phase 4/6 Shape Adaptations

- **hero-run.json:** no translation needed. The trace attrs match the 04-01 vocabulary: `action.execute` start and end carry actionId, app, tool, key, maxAttempts, attempt, outcome and refId; `verify.readback` end carries found and artifactStatus. The hero run has no `retry` events, so its rows show no attempt sub-lines. The fixtures cover retries.
- **evals.json:** no renaming. The real file matches the UI-SPEC names, plus extra fields: `schemaVersion`, `seed`, `model`, `methodology`, `failureTotals`, `models[].{model,config,n,seed}`, `scenarios[].{tags,adversarial}`, `results[].{passHatK,silentFailures}` and `totals[].silentFailures`. Loose zod objects keep them. Both models are `kind: 'scripted'` (`fake`, `fake-verifier-off`), so `llmModel` is null and no second sub-line appears. The table still shows a before/after column pair per model.
- **silent-failure-run.json:** the file was absent when this plan started. It landed during execution in `167ab6d` (06-03), together with the `evals.json` `silentFailure` pointer `{ file: 'data/silent-failure-run.json', scenarioId: 'lying-success' }`. Its extra `before` block (the verifier-off report) passes through. The `it.runIf(existsSync(...))` contract test now runs and passes. If the file is ever missing, the dashboard shows "Replay not available".

## Component Props

| Component | Props |
|-----------|-------|
| `ActionCard` | `{ action: Action; checked: boolean; preflight?: 'new'\|'exists'; disabled?: boolean; ontoggle(id, checked); describedById: string }` |
| `PlanApproval` | `{ plan: Plan; preflight?; approved: SvelteSet<string>; running: boolean; mode: AppMode; pristine: boolean; onRun(): void }` |
| `ReplayControls` | `{ playing; index; total; onPlay; onPause; onStep; onPrev?; onRestart; speedMs?; onSpeed?(ms) }`. Passing `onPrev` turns on manual mode, with Previous and Next step plus a "Step i of n" counter. |
| `TraceTimeline` | `{ rows: TraceRow[]; total: number; currentIndex?: number = -1; announce?: boolean = true; finalMessage?: string = '' }` |
| `ArtifactsPanel` | `{ report: RunReport; plan: Plan; onRerun?(): void; rerunning?: boolean }` |
| `StatCard` | `{ label; value; sub; sub2?; chip?: ChipSpec }` |
| `ScenarioTable` | `{ evals: EvalsFile }` |
| `TaxonomyBreakdown` | `{ evals: EvalsFile }` (picks its own model; the select appears when there is more than one model) |
| `SilentFailureReplay` | `{ run: SilentFailureRun }` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Run again replayed every recorded action regardless of approval**
- **Found during:** Task 2
- **Issue:** `hero-run.json` `rerun` records all 23 actions. After a partial approval, "Run again" would have shown dedupes for actions the user never approved, so they never existed.
- **Fix:** `SprintSource.rerun?(approvedIds?)` is an optional parameter that stays compatible with the interface. ReplaySource filters the recorded rerun through `filterRecordedRun`. The page passes the current approval set, and a test was added.
- **Files:** web/src/lib/ui/sprint-source.ts, sprint-source.test.ts, web/src/routes/+page.svelte
- **Commit:** a1954a3

**2. [Rule 1 - Bug] Race between a stale replay and Restart**
- **Found during:** Task 2
- **Issue:** Cancelling the old run and starting a new one lets the old run's `finally` set `running = false`, and a late `onEvent` could append to the new timeline.
- **Fix:** Each run gets a monotonic `runToken` plus its own AbortController. Only the current token may push events, set the report or reset `running`. "Build plan" also invalidates any in-flight run.
- **Commit:** a1954a3

**3. [Rule 1 - Bug] "Open ↗" would have linked to `mock://` URLs**
- **Found during:** Task 2
- **Fix:** The link renders only for `http(s)` refs. The ref id is always shown.
- **Commit:** a1954a3

**4. [Rule 1 - Honesty] Silent-failures card while the replay is absent**
- **Found during:** Task 3
- **Issue:** The planned "0" with the sub-line "Lying-API run caught by read-back" would contradict itself when the file is simply missing.
- **Fix:** The card shows "…" while loading and "—" with "Replay file missing from this build" when absent. It shows `1`/`0` only from the real oracle.
- **Commit:** 42e12bb

**5. [Rule 1 - Copy bug] Evals error body**
- **Found during:** Task 3
- **Issue:** The planned `{status ?? 'an invalid format'}` prints "returned 200" for malformed JSON (status 200) and "an invalid format" for network errors.
- **Fix:** The body now says `HTTP {status}` for HTTP errors, "a network error" for network failures and "an invalid format" for malformed JSON.
- **Commit:** 42e12bb

**6. [Rule 3 - Blocking] Acceptance grep for `playEvents`**
- **Found during:** Task 1
- **Issue:** `export async function playEvents` does not match `export (function|interface|class)`, so the count was 3 instead of 4.
- **Fix:** It is now declared as `export function playEvents(...): Promise<void>`, which returns an async IIFE. Behavior is unchanged.
- **Commit:** 31f72bc

**7. [Rule 1 - A11y] Group checkbox inside the `<legend>`**
- **Found during:** Task 2
- **Issue:** Controls in the first `<legend>` of a disabled `<fieldset>` are not disabled.
- **Fix:** The group checkbox also gets `disabled={running}`. The master and group tri-state checkboxes use Svelte function bindings, because `bind:` cannot target a `$derived`.
- **Commit:** a1954a3

**Minor, no behavior risk:**
- `plan`, `events` and `report` use `$state.raw` so the large recorded payloads (critique doc bodies) are not deep-proxied.
- TaxonomyBreakdown derives `modelId` from a `picked` state. This avoids capturing the prop at init and keeps svelte-check at 0 warnings.
- The rate chip beside the pass-rate value has text labels "90% or more", "50–89%" and "Below 50%". UI-SPEC specifies the tone but no label, and the tone must not be the only cue.
- Added an h2 "Per-scenario results" above the table so the dashboard heading outline has no gaps, and a one-line keyboard hint in the silent-failure panel.
- The ActionCard payload `<pre>` also gets `overflow-y-auto`, so `max-h-64` scrolls instead of overflowing.
- SilentFailureReplay carries a `svelte-ignore` for `a11y_no_noninteractive_tabindex` and `a11y_no_noninteractive_element_interactions`. UI-SPEC requires the focusable `role="group"` region with arrow keys.

## Known Stubs

- `web/src/routes/+page.svelte` has `source = null` when `appState.mode === 'live'`, and the Build plan helper then reads "Loading the recorded run…". This can't happen yet because `LIVE_SOURCE_AVAILABLE = false` forces replay. Phase 9 (09-02) adds LiveSource behind `SprintSource`.

## Deferred / Follow-ups

- No in-browser manual pass in this plan (no browser tool). Plan verification item 5 is optional and belongs to the 07-03 checkpoint: `npm --prefix web run dev`, open `/?replay`, then Build plan → Run → Run again, and check the `/evals/` step-through.
- The real silent-failure catch is at step 26 of 46. Play reaches it in about 10 s, or a user can press Next step 26 times. A possible 07-03 or Phase 12 addition is a "Jump to the read-back failure" control.

## Issues Encountered

None beyond the auto-fixes above. Phase 6 gap closure (06-03) committed its artifacts during execution. This plan touched none of its paths.

## Self-Check: PASSED

- All 19 files in `files_modified` exist.
- Commits `fd93113`, `31f72bc`, `a1954a3` and `42e12bb` are in the git log.
- No untracked files remain under `web/src/lib/ui`, `web/src/lib/components` or `web/src/routes`.
- `git log --format=%B -6 | grep -ciE "co-authored|claude|anthropic"` prints 0.

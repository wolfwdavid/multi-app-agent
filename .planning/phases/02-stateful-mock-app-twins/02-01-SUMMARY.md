---
phase: 02-stateful-mock-app-twins
plan: 01
subsystem: connectors/mock
tags: [mock, world, twins, idempotency, validation, apps-04]
requires:
  - web/src/lib/core/connectors/types.ts (Phase 1 ports, ConnectorError)
  - web/src/lib/core/schemas.ts (IdempotencyKey)
provides:
  - createWorld / diffWorldStates / isEmptyDiff (per-run isolated mock state)
  - createMockNotion / createMockCalendar / createMockDocs / createMockGmail (write twins with findByKey)
  - createMockGitHub / createMockHF (read-only twins)
  - real-API-shape validators (validate.ts)
affects:
  - 02-02 (connectors/mock/index.ts, faults.ts, seed.ts import these factories)
  - Phase 4 executor (findByKey dedupe, 409/400 error paths)
  - Phase 6 oracle (reads world.state / world.diff)
tech-stack:
  added: []
  patterns:
    - "Factory functions returning plain objects of async arrows (Object.keys(port) === port methods)"
    - "All mutable state in a closure-held WorldState; nothing at module level"
    - "Every port method reads world.state.<app> at call time and returns structuredClone"
    - "Deterministic ids via world.nextId(prefix), timestamps via world.now()"
key-files:
  created:
    - web/src/lib/core/connectors/mock/world.ts
    - web/src/lib/core/connectors/mock/validate.ts
    - web/src/lib/core/connectors/mock/github.ts
    - web/src/lib/core/connectors/mock/hf.ts
    - web/src/lib/core/connectors/mock/notion.ts
    - web/src/lib/core/connectors/mock/calendar.ts
    - web/src/lib/core/connectors/mock/docs.ts
    - web/src/lib/core/connectors/mock/gmail.ts
    - web/src/lib/core/connectors/mock/world.test.ts
    - web/src/lib/core/connectors/mock/twins.test.ts
  modified: []
decisions:
  - "World.restore keeps root state object identity and replaces top-level keys with clones, so held world.state references stay valid"
  - "Calendar event id = idempotency key without dashes (valid base32hex), so duplicate create returns 409 validation, as with Google"
  - "Docs and Gmail twins do no server-side dedupe (like the real APIs); dedupe is the caller's findByKey guard"
  - "Notion upsert validates every field before any state mutation, so rejected calls never partially write"
metrics:
  duration: 4min
  completed: 2026-09-13
  tasks: 2
  files: 10
---

# Phase 2 Plan 01: Stateful Mock World and App Twins Summary

Per-run seeded `createWorld()` with snapshot, restore, reset and id-level diff, plus credential-free Notion, Calendar, Docs and Gmail write twins (`findByKey`, real-API 400/404/409 errors) and read-only GitHub and HF twins. None of them keep module-level state.

## What was built

### world.ts: exact exported signatures
```ts
export const DEFAULT_CLOCK = '2026-09-13T17:00:00.000Z';
export type MockCalEvent = CalEvent & { start: { date: string }; end: { date: string } }; // end exclusive
export type MockDoc = { id: string; title: string; body: string; key?: string; url?: string };
export interface WorldState {
  meta: { clock: string; counters: Record<string, number> };
  notion: { rows: TrackerRow[] };
  calendar: { events: MockCalEvent[] };
  gmail: { drafts: Draft[]; inbox: MessageSummary[]; sent: MessageSummary[] };
  docs: { docs: MockDoc[] };
  github: { repos: Record<string, RepoSummary[]> }; // lowercase username keys
  hf: { items: Record<string, HFItem[]> };
}
export interface WorldSeed {
  clock?: string;
  notion?: { rows?: TrackerRow[] };
  calendar?: { events?: CalEvent[] };
  gmail?: { drafts?: Draft[]; inbox?: MessageSummary[] };
  docs?: { docs?: MockDoc[] };
  github?: { repos?: Record<string, RepoSummary[]> };
  hf?: { items?: Record<string, HFItem[]> };
}
export type CollectionName = 'notion.rows' | 'calendar.events' | 'gmail.drafts' | 'gmail.inbox' | 'gmail.sent' | 'docs.docs';
export const COLLECTIONS: readonly CollectionName[];
export interface CollectionDiff { added: string[]; removed: string[]; changed: string[] }
export type WorldDiff = Record<CollectionName, CollectionDiff>;
export interface World {
  readonly state: WorldState;
  snapshot(): WorldState;
  restore(snapshot: WorldState): void;
  reset(): void;
  diff(before: WorldState, after?: WorldState): WorldDiff;
  nextId(prefix: string): string;   // `${prefix}-0001`
  now(): string;
}
export function createWorld(seed?: WorldSeed): World;
export function diffWorldStates(before: WorldState, after: WorldState): WorldDiff;
export function isEmptyDiff(d: WorldDiff): boolean;
```

### Twin factories
```ts
export function createMockNotion(world: World): NotionPort;     // notion.ts   ids page-NNNN, url mock://notion/<id>
export function createMockCalendar(world: World): CalendarPort; // calendar.ts id = key w/o dashes, url mock://calendar/<id>
export function createMockDocs(world: World): DocsPort;         // docs.ts     ids doc-NNNN, url mock://docs/<id>
export function createMockGmail(world: World): GmailPort;       // gmail.ts    ids r-NNNN; keys: createDraft, findByKey, listDrafts, searchInbox
export function createMockGitHub(world: World): GitHubPort;     // github.ts   404 not_found for unknown user (case-insensitive)
export function createMockHF(world: World): HFPort;             // hf.ts       [] for unknown author
```

### validate.ts exports
`NOTION_RICH_TEXT_MAX` (2000), `NOTION_ARRAY_MAX` (100), `isIsoDate`, `addDaysIso`, `assertIdempotencyKey`, `assertNotionRichText`, `assertNotionDate`, `assertNotionSelect`, `assertAllDayDate`, `assertEmailList`, `assertNoHeaderInjection`. They all throw `ConnectorError('validation', <real-shaped message>, { status: 400 })`.

## Tasks and commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | World factory, validators, GitHub/HF twins | c9a438f (test RED), ac83ed6 (feat GREEN) |
| 2 | Notion/Calendar/Docs/Gmail write twins | 9c5d275 (test RED), 4d07830 (feat GREEN) |

## Verification

- `npm --prefix web test -- src/lib/core/connectors`: 2 files, 26 tests passed (12 world, 14 twins)
- `npm --prefix web run check`: 0 errors, 0 warnings. The `@ts-expect-error` on `gmail.send` is satisfied.
- Acceptance greps: no top-level `let`/`var`, no `Math.random`/`Date.now`/`randomUUID`, `status: 409` once in calendar.ts, no send in gmail.ts, no `gap/` references
- Full `npm --prefix web test`: 192 passed, 2 failed. Both failures are in `src/lib/core/gap/analyze.test.ts` (snapshot tests for demo and demo-quarter). That is Phase 3 in progress, outside this plan's scope, and was not touched.

## Deviations from Plan

Two small additions, both within the plan's intent:
- Tests add coverage beyond the listed behaviors: an invalid Cc address, negative `recsRequired`, `restore()`/`reset()` seen through a twin, and clone checks on calendar and gmail return values.
- Docs `createDoc` rejects an empty title with the message `Invalid value at document.title: title is required` (the plan asked for validation 400 but gave no message).

Actual `connectors/types.ts` matches the plan's interfaces exactly. No differences.

## Known Stubs

None. The fixture-based default seed and `connectors/mock/index.ts` are owned by plan 02-02 by design.

## Self-Check: PASSED

- All 10 files in key-files.created exist (verified by test run and type-check)
- Commits c9a438f, ac83ed6, 9c5d275, 4d07830 present in `git log`

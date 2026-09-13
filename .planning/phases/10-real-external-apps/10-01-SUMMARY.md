---
phase: 10-real-external-apps
plan: 01
subsystem: connectors
tags: [real-connectors, github, huggingface, obsidian, health, port-01, port-02, port-03]
requires:
  - Phase 1 connectors/types.ts (GitHubPort, HFPort, ConnectorError) and schemas (AppName, ConnectorErrorKind)
  - Plan 02-02 createConnectors factory and real/index.ts export names
provides:
  - Live GitHub (public REST) and Hugging Face (public Hub API) read ports via fetch
  - fetchJson with timeout and status-to-ConnectorError mapping, parseRetryAfterMs, createPacer
  - shared helpers (Env, RealDeps, ProbeResult, missingEnv, notConfiguredPort, redactSecrets, toConnectorError)
  - real/notion.ts contract stub (plan 10-02 fills in the bodies)
  - real/google/flags.ts SDK-free constants and real/google/index.ts lazy contract stub (plan 10-03 fills in the bodies)
  - realConnectorStatus with per-app implemented flags, probeRealConnectors
  - /api/health connectors status plus ?probe=1 live probes
  - scripts/smoke-real.ts live smoke check
  - readObsidianVault (tags and frontmatter only) plus fixture vault
affects:
  - 10-02 Notion (owns real/notion.ts; imports createPacer and redactSecrets)
  - 10-03 Google (owns real/google/**; flips GOOGLE_IMPLEMENTED in flags.ts)
  - Phase 5 evidence section (mode real now returns live GitHub/HF data)
  - Phase 8/9 health check (connectors.real status)
tech-stack:
  added: []
  patterns:
    - "Every real connector takes (env, deps) with injectable fetch/sleep/now/timeoutMs; tests never touch the network"
    - "SDK-bearing modules are reachable only through dynamic import(); the constants they need live in an import-free flags module"
    - "Probes never throw: ok true | false (kind + redacted detail) | null (skipped)"
    - "Untrusted content boundary: README text and Obsidian note bodies are never returned"
key-files:
  created:
    - web/src/lib/core/connectors/real/shared.ts
    - web/src/lib/core/connectors/real/http.ts
    - web/src/lib/core/connectors/real/github.ts
    - web/src/lib/core/connectors/real/hf.ts
    - web/src/lib/core/connectors/real/real-read.test.ts
    - web/src/lib/core/connectors/real/notion.ts
    - web/src/lib/core/connectors/real/google/flags.ts
    - web/src/lib/core/connectors/real/google/index.ts
    - web/src/lib/core/connectors/real/obsidian.ts
    - web/src/lib/core/connectors/real/obsidian.test.ts
    - web/src/lib/core/data/fixtures/obsidian-vault/** (6 notes)
    - web/scripts/smoke-real.ts
  modified:
    - web/src/lib/core/connectors/real/index.ts
    - web/src/lib/core/connectors/connectors.test.ts
    - web/src/routes/api/health/+server.ts
    - web/.env.example
decisions:
  - "Routes import core through extensionless $lib paths ($lib/core/connectors/index). TS rejects .ts extensions on non-relative specifiers; core keeps relative .ts imports"
  - "readObsidianVault maxNotes caps parsed notes, not files scanned, so broken notes that sort first cannot starve the result"
  - "probeRealConnectors runs github, hf, notion and google probes concurrently; results keep the fixed order github, hf, notion, calendar, gmail, docs"
  - "From Git Bash, the static build needs MSYS_NO_PATHCONV=1 BASE_PATH=/multi-app-agent; otherwise MSYS rewrites the base into a Windows path and SvelteKit rejects it"
metrics:
  duration: 10min
  completed: 2026-09-13
  tasks: 3
  files: 21
---

# Phase 10 Plan 01: Live GitHub/HF Read Connectors, Real Module Layout, Obsidian Reader Summary

`createConnectors({ mode: 'real', env })` now returns live GitHub and Hugging Face data over plain `fetch`. Requests use a 10s timeout, and HTTP failures map to typed `ConnectorError`s (404 not_found, 403/429 rate_limit with retryAfterMs, 401/403 auth, 5xx server, abort timeout). Notion and Google still reject `not_configured` with the missing env names. They now live in exclusive modules (`real/notion.ts`, `real/google/**`), so 10-02 and 10-03 can fill them in parallel. Google loads lazily. `/api/health` and `scripts/smoke-real.ts` report configured, implemented and ok for each app. A local Obsidian vault reader returns tags and frontmatter only; it never returns note bodies and it blocks executable frontmatter.

## Tasks and commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Shared helpers, fetchJson mapping, live GitHub + HF ports | 0e7467a (test RED), 11d221e (feat GREEN) |
| 2 | Rewired createRealConnectors, Notion + lazy Google stubs, status/probes, health, env docs, smoke | 892ef2d |
| 3 | Obsidian vault reader + fixture vault + smoke line (NOT cut) | ef43b32 |

## Live smoke output (counts only)

`NOTION_TOKEN= GOOGLE_REFRESH_TOKEN= npx tsx scripts/smoke-real.ts` from web/, no .env, exit 0:

- `[ok]   github` 30 public repos (wolfwdavid). 30 is the cap: public non-fork repos, sorted by most recent push.
- `[ok]   hf` 12 models/spaces (WolfDavid)
- `[skip]` notion, calendar, gmail, docs, each with its missing env names
- `[skip] obsidian  OBSIDIAN_VAULT_PATH not set`. With OBSIDIAN_VAULT_PATH set to the fixture vault: `[ok] obsidian 3 notes, 7 distinct tags (2 skipped)`

**Obsidian was NOT cut.** Task 3 shipped in full.

## Contract signatures for 10-02 / 10-03

```ts
// real/shared.ts (use these, do not redefine)
export type Env = Record<string, string | undefined>;
export interface RealDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number }
export interface ProbeResult { app: AppName; configured: boolean; implemented: boolean; ok: boolean | null; kind?: ConnectorErrorKind; detail: string; latencyMs?: number }
export function missingEnv(env: Env, names: readonly string[]): string[];
export function notConfiguredPort<T>(app: AppName, methods: readonly string[], detail: string): T;
export function redactSecrets(text: string, env: Env): string;      // redacts values (len >= 8) of keys matching /TOKEN|SECRET|KEY|PASSWORD/i
export function toConnectorError(e: unknown, context: string, env?: Env): ConnectorError;

// real/http.ts
export function parseRetryAfterMs(headers: Headers, nowMs: number): number | undefined;
export async function fetchJson<T>(url: string, opts: { app: 'github' | 'hf'; headers?: Record<string, string>; deps?: RealDeps }): Promise<T>;
export function createPacer(minIntervalMs: number, deps?: Pick<RealDeps, 'sleep' | 'now'>): <T>(fn: () => Promise<T>) => Promise<T>;  // Notion 3 req/s: createPacer(350)

// real/notion.ts (10-02 replaces bodies, keeps signatures; flip NOTION_IMPLEMENTED to true)
export const NOTION_ENV: readonly ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID'];
export const NOTION_METHODS: readonly ['findByKey', 'upsertTrackerRow', 'listTrackerRows'];
export const NOTION_IMPLEMENTED: boolean;   // currently false
export function createRealNotion(env: Env, deps?: RealDeps): NotionPort;
export async function probeNotion(env: Env, deps?: RealDeps): Promise<ProbeResult>;   // must never throw in practice; index.ts also catches

// real/google/flags.ts (SDK-free, MUST keep zero import lines; 10-03 flips the booleans)
export type GoogleApp = 'gmail' | 'calendar' | 'docs';
export const GOOGLE_IMPLEMENTED: Readonly<Record<GoogleApp, boolean>>;   // { gmail: false, calendar: false, docs: false }
export const GOOGLE_ENV: readonly ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
export const GOOGLE_METHODS: {
  readonly gmail: readonly ['findByKey', 'createDraft', 'listDrafts', 'searchInbox'];   // NO send
  readonly calendar: readonly ['findByKey', 'createEvent', 'listEvents'];
  readonly docs: readonly ['findByKey', 'readDoc', 'createDoc'];
};

// real/google/index.ts (10-03 replaces bodies; loaded ONLY via import('./google/index.ts'))
export interface GooglePorts { gmail: GmailPort; calendar: CalendarPort; docs: DocsPort }
export function createRealGoogle(env: Env, deps?: RealDeps): GooglePorts;
export async function probeGoogle(env: Env, deps?: RealDeps): Promise<ProbeResult[]>;   // order: calendar, gmail, docs

// real/index.ts
export const REAL_ENV_REQUIREMENTS: Readonly<Record<AppName, readonly string[]>>;
export interface RealConnectorStatus { app: AppName; configured: boolean; implemented: boolean; missing: string[] }
export function realConnectorStatus(env: Env): RealConnectorStatus[];
export function createRealConnectors(env?: Env, deps?: RealDeps): Connectors;
export async function probeRealConnectors(env: Env, deps?: RealDeps): Promise<ProbeResult[]>;   // never throws

// real/obsidian.ts (NOT re-exported from connectors/index.ts; import directly from routes/scripts)
export interface VaultNote { path: string; title: string; tags: string[]; frontmatter: Record<string, unknown>; modified: string }
export interface VaultReadResult { root: string; notes: VaultNote[]; skipped: { path: string; reason: string }[] }
export function extractTags(frontmatter: Record<string, unknown>, content: string): string[];
export async function readObsidianVault(root: string, opts?: { maxNotes?: number; includeInlineTags?: boolean }): Promise<VaultReadResult>;
```

Lazy-load rules for 10-03:
- `real/index.ts` imports `./google/index.ts` only via `import type` plus `import('./google/index.ts')`.
- `@googleapis/*` and `google-auth-library` may be imported ONLY inside `real/google/index.ts` or its siblings, never in `flags.ts`.
- With Google env present, `createRealConnectors` builds lazy method wrappers from `GOOGLE_METHODS` synchronously. Each method key must exist on the ports that `createRealGoogle` returns.

## Verification

- `npm --prefix web test -- src/lib/core/connectors/real/real-read.test.ts`: 26 passed (at least 20 required).
- `npm --prefix web test -- src/lib/core/connectors/real/obsidian.test.ts`: 10 passed (at least 9 required).
- `npm --prefix web test`: 20 files, 327/327 passed, including boundary.test.ts. No network calls.
- `npm --prefix web run check`: 522 files, 0 errors, 0 warnings.
- `MSYS_NO_PATHCONV=1 BASE_PATH=/multi-app-agent npm run build` (from web/): adapter-static wrote the site, exit 0.
- Acceptance greps all pass:
  - dynamic `import('./google/index.ts')` 2
  - SDK names in index.ts + flags.ts 0
  - `GOOGLE_ENV`/`GOOGLE_METHODS` exports: 2 in flags, 0 in google/index
  - `^import` lines in flags.ts 0; value static imports of `./google/index.ts` 0
  - health route probe/status references 3
  - new env vars in .env.example 4; secret-like values 0
  - `process.env` in core real modules 0
  - top-level let/var in real/*.ts (non-test) 0
  - engines 1; obsidian in connectors/index.ts 0; body marker 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] svelte-check rejected `.ts` alias imports in the health route**
- **Found during:** Task 2
- **Issue:** `$lib/core/connectors/index.ts` failed with "uses a '.ts' extension ... not a relative path" (2 errors).
- **Fix:** Changed to the extensionless `$lib/core/connectors/index` and `$lib/core/connectors/real/index`.
- **Files modified:** web/src/routes/api/health/+server.ts
- **Commit:** 892ef2d

**2. [Rule 1 - Bug] `maxNotes` applied to files would return 0 notes**
- **Found during:** Task 3
- **Issue:** Capping the sorted file list at 1 picks `Broken/Bad YAML.md`, which is skipped, so the result has 0 notes. The behavior spec requires `maxNotes: 1` to return 1 note.
- **Fix:** The cap applies to the number of parsed notes.
- **Commit:** ef43b32

### Process notes
- Task 3: the tests and the implementation were written in one pass and committed together, with no separate RED commit, to stay inside the time box. The tests were run against the implementation and pass.
- `real/google/flags.ts` also exports `type GoogleApp`. It is still import-free.
- Tests added beyond the behavior list: toConnectorError passthrough/redaction, the 30-repo cap, HF author validation, `includeInlineTags: false`, and error messages never containing query-string secrets.
- Mid-plan the coordinator issued a git-safety correction. Before it, earlier commits used explicit `git add` plus `git commit`; I checked with `git show --name-only` that each contained only this plan's files. Task 3 and the final metadata commit use `git commit --only -- <paths>`.
- REQUIREMENTS.md was not modified. It is outside this plan's owned files under the parallel-execution rules; PORT-01..03 are satisfied and can be checked off by the orchestrator.

## Known Stubs

- `web/src/lib/core/connectors/real/notion.ts`: every method rejects `not_configured` and `NOTION_IMPLEMENTED = false`. This is an intentional contract stub that plan 10-02 replaces.
- `web/src/lib/core/connectors/real/google/index.ts`: every method rejects `not_configured`, `probeGoogle` returns ok null, and `GOOGLE_IMPLEMENTED` is all false in flags.ts. This is an intentional contract stub that plan 10-03 replaces.
- Both fail loudly with no silent empty data, and neither blocks this plan's goal (live GitHub/HF plus module layout).

## Self-Check: PASSED

- All created files exist (verified by the test runs and by `git show --name-only` on each commit).
- Commits 0e7467a, 11d221e, 892ef2d and ef43b32 are present in `git log`. No commit message contains Co-Authored-By, tool/assistant names or session trailers.

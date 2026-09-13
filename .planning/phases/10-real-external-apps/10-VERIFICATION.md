---
phase: 10-real-external-apps
verified: 2026-09-13T14:45:00Z
status: human_needed
score: 4/4 must-haves verified (automated); Notion/Google live behavior requires human credential verification
human_verification:
  - test: "Live Notion roundtrip"
    expected: "With NOTION_TOKEN and NOTION_DATA_SOURCE_ID (a data source id, database shared with the integration) set in web/.env: `npx tsx scripts/notion-setup.ts` reports the tracker schema as ok (or `--apply` fixes missing properties), then `npx tsx scripts/notion-setup.ts --roundtrip --keep` prints `[ok] roundtrip: created page ..., re-run deduped, 1 row for key`, and `npx tsx scripts/smoke-real.ts` shows `[ok]   notion    schema ok (N properties)`."
    why_human: "Credentials are not available in this session (no web/.env). Live network calls against a real Notion workspace cannot be exercised or cross-checked automatically here."
  - test: "Live Google Calendar roundtrip"
    expected: "With GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET set, run `npx tsx scripts/google-auth.ts`, open the printed consent URL as the Test user, paste the printed `GOOGLE_REFRESH_TOKEN=...` line into web/.env. Then `npx tsx scripts/google-auth.ts --check` prints `[ok] google auth: scopes ok`, `npx tsx scripts/google-smoke.ts --keep` prints `[ok] calendar create → read-back → re-run 409 deduped → 1 event (<link>)`, and `npx tsx scripts/smoke-real.ts` shows `[ok]   calendar`."
    why_human: "Credentials are not available in this session. OAuth consent requires an interactive browser login as a Google Test user, which cannot be performed by this verifier."
  - test: "Live Gmail draft and Docs roundtrip (optional, both flags are implemented)"
    expected: "With the same Google refresh token and `GOOGLE_SMOKE_TO=<demo account address>` set, `npx tsx scripts/google-smoke.ts --keep` also prints `[ok]` for gmail (a draft with a `[tp:...]` subject marker, no send) and docs (a Drive doc with appProperties.tpKey, body inserted, readDoc returns the text)."
    why_human: "Same credential gate as above; requires a live Gmail/Drive account and cannot be exercised offline."
---

# Phase 10: Real External Apps Verification Report

**Phase Goal:** The agent works against real apps behind the same ports: live GitHub and HF portfolio evidence, a real Notion tracker, at least one real Google app, and optionally a local Obsidian vault.
**Verified:** 2026-09-13T14:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Given a GitHub username, public repos (name, description, stars, languages, recent activity) come back live; given an HF username, public models and Spaces come back live | VERIFIED | `npx tsx scripts/smoke-real.ts` (no `.env`, offline creds): `[ok] github 30 most recently pushed public repos (wolfwdavid)`, `[ok] hf 12 models/spaces (WolfDavid)`. Cross-checked against live public APIs: GitHub returned 100 non-fork/non-private repos on page 1 (far more than the 30-cap, confirming the wording "30 most recently pushed" is accurate, not a total-account count); HF returned 2 models + 10 spaces (all non-private) = 12, matching exactly. |
| 2 | With a Notion token and shared database, upsertTrackerRow creates one page; a re-run updates instead of duplicating, confirmed by read-back | VERIFIED (code+tests) / human_needed (live) | 31 unit tests in `notion.test.ts` pass against a fake client proving the upsert, findByKey, pacing (350ms), and error-mapping contract. No live Notion workspace is available in this session (`web/.env` absent) — `notion-setup.ts` and `smoke-real.ts` both print a clean `[skip] notion missing env: NOTION_TOKEN, NOTION_DATA_SOURCE_ID` and exit 0. Live roundtrip requires a human with credentials (see Human Verification). |
| 3 | With a Google refresh token, at least one Google app (Calendar/Gmail/Docs) is written and read back; missing/expired credentials show up loudly, never as silent success | VERIFIED (code+tests) / human_needed (live) | 190 connector tests pass including auth.test.ts (25), calendar.test.ts (16), gmail-docs.test.ts (21) against fake Google API objects. All three apps (`calendar`, `gmail`, `docs`) are flagged `true` in `flags.ts`. No live Google credentials in this session — `google-smoke.ts` and `google-auth.ts` both fail loudly/cleanly without hanging (see below). Live roundtrip requires a human (see Human Verification). |
| 4 | (Optional) Pointing at a local Obsidian vault yields note tags and frontmatter | VERIFIED | Ran live against the fixture vault: `OBSIDIAN_VAULT_PATH=src/lib/core/data/fixtures/obsidian-vault npx tsx scripts/smoke-real.ts` → `[ok]   obsidian  3 notes, 7 distinct tags (2 skipped)`. 10/10 `obsidian.test.ts` unit tests pass (executable frontmatter blocked, bodies never returned). |

**Score:** 4/4 truths hold at the code/unit-test/GitHub-HF-live level. Notion and Google truths are architecturally complete and unit-proven but their *live* behavior against real external services cannot be exercised without user-supplied credentials (explicitly out of scope for this session per the task's classification rule).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `web/src/lib/core/connectors/real/shared.ts`, `http.ts`, `github.ts`, `hf.ts` | Live GitHub/HF ports, error mapping, pacer | VERIFIED | 26 `real-read.test.ts` tests pass; live smoke confirmed against public GitHub/HF APIs |
| `web/src/lib/core/connectors/real/index.ts` | createRealConnectors wiring, status, probes, lazy Google | VERIFIED | `probeRealConnectors`/`realConnectorStatus` wired into `/api/health`; lazy `import('./google/index.ts')` confirmed (2 call sites), only `import type` used statically |
| `web/src/lib/core/connectors/real/notion.ts`, `notion-schema.ts` | Real NotionPort on data-sources API | VERIFIED (unit) | `NOTION_IMPLEMENTED = true`; 31 tests pass; live untested (no creds) |
| `web/src/lib/core/connectors/real/google/*.ts` | Real Calendar/Gmail/Docs ports, auth, lazy stub layout | VERIFIED (unit) | `flags.ts` has zero import lines; `calendar/gmail/docs: true`; 62 Google unit tests pass; live untested (no creds) |
| `web/src/lib/core/connectors/real/obsidian.ts` | Local vault reader (tags/frontmatter only, no bodies) | VERIFIED | 10 unit tests pass; live-verified against fixture vault (3 notes, 7 tags, 2 skipped) |
| `web/src/routes/api/health/+server.ts` | connectors status + `?probe=1` live probes | VERIFIED | Keeps existing fields; adds `connectors: { mode, real: realConnectorStatus(...) }` and conditional `probes` |
| `web/scripts/smoke-real.ts` | Live smoke for all real connectors | VERIFIED | Runs offline cleanly, exit 0; `[ok]` for github/hf with counts, `[skip]` for notion/calendar/gmail/docs naming missing env vars, `[skip]`/`[ok]` for obsidian |
| `web/scripts/notion-setup.ts` | Schema check / --apply / --roundtrip | VERIFIED | Exits 0 with `[skip] notion` and setup steps when creds absent |
| `web/scripts/google-auth.ts` | Loopback OAuth consent | VERIFIED | Exits without opening a browser or waiting for input when `GOOGLE_CLIENT_ID`/`SECRET` are absent; prints setup steps naming both vars |
| `web/scripts/google-smoke.ts` | Live create/read-back/dedupe/cleanup | VERIFIED | Exits 0 with `[skip] google` naming missing env vars |
| `web/.env.example` | Documents new vars, no secrets | VERIFIED | `GITHUB_TOKEN`, `OBSIDIAN_VAULT_PATH`, `GOOGLE_CALENDAR_ID`, `GOOGLE_OAUTH_PORT` present with comments; no secret-like values |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `real/index.ts` | `github.ts` + `hf.ts` | `createRealGitHub`/`createRealHF` | WIRED | Confirmed by passing tests and live smoke counts |
| `real/index.ts` | `google/index.ts` | lazy `import('./google/index.ts')` | WIRED | 2 dynamic-import call sites; 0 value static imports; `web/build` (final static output) has 0 matches for `@googleapis`/`google-auth-library` |
| `github.ts` | `http.ts` | `fetchJson` status→error mapping | WIRED | `real-read.test.ts` proves 404/401/403/429/5xx/timeout mapping |
| `smoke-real.ts` | `real/index.ts` | `probeRealConnectors` | WIRED | Smoke output matches probe detail strings exactly |
| `notion.ts` | `@notionhq/client dataSources.query` | TP Key rich_text filter | WIRED (unit-proven) | `dataSources.query` grep and tests confirm; not live-exercised |
| `notion.ts` | `http.ts` | `createPacer(350)` | WIRED | `createPacer(350` present once; pacing test passes |
| `google/calendar.ts` | Calendar `events.insert` | deterministic id + `extendedProperties.private` | WIRED (unit-proven) | base32hex/tpApp greps + 16 tests pass; not live-exercised |
| `google/docs.ts` | Drive `files.list` | `appProperties has {...}` | WIRED (unit-proven) | grep + tests pass; not live-exercised |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| PORT-01 | 10-01 | Agent pulls public GitHub repos live | SATISFIED | Live smoke + cross-check against `api.github.com` |
| PORT-02 | 10-01 | Agent pulls public HF models/Spaces live | SATISFIED | Live smoke + cross-check against `huggingface.co/api` (12 = 2 models + 10 spaces, matches exactly) |
| PORT-03 | 10-01 | Agent reads tags/frontmatter from a local Obsidian vault | SATISFIED | Live-run against fixture vault: 3 notes, 7 tags, 2 skipped; bodies never returned |
| APPS-05 | 10-02, 10-03 | Real mode works for Notion and >=1 Google app when credentials are provided | SATISFIED (code) / NEEDS HUMAN (live) | Both halves are fully implemented, unit-tested with fake clients, and fail loudly with named missing-env vars when unconfigured. Live behavior against real Notion/Google accounts cannot be exercised without user-supplied credentials in this session (see Human Verification). This is the expected state per the task's classification rule, not a code gap. |

Note: `.planning/REQUIREMENTS.md` still shows `[ ]`/"Pending" for PORT-01..03 and APPS-05. Per both plan SUMMARYs, this is intentional — REQUIREMENTS.md was outside each plan's exclusively-owned files under the parallel-execution rules, and updating the checkboxes was left to the orchestrator. This is not a phase-10 implementation gap.

No orphaned requirements: all four IDs (PORT-01, PORT-02, PORT-03, APPS-05) appear in plan frontmatter (`10-01` claims PORT-01/02/03; `10-02` and `10-03` each claim APPS-05).

### Anti-Patterns Found

None. No TODO/FIXME/placeholder/"not yet implemented" comments in any Phase 10 file. No `.send(` calls, no `gmail.send`/`mail.google.com` scope values (one comment in `gmail.ts` mentions "never gmail.send" as documentation of an absence, not a scope declaration). No `process.env` inside `src/lib/core` (checked non-test files). No top-level `let`/`var` in `real/**` non-test files. `GOOGLE_REFRESH_TOKEN=` is printed exactly once, only in `google-auth.ts`'s designed consent-completion line.

### Concurrent-Phase Test Failures (not Phase 10 gaps)

`npm --prefix web run check` reports 4 TypeScript errors, all in `src/lib/core/critique/analyze.test.ts` (`'seed.github' is possibly 'undefined'`, etc.), a file owned by a different, concurrently-executing phase (critique/Phase 5), last modified during this session by another agent. This file is not in any Phase 10 plan's `files_modified` list. Recorded here per instructions; not attributed to Phase 10 and not fixed.

### Human Verification Required

See YAML frontmatter `human_verification` for the exact commands. Summary:

1. **Live Notion roundtrip** — needs `NOTION_TOKEN` + `NOTION_DATA_SOURCE_ID` in `web/.env`, a database shared with the integration, then `notion-setup.ts --apply --roundtrip --keep` and `smoke-real.ts` should both show `[ok]`.
2. **Live Google Calendar roundtrip** — needs `GOOGLE_CLIENT_ID`/`SECRET`, an interactive `google-auth.ts` consent as a Test user, then `google-smoke.ts --keep` and `smoke-real.ts` should show `[ok] calendar`.
3. **Live Gmail/Docs roundtrip (optional)** — same token plus `GOOGLE_SMOKE_TO`; `google-smoke.ts --keep` should additionally show `[ok]` for gmail and docs.

### Gaps Summary

No code gaps found. All automated, offline-verifiable checks pass: 190/190 connector unit tests, live GitHub/HF data independently cross-checked against the public APIs, the Obsidian reader live-verified against the fixture vault, the static build free of Google SDK code, and every credential-gated script (`notion-setup.ts`, `google-smoke.ts`, `google-auth.ts`) fails loudly and cleanly with named missing env vars, exiting 0 where specified and never hanging or opening a browser. `svelte-check` errors are confined to a different phase's file. The only open item is live verification against real Notion and Google accounts, which requires user-supplied credentials not available in this session — classified as `human_needed`, not `gaps_found`, per the task's explicit instruction.

---

_Verified: 2026-09-13T14:45:00Z_
_Verifier: Claude (gsd-verifier)_

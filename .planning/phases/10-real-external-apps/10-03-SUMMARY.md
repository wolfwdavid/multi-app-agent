---
phase: 10-real-external-apps
plan: 03
subsystem: connectors
tags: [real-connectors, google, calendar, gmail, docs, oauth, apps-05]
requires:
  - 10-01 contracts (real/shared.ts helpers, real/google/flags.ts, lazy import('./google/index.ts') in real/index.ts)
  - connectors/types.ts ports (CalendarPort, GmailPort, DocsPort) and mock/validate.ts validators
provides:
  - Refresh-token Google auth (GOOGLE_SCOPES, createGoogleAuth, mapGoogleError, missingScopes, probeGoogleAuth)
  - Real CalendarPort (deterministic base32hex event ids, private tpKey/tpApp tags, 409 dedupe, cancelled restore)
  - Real GmailPort, drafts only ([tp:<key>] subject marker, no send, searchInbox not_configured)
  - Real DocsPort (Drive appProperties tpKey, batchUpdate body, readDoc text extraction)
  - createGoogleApis / createRealGoogle / probeGoogle feeding /api/health?probe=1 and smoke-real.ts
  - scripts/google-auth.ts (PKCE loopback consent, --check) and scripts/google-smoke.ts (live create/read-back/dedupe/cleanup)
affects:
  - Phase 8/9 health and live backend (Google probes now report implemented true for all three apps)
  - BRIEF.md / demo prep (7-day Testing-mode refresh tokens)
tech-stack:
  added: []
  patterns:
    - "Per-app Google ports take structural API interfaces (CalendarApi/GmailApi/DocsApi/DriveApi); only index.ts and auth.ts import SDKs"
    - "GoogleDeps.implemented test seam overrides GOOGLE_IMPLEMENTED per app, so stub behavior stays testable after the flags flip"
    - "Real ports are built lazily on the first method call (lazyPort), so constructing ports never builds clients"
key-files:
  created:
    - web/src/lib/core/connectors/real/google/auth.ts
    - web/src/lib/core/connectors/real/google/auth.test.ts
    - web/src/lib/core/connectors/real/google/calendar.ts
    - web/src/lib/core/connectors/real/google/calendar.test.ts
    - web/src/lib/core/connectors/real/google/gmail.ts
    - web/src/lib/core/connectors/real/google/docs.ts
    - web/src/lib/core/connectors/real/google/gmail-docs.test.ts
    - web/scripts/google-auth.ts
    - web/scripts/google-smoke.ts
  modified:
    - web/src/lib/core/connectors/real/google/index.ts
    - web/src/lib/core/connectors/real/google/flags.ts
decisions:
  - "Google Calendar event id = base32hex(sha256(key)) (52 chars), unlike the mock twin's key.replace('-',''); both are valid base32hex, ids are internal and callers address events by key"
  - "Calendar listEvents widens the UTC timeMin/timeMax window by one day each side and filters all-day dates exactly client-side, because all-day dates float with the calendar timezone"
  - "Gmail findByKey searches drafts with q subject:\"[tp:<key>]\" and falls back to scanning 50 recent drafts, because search indexing lags for brand-new drafts"
  - "createRealGoogle/probeGoogle accept deps.implemented to override GOOGLE_IMPLEMENTED per app (test seam; the contract signatures are only widened)"
metrics:
  duration: 11min
  completed: 2026-09-13
  tasks: 3
  files: 11
---

# Phase 10 Plan 03: Real Google Connectors (Calendar, Gmail Drafts, Docs) Summary

All three Google apps now run behind the unchanged ports through `createConnectors({ mode: 'real', env })`, using one refresh token:
- **Calendar** creates all-day events with deterministic base32hex ids and private `tpKey`/`tpApp` tags. A duplicate create returns 409, and a deleted event is restored.
- **Gmail** creates drafts only. The `[tp:<key>]` marker goes in the subject, and there is no send method in the type, the scope, or the code.
- **Docs** creates the document through Drive with `appProperties.tpKey`, then inserts the body with `batchUpdate`.

Bad credentials fail loudly as typed errors: `invalid_grant` includes a re-auth hint, and missing scopes are listed. A one-command loopback consent script mints the token.

**Shipped apps (flags.ts):** `calendar: true, gmail: true, docs: true`. **Nothing was cut.** Task 3 finished inside the time box.

## Tasks and commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Google auth (scopes, error mapping, auth probe), google/index.ts rewrite, loopback consent script | 30fe9c3 |
| 2 | Real CalendarPort, calendar flag, calendar probe read, live smoke script | bdc1366 |
| 3 | Real GmailPort (drafts) + DocsPort, gmail/docs flags, probe reads, smoke blocks | 3eaba58 |

## Google Cloud setup the user must do (one time)

1. **Pick a project.** In Google Cloud Console, create a project or select an existing one.
2. **Enable 4 APIs.** Go to APIs & Services, then Library, and enable **Google Calendar API**, **Gmail API**, **Google Docs API** and **Google Drive API**.
3. **Consent screen.** In Google Auth Platform, set Branding (app name "TransferPilot" and your support email). Under Audience, choose **External** and publishing status **Testing**, then add the demo Google account under **Test users**. If the account isn't a test user, consent fails with `access_denied`.
4. **Data access (scopes).** Add exactly these four, and nothing broader. `gmail.send` and `https://mail.google.com/` are intentionally NOT requested.
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.compose`
5. **OAuth client.** Go to APIs & Services, then Credentials, then Create credentials, then **OAuth client ID**, and set Application type to **Desktop app**. A Desktop client allows the `http://127.0.0.1:<port>` loopback redirect, so no redirect URI needs registering. Put the id and secret in `web/.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
6. **Mint the refresh token.** From `web/`, run `npx tsx scripts/google-auth.ts`.
   - The script prints a consent URL to stderr. Open it in a browser signed in as the test user and **tick every scope checkbox**.
   - It prints one stdout line, `GOOGLE_REFRESH_TOKEN=...`. Paste it into `web/.env`, and also into the Vercel env for the live backend.
   - Optional: set `GOOGLE_OAUTH_PORT` if port 53682 is busy.
7. **Verify.** From `web/`, run these three:
   - `npx tsx scripts/google-auth.ts --check`, which should print `[ok] google auth: scopes ok`.
   - `npx tsx scripts/google-smoke.ts --keep`, which should print `[ok]` for calendar, gmail and docs.
     - Set `GOOGLE_SMOKE_TO=<the demo account's own address>` or gmail is skipped. The smoke never addresses a third party and never sends.
     - Optional: `GOOGLE_CALENDAR_ID` (default `primary`).
   - `npx tsx scripts/smoke-real.ts`.

**BRIEF.md note:** Refresh tokens for apps in Testing mode **expire after 7 days**. Re-mint the token with `scripts/google-auth.ts` shortly before recording the demo, and update Vercel env. Expiry shows up as `auth` with `invalid_grant` in `/api/health?probe=1`.

## Live smoke results

**Credentials not provided.** `web/.env` does not exist in this session, and the consent flow was not run.
- From `web/`, `npx tsx scripts/google-smoke.ts` prints `[skip] google  missing env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN` and exits 0.
- `npx tsx scripts/google-auth.ts` with no client id or secret prints the setup steps and exits 1, without opening a browser or waiting for input.

## Verification

- `npm --prefix web test -- src/lib/core/connectors`: 10 files, 190/190 passed. That includes auth.test.ts (25, at least 14 required), calendar.test.ts (16, at least 12 required) and gmail-docs.test.ts (21, at least 16 required). All Google tests inject fake APIs, so there are no network calls.
- `npm --prefix web test` (full suite): 31 files, 534/534 passed.
- `npm --prefix web run check`: 0 errors, 0 warnings.
- From web/, `MSYS_NO_PATHCONV=1 BASE_PATH=/multi-app-agent npm run build` exited 0. `web/build` has 0 files matching `@googleapis`, `OAuth2Client` or the gmail scope URL, and client chunks have 0 files matching `OAuth2Client` or `gaxios`, so the lazy load holds.
- Acceptance greps:
  - Scopes and credential printing:
    - `gmail.send|mail.google.com` in auth.ts and google-auth.ts: 0
    - `access_type: 'offline'`, `prompt: 'consent'`, `codeVerifier` and `127.0.0.1` are present in google-auth.ts
    - `GOOGLE_REFRESH_TOKEN=` in google-auth.ts: 1
    - `access_token|id_token` in google-auth.ts: 0
  - Calendar:
    - base32hex alphabet: 1
    - `tpApp=transferpilot`: 2
    - `dateTime`: 0
  - Gmail and Docs:
    - `.send(` in gmail.ts and google-smoke.ts: 0
    - `base64url`: 3
    - `gmail.readonly`: 1
    - `appProperties has`: 1
    - `endOfSegmentLocation`: 1
  - Flags: `gmail: true|docs: true` 2, `calendar: true` 1, import lines in flags.ts 0.
  - Lazy-load and core rules:
    - SDK imports in calendar.ts, gmail.ts and docs.ts: 0
    - `process.env` in real/google/*.ts: 0
    - GOOGLE_* exports from google/index.ts: 0
    - static SDK or google/index.ts value imports in real/index.ts: 0
    - module-level let/var: 0
- Secret scan (`ya29.|1//0|GOCSPX-|ntn_|secret_|ghp_`): 0 hits in this plan's files. The 6 repo hits are fake fixture strings in 10-01/10-02 test files (`notion.test.ts`, `real-read.test.ts`) and are not real secrets.

## Type casts used (googleapis / google-auth-library)

- `createGoogleApis`: `const auth = createGoogleAuth(env) as never`, passed to `calendar/gmail/docs/drive({ version, auth })`. `@googleapis/*` may bundle a different google-auth-library major; the two are runtime-compatible.
- `probeGoogleAuth`: `createGoogleAuth(env) as unknown as AuthLike`. `OAuth2Client.getAccessToken()` and `getTokenInfo()` structurally satisfy it.
- `index.ts` casts the `GoogleApis` members (typed `unknown`) to the structural `CalendarApi`/`GmailApi`/`DocsApi`/`DriveApi` at the port builders.
- No other casts touch SDK types. Port modules use `any` only inside the structural API interfaces.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Calendar test mock typing failed svelte-check**
- **Found during:** Task 2
- **Issue:** `fakeApi` typed its overrides as `Partial<CalendarApi['events']>`, so `.mock` was missing on the event functions (3 type errors).
- **Fix:** Typed the fake events as `Record<'insert'|'get'|'list'|'update', Mock>`.
- **Commit:** bdc1366

**2. [Rule 1 - Acceptance] Comment tripped the forbidden-scope grep**
- **Found during:** Task 3 verification
- **Issue:** An auth.ts doc comment named `gmail.send` while explaining that it is not requested, so the `gmail.send|mail.google.com` grep counted 1.
- **Fix:** Reworded to "no send or full-mailbox scope".
- **Commit:** 3eaba58 (a one-line comment change to auth.ts, included with Task 3)

### Additions beyond the plan
- `GoogleDeps.implemented` (a per-app override of GOOGLE_IMPLEMENTED) on `createRealGoogle` and `probeGoogle`. Once the flags are true, the Task 1 behaviors "flags all false → not_configured / ok null" can only be tested through this seam. Signatures are widened, not changed.
- Lazy real-port construction (`lazyPort`), so API clients are built on the first method call of an implemented app only.
- The probe runs one read per implemented app, each timed with latencyMs through `deps.now`.
- Extra tests: the Headers-object retry-after, a Drive query-injection key rejected before any API call, Gmail nested multipart plus RFC 2047 subject decoding, and the probe result never containing the refresh token.

### Process notes
- TDD: to stay inside the time box, each task's tests and implementation were written in one pass and committed together, with no separate RED commit. The Task 3 wiring tests were observed failing (2 failures) before index.ts and flags.ts were wired, then passed.
- **ROADMAP.md was NOT updated.** At the start of execution it already had uncommitted changes from another agent. Under the shared-file rule I did not run `roadmap update-plan-progress` or commit it. The orchestrator should mark 10-03 complete.
- REQUIREMENTS.md was not modified because it is outside this plan's owned files. The Google half of APPS-05 is satisfied, so the orchestrator can check it off along with 10-02's Notion half.
- All commits used explicit paths with `git commit --only -- <paths>`, and none carries attribution trailers.

## Known Stubs

- None in this plan's files. Real `searchInbox` deliberately rejects `not_configured`, because inbox reading would need `gmail.readonly`, which is not requested. This is by design (inbox content is mock-only), and it fails loudly rather than returning silent empty data.

## Self-Check: PASSED

- Created files exist (all imported and exercised by the 190-test connectors run): auth.ts, auth.test.ts, calendar.ts, calendar.test.ts, gmail.ts, docs.ts, gmail-docs.test.ts, scripts/google-auth.ts, scripts/google-smoke.ts.
- Commits 30fe9c3, bdc1366 and 3eaba58 are present in `git log`.

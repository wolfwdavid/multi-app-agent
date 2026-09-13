---
status: partial
phase: 10-real-external-apps
source: [10-VERIFICATION.md]
started: 2026-09-13T18:40:00Z
updated: 2026-09-13T18:40:00Z
---

## Current Test

[awaiting human testing — requires credentials in web/.env, which do not exist yet]

## Tests

### 1. Live Notion roundtrip
Setup: an internal integration token in `NOTION_TOKEN`, and a tracker database shared with the integration (database **...** menu → Connections). Put its URL or id in `NOTION_DATA_SOURCE_ID`. Required properties: `Name` (title), `TP Key` (text), `School ID`/`Program ID`/`Required Docs`/`Notes` (text), `Deadline` (date), `Recs Required`/`Gap Count` (number), `Essay Status` (select: not_started, draft, critiqued, final), `Status` (select, not Notion's built-in Status type: planning, in_progress, submitted, blocked).
Run from `web/`: `npx tsx scripts/notion-setup.ts --apply --roundtrip --keep`, then `npx tsx scripts/smoke-real.ts`
expected: `[ok] roundtrip` from notion-setup; `[ok] notion schema ok` from smoke-real; re-running the roundtrip updates the same row (no duplicate)
result: [pending]

### 2. Live Google Calendar roundtrip
Setup: Google Cloud project with the Calendar/Gmail/Docs/Drive APIs enabled; consent screen External + Testing with the demo account as a Test user; scopes exactly `documents`, `drive.file`, `calendar.events`, `gmail.compose`; OAuth client of type Desktop app → `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
Run from `web/`: `npx tsx scripts/google-auth.ts` (consent, paste the printed `GOOGLE_REFRESH_TOKEN=` line into web/.env), `npx tsx scripts/google-auth.ts --check`, then `npx tsx scripts/google-smoke.ts --keep` and `npx tsx scripts/smoke-real.ts`
expected: `[ok] calendar` in both; re-running creates no duplicate event (deterministic event id)
result: [pending]

### 3. Live Gmail drafts + Docs roundtrip (optional)
Setup: same token as test 2, plus `GOOGLE_SMOKE_TO` set to the demo account's own address
Run from `web/`: `npx tsx scripts/google-smoke.ts --keep`
expected: `[ok]` for gmail (a draft is created, never sent) and docs; re-running finds the existing draft/doc by key instead of duplicating
result: [pending]

Note: Testing-mode refresh tokens expire after 7 days — mint the token shortly before recording the demo.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

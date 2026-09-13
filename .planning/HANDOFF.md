# Session Handoff — 2026-09-13 ~2:55 PM ET

Hackathon build window ends **7:00 PM ET** (judging at 7). GSD project: `.planning/` (ROADMAP.md, STATE.md, REQUIREMENTS.md, per-phase PLAN/SUMMARY/VERIFICATION). Read `tasks/lessons.md` before any git work.

## Phase status
| Phase | Status |
|---|---|
| 1 Contracts & seed data | ✓ complete, verified |
| 2 Mock app twins | ✓ complete, verified |
| 3 Gap analysis | ✓ complete, verified |
| 4 Sprint pipeline on mocks | ✓ complete, verified |
| 5 Essay critique & injection guard | 05-01 ✓. **05-02 was executing at handoff.** Check that `.planning/phases/05-*/05-02-SUMMARY.md` exists. If it does, run the phase 5 verifier. If it doesn't, check `git log --oneline --grep=05-02`; with no progress, re-run `/gsd:execute-phase 5` (it skips completed plans). |
| 6 Eval harness (25% of score, CRITICAL PATH) | planned + checked; execute after phase 5 |
| 7 UI + Pages/HF showcase | planned + checked; after 6. 07-03 has a user checkpoint before publishing |
| 8 Real LLM | ✓ complete, verified (real Ollama hero sprint 23/23) |
| 9 Vercel backend | planned + checked; after 4, 7, 8 |
| 10 Real external apps | built; GitHub + HF live-verified; Notion/Google `human_needed` (see 10-HUMAN-UAT.md). NOT marked complete |
| 11 MCP server | ✓ complete (verifier not run; executor reported 637/637 tests, stdio handshake OK) |
| 12 Brief/README/demo/submit | planned, checked, revised; run ~6:15 PM ET |

Next command order: verify phase 5 → `/gsd:execute-phase 6` → `/gsd:execute-phase 7` → `/gsd:execute-phase 9` → `/gsd:execute-phase 12`.

## Hard rules (learned this session)
- **Commits:** no AI trailers (no Co-Authored-By / Claude / Claude-Session). Every executor prompt must say so.
- **Commit by path only:** `git add <paths> && git commit --no-verify --only -m "..." -- <paths>`. Never a bare `git commit` while agents run.
- **Before any push:** `bash scripts/strip-ai-trailers.sh origin/main`, plus an independent `git log origin/main..HEAD --format=%B | grep -inE "co-authored|claude|anthropic"`. Push only when no agent is committing.
- **`web/scripts/sprint.ts`** rewrites the tracked `web/static/data/hero-run.json` and `static/traces/demo-sprint*.jsonl` on every plain run. For verification, always pass `--out <scratch> --json <scratch>`. Follow-up fix, not yet done: write recordings only behind an explicit flag (after 05-02, which re-records once).
- **When messaging a running agent:** identify it by its spawn description, not its position in a batch.

## Git state
- **Not pushed:** nothing since `a0972d6`. origin/main is behind by many commits.
- **Mislabeled commit:** `317a66e` "docs(11): create phase 11 MCP server plan" also deletes app.py / docs/index.html / requirements.txt. The deletions are intended, but the message doesn't mention them. Optionally note this when pushing.
- **Vercel:** project linked from `web/`, preview deployed. Deployment Protection is ON; changing it is the user's decision.

## Open user decisions (ask; never decide for them)
1. Submission destination (link or form)
2. Notion token + database (optional third live app). Setup is in 10-HUMAN-UAT.md.
3. Vercel demo public? (Deployment Protection off)
4. MIT LICENSE file? (README says MIT; no LICENSE file exists)
5. The user records the 2-minute demo video around 6:15–6:40 PM ET (phase 12-02 checkpoint)

## What was verified directly vs relayed
- **Checked directly in the session:**
  - live GitHub/HF smoke (30 most-recently-pushed repos; 12 HF items)
  - hero sprint + rerun (0 new writes, 23/23 deduped)
  - lying-success fault → `partial`, 1 mismatch
  - hero-run.json PII scan = 0
- **Everything else is from agent reports**, including verifier "passed" results and test counts. Re-run `npm --prefix web test` and `npm --prefix web run check` early in the next session.

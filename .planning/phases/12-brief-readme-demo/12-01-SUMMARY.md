---
phase: 12-brief-readme-demo
plan: 01
subsystem: docs
tags: [brief, readme, evals, verification, secret-scan, submission]
requires:
  - "06-03: evals.json/evals.md, silent-failure-run.json, LLM column"
  - "07-03: live Pages + HF static Space"
  - "08-02, 10-01..10-03, 11-01 SUMMARYs for LLM, connector and MCP status"
provides:
  - "BRIEF.md final: verbatim eval tables, real-LLM finding, caught silent failure, verification record, shipped vs cut"
  - "README.md final: links, verified commands, connector status, canonical demo beats -> DEMO.md, video links"
  - ".planning/phases/12-brief-readme-demo/12-01-FACTS.txt (sanitized facts for 12-02)"
affects: [12-02]
tech-stack:
  added: []
  patterns:
    - "Every doc number traces to 12-01-FACTS.txt or a committed artifact; eval tables pasted verbatim from evals.md"
key-files:
  created:
    - .planning/phases/12-brief-readme-demo/12-01-FACTS.txt
  modified:
    - BRIEF.md
    - README.md
key-decisions:
  - "Verified commit is 13f9856 (last code commit); HEAD moved to cd34e3e during capture but that commit changes only .planning docs"
  - "Real-LLM column (0/2, communication_failure silent failures) reported as a measured finding plus limitation and next step, not hidden"
  - "Vercel backend + REST API marked Cut (no deploy, LIVE_URL empty, no 09 SUMMARYs); Notion/Google marked Built, credential-gated"
requirements-completed: [SHIP-02, SHIP-03]
duration: 12min
completed: 2026-09-13
---

# Phase 12 Plan 01: Final Brief and README Summary

**BRIEF.md and README.md are finalized using facts captured this session. The clean clone at 13f9856 ran 864/864 tests with 0 svelte-check errors, and the scripted eval columns reproduced exactly. GitHub and Hugging Face are live, and the Notion/Google connectors are marked credential-gated. The secret scan found 0 hits. The Ollama column's silent failures are stated honestly as a finding.**

## BLOCKERS

None. There were no secret hits, no failing tests and no EVAL_REPRO mismatch.

## Performance

- Duration: about 12 min (5:08 to 5:20 PM ET)
- Tasks: 3 of 3
- Files: 3 (BRIEF.md, README.md, 12-01-FACTS.txt)

## Task Commits

| Task | Name | Commit |
|---|---|---|
| 1 | Capture verified facts into 12-01-FACTS.txt | e7a0757 (single docs commit per plan) |
| 2 | Finalize BRIEF.md | e7a0757 |
| 3 | Finalize README.md and commit by explicit path | e7a0757 |

`docs(12-01)` commit: **e7a0757**. It touches exactly BRIEF.md, README.md and 12-01-FACTS.txt, has no AI trailers (grep count 0), and was not pushed.

## Excluded test-fixture files (SECRETS_EXCLUDED_TEST_FILES=0)

None. No tracked `*.test.ts` file matched the length-thresholded token patterns under either `git grep -E` or GNU grep over `git ls-files`.

## Captured facts (12-01-FACTS.txt, full content)

```
HEAD_SHA=13f9856
CURRENT_HEAD=cd34e3e (docs(07-03) commit; git diff 13f9856..cd34e3e touches 0 files under web/, scripts/, .github/)
VERIFIED_AT_ET=5:15 PM ET
UNPUSHED=0
DIRTY_WEB=0
CLEAN_CLONE=ok (npm ci at 29f3d96, then checkout 13f9856 with package files unchanged; test, check, eval reproduction and build rerun at 13f9856)
TESTS=Test Files 52 passed (52); Tests 864 passed (864)
TESTS_FIRST_PASS=at 29f3d96: Test Files 52 passed (52); Tests 856 passed (856)
CHECK=svelte-check COMPLETED 894 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
BUILD_RC=0
EVALS_MD=present
EVALS_COMMIT=0f7d07b
EVALS_GENERATED_AT=2026-09-13T20:16:22.756Z
EVALS_N=10
EVALS_SEED=1337
EVALS_SCENARIOS=23
EVALS_ADVERSARIAL=18
EVALS_MODELS=fake:scripted:fake-scripted:10;fake-verifier-off:scripted:fake-scripted:10;llm-ollama:llm:qwen3.5:4b+qwen2.5-coder:7b:1
TOTALS_fake=86.96% of 230 runs (200 passed); passK 86.96% of scenarios; silentFailures 10
TOTALS_fake-verifier-off=78.26% of 230 runs (180 passed); passK 78.26% of scenarios; silentFailures 30
TOTALS_llm-ollama=0% of 2 runs (0 passed); passK 0% of scenarios; silentFailures 2
FAILURE_TOTALS=fake: instruction_violation 10, hallucination 10, communication_failure 10 | fake-verifier-off: communication_failure 30, instruction_violation 10, hallucination 10 | llm-ollama: communication_failure 2
LLM_COLUMN=llm-ollama:qwen3.5:4b+qwen2.5-coder:7b:1 (commit 0622cc7; happy-path + injection-essay-doc; both communication_failure, both silent)
SILENT_FAILURE=caught=true class=communication_failure on_status=partial off_status=ok scenario=lying-success (on: verified 19 failed 4; off: verified 23)
HERO_ACTIONS=23
HERO_STATUS=ok
HERO_RERUN_DEDUPED=23
EVALS_MD_FOOTER=Generated from static/data/evals.json (commit 0f7d07b, seed 1337, 2026-09-13T20:16:22.756Z).
EVAL_REPRO=match (scripted columns, all 23 scenarios, at 13f9856 and 29f3d96)
SMOKE_AT_ET=5:11 PM ET
SMOKE_github=[ok] github 30 most recently pushed public repos (wolfwdavid)
SMOKE_hf=[ok] hf 12 models/spaces (WolfDavid)
SMOKE_notion=[skip] notion missing env: NOTION_TOKEN, NOTION_DATA_SOURCE_ID
SMOKE_calendar=[skip] calendar missing env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
SMOKE_gmail=[skip] gmail missing env: (same Google vars)
SMOKE_docs=[skip] docs missing env: (same Google vars)
SMOKE_obsidian=[ok] obsidian 3 notes, 7 distinct tags (2 skipped) (fixture vault)
IMPL_notion=1  IMPL_calendar=1  IMPL_gmail=1  IMPL_docs=1
LIVE_EVIDENCE_notion=none   LIVE_EVIDENCE_google=none
LIVE_APPS_VERIFIED=2 (github, hf)
PAGES_HTTP=200  PAGES_EVALS_HTTP=200  PAGES_EVALS_JSON_HTTP=200  HF_HTTP=200  REPO_HTTP=200
DEPLOYED_EVALS_MATCH=yes
VERCEL_URL=none  VERCEL_HEALTH=none
SHIPPED_agent/critique/evals/ui/static_deploy/llm/real_notion/real_google/obsidian/mcp=yes
SHIPPED_api=no (09-01-SUMMARY missing; only /api/health route)
SHIPPED_vercel=no (09-02-SUMMARY missing)
SECRETS_EXCLUDED_TEST_FILES=0  SECRETS_TRACKED=0  SECRETS_HISTORY=0  SECRETS_UNTRACKED=0  SECRETS_BUILD=0  SECRETS_VERCEL_STATIC=0
ENV_TRACKED=0  ENV_IGNORED=yes  CLIENT_SCAN=n/a
```

The authoritative copy, line by line, is `.planning/phases/12-brief-readme-demo/12-01-FACTS.txt`.

## Marker map: final status

| # | Final text |
|---|---|
| B1 | Comment removed; a sentence names agent/planner.ts, policy.ts, executor.ts, retry.ts, idempotency.ts, verifier.ts, sprint.ts |
| B2 | Notion: Built, credential-gated (not live-verified: credentials not configured); `TP Key` kept (grep 3) |
| B3 | Calendar: same status; `extendedProperties.private.tpKey` kept (grep 4) + deterministic event id |
| B4 | Docs/Drive: same status; `appProperties.tpKey` kept (grep 3) |
| B5 | Gmail: same status; `[tp:<key>]` kept (grep 3) |
| B6 | GitHub: Live (verified 5:11 PM ET: 30 most recently pushed public repos) |
| B7 | Hugging Face: Live (verified 5:11 PM ET: 12 models/spaces) |
| B8 | Obsidian: Built (local reader, tags/frontmatter only; verified on the fixture vault: 3 notes, 7 tags) |
| B9 | Built: verifier read-back (agent/verifier.ts) + independent oracle (eval/oracle.ts) |
| B10 | Built: World.diff() + oracle collateral-damage check |
| B11 | Policy gate: Built (Phase 4): HMAC plan token + approvedIds + recipient allowlist |
| B12 | Executor retry loop (agent/retry.ts): Built (Phase 4) |
| B13 | SprintLimits defaults maxSteps=200, maxAttempts=3 (agent/types.ts); Built (Phase 4); mermaid cap 3 unchanged |
| B14 | Built (Phase 5): grounding/claims.ts (known gap W2 noted) |
| B15 | Built: report graded from read-back; caught in eval (lying-success) |
| B16 | Rewritten as built; key `tp1-<first 16 hex of sha256(...)>`; hero re-run 23/23 deduped |
| B17 | Placeholder table replaced by the verbatim evals.md tables, totals, silent failures, seed, verifier on/off, known weaknesses, LLM columns and footer |
| B18 | Caught silent failure paragraph (lying-success: verifier on partial, off ok -> communication_failure; Evals page + traces + video 03) |
| B19 | Marker removed ("Verify on official page" in SourceLink.svelte) |
| B20 | Marker removed (critique/policy.ts); W1 gap noted |
| B21 | Marker removed (trace/redact.ts) |
| B22 | Marker removed; claims.ts named; hallucinated-claim 10/10 and W2 0/10 noted |
| B23 | Replaced by the "What shipped vs. cut" bullet |
| R1 | Live backend (Vercel): Cut: static replay stands in |
| R2 | `npm run record` + sprint.ts dry run with scratch --out/--json |
| R3 | eval.ts --n 10, the --no-artifacts variant, and the --llm ollama variant (LLM column exists) |
| R4 | smoke-real.ts kept |
| R5 | mcp.ts kept + .vscode/mcp.json + mcp/README.md link |
| R6-R12 | Same status phrases as BRIEF |
| R13-R16 | Canonical 6-beat timeline + DEMO.md link + demo/videos link |

## Cut items as written in BRIEF

- Live Vercel backend and REST API (Phase 9): cut. Only `/api/health` exists as a route. There is no Vercel deployment and no live URL, and the public showcase replays a recorded mock-mode run.
- MCP over HTTP: cut with Phase 9. The stdio server shipped. Its critique_essay tool still uses the FakeLLM critique slot.
- Live Notion and Google verification: not done, because credentials were not configured (10-HUMAN-UAT has 3 tests pending).

## Deviations from Plan

1. **[Rule 3 - Blocking] HEAD moved during capture.** Other agents committed ce2d10d, 13f9856 and cd34e3e after the first clean clone ran at 29f3d96. I fast-forwarded the scratch clone to 13f9856 (package files unchanged, so npm ci was reused) and reran test, check, eval reproduction and build there. cd34e3e changes only `.planning/`, so the verified commit is 13f9856 and both docs say so.
2. **[Rule 3] Scratch path.** The orchestrator's scratch dir `.../scratchpad/phase12` was used instead of `${TMPDIR}/tp-verify`.
3. **[Rule 1] Secret-scan tooling.** `git grep -E` with `\b` is unreliable on Git for Windows, so I reran the tracked scan with GNU grep over `git ls-files`. Both gave 0.
4. **Time zone.** `TZ=America/New_York date` is not honored in this Git Bash and `powershell` is not on PATH, so I used local `date`, which is on EDT (-0400).
5. **Extra honest content.** The orchestrator asked for these beyond the plan text: a real-LLM finding paragraph and limitation, video links in BRIEF/README, the Phase 8 23/23 run vs the video 05 21/23 run, and a "Results at a glance" section in README that copies the totals lines from evals.md verbatim.
6. **Commit.** A single docs commit covers all three tasks, as the plan specifies, and no per-task commits were made.

## Notes for 12-02

- README links `DEMO.md`, which 12-02 creates. The link stays broken until 12-02 lands.
- `web/.vercel/output/static` exists locally from an old build. It is gitignored and scanned clean.

## Fact-check corrections (5:30 PM ET)

Each finding was checked against code, evals.json and curl before any edit:
- Gmail scope: `gmail.compose` does permit sending. BRIEF §5, README Ethics, and the `gmail.ts`/`auth.ts` comments now say sending is blocked by the `GmailPort` type, not by the scope.
- Docs scope: `documents` is account-wide. The text now says code reads only the essay doc id, Drive uses `drive.file`, and there is no inbox access in real mode (Gmail Read is marked mock only).
- Verifier-on silent failures: W2 is the only source in the scripted column (10). The Ollama verifier-on column has 2 more.
- rate-limit-storm: 10/10 = 9 complete runs + 1 honest partial (run 4). The oracle accepts any non-ok report.
- §3 Communication failure and Instruction violation rows now list their known gaps: dropped `LLM_SLOT_FAILED` slots do not lower status (`verifier.ts`), W3 fails 0/10, W1 fails 0/10. README was softened to match.
- §1 and the README tagline now say "mock twins of their apps" with credential-gated real connectors, and "measure how reliably it works".
- ILR PDF link was 404; replaced with the 2026-02 URL used in schools.json (200 application/pdf).
- Video 07 description: every adversarial scenario passes 10/10 except W1/W2. Video 03 is described as a separate run (partial, 22/1). Video 05 is described as reporting ok while 2 slots were dropped. The Ollama mechanism is marked as inferred from the code path.
- Verification record: later commits up to 8096a9f; MSYS_NO_PATHCONV=1 prefix noted; showcase URLs rechecked 200 at 5:29 PM ET.
- README: no-credentials line added, .env made optional and web-relative, `--json` dropped from the dry run (sprint.ts writes it only on execute), Results lines reworded (200/230, 180/230, 20/23 and 18/23 all-pass scenarios, 0/2 Ollama). An MIT LICENSE file was added.
- Skipped: GAO link (403 bot protection from CLI on both the product page and the PDF; needs a browser check). Push finding already resolved: origin/main = 8096a9f contains e7a0757/fb67311. The BRIEF evals.md paste keeps its generator wording because it is labeled verbatim.

## Self-Check: PASSED

- FOUND: BRIEF.md, README.md, .planning/phases/12-brief-readme-demo/12-01-FACTS.txt
- FOUND: commit e7a0757 (3 files, trailer grep 0)
- FACTS_OK, BRIEF_OK, README_OK all printed; `TODO(` and `{{` counts 0 in both docs
- `git status --porcelain -- web/static`: no changes from this plan

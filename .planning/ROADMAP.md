# Roadmap: TransferPilot

## Overview

TransferPilot goes from an empty SvelteKit scaffold to a submitted, deployed, measured multi-app agent in one afternoon (build window 1:05 PM to 7:00 PM ET, 2026-09-13). The path is mock-first. Phases 1-3 lock the contracts, the sourced school dataset, stateful app twins, and the deterministic gap analysis. Phases 4-5 get the whole hero sprint (gap report, essay critique Doc, Notion tracker, Calendar deadlines, Gmail drafts) running in the terminal on mocks with a scripted LLM, with approval, idempotency, retries, read-back verification, and injection containment. Phase 6 produces real pass rates from an adversarial scenario suite. Phase 7 publishes the UI and eval dashboard to GitHub Pages and the HF Space by about 4:50 PM (hour 4). Later phases add the real LLM, the live Vercel backend, real external apps, and the MCP server, then close with the brief and demo. The late, credential-blocked, or optional work (real Google/Notion, Obsidian, MCP) is flagged as cut candidates so the reliability story never slips.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Contracts, Seed Data & Build Smoke** - zod domain contracts, sourced schools dataset, demo profile/fixtures, both deploy builds green (35 min) (completed 2026-09-13)
- [x] **Phase 2: Stateful Mock App Twins** - credential-free twins of Gmail/Calendar/Docs/Notion/GitHub/HF behind shared ports, with findByKey and fault injection (30 min, parallel with Phase 3) (completed 2026-09-13)
- [x] **Phase 3: Deterministic Gap Analysis** - per-school gap report and feasibility warnings in pure TypeScript (25 min, parallel with Phase 2) (completed 2026-09-13)
- [x] **Phase 4: Sprint Pipeline on Mocks** - terminal vertical slice: plan, approve, execute with idempotency and retry, read-back verify, redacted trace (45 min) (completed 2026-09-13)
- [ ] **Phase 5: Essay Critique, Evidence Grounding & Injection Guard** - policy-aware critique Doc, claim-evidence validator, injection flagged and contained, LLM-phrased actions (30 min)
- [ ] **Phase 6: Eval Harness & Real Pass Rates** - 8+ adversarial scenarios x N runs, state oracle, Lemma taxonomy, evals.json (40 min)
- [ ] **Phase 7: Sprint UI, Eval Dashboard & Static Showcase** - profile to verified artifacts UI, eval dashboard, deployed to Pages + HF with real numbers (45 min)
- [ ] **Phase 8: Real LLM Slots** - Ollama qwen3.5:4b (think off) and hosted fallback via env, LLM-backed eval column (20 min)
- [ ] **Phase 9: Live Backend on Vercel & REST API** - plan/execute/SSE/evals endpoints, server-enforced approval, live mock-mode URL (25 min)
- [ ] **Phase 10: Real External Apps** - live GitHub/HF evidence, real Notion, one real Google app, optional Obsidian (25 min, CUT CANDIDATE, parallel with Phase 11)
- [ ] **Phase 11: MCP Server** - stdio MCP server generated from the tool registry, usable from VS Code (15 min, CUT CANDIDATE, parallel with Phase 10)
- [ ] **Phase 12: Brief, README & Demo** - BRIEF.md with final numbers, README, 2-minute demo script and recording, submission (45 min incl. slack)

## Time Budget & Checkpoints

Build window: 1:05 PM to 7:00 PM ET = 355 min. Budgets include plan + execute + verify for each phase.

| Window (ET) | Phase(s) | Budget | Checkpoint (must be true at end of window) |
|-------------|----------|--------|--------------------------------------------|
| 1:05-1:40 | 1 | 35 min | Both builds green; schools.json + profile validate |
| 1:40-2:10 | 2 and 3 in parallel | 30 / 25 min | Mock twins + gap analysis tests green |
| 2:10-2:55 | 4 | 45 min | Terminal hero sprint on mocks; re-run shows all `deduped` |
| 2:55-3:25 | 5 | 30 min | Critique Doc + claim guard + injection containment on mocks |
| 3:25-4:05 | 6 | 40 min | `evals.json` with real pass rates exists |
| 4:05-4:50 | 7 | 45 min | **Public Pages + HF showcase live with real eval numbers (hour ~3:45)** |
| 4:50-5:10 | 8 | 20 min | Real LLM runs the sprint; LLM-backed eval column |
| 5:10-5:35 | 9 | 25 min | Live Vercel URL; core code freeze for phases 1-9 |
| 5:35-6:15 | 10 and 11 in parallel | 25 / 15 min | **HARD STOP 6:15 PM**: whatever is not done is cut |
| 6:15-7:00 | 12 | 45 min | Brief, README, demo recorded, submitted by 6:45 (15 min slack) |

Planned work ends by 6:00-6:15 PM depending on how the parallel waves go. That leaves 45 min for brief, demo, and submission, including at least 15 min of slack.

**Overrun rules:**
- If the Phase 7 showcase is not live by 5:00 PM, skip Phases 10 and 11 entirely.
- If Phase 4 is not green by 3:15 PM, fold the Phase 5 portfolio-evidence section (PORT-04) into Phase 10 and keep going.
- Never cut: Phases 1-7 and 12 (mock hero flow, final-state evals with N runs, approval gate, deployed dashboard, BRIEF numbers, demo).

**Cut order (first cut first):** Obsidian (PORT-03), then real Google app (Google part of APPS-05), then MCP server (MCP-01), then real Notion, then live HF, then live GitHub, then Vercel live backend (fall back to static replay).

**Eligibility note:** Organizers require 3 or more external apps. Mock twins alone may not count. The cheapest path to 3 real apps is live GitHub + live HF (public, no credentials) + real Notion (one integration token). Protect those three inside Phase 10 before Google.

## Phase Details

### Phase 1: Contracts, Seed Data & Build Smoke
**Goal**: The shared domain contracts and a sourced, program-level transfer requirements dataset exist, and both deploy builds (static and Vercel) succeed, so everything else builds on locked schemas.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02
**Time budget**: 35 min (1:05-1:40 PM ET)
**Cut candidate**: No
**Success Criteria** (what must be TRUE):
  1. `schools.json` validates against the zod School schema and contains 4 real schools plus 1 clearly labeled fictional adversarial school, keyed by school and program. Each entry has min/competitive GPA, units and semester/quarter system, required courses, GE pattern, essay prompts with word limits, recs, deadlines by term, `has_transfer_program`, and `ai_policy`.
  2. A schema test fails if any requirement field is missing `source_url`, `retrieved_at`, or `confidence`, and it passes on the committed dataset.
  3. A seeded demo student profile and the adversarial content fixtures validate against their schemas. Fixtures: an essay doc, an essay doc with a prompt injection, an inbox email with a prompt injection, and a quarter-unit profile variant.
  4. The static build (adapter-static, Pages base path) and the Vercel build (adapter-vercel) both succeed with a dummy `/api/health` route. Nothing under `src/lib/core/` imports `$app`, `$env`, `$lib`, or `svelte`.
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Wave 1: runtime contracts (schemas.ts, connectors/types.ts, tools/registry, tracer) + adapter switch + /api/health + dual build smoke + core boundary test
- [x] 01-02-PLAN.md — Wave 1 (parallel): schemas/school.ts + build-schools.ts transform of verified seed → schools.json with per-field provenance + negative provenance tests
- [x] 01-03-PLAN.md — Wave 2: profile/fixture schemas + demo & quarter profiles + injection fixtures + full phase gate (test, check, both builds)

Parallel human tasks to start now (not blocking this phase): get a hosted OpenAI-compatible LLM key (needed by Phase 8/9), create a Notion integration and share a tracker database with it, add the demo Google account as an OAuth test user (needed by Phase 10).

### Phase 2: Stateful Mock App Twins
**Goal**: Every app the agent touches has a stateful, credential-free twin behind the same port interface the real connectors will implement, with uniform idempotency lookup and injectable real-shaped faults.
**Depends on**: Phase 1
**Requirements**: APPS-04
**Time budget**: 30 min (1:40-2:10 PM ET), runs in parallel with Phase 3
**Cut candidate**: No
**Success Criteria** (what must be TRUE):
  1. `createConnectors({ mode: 'mock' })` returns Gmail, Calendar, Docs/Drive, Notion, GitHub (read-only), and HF (read-only) ports over a per-run seeded World. `snapshot()`, `reset()`, and `diff()` work, and two concurrently created worlds never share state (vitest).
  2. Every write port exposes `findByKey`, and tests show a keyed item is found after creation and absent before.
  3. `withFaults(port, rules)` injects 429 (with `retryAfterMs`), 500, ghost-write (commit then 500), and latency on any method by rule, surfacing typed `ConnectorError`s. Mocks reject real-API violations (Notion rich text over 2000 chars, malformed all-day dates) with real-shaped errors.
  4. The Gmail port has no send method at the type level. `mode: 'real'` resolves through the same factory, with real implementations reporting "not configured" until Phase 10.
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Wave 1: createWorld(seed) + snapshot/restore/reset/diff + API-shape validators + Notion/Calendar/Docs/Gmail twins with findByKey + GitHub/HF read-only twins
- [x] 02-02-PLAN.md — Wave 2 (imports 02-01 twins): withFaults (429/500/ghost-write/lying-success/latency, seeded) + GitHub/HF fixtures + defaultWorldSeed + real not_configured stubs + createConnectors mode switch + integration tests

### Phase 3: Deterministic Gap Analysis
**Goal**: A student gets a correct, reproducible per-school gap report and feasibility warnings computed from profile plus dataset, with no LLM involved.
**Depends on**: Phase 1
**Requirements**: GAP-01, GAP-02
**Time budget**: 25 min (1:40-2:05 PM ET), runs in parallel with Phase 2
**Cut candidate**: No
**Success Criteria** (what must be TRUE):
  1. For the demo profile, each school+program report shows GPA vs program minimum and competitive GPA, units vs required, each prereq as `met` / `missing` / `unknown-equivalency`, essays and recs needed, and days to deadline. Output is identical across runs (snapshot test).
  2. A quarter-unit profile compared against a semester-unit requirement produces the correctly converted comparison (unit test).
  3. Feasibility warnings appear for GPA below a program-specific minimum (the Cornell 3.5 case), missing prereqs vs terms remaining before the deadline, and the fictional school with no transfer program.
  4. Every finding references a requirement id that exists in `schools.json`. No number appears in the report that is absent from the dataset or profile.
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md: core/gap/** analyzeGaps (GPA with competitive fallback, semester/quarter units, met/missing/unknown-equivalency prereqs, essays/recs, next deadline) + stable-code feasibility warnings + table/snapshot/integrity tests

### Phase 4: Sprint Pipeline on Mocks
**Goal**: The hero sprint runs end-to-end in the terminal on mocks with a scripted FakeLLM. It plans, gates on approval, executes with idempotency and retries, verifies by reading back real state, and emits a trace. Re-runs create zero duplicates.
**Depends on**: Phase 2, Phase 3
**Requirements**: AGENT-01, AGENT-03, AGENT-05, AGENT-06, APPS-01, APPS-02, APPS-03, APPS-06
**Time budget**: 45 min (2:10-2:55 PM ET)
**Cut candidate**: No
**Success Criteria** (what must be TRUE):
  1. `tsx scripts/record.ts` prints a dry-run plan (app, operation, payload, idempotency key) for the demo profile and executes only the approved action ids. An unknown id or a tampered plan token (HMAC) is rejected before any write.
  2. After one approved run, the mock world holds:
     - exactly one Notion tracker row per school+program (deadline, required docs, recs, essay status, gap count, status);
     - Calendar events for the deadline, T-30/T-14/T-3 reminders, and the rec-request date, with none in the past;
     - Gmail drafts for the admissions rep, professor rec request, and CC advisor check;
     - zero sent messages.
     A second run reports every action `deduped` and all counts are unchanged.
  3. With 429 and ghost-write 500 faults injected, the executor backs off and re-checks `findByKey` before each retry. It creates no duplicates, and when retries run out it reports an integration failure instead of a silent success.
  4. The RunReport marks each artifact verified or failed from read-back of final state, not from intent. Tool arguments are zod-validated with a repair retry, and a hard step cap stops runaway loops.
  5. Each run writes a structured JSONL trace (tool, args, result, latency, verification). Student name, email, and GPA are redacted in the exported file.
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Wave 1: agent contracts + UI trace vocabulary, tracer SpanControl, idempotency keys, 4 write tools registry, FakeLLM slot + repair, deterministic planner (23 actions for demo), policy gate (HMAC token bound to recipient allowlist, approved ids, no-send)
- [x] 04-02-PLAN.md — Wave 2: withRetry (retry-after/backoff/caps) + step budget + loop guard, executor (topo order, findByKey before write and retry, ghost-write recovery, action.execute spans), verifier read-back (verify.readback, lying success = mismatch) + RunReport
- [x] 04-03-PLAN.md — Wave 3: PII redaction + JSONL, planSprint/executeSprint + HeroRunFile recording contract, e2e reliability scenarios, scripts/sprint.ts CLI (npm run record) writing static/traces/demo-sprint.jsonl + static/data/hero-run.json

### Phase 5: Essay Critique, Evidence Grounding & Injection Guard
**Goal**: The sprint reads only the specified essay Doc and writes a critique Doc that is grounded in evidence and follows the school's AI policy. Instructions injected into docs or emails are flagged and cannot change the plan.
**Depends on**: Phase 4
**Requirements**: ESSAY-01, ESSAY-02, ESSAY-03, ESSAY-04, AGENT-04, GAP-03, PORT-04
**Time budget**: 30 min (2:55-3:25 PM ET)
**Cut candidate**: No (PORT-04 section can be deferred into Phase 10 under the overrun rule)
**Success Criteria** (what must be TRUE):
  1. The sprint reads the essay by the specified doc id only (the trace shows no other doc reads). A missing or empty essay doc surfaces as a blocker in the report instead of producing a critique.
  2. The critique Doc in mock Docs scores the essay against the school's actual transfer prompt: why transfer, why this school, academic trajectory, evidence, and word count vs limit. It is written as questions and comments with no rewritten prose, and it includes an "evidence you're not using yet" section that maps seeded GitHub/HF items to the prompt.
  3. For a `grammar_only` school the critique is restricted to mechanics and shows a visible policy note. `feedback_ok` and `brainstorm_ok` schools get correspondingly deeper coaching.
  4. A claim validator rejects any claim in the critique or outreach drafts without an evidence reference to the profile or portfolio. A test with an invented achievement shows the rejection.
  5. With injection text in the essay doc and an inbox email, the executed actions and recipients exactly match the approved plan and the recipient allowlist, and the injection is flagged in the report and trace. The gap report's LLM-phrased next actions leave the deterministic findings byte-identical.
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md — Wave 1: pure critique/grounding core: essay analysis (words/chars vs limit, prompt coverage), evidence catalog + evidence-you-are-not-using mapping, strict EssayCritique slot schema (no prose field), ai_policy restriction + policy note, critique Doc renderer, claim/quote/achievement/foreign-email validator, untrusted wrapper + injection detector, guarded LLM-phrased gap next actions, scripted FakeLLM responders
- [ ] 05-02-PLAN.md — Wave 2: wire into the sprint: gatherPlanningContext (read essay doc by id only, inbox scan, portfolio evidence, injection flags), buildCritiqueDoc on the grounded slot, minimal planner/planSprint/PlanResult/FakeLLM edits, end-to-end containment tests (injected doc + email, hallucinating and injection-obeying LLM, missing/empty essay, next-actions immutability), re-recorded hero run

### Phase 6: Eval Harness & Real Pass Rates
**Goal**: We can prove reliability. Eight or more seeded adversarial scenarios run N times against mocks, are graded by an independent final-state oracle, classified with Lemma's taxonomy, and written to a committed JSON artifact.
**Depends on**: Phase 5
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05
**Time budget**: 40 min (3:25-4:05 PM ET)
**Cut candidate**: No (never cut)
**Success Criteria** (what must be TRUE):
  1. `npm run eval -- --n 10 --llm fake` runs 8 or more scenarios in a few minutes and writes `static/data/evals.json`. Scenarios: happy path, existing duplicate tracker row, same-day/changed deadlines, missing/empty essay doc, Notion/Calendar 429/500 including ghost-write, injection in doc and in email, no transfer program, GPA below program minimum, quarter vs semester units, essay over word limit. The JSON has pass rate and pass^k per scenario, failure classes, run count, model, commit SHA, and timestamp.
  2. The oracle asserts final world state and a collateral-damage diff by reading the World directly, never the agent's verifier or report. A deliberately weakened config (verifier off or a "lying API" mock) produces a caught silent failure, saved as a replayable trace.
  3. Every failed run carries a primary Lemma taxonomy label (skipped work, out-of-scope work, instruction violation, integration failure, retry loop, hallucination, communication failure), and the report shows the breakdown.
  4. The deterministic scripted-policy baseline runs the full suite with no LLM key. The runner accepts `--llm ollama|hosted` so LLM-backed runs appear as separate columns.
  5. A markdown results table for BRIEF.md is generated from the same results file.
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — 19 data-driven adversarial scenarios + seeded per-run World setup + verifier-on/off agent adapter + independent final-state oracle + Lemma taxonomy classifier (wave 1)
- [ ] 06-02-PLAN.md — N-run runner with pass rate/pass^k + EvalsFile/SilentFailureRun contracts + scripts/eval.ts (no-key scripted baseline, --llm hook) + committed evals.json, silent-failure replay, BRIEF tables (wave 2)

### Phase 7: Sprint UI, Eval Dashboard & Static Showcase
**Goal**: A judge can open the public GitHub Pages or HF site, walk through the sprint (profile, gap report, plan approval, step trace, verified artifacts), and see real eval numbers with a caught silent failure.
**Depends on**: Phase 4 (sprint page), Phase 6 (dashboard data). The sprint-page plan may start once Phase 4 traces exist.
**Requirements**: UI-01, UI-02, DATA-03
**Time budget**: 45 min (4:05-4:50 PM ET)
**Cut candidate**: No (never cut; styling polish is the only compressible part)
**Success Criteria** (what must be TRUE):
  1. User can load the seeded demo profile or edit the profile form, with schema validation errors shown inline. The resulting gap report shows a "verify on official page" link and retrieved date next to every requirement.
  2. User sees the plan as human-readable action cards (app, operation, target, payload preview, new vs exists), can approve all or individual actions, then watches a step timeline with status chips end in a verified-artifacts panel.
  3. The eval dashboard shows per-scenario pass rate over N, pass^k, the taxonomy breakdown, and a replay of the caught silent-failure trace.
  4. The static build is live at https://wolfwdavid.github.io/multi-app-agent/ (correct base path, `.nojekyll`) and on the HF static Space. It loads `evals.json` and a recorded hero trace labeled "recorded run", and every link navigates correctly.
**Plans**: 3 plans

Plans:
- [ ] 07-01-PLAN.md — Wave 1: UI-SPEC tokens + shell (header, mode detection, replay banner, base/trailingSlash) + tested lib/ui modules (status, format, provenance, profile-form, data, mode) + profile panel with inline zod errors + gap report cards with verify link, retrieved date, confidence
- [ ] 07-02-PLAN.md — Wave 2: tested adapters (trace-rows, pacer, ReplaySource, evals/silent-failure) + plan approval cards, paced trace timeline, verified artifacts panel + eval dashboard (stat cards, per-scenario table, 7-class taxonomy, caught silent-failure step-through)
- [ ] 07-03-PLAN.md — Wave 3: zero-dependency static smoke tool + scripts/deploy-hf.sh (manual, local HF token) + Pages workflow check/smoke steps + publish checkpoint + live smoke of Pages and HF static Space

### Phase 8: Real LLM Slots
**Goal**: The same pipeline runs on a real OpenAI-compatible LLM: local Ollama (qwen3.5:4b, think off) or a hosted fallback chosen by env. Every output is schema-validated, and LLM variance is measured separately from harness reliability.
**Depends on**: Phase 6
**Requirements**: AGENT-02
**Time budget**: 20 min (4:50-5:10 PM ET)
**Cut candidate**: No (if no hosted key exists, ship Ollama-local results only and note it in BRIEF)
**Success Criteria** (what must be TRUE):
  1. Setting `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` switches between local Ollama and the hosted provider with no code change. The hero sprint completes locally on qwen3.5:4b with think off.
  2. Every LLM slot output passes zod or goes through a visible repair retry. Output that is still invalid fails the step with a classification and never reaches a connector, and think tags never appear in written artifacts.
  3. `evals.json` and the dashboard show an LLM-backed column (N=3-5, model named) alongside the scripted baseline.
  4. The health check (CLI or `/api/health`) reports which LLM is configured and whether it is reachable.
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Wave 1: llm/common.ts (LLMError kinds, messages+repair turn, think/fence strip, key redaction) + llm/ollama.ts (native /api/chat, format=zod JSON schema, think:false, temp 0, seed, keep_alive, num_ctx, timeout) + llm/openai-compat.ts (lazy openai SDK, strict json_schema → json_object fallback), offline tests
- [x] 08-02-PLAN.md — Wave 2: llm/select.ts (resolveLlmConfig(env), per-slot routing coder:7b grounding / qwen3.5:4b phrasing / hosted LLM_MODEL, createLLM, probeLlm, --llm eval contract + llmRunMeta) + llm/index.ts + scripts/llm-smoke.ts live smoke (+ opt-in --sprint)

### Phase 9: Live Backend on Vercel & REST API
**Goal**: Anyone can run a live mock-mode sprint at the Vercel URL. Approval is enforced on the server, the trace streams live, and all three deploy targets are up.
**Depends on**: Phase 7, Phase 8
**Requirements**: API-01, SHIP-01
**Time budget**: 25 min (5:10-5:35 PM ET)
**Cut candidate**: Late-stage only (last resort: static replay stands in for the live demo)
**Success Criteria** (what must be TRUE):
  1. `POST /api/plan` returns a plan and a signed planToken. `POST /api/execute` with approvedIds streams trace events over SSE and ends with the report and world snapshot. An eval-results endpoint returns `evals.json`.
  2. A curl call to execute with a tampered plan or an unapproved id is rejected (403/409) and writes nothing.
  3. The Vercel production URL runs the hero sprint in mock mode on the hosted LLM within `maxDuration`. Re-running with the returned world snapshot shows every action deduped.
  4. Pages, the HF Space, and Vercel all load and navigate. The public deploy defaults to mock mode, and a grep of the client build output finds no secrets.
**Plans**: 2 plans

Plans:
- [ ] 09-01-PLAN.md — Wave 1: lib/server glue (per-request mock World, real-mode key gate, LLM resolve) + POST /api/plan, POST /api/execute (NDJSON stream via fetch POST, pre-stream 403/409 policy rejection), GET /api/evals + Request-object handler tests + both builds
- [ ] 09-02-PLAN.md — Wave 2: LiveSource wired into Phase 7 live mode, api-smoke.ts (approval-bypass checks), client secret scan, vercel-smoke.sh deploy (optional live verify; Deployment Protection left to user), LIVE_URL if public

### Phase 10: Real External Apps
**Goal**: The agent works against real apps behind the same ports: live GitHub and HF portfolio evidence, a real Notion tracker, at least one real Google app, and optionally a local Obsidian vault.
**Depends on**: Phase 5 (runs in parallel with Phase 11; hard stop 6:15 PM ET)
**Requirements**: PORT-01, PORT-02, PORT-03, APPS-05
**Time budget**: 25 min (5:35-6:00 PM ET, hard stop 6:15)
**Cut candidate**: **YES.** Credential-blocked and highest risk. Internal cut order: Obsidian, then Google, then Notion, then HF, then GitHub. Protect GitHub + HF + Notion for the 3-real-apps requirement.
**Success Criteria** (what must be TRUE):
  1. Given a GitHub username, the sprint pulls public repos (name, description, stars, languages, recent activity) live. Given an HF username, it pulls public models and Spaces. Both feed the critique's evidence section.
  2. With a Notion token and a shared database configured in env, the sprint upserts a real tracker row. A re-run creates no duplicate, confirmed by read-back and captured as recorded evidence.
  3. With a Google refresh token in env, at least one Google app (Calendar event, Gmail draft, or critique Doc) is written and read back. Missing or expired credentials show up loudly in the health check, never as silent success.
  4. (First to cut) Pointing the agent at a local Obsidian vault folder yields note tags and frontmatter as optional portfolio evidence.
**Plans**: 3 plans

Plans:
- [x] 10-01-PLAN.md — Wave 1: live GitHub + HF read ports (fetch, timeout, typed errors) + real/index.ts rewire with Notion/Google contract stubs + /api/health status/probes + smoke-real.ts + Obsidian vault reader (first cut)
- [x] 10-02-PLAN.md — Wave 2: real Notion on 2025-09-03 data sources (TP Key upsert, 350ms pacing, error mapping, schema probe) + notion-setup.ts (--apply, --roundtrip) (parallel with 10-03)
- [ ] 10-03-PLAN.md — Wave 2: Google refresh-token auth + google-auth.ts loopback consent + real Calendar (base32hex ids) first, then Gmail drafts + Docs (cut if past time box) + google-smoke.ts

### Phase 11: MCP Server
**Goal**: A VS Code user can call the agent's tools through a custom MCP stdio server generated from the same tool registry the agent and evals use.
**Depends on**: Phase 5 (runs in parallel with Phase 10; hard stop 6:15 PM ET)
**Requirements**: MCP-01
**Time budget**: 15 min (5:35-5:50 PM ET)
**Cut candidate**: **YES** (cut after real Google)
**Success Criteria** (what must be TRUE):
  1. VS Code lists `gap_analysis`, `critique_essay`, `plan_sprint`, and `run_sprint` from the stdio server, with input schemas generated from the registry.
  2. Calling `gap_analysis` returns the same report as the CLI for the demo profile. `run_sprint` runs in mock mode and refuses to write without a valid plan token and approved ids.
  3. The server survives a full client session with no stdout parse errors, because all logging goes to stderr.
**Plans**: 1 plan

Plans:
- [ ] 11-01-PLAN.md — Wave 1: core/mcp agent tools (gap_analysis, critique_essay, plan_sprint, run_sprint w/ planToken + approvedIds, mock default) on @modelcontextprotocol/server v2 + in-memory JSON-RPC test + scripts/mcp.ts (serveStdio, stderr-only logs) + spawned stdio handshake test + .vscode/mcp.json + README snippet

### Phase 12: Brief, README & Demo
**Goal**: The submission is complete. Judges can read how the system works and how we know it works, run it themselves, and watch a 2-minute demo showing a caught failure and an idempotent re-run.
**Depends on**: Phase 9 (plus whatever of Phases 10-11 landed by 6:15 PM ET)
**Requirements**: SHIP-02, SHIP-03
**Time budget**: 45 min (6:15-7:00 PM ET, includes 15 min submission slack; starts at 6:15 at the latest)
**Cut candidate**: No (never cut)
**Success Criteria** (what must be TRUE):
  1. BRIEF.md covers architecture, reliability measures (approval gate, idempotency keys, retries, read-back, injection containment), real numbers from the final `evals.json` (scripted and LLM columns, N, model, commit SHA), ethics and privacy handling, and known limitations including anything cut.
  2. README gives run instructions (local dev, eval CLI, MCP if shipped, env vars) that work from a clean checkout.
  3. The 2-minute demo script shows the sprint, a caught silent failure, and an idempotent re-run, and the demo is recorded.
  4. The final eval run is committed, the static showcase is redeployed with final numbers, a secret scan of the repo and build output is clean, and the submission goes in before 7:00 PM ET.
**Plans**: 2 plans

Plans:
- [ ] 12-01-PLAN.md — Wave 1: verified facts (clean-clone test/check, eval reproduction at HEAD, smoke-real counts, URL codes, secret scan of repo/history/build) + BRIEF.md and README.md with every TODO replaced by real numbers or honest cut rows, committed locally
- [ ] 12-02-PLAN.md — Wave 1 (parallel; push gated on the 12-01 commit): DEMO.md 2:00 shooting script + pre-flight, SUBMISSION.md, human recording checkpoint, then trailer strip + push + Pages/HF redeploy + public URL checks

## Progress

**Execution Order:**
Phases execute in numeric order, with parallel waves: 1 → (2 ‖ 3) → 4 → 5 → 6 → 7 → 8 → 9 → (10 ‖ 11) → 12

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Contracts, Seed Data & Build Smoke | 0/3 | Complete    | 2026-09-13 |
| 2. Stateful Mock App Twins | 0/2 | Complete    | 2026-09-13 |
| 3. Deterministic Gap Analysis | 0/1 | Complete    | 2026-09-13 |
| 4. Sprint Pipeline on Mocks | 0/3 | Complete    | 2026-09-13 |
| 5. Essay Critique, Evidence Grounding & Injection Guard | 1/2 | In Progress | - |
| 6. Eval Harness & Real Pass Rates | 0/3 | Not started | - |
| 7. Sprint UI, Eval Dashboard & Static Showcase | 0/3 | Not started | - |
| 8. Real LLM Slots | 0/1 | Not started | - |
| 9. Live Backend on Vercel & REST API | 0/2 | Not started | - |
| 10. Real External Apps | 2/3 | In Progress|  |
| 11. MCP Server | 0/1 | Not started | - |
| 12. Brief, README & Demo | 0/2 | Not started | - |

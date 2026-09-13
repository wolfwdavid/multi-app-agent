# Project Research Summary

**Project:** TransferPilot (Multi-App AI Agent Hackathon)
**Domain:** Reliable multi-app action agent (college-transfer "application sprint") with in-memory app copies, an approval gate, MCP, and evals that check final app state
**Researched:** 2026-09-13
**Confidence:** MEDIUM-HIGH

## Executive Summary

TransferPilot is a workflow agent, not a chatbot. Existing tools each cover one piece:
- Transferology and ASSIST look up requirements.
- CollegeVine chats about essays.
- Notion, Calendar and Gmail get managed by hand.

Nothing turns "my profile plus these schools" into checked results inside the student's own apps.

The build follows the tau-bench and AppWorld pattern:
- **Code controls the steps.** The model only fills schema-checked blanks: the critique, email text and action wording.
- **Every write is safe to repeat.** It needs approval, carries a dedupe key, and is read back afterwards.
- **Evals check the apps, not the agent.** They look at final app state and never trust what the agent says it did.

**Recommended layout:**
- **One SvelteKit app** (`web/`).
- **Core with no SvelteKit imports** in `web/src/lib/core/`, shared by the UI routes, a `tsx` eval CLI and an MCP stdio server.
- **Mock-first.** In-memory stateful copies of Gmail, Calendar, Docs, Notion, GitHub and HF sit behind the same interfaces as the real connectors. A `withFaults()` wrapper injects errors.
- **Gap analysis in plain TypeScript**, not model output.
- **Evals right after the first end-to-end mock run** (they are 25% of the score). They come before UI polish or real connectors, so Pages and HF show real pass rates by about hour 4.

**Main risks:**
- Small local models are slow (10-56 s per call) and poor at picking tools on their own.
- Wide scope: 4 apps to write to, 3 evidence sources, MCP and 3 deploy targets.
- Google OAuth setup can eat an hour.
- Vercel functions keep no state between requests.

**Mitigations:**
- Force model output into a JSON schema and check it with zod.
- Agree the cut list now.
- Give real Google 45 minutes, then fall back.
- Sign the plan and pass it between requests.
- Create a fresh mock world for each request.
- Keep a recorded-trace replay for the demo.

## Key Findings

### Recommended Stack (details: STACK.md)

Keep the existing scaffold: SvelteKit 2, Svelte 5, Vite 8, Tailwind 4 and vitest 4 (stay on 4). Add `adapter-vercel` and pick the adapter from `process.env.VERCEL`. No agent framework, no monorepo.

- **LLM client:** a small `completeJSON(schema, messages)` with two backends.
  - **Local:** Ollama native `/api/chat` with `format: <JSON schema>`, `think:false`, temperature 0 and a fixed seed. This is the path the bake-off tested.
  - **Hosted:** `openai` 7.15.0 (Chat Completions, `response_format`) against Groq `openai/gpt-oss-20b`.
  - Both re-check output with zod and allow one repair retry. No native `tools` with small models.
- **zod 4.6.4** is the single source for schemas: model schemas via `z.toJSONSchema`, runtime checks, and MCP `registerTool`.
- **MCP:** `@modelcontextprotocol/server` 2.0.0 over stdio only. Give it 20 minutes, then fall back to `@modelcontextprotocol/sdk@1.30.0`. MCP over HTTP on Vercel is a stretch goal.
- **Connectors:**
  - **Google:** `google-auth-library` 11 plus the per-API `@googleapis/*` packages.
  - **Notion:** `@notionhq/client` 5.26 on the data sources API (`dataSources.query`, `parent: {data_source_id}`). Examples using `databases.query` are out of date.
  - **GitHub and HF:** plain `fetch`.
  - **Obsidian:** `node:fs` plus `gray-matter`.
- **Scripts** run with `tsx --env-file`. The custom eval runner writes `static/data/evals.json` and `static/traces/*.jsonl`. vitest is only for tests with fixed outcomes.
- **Vercel:** Node 22 or later (openai v7 requires it). Set `maxDuration`; Fluid compute allows 300 s on Hobby.

### Expected Features (details: FEATURES.md)

**Must have:**
- **T2 school data:** hand-curated `schools.json` with 4 real schools (Berkeley, Cornell, Michigan, UVA) plus 1 fictional school with no transfer program. Keyed by school and program; every fact has `source_url` and `retrieved_at`.
- **T1 profile:** includes a seeded demo profile.
- **T3 gap analysis:** plain TypeScript; each prereq is `met`, `missing` or `unknown-equivalency`, with D7 feasibility warnings on top.
- **T4 Notion:** tracker rows updated in place, never duplicated.
- **T5 Calendar:** all-day deadline events plus reminders.
- **T6 essay critique:** written against the school's actual prompt as questions and a rubric in a Doc. Never rewrites the essay.
- **T7 Gmail:** drafts only.
- **T8 approval:** plan preview plus an approval gate.
- **T9 sources:** a source link on each requirement and a note that data may be out of date.

**Differentiators (weighted by the judges):**
- **D1** Read back every write.
- **D2** Adversarial scenarios run N times, reported as pass^k (every run passes).
- **D6** Failure labels using Lemma's categories, plus one demoed failure the agent reported as a success but the checks caught (an API that says OK but saves nothing).
- **D8** Re-running creates zero duplicates.
- **D3** Every critique claim must cite evidence from a fixed list: `claims[]{text, evidence_ref}`.
- **D5** Per-school AI-policy mode: grammar only (Cornell) vs brainstorming allowed (Michigan).
- **D4** GitHub and HF portfolio evidence.

**Anti-features (enforced in code and evals):**
- Writing the essay for the student.
- Invented achievements.
- Auto-send: the Gmail interface has no `send()` and the send scope is never requested.
- Admission-odds scores.
- Live scraping.
- A full course-equivalency engine.
- Reading the whole inbox or Drive.
- Publishing real personal data in traces.

**Defer:** MCP over HTTP, College Scorecard, Obsidian, multi-user, financial-aid deadlines.

### Architecture Approach (details: ARCHITECTURE.md)

The core runs one pipeline:
- **`planSprint`** reads trusted seed data and untrusted doc, email and repo text. It fills the model's blanks and returns a typed `Plan`.
  - Each action in the plan has a dedupe key.
  - The plan is signed with `planToken = HMAC(plan)`.
- **`executePlan(plan, token, approvedIds)`** runs only the approved actions.
- **Why this contains prompt injection:** the list of possible actions is fixed before untrusted text can touch it.

**Components:**
1. **`schemas.ts` and `tools/registry.ts`.** Zod contracts, the single source for the executor, the UI plan preview and MCP.
2. **`connectors/{mock,real}`.** Small interfaces; every write interface has `findByKey`.
   - The mock `World` comes from `createWorld(seed)` on every run, never a shared module-level object.
   - `withFaults` injects 429s, 500s, latency, a write that saves but then returns 500, and expired auth.
3. **`agent/{planner,policy,executor,verifier}`.**
   - The executor runs actions in dependency order and looks up the key before each write and each retry.
   - It makes at most 3 attempts, only on 429 or 5xx, and has step and loop limits.
   - The verifier builds the `RunReport` from what is actually in the apps.
4. **`trace/`.** Events in OpenTelemetry style, sent to memory, a stream or a JSONL file. Streaming is NDJSON over a `fetch` POST; the last event carries the full trace and world snapshot.
5. **`eval/`.** Each scenario is seed data plus faults plus expectations.
   - An independent checker reads `World` directly: goal state, unintended changes, grounding, and whether the report matches reality.
   - A rule-based failure classifier labels each failure.
   - A runner repeats each scenario N times.
6. **Entry points.** SvelteKit `/api/plan`, `/api/execute`, `/api/health`; plus `scripts/eval.ts`, `scripts/record.ts`, `scripts/mcp.ts`.

**Where each app stores the dedupe key:**

| App | Marker | Lookup |
|---|---|---|
| Notion | `TP Key` property | Data-source filter |
| Calendar | Event `id` = hex sha256 (valid base32hex), plus `extendedProperties.private.tpKey` | Private extended property |
| Docs | Drive `appProperties.tpKey` | Drive query |
| Gmail | `[tp:<key>]` token in the draft | Scan drafts |

### Critical Pitfalls (details: PITFALLS.md)

1. **Scope creep.**
   - **Checkpoints (ET):** 2:30 PM first end-to-end mock run with read-back; 4:00 PM eval numbers; 5:30 PM deploy frozen; 6:15 PM video and BRIEF done.
   - **Cut in this order:** Obsidian, HF, GitHub evidence, MCP over HTTP, real Docs, real Gmail, dashboard polish.
   - **Never cut:** the mock end-to-end flow, repeated state-checking evals, the approval gate, BRIEF numbers, the recorded video.
2. **Small models are slow and unreliable.**
   - Code drives the workflow; each step exposes only 2-4 narrow blanks.
   - JSON-schema output checked with zod, at most 2 repairs.
   - A hash of repeated calls stops loops.
   - Keep the model warm (`keep_alive`) and set `num_ctx` explicitly.
3. **Evals that trust the agent, or mocks looser than the real APIs.**
   - The checker reads state.
   - Mocks enforce real rules: Notion rich text of 2000 characters or less, Calendar all-day `date` with an exclusive end, typed errors.
   - Include an "API says OK but saves nothing" scenario.
4. **Duplicate writes.** The dedupe marker lives in the target app, and retries check for the item first. Include re-run and "saved, then returned 500" scenarios.
5. **Approval bypass and prompt injection.**
   - The executor itself checks the signed plan and approved IDs, not just the UI.
   - Email recipients come only from an allowlist built from the profile and dataset.
   - Untrusted text is clearly marked as data.

**Also watch:**
- **Google:** `gmail.compose` is a restricted scope, so the app stays in Testing mode and refresh tokens expire after 7 days. Use `access_type=offline&prompt=consent` in a local script.
- **Notion:** share the database with the integration or the API returns 404. At most 3 requests per second, one at a time.
- **Pages:** needs `paths.base=/multi-app-agent` and `.nojekyll`. HF and Vercel use base `''`.
- **MCP stdio:** a single `console.log` breaks it.
- **Windows:** paths with spaces, CRLF line endings (add `.gitattributes`), and import filename case (the Linux build is case-sensitive).
- **Dates:** store deadlines as `YYYY-MM-DD` plus a time zone.

## Reconciled Decisions (where research files disagreed)

| Topic | Conflict | Decision |
|---|---|---|
| Which model runs evals | STACK: run the repeated evals on local Ollama. PROJECT: use the hosted model. Bake-off: local calls take 10-56 s. | **Large runs (N=10-20) use a scripted fake model (FakeLLM).** They test the harness, dedupe, verification, faults and injection containment. **A small real-model column (N=3-5 over 3-4 scenarios) is reported separately**, using qwen2.5-coder:7b for grounding-critical steps, or Groq if a key exists. |
| Model per step | PROJECT: qwen3.5:4b. Bake-off: 4b grounded claims wrongly (33 s); coder:7b got them right (56 s). | **qwen2.5-coder:7b** for claim/evidence grounding. qwen3.5:4b (thinking off, ~10 s) for name cleanup and short wording. Deployed: Groq gpt-oss-20b. |
| MCP SDK | STACK: v2 2.0.0. ARCH: v1 1.30.0 (more examples). | **v2 `@modelcontextprotocol/server` over stdio.** Fall back to v1 1.30.0 after 20 minutes. |
| Structured output | STACK: `openai` SDK with tools. PITFALLS: don't use native tools. | JSON-schema-constrained blanks: Ollama `format` locally, `response_format` through the openai SDK when hosted. |
| Notion query | ARCH: `databases.query`. STACK and PITFALLS: data sources. | v5 `dataSources.query`. |
| Google Docs scope | STACK: `drive.readonly`. PITFALLS: `documents` plus a pasted Doc ID. | `documents` + `drive.file` + `calendar.events` + `gmail.compose`. The user pastes the essay Doc ID, so the agent never reads their whole Drive. |
| Demo | none | Default to mock mode. Warm the model first. Keep a recorded-trace replay as fallback, plus one real-mode clip as evidence. |

## Implications for Roadmap

1. **Foundation and contracts:** zod schemas; `schools.json` built from `seed-schools.json` plus 2 prompt-injection fixtures; adapter switch plus `/api/health` with both builds passing; `.gitattributes`, `.env.example`. Human tasks in parallel: Google test user, Notion database shared with the integration, Groq key.
2. **Mock world and connectors:** interfaces, `createWorld(seed)`, snapshot and diff, stateful mock apps with real API limits and typed errors, `withFaults`, dedupe keys and `findByKey`, vitest tests.
3. **Sprint pipeline (first end-to-end run):** plain-TypeScript gap analysis; planner, policy, executor, verifier; tracer and FakeLLM; a re-run shows `deduped`.
4. **Eval harness:** 8 adversarial scenarios, independent checker, failure classifier, pass rate and pass^k, `evals.json` plus traces, and a `verifier: off` run as the "before" case.
5. **Real LLM steps:** `completeJSON` with both backends; critique with claim checks (D3) and AI-policy mode (D5); outreach wording; small real-model eval column.
6. **UI and static showcase deploy:** profile, plan cards, approve, live trace, final-state panel, eval dashboard, trace replay; Pages and HF deployed by about hour 4.
7. **Vercel live backend:** `/api/plan` and streaming `/api/execute` in mock mode with the hosted model; real mode behind a shared secret.
8. **MCP server (stdio):** tools generated from the registry.
9. **Real connectors and portfolio evidence (cut first):** Notion, then Google (45-minute limit); GitHub and HF public fetch.
10. **BRIEF.md and demo:** real numbers with model, seed and commit SHA; secret scan; 2-minute script and video by 6:15 PM ET.

### Research Flags

- **Phase 1:** check that adapter-static accepts `+server.ts` routes with `prerender=false`, and that base paths work on all 3 targets.
- **Phase 5:** check the openai v7 `response_format` shape with Groq, and whether Groq's limits allow N=3.
- **Phase 8:** MCP v2 is new; check `registerTool` and zod 4 against the type definitions.
- **Phase 9:** check the Calendar private-property filter, the Drive `appProperties` query, Gmail draft marker search, and Notion v5 create-parent types.

## Seed Data (see seed-schools.json, SEED-DATA.md)

- **Common App fraud policy** (verified on commonapp.org) covers "the substantive content or output of an artificial intelligence platform, technology, or algorithm."
- **UC Berkeley Data Science** (College of Computing, Data Science, and Society):
  - Fall 2027 filing Oct 1 – Nov 30, 2026.
  - 60 semester / 90 quarter units, 3.0 GPA.
  - 1 required and 3 of 7 other questions, 350 words each.
  - UC AI statement: AI may assist with readability only.
- **Cornell (ILR, A&S Economics):**
  - Application due Mar 15, other materials Apr 15.
  - 1 instructor recommendation; transfer essay of 250–650 words.
  - Economics prereqs: ECON 1110/1120 and Calculus I.
  - AI tagged grammar-only.
  - A&S supplement prompt: LOW confidence.
- **Michigan LSA:**
  - Fall 2027 due Feb 1, 2027.
  - No published minimum GPA.
  - Essay limits are in characters.
  - AI: brainstorm_ok.
- **UVA A&S** guaranteed admission for Virginia community college (VCCS) students:
  - 3.4 GPA, 45+ credits, associate degree; due Mar 1.
  - AI policy unknown.
- **Northfield Institute of Technology** is fictional, with `has_transfer_program: false`.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions from `npm view` today; MCP v2 exports checked |
| Features | MEDIUM | GAO and official pages solid; AI policies partly secondary |
| Architecture | MEDIUM-HIGH | tau-bench and AppWorld patterns; per-app dedupe markers MEDIUM |
| Pitfalls | MEDIUM-HIGH | Official docs plus our own bake-off |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Real-model eval speed:** a sprint takes about 3 minutes on coder:7b. Cap the real-model column at about 30 minutes of background time.
- **Seed data:** show confidence and source on every field, and label unverified values.
- **Which 3 apps run for real:** decide at the end of Phase 1 based on credentials (default Notion, Calendar, Docs, plus Gmail if OAuth works).
- **Unverified settings:** record Ollama `num_ctx` and seeds in the eval JSON and report the spread.
- **Privacy wording:** say "FERPA-grade handling", never "FERPA compliant".

---
*Research completed: 2026-09-13*
*Ready for roadmap: yes*

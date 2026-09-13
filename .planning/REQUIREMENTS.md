# Requirements: TransferPilot

**Defined:** 2026-09-13
**Core Value:** One end-to-end application sprint (profile + target school → gap analysis → essay critique Doc → Notion tracker + Calendar deadlines → Gmail draft) runs reliably across real apps, and we can *prove* it works with measured evals — not just a happy-path demo.

## v1 Requirements

### Data (seed dataset + profile)

- [x] **DATA-01**: Requirements dataset covers 4 real schools + 1 clearly-labeled fictional adversarial school, keyed by school **and** program (min/competitive GPA, units + semester/quarter system, required courses, GE pattern, essay prompts + word limits, recs, deadlines by term, has_transfer_program, ai_policy)
- [x] **DATA-02**: Every requirement field carries `source_url`, `retrieved_at`, and `confidence`, and the UI shows a "verify on official page" link next to it
- [ ] **DATA-03**: User can load a seeded demo student profile or edit a profile form (current school, major, GPA, units + system, courses, activities, goals, target school+program list), validated by schema

### Gap Analysis

- [x] **GAP-01**: User sees a deterministic per-school gap report: GPA vs program minimum/competitive, units vs required (with semester↔quarter conversion), each prereq marked `met` / `missing` / `unknown-equivalency`, essays and recs needed, days to deadline
- [x] **GAP-02**: User sees feasibility warnings (e.g. missing prereqs vs terms remaining before deadline, GPA below a program-specific minimum, school has no transfer program)
- [x] **GAP-03**: Gap report includes LLM-phrased next actions that never change the deterministic findings

### Essay Coaching

- [x] **ESSAY-01**: Agent reads the student's essay draft from a specified Google Doc (only that doc)
- [x] **ESSAY-02**: Agent writes a critique Doc scored against the school's actual transfer prompt (why transfer, why this school, academic trajectory, evidence, word count vs limit) as questions/comments — never rewritten prose
- [x] **ESSAY-03**: Coaching depth adapts to the school's AI policy (`grammar_only` / `feedback_ok` / `brainstorm_ok`) with a visible policy note
- [x] **ESSAY-04**: Every claim in the critique and outreach drafts references evidence from the profile or portfolio; unsupported claims are rejected by a validator

### Portfolio Evidence

- [x] **PORT-01**: Agent pulls public GitHub repos (name, description, stars, languages, recent activity) for a given username
- [x] **PORT-02**: Agent pulls public Hugging Face models and Spaces for a given username
- [x] **PORT-03**: Agent reads tags/frontmatter from a local Obsidian vault folder (optional source)
- [x] **PORT-04**: Critique surfaces "evidence you're not using yet" mapped to the school's prompt

### App Actions

- [x] **APPS-01**: Agent upserts one Notion tracker row per school+program (deadline, required docs, recs, essay status, gap count, status) — re-runs never create duplicates
- [x] **APPS-02**: Agent creates Google Calendar events for deadlines and reminders (T-30/T-14/T-3, rec-request date), skipping past dates and deduping by deterministic key
- [x] **APPS-03**: Agent creates Gmail **drafts** (admissions rep question, professor rec request, CC advisor prereq check) — no send capability exists; drafts dedupe by tagged subject
- [x] **APPS-04**: Every connector has a stateful mock and a real implementation behind one interface, switchable by config; mock mode fully works without credentials
- [ ] **APPS-05**: Real mode works for Notion and at least one Google app when credentials are provided in env
- [x] **APPS-06**: Connector calls retry with backoff on 429/5xx and surface integration failures instead of silently continuing

### Agent Core & Safety

- [x] **AGENT-01**: Agent runs a multi-step loop (plan → approved actions → execute → verify) with schema-validated tool calls, argument repair retries, and a hard step cap
- [x] **AGENT-02**: Agent works with an OpenAI-compatible LLM: local Ollama (qwen3.5:4b, think off) and a hosted fallback configured by env
- [x] **AGENT-03**: User sees a dry-run plan (app, operation, payload) and approves all or individual actions before any external write
- [x] **AGENT-04**: Content from docs/emails is treated as data; instructions embedded in it (prompt injection) cause no out-of-plan tool calls and are flagged
- [x] **AGENT-05**: After execution, agent reads back each target app and marks each artifact verified/failed based on actual final state
- [x] **AGENT-06**: Every run emits a structured step trace (tool, args, result, latency, verification) with PII redacted in exported artifacts

### Evaluation

- [x] **EVAL-01**: Seeded scenario suite (≥8) including adversarial cases: existing duplicate tracker row, same-day/changed deadlines, missing/empty essay doc, Notion/Calendar 429/500, prompt injection in doc and email, school with no transfer program, GPA below program minimum, quarter vs semester units, essay over word limit
- [x] **EVAL-02**: Eval runner executes each scenario N times against mocks and asserts final app state (not the agent's self-report)
- [x] **EVAL-03**: Failures are classified into Lemma's taxonomy (skipped work, out-of-scope work, instruction violation, integration failure, retry loop, hallucination, communication failure)
- [x] **EVAL-04**: Eval results (pass rate per scenario, failure classes, run count, model) are written to a JSON artifact consumed by the UI and BRIEF.md
- [x] **EVAL-05**: A deterministic scripted-policy baseline runs the suite with no LLM key, alongside LLM-backed runs

### Interfaces

- [ ] **UI-01**: SvelteKit UI flow: profile → gap report → plan approval → live step trace → verified artifacts
- [ ] **UI-02**: Eval dashboard page shows pass rates, failure taxonomy breakdown, and a replayable trace of a caught silent failure
- [ ] **API-01**: REST API endpoints to start a sprint, approve a plan, stream trace events, and fetch eval results
- [x] **MCP-01**: Custom MCP server exposes `gap_analysis`, `critique_essay`, `plan_sprint`, and `run_sprint` tools reusing the same tool registry, usable from VS Code

### Ship

- [ ] **SHIP-01**: Live app deployed on Vercel (server routes hold secrets); static showcase (eval dashboard + recorded traces) on GitHub Pages and the HF static Space
- [ ] **SHIP-02**: BRIEF.md system & reliability brief with architecture, reliability measures, real eval numbers, ethics/privacy handling, known limitations
- [ ] **SHIP-03**: README with run instructions and a 2-minute demo script that includes a caught failure and an idempotent re-run

## v2 Requirements

### Enrichment

- **ENRCH-01**: College Scorecard enrichment (size, in-state tuition, admit rate) pre-cached into seed data
- **ENRCH-02**: Financial-aid / scholarship deadlines for transfer students

### Scale

- **SCALE-01**: Course-equivalency integration (Transferology / ASSIST partnerships)
- **SCALE-02**: Multi-user accounts with secure profile storage
- **SCALE-03**: Arga Labs twin-backed test mode alongside in-repo mocks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Ghostwriting / "rewrite my essay" | Common App fraud policy covers AI-generated substantive content; several schools bar AI drafting |
| Inventing or embellishing achievements | Fraud risk; counted as hallucination failure |
| Auto-sending email / submitting applications | Irreversible, instruction-violation risk — drafts + approval only |
| Admission chancing / % odds | No reliable transfer-admit data; false precision misleads |
| Live scraping school sites / ASSIST.org | Brittle, non-deterministic, breaks evals — curated seed data instead |
| Full course-articulation engine | Multi-year dataset problem; mark unknown-equivalency and draft advisor email |
| Reading whole inbox/Drive | Privacy and prompt-injection surface — only specified doc/threads |
| Chatbot-first UI | Hides the plan and makes reliability invisible |
| Write connectors for Obsidian/GitHub/HF/VS Code | Read-only portfolio evidence + MCP access fits the time box |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete (data); UI "verify on official page" link pending Phase 7 |
| DATA-03 | Phase 7 | Pending |
| GAP-01 | Phase 3 | Complete |
| GAP-02 | Phase 3 | Complete |
| GAP-03 | Phase 5 | Complete |
| ESSAY-01 | Phase 5 | Complete |
| ESSAY-02 | Phase 5 | Complete |
| ESSAY-03 | Phase 5 | Complete |
| ESSAY-04 | Phase 5 | Complete |
| PORT-01 | Phase 10 | Complete (live-verified) |
| PORT-02 | Phase 10 | Complete (live-verified) |
| PORT-03 | Phase 10 | Complete (fixture vault) |
| PORT-04 | Phase 5 | Complete |
| APPS-01 | Phase 4 | Complete |
| APPS-02 | Phase 4 | Complete |
| APPS-03 | Phase 4 | Complete |
| APPS-04 | Phase 2 | Complete |
| APPS-05 | Phase 10 | Pending |
| APPS-06 | Phase 4 | Complete |
| AGENT-01 | Phase 4 | Complete |
| AGENT-02 | Phase 8 | Complete |
| AGENT-03 | Phase 4 | Complete |
| AGENT-04 | Phase 5 | Complete |
| AGENT-05 | Phase 4 | Complete |
| AGENT-06 | Phase 4 | Complete |
| EVAL-01 | Phase 6 | Complete |
| EVAL-02 | Phase 6 | Complete |
| EVAL-03 | Phase 6 | Complete |
| EVAL-04 | Phase 6 | Complete |
| EVAL-05 | Phase 6 | Complete |
| UI-01 | Phase 7 | Pending |
| UI-02 | Phase 7 | Pending |
| API-01 | Phase 9 | Pending |
| MCP-01 | Phase 11 | Complete |
| SHIP-01 | Phase 9 | Pending |
| SHIP-02 | Phase 12 | Pending |
| SHIP-03 | Phase 12 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-13*
*Last updated: 2026-09-13 after roadmap creation (traceability filled)*

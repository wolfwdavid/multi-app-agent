# TransferPilot (working name)

## What This Is

An AI agent that helps college transfer applicants — anyone, including the builder — plan a transfer and stand out from other applicants. Given a student profile and target schools, it runs a multi-step "application sprint": finds gaps against each school's transfer requirements, critiques essay drafts, builds a deadline tracker, schedules reminders, and drafts outreach to admissions/advisors — acting across Google Docs/Drive, Notion, Google Calendar, and Gmail, with human approval before any write. Built for the Multi-App AI Agent Hackathon (Sun 2026-09-13).

## Core Value

One end-to-end application sprint (profile + target school → gap analysis → essay critique Doc → Notion tracker + Calendar deadlines → Gmail draft) runs reliably across real apps, and we can *prove* it works with measured evals — not just a happy-path demo.

## Requirements

### Validated

- ✓ Program-level transfer requirements dataset (4 real schools + 1 fictional, 93 sourced fields with source_url/retrieved_at/confidence) — Validated in Phase 1: Contracts, Seed Data & Build Smoke
- ✓ Framework-free core contracts (schemas, connector ports with draft-only Gmail, tool registry, tracer) + dual static/Vercel build — Validated in Phase 1
- ✓ Deterministic per-school gap analysis + feasibility warnings with stable codes, every finding traced to requirement id + source URL — Validated in Phase 3: Deterministic Gap Analysis (LLM-phrased next actions with byte-identical findings, GAP-03, validated in Phase 5)
- ✓ Stateful mock app twins (Notion, Calendar, Docs, Gmail drafts-only, GitHub, HF) with per-run worlds, findByKey dedupe, realistic API validation, seeded fault injection (429/500/ghost-write/lying-success/latency), and a mock/real connector factory — Validated in Phase 2: Stateful Mock App Twins
- ✓ Policy-aware essay critique Doc on mocks (reads only the profile's essay doc id; questions-not-prose scored against the transfer prompt + word limit; grammar_only/feedback_ok/brainstorm_ok depth; "evidence you're not using yet" from GitHub/HF), claim-evidence validator for critique and outreach drafts, and injection in docs/emails flagged but unable to change actions or recipients (ESSAY-01..04, AGENT-04, GAP-03, PORT-04) — Validated in Phase 5: Essay Critique, Evidence Grounding & Injection Guard. Open warnings: grammar_only filter is section-level only; outreach claim check covers achievement words only; UMich critique targets the Common App prompt; no real-LLM run yet

### Active

**Hero flow — application sprint**
- [ ] Student can enter/import a profile (current school, major, GPA, courses, activities, goals) and target schools
- [ ] Agent produces a per-school gap analysis (requirements/prereqs/GPA vs. profile) with concrete actions before the deadline
- [ ] Agent reads an essay draft from Google Docs/Drive and writes a critique against the school's transfer prompt ("why transfer / why us") into a Google Doc
- [ ] Agent pulls portfolio evidence from GitHub and Hugging Face (repos, models, Spaces) and optionally an Obsidian vault to strengthen essays/activities
- [ ] Agent creates/updates a Notion tracker row per school (deadline, required docs, recs, status)
- [ ] Agent creates Google Calendar events for deadlines and reminders
- [ ] Agent drafts (not auto-sends) outreach emails in Gmail to admissions reps/advisors/professors
- [ ] Human approval gate before every external write; dry-run preview of planned actions

**Agent + interfaces**
- [ ] Multi-step agent loop with typed tools (plan → act → verify) using an OpenAI-compatible LLM client: Ollama locally, hosted fallback (Groq/OpenRouter) when deployed
- [ ] Custom MCP server exposing the agent's tools (usable from VS Code / Claude clients)
- [ ] REST API for running the sprint and fetching traces
- [ ] SvelteKit UI: profile input, plan/approval view, live step trace, eval dashboard

**Reliability & evaluation (25% of score)**
- [ ] Stateful in-repo mock apps (Gmail, Calendar, Docs/Drive, Notion, GitHub, HF) with the same interface as real connectors (mock/real mode switch)
- [ ] Seeded scenario suite incl. adversarial cases (duplicate tracker rows, conflicting deadlines, missing essay doc, API 429/500, prompt-injection in an email/doc, school with no transfer program)
- [ ] Evals verify final app state (read-back), not the agent's self-report
- [ ] Idempotent writes (re-run creates no duplicates) + retries with backoff
- [ ] Failures classified with Lemma's taxonomy (skipped work, out-of-scope work, instruction violation, integration failure, retry loop, hallucination, communication failure)
- [ ] Pass rates over N runs per scenario, shown in the UI and in BRIEF.md

**Submission**
- [ ] Deployed: GitHub Pages (static showcase/eval dashboard), HF static Space, Vercel (live backend)
- [ ] BRIEF.md system & reliability brief with real numbers
- [ ] 2-minute demo script

### Out of Scope

- Submitting applications or sending emails without explicit approval — safety/instruction-violation risk; drafts only
- Ghostwriting essays or inventing achievements — coaching and critique only; hallucinated claims are an eval failure
- Guaranteeing admission odds / predictive admissions scoring — no reliable data in the time box
- Scraping every college site — curated seed dataset of a handful of schools' transfer requirements
- Multi-user accounts, auth, payments — single-user hackathon demo
- Full write connectors for Obsidian/GitHub/HF/VS Code — read-only portfolio evidence + MCP access instead

## Context

- **Event:** Multi-App AI Agent Hackathon, virtual, Sun 2026-09-13. Build 9:30 AM–4:00 PM PT (12:30–7:00 PM ET); judging 4:00 PM PT. Project initialized 12:51 PM ET → ~6 hours of build time.
- **Requirements from organizers:** one useful multi-step agent, ≥3 external apps, show how you know it works. Submission = repo + 2-min demo + system & reliability brief.
- **Scoring:** technical execution 30%, reliability & evaluation 25%, usefulness 20%, originality 15%, demo clarity 10%.
- **Judges:** Arga Labs (stateful sandbox "twins" of Gmail/Calendar/Drive/Notion/GitHub for testing multi-app agents), Lemma (host; silent-failure monitoring & failure taxonomy), Userlens (AI customer-success agent), Clera (AI talent agent over Gmail). They reward: seeded adversarial scenarios, final-state verification, trace evidence, pass rates over N runs, showing a caught silent failure.
- **Market evidence:** agent adoption is failing on reliability (Gartner: >40% of agentic projects canceled by 2027; LangChain survey: quality is #1 blocker, only 52% run offline evals).
- **Existing code (scaffold only, created this session — no codebase map needed):** repo https://github.com/wolfwdavid/multi-app-agent; `web/` SvelteKit (Svelte 5 runes, TS, Tailwind v4, adapter-static, vitest) deployed via GitHub Actions to https://wolfwdavid.github.io/multi-app-agent/; HF static Space https://huggingface.co/spaces/WolfDavid/multi-app-agent; placeholder `app.py`, `docs/index.html`, `BRIEF.md` template.
- **Environment:** Windows 11, Node 24, Python 3.11, gh CLI (wolfwdavid), hf CLI (WolfDavid), Vercel CLI logged in, Ollama installed with qwen3.5:4b, llama3.2:3b, qwen2.5-coder:7b. No hosted LLM API keys set yet.
- **Vercel smoke (2026-09-13 13:40 ET):** project `cdw8481-nyuedus-projects/multi-app-agent` linked from `web/`. The remote Linux build is Ready, with the `/api/health` function included. Unauthenticated requests get a 302 to `vercel.com/sso-api` because Deployment Protection (Vercel SSO) is on. For a public live demo the user must disable it, or share a bypass link. `vercel curl` created a protection bypass token but fails on Windows with "URL rejected: Malformed input". Verify from Linux CI or the browser in Phase 9.
- **Local LLM measurements (2026-09-13, OpenAI-compatible tool calls, temp 0):**
  - qwen3.5:4b with thinking on: correct call, 36–45 s.
  - llama3.2:3b: correct call, ~15 s, but did not normalize school names ("UC Berkeley transfer").
  - qwen3.5:4b via native `/api/chat` with `think:false` plus a format system prompt: correct and normalized ("University of California, Berkeley"), ~10 s warm.
  - Implications: the live demo uses qwen3.5:4b with think off. N-run evals use the hosted fallback. A deterministic scripted policy is the no-key baseline. Always normalize and validate tool arguments (zod) regardless of model.

## Constraints

- **Timeline:** Everything must be built, deployed, documented, and demo-ready by 7:00 PM ET — cut scope before cutting evals.
- **Tech stack:** SvelteKit + TypeScript (user choice); agent, connectors, MCP server in TypeScript.
- **Hosting:** GitHub Pages + HF static Space (free HF can't host Gradio/Docker) for showcase; Vercel for secret-holding backend.
- **LLM:** OpenAI-compatible interface; Ollama locally (small models → keep tool schemas tight, validate every call); hosted fallback via env for deploy.
- **Credentials:** Real Google (Gmail/Calendar/Docs/Drive) and Notion connectors require OAuth/integration tokens from the user — mock mode must fully work without them so evals and deploy never block on credentials.
- **Security:** No secrets committed; `.env` local only; Vercel env vars for deploy.
- **Commit hygiene:** No mentions of AI assistants in commit messages or code.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Transfer-applicant agent (user's idea) for anyone incl. builder | Real personal pain, high usefulness, original vs. typical CRM/support agents | — Pending |
| Hero flow = full application sprint with approval gate | Touches all core apps in one demo; approval gate is a reliability story | — Pending |
| Core writes: Google Docs/Drive, Notion, Calendar, Gmail (drafts) | Already familiar APIs; ≥3 apps with margin | — Pending |
| Extras: custom MCP server + REST API; GitHub/HF/Obsidian as read-only portfolio evidence | Honors user's app list without unfinishable full connectors | — Pending |
| In-repo stateful mock apps + real-API mode | Evals run unlimited and credential-free; mirrors Arga's twin approach | — Pending |
| SvelteKit frontend; Vercel backend; Pages + HF static showcase | User choice; secrets can't live on static hosts | — Pending |
| Ollama local + hosted OpenAI-compatible fallback | User choice; Ollama unreachable from Vercel | — Pending |
| GSD: YOLO, fine granularity, plan checker + verifier, quality models | User choice | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-13 after Phase 5 completion*

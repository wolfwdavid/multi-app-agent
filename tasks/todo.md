# Hackathon Plan — Multi-App AI Agent Hackathon (Sun Sept 13, 2026)

Build window: 9:30 AM – 4:00 PM PT (12:30 – 7:00 PM ET). Judging 4:00 PM PT.

Requirements: multi-step agent · ≥3 external apps · proof it works.
Submission: repo · 2-min demo video · system & reliability brief.

## Setup
- [x] Scaffold repo (README, Gradio app stub, landing page, brief template)
- [x] Push to GitHub + enable Pages (`/docs`) — verified 200
- [x] Create HF Space — static (Gradio/Docker Spaces need HF PRO); verified running
- [x] Pick idea — TransferPilot: college transfer applicant agent (gap analysis, essay coaching, Notion tracker, Calendar, Gmail drafts; GitHub/HF/Obsidian evidence; MCP server)
- [x] SvelteKit scaffold in `web/` + Actions deploy to Pages (verified live)
- [x] GSD init: PROJECT.md, config, research (stack/features/architecture/pitfalls), REQUIREMENTS.md (38 v1)
- [ ] GSD roadmap → phase plans → execution (tracked in `.planning/ROADMAP.md` / `STATE.md` from here on)

## Build
- [ ] Agent loop + tool layer
- [ ] App integration 1
- [ ] App integration 2
- [ ] App integration 3
- [ ] Approval gate / dry-run mode

## Prove it works
- [ ] Mock app sandbox + scenario suite
- [ ] Failure injection + retries
- [ ] Eval results table in BRIEF.md

## Ship
- [ ] Landing page + Space final
- [ ] Record 2-min demo
- [ ] Submit

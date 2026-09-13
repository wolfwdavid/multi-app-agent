# Submission: TransferPilot

Build window closes 7:00 PM ET (4:00 PM PT), 2026-09-13; target submitted by 6:45 PM ET.

## Fields

| Field | Value |
|---|---|
| Project name | TransferPilot |
| One-liner | An AI agent that turns a transfer applicant's profile and target schools into verified, approval-gated action across their own apps, with evals proving it works. |
| Repository | https://github.com/wolfwdavid/multi-app-agent (HTTP 200 at 5:10 PM ET) |
| Live showcase (GitHub Pages) | https://wolfwdavid.github.io/multi-app-agent/ (HTTP 200 at 5:10 PM ET; replays a recorded mock-mode run) |
| Eval dashboard | https://wolfwdavid.github.io/multi-app-agent/evals/ (HTTP 200 at 5:10 PM ET) |
| HF Space | https://huggingface.co/spaces/WolfDavid/multi-app-agent (HTTP 200 at 5:10 PM ET) |
| Live backend (Vercel) | not deployed (the Phase 9 live backend was not executed; the Pages and HF showcases replay a recorded run) |
| System & reliability brief | https://github.com/wolfwdavid/multi-app-agent/blob/main/BRIEF.md |
| README | https://github.com/wolfwdavid/multi-app-agent#readme |
| Demo script | https://github.com/wolfwdavid/multi-app-agent/blob/main/DEMO.md |
| Supporting recordings | https://github.com/wolfwdavid/multi-app-agent/tree/main/demo/videos (3:51 reel + 7 scene clips) |
| Demo video | [[USER: video link]] |
| Team | [[USER: team name, members, emails/handles]] |
| Submission destination | [[USER: form URL / platform, or "unknown"]] |
| External apps used | GitHub: live (verified 5:12 PM ET, 30 most recently pushed public repos). Hugging Face: live (verified 5:12 PM ET, 12 models/Spaces). Notion, Google Calendar, Google Docs/Drive, Gmail (drafts only): real connectors built, credential-gated (not live-verified: credentials not configured); exercised through stateful mock twins in the sprint and evals. Obsidian: local vault reader (not configured this session). MCP: stdio server with 4 tools. |

## Copy-paste: short description

TransferPilot is a multi-app agent for college transfer applicants. From a profile and target schools it builds a sourced gap analysis. After per-action human approval, it writes a Notion tracker, Calendar deadlines, Docs and Gmail drafts (it never sends), reads every write back to verify it, and dedupes re-runs. It is also exposed as an MCP server.

## Copy-paste: how we know it works

An independent oracle grades each run from final app state, not the agent's report. 23 seeded scenarios (18 adversarial) x N=10: 87% pass (200/230) with the read-back verifier, 78% (180/230) without it. The remaining failures are three known weaknesses kept failing on purpose. A lying Calendar API that returns OK without saving is caught, and the run reports partial instead of ok. Re-running the sprint writes nothing new (23/23 deduped). A first real-model column (local Ollama, N=1, 2 scenarios) failed 0/2: the agent reported ok after LLM slot failures dropped writes. We report that as an open finding.

## Final checklist

- [ ] docs(12-01) (BRIEF.md, README.md) and docs(12-02) (DEMO.md, SUBMISSION.md) committed
- [ ] Trailers stripped, independent grep clean
- [ ] Pushed
- [ ] Pages deploy run green for HEAD
- [ ] Pages, /evals/ and HF return 200
- [ ] Deployed evals.json commitSha matches the committed one
- [ ] Video link opens in a private window
- [ ] Form submitted at ___ ET (user)
- [ ] Confirmation email/screenshot saved (user)

The submission form URL was not published by organizers at planning time (registration form closed). Check https://multiappagenthackathon.com/ and organizer email/Discord.

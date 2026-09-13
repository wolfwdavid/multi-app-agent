---
title: TransferPilot
emoji: 🔗
colorFrom: indigo
colorTo: blue
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Transfer application agent with measured evals
---

# TransferPilot

TransferPilot is an agent that runs an application sprint for college transfer applicants. It starts from a student profile, builds a deterministic gap report against each target school's published transfer requirements (with source links and retrieval dates), and proposes a plan of writes across Notion, Google Calendar, Google Docs and Gmail. Nothing runs until you approve it. After the run, every artifact is read back from its app and marked verified or failed. The eval dashboard shows measured pass rates, pass^k and a failure taxonomy across seeded scenarios, and it replays a lying-API run that read-back caught. This static site replays a recorded mock-mode run with personal details redacted; gap analysis runs live in your browser.

- GitHub Pages: https://wolfwdavid.github.io/multi-app-agent/
- Source: https://github.com/wolfwdavid/multi-app-agent
- Reliability brief: https://github.com/wolfwdavid/multi-app-agent/blob/main/BRIEF.md

Submission for the [Multi-App AI Agent Hackathon](https://multiappagenthackathon.com/).

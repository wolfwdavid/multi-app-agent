# Lessons

## 2026-09-13 — Subagent commits picked up AI attribution trailers
- **What happened:** GSD executor agents appended `Co-Authored-By: Claude…` / `Claude-Session:` trailers to commits (from the harness attribution reminder), violating the user's rule that commits never mention AI assistants.
- **Rule:** Every executor/committer prompt must state the no-trailer rule explicitly and require a `git log --format=%B` self-check. Never rely on agents inheriting CLAUDE.md.
- **Guardrail:** Run `scripts/strip-ai-trailers.sh` before every `git push` (parallel executors use `--no-verify`, so commit-msg hooks can't be relied on). Only rewrite unpushed commits, and only when no executor is mid-commit.

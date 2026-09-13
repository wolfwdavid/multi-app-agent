# Lessons

## 2026-09-13 — Subagent commits picked up AI attribution trailers
- **What happened:** GSD executor agents appended `Co-Authored-By: Claude…` / `Claude-Session:` trailers to commits (from the harness attribution reminder), violating the user's rule that commits never mention AI assistants.
- **Rule:** Every executor/committer prompt must state the no-trailer rule explicitly and require a `git log --format=%B` self-check. Never rely on agents inheriting CLAUDE.md.
- **Guardrail:** Run `scripts/strip-ai-trailers.sh` before every `git push` (parallel executors use `--no-verify`, so commit-msg hooks can't be relied on). Only rewrite unpushed commits, and only when no executor is mid-commit.
- **Test history rewrites on a throwaway clone first.** The first version of the strip script silently missed `Co-Authored-By` lines (a multibyte emoji in the `grep -E` alternation broke matching under Git Bash) while reporting "0 remaining" — its self-check used the same broken pattern. Keep patterns ASCII-only, and verify with an independent grep (`grep -inE "co-authored|claude|anthropic"`) plus a tree-hash equality check.

## 2026-09-13: Sent a correction to the wrong background agent
- **What happened:** I launched 9 agents in one batch and then sent the plan checker's 04-01 fix note to the agent ID of the Phase 11 *planner* instead of the 04-01 *executor*. I mapped IDs by position, and the spawn results arrived out of order relative to the calls. The executor never got the note until I noticed a "Coordinator note on Cornell" in the Phase 11 planner's report.
- **Rule:** Before any SendMessage, identify the target from its spawn result's own `description` (e.g. "Execute plan 04-01"), not from its position in a batch. Right after launching a batch, keep an explicit `description → agentId` map.
- **Also:** An Edit with identical old/new strings is a no-op. Re-read the intended change before sending it.

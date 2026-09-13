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

## 2026-09-13: `git add X && git commit` swept another agent's staged files
- **What happened:** A README agent staged `git rm` deletions (app.py, docs/index.html, requirements.txt). My next commit, "docs(11): create phase 11 MCP server plan" (317a66e), ran `git add <plan files> && git commit`, which recorded the whole index. The deletions landed in a mislabeled commit. Agents told to "stage only your own files" can hit the same bug.
- **Rule:** When other agents share the working tree, always commit with an explicit pathspec: `git commit --only -m "..." -- <paths>` (or gsd-tools `commit --files`). Check `git diff --cached --name-only` before every commit. Never tell a non-committing agent to stage (`git add`/`git rm`); unstaged working-tree changes are safe, staged ones are not.
- **Also add the rule to every executor/planner prompt** alongside the no-AI-trailer rule.
- **Gotcha:** `git commit --only -- <paths>` fails with "pathspec did not match any file(s) known to git" for brand-new untracked files. Use `git add <paths> && git commit --only -- <paths>` (same explicit paths in both), which still excludes anything else that is staged.

#!/usr/bin/env bash
# Remove AI attribution trailers from every unpushed commit message before pushing.
# Usage: scripts/strip-ai-trailers.sh [upstream]   (default upstream: origin/main)
# Refuses to run with a dirty index; no-op when the range is already clean.
set -euo pipefail

upstream="${1:-origin/main}"
cd "$(git rev-parse --show-toplevel)"

# ASCII-only, case-insensitive patterns (multibyte chars break grep -E under some Windows locales).
GREP_ARGS=(-iE -e '^co-authored-by:.*(claude|anthropic)' -e '^claude-session:' -e 'claude\.ai/code/session' -e 'generated with \[claude code\]')

count_trailers() {
  git log "$1" --format=%B | { grep -c "${GREP_ARGS[@]}" || true; }
}

range="$upstream..HEAD"
dirty=$(count_trailers "$range")
if [ "$dirty" = "0" ]; then
  echo "clean: no AI trailers in $range"
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes; commit or stash first" >&2
  exit 1
fi

echo "stripping $dirty trailer line(s) across $(git rev-list --count "$range") commit(s)"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter '
  grep -viE -e "^co-authored-by:.*(claude|anthropic)" -e "^claude-session:" -e "claude\.ai/code/session" -e "generated with \[claude code\]" \
  | sed -e :a -e "/^\n*\$/{\$d;N;ba" -e "}"
' -- "$range" >/dev/null

left=$(count_trailers "$range")
echo "remaining trailer lines: $left"
[ "$left" = "0" ]

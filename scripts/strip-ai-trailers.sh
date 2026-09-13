#!/usr/bin/env bash
# Remove AI attribution trailers from every unpushed commit message before pushing.
# Usage: scripts/strip-ai-trailers.sh [upstream]   (default upstream: origin/main)
# Refuses to run with a dirty index or when the range is already clean.
set -euo pipefail

upstream="${1:-origin/main}"
cd "$(git rev-parse --show-toplevel)"

pattern='^(Co-Authored-By:.*(Claude|anthropic)|Claude-Session:.*|.*claude\.ai/code/session.*|🤖 Generated with.*Claude.*)$'

range="$upstream..HEAD"
dirty=$(git log "$range" --format=%B | grep -icE "$pattern" || true)
if [ "$dirty" = "0" ]; then
  echo "clean: no AI trailers in $range"
  exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree has uncommitted changes; commit or stash first" >&2
  exit 1
fi

echo "stripping $dirty trailer line(s) across $(git rev-list --count "$range") commit(s)"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter \
  "grep -vE '$pattern' | sed -e :a -e '/^\n*\$/{\$d;N;ba' -e '}'" -- "$range"

left=$(git log "$range" --format=%B | grep -icE "$pattern" || true)
echo "remaining trailer lines: $left"
[ "$left" = "0" ]

#!/usr/bin/env bash
# Deploy the static showcase to the Hugging Face static Space.
# MANUAL ONLY: uses the local HF CLI login (hf auth login). Never run from CI.
# Usage: bash scripts/deploy-hf.sh [--dry-run]
#   --dry-run  build (base ''), smoke-check and stage README.md, but skip the upload
# Env: HF_SPACE (default WolfDavid/multi-app-agent)
set -euo pipefail

SPACE="${HF_SPACE:-WolfDavid/multi-app-agent}"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "error: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

command -v hf >/dev/null || { echo "error: hf CLI not found (pip install -U huggingface_hub)" >&2; exit 1; }

[ -d web/node_modules ] || npm --prefix web ci

# HF static Spaces serve at the root, so build with an empty base path.
node scripts/smoke-static.mjs --build --base ''

cp space/README.md web/build/README.md && grep -q '^sdk: static$' web/build/README.md

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run: web/build staged for $SPACE ($(find web/build -type f | wc -l | tr -d ' ') files); skipping upload"
  echo "note: web/build now has base ''; rebuild with: node scripts/smoke-static.mjs --build --base multi-app-agent"
  exit 0
fi

hf auth whoami >/dev/null 2>&1 || { echo "error: not logged in to Hugging Face; run: hf auth login" >&2; exit 1; }

sha=$(git rev-parse --short HEAD 2>/dev/null || echo local)

hf upload "$SPACE" web/build . --repo-type space --delete "app.py" "requirements.txt" --commit-message "Deploy static showcase ($sha)"

subdomain=$(curl -s "https://huggingface.co/api/spaces/$SPACE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).subdomain||'')}catch{console.log('')}})" || true)
[ -n "$subdomain" ] || subdomain="$(echo "$SPACE" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"

echo "Space: https://huggingface.co/spaces/$SPACE"
echo "Static host: https://$subdomain.static.hf.space"
echo "note: web/build now has base ''; rebuild with: node scripts/smoke-static.mjs --build --base multi-app-agent"

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

msg="Deploy static showcase ($sha)"

# `hf upload` (huggingface_hub <= 0.36) first calls create_repo(exist_ok=True, space_sdk="gradio"),
# which the Hub rejects with 402 for free accounts even when the static Space already exists.
# Prefer HfApi.upload_folder, which commits straight to the existing repo; fall back to the CLI.
# Probe each interpreter: on Windows `python3` may be the Store stub without huggingface_hub.
PY=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import huggingface_hub" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -n "$PY" ]; then
  HF_SPACE_ID="$SPACE" HF_COMMIT_MSG="$msg" "$PY" - <<'PYEOF'
import os
from huggingface_hub import HfApi
info = HfApi().upload_folder(
    repo_id=os.environ["HF_SPACE_ID"],
    repo_type="space",
    folder_path="web/build",
    path_in_repo=".",
    delete_patterns=["app.py", "requirements.txt"],
    commit_message=os.environ["HF_COMMIT_MSG"],
)
print(f"uploaded: {getattr(info, 'commit_url', info)}")
PYEOF
else
  hf upload "$SPACE" web/build . --repo-type space --delete "app.py" "requirements.txt" --commit-message "$msg"
fi

subdomain=$(curl -s "https://huggingface.co/api/spaces/$SPACE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).subdomain||'')}catch{console.log('')}})" || true)
[ -n "$subdomain" ] || subdomain="$(echo "$SPACE" | tr '/' '-' | tr '[:upper:]' '[:lower:]')"

echo "Space: https://huggingface.co/spaces/$SPACE"
echo "Static host: https://$subdomain.static.hf.space"
# HF static hosting does not serve directory indexes (/evals/ 302s to huggingface.co), hence --dir-index.
echo "live smoke: node scripts/smoke-static.mjs --url https://$subdomain.static.hf.space --dir-index --wait 300"
echo "note: web/build now has base ''; rebuild with: node scripts/smoke-static.mjs --build --base multi-app-agent"

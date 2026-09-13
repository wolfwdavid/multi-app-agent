# TransferPilot: 2-minute demo

## Video

Watch: [[USER: video link (YouTube unlisted / Loom)]]

Supporting recordings, already in the repo: [demo/videos/](demo/videos/). The main one is the 3:51 reel `transferpilot-agent-reel.mp4`, plus 7 scene clips. These are terminal recordings on mock apps, with honest notes on pacing and time compression in [demo/videos/README.md](demo/videos/README.md).

## Surface and tabs

**Surface: `pages-replay`.** Checked at 5:10 PM ET on 2026-09-13: Pages `/`, `/evals/` and `/data/evals.json` all returned 200. No Vercel live backend is deployed, so there is no live surface.

- Tab 1: sprint page, https://wolfwdavid.github.io/multi-app-agent/
- Tab 2: evals, https://wolfwdavid.github.io/multi-app-agent/evals/
- Tab 3: brief, https://github.com/wolfwdavid/multi-app-agent/blob/main/BRIEF.md
- Terminal: one Git Bash window, about 100x28, font 16+, cwd `web/`.

The Pages site replays a recorded mock-mode run, and its banner says so ("Recorded run."). The narration never calls it live. The HF Space (https://huggingface.co/spaces/WolfDavid/multi-app-agent, 200 at 5:10 PM ET) mirrors the same static showcase.

## Automated pre-flight results (captured 5:10–5:13 PM ET)

| Check | Result |
|---|---|
| Pages `/`, `/evals/`, `/data/evals.json` | 200, 200, 200 |
| HF Space / GitHub repo | 200 / 200 |
| Vercel live backend | not deployed (no URL) |
| Ollama | `qwen3.5:4b` loaded and warmed (keep_alive 45m) |
| Fresh mock sprint to scratch | `status ok`, `RERUN: 0 new writes (23/23 deduped)`; `web/static` untouched |
| smoke-real (5:12 PM ET) | GitHub ok: 30 most recently pushed public repos. Hugging Face ok: 12 models/Spaces. Notion, Calendar, Gmail, Docs skipped (credentials not configured). Obsidian skipped (vault path not set) |

## Pre-flight (T-15 min)

- [ ] 1. Turn notifications off (Windows Focus Assist / Do Not Disturb). Close email, chat and password-manager windows.
- [ ] 2. Close every editor tab showing `web/.env`. Never run `env`, `printenv` or `cat .env` on camera. Run `clear` in the terminal and hide shell history.
- [ ] 3. Browser: use a fresh profile or guest window at 1920x1080 with zoom 125% (Ctrl + / Ctrl -). Hide the bookmarks bar and extensions. Load all three tabs once and confirm the "Recorded run." banner shows on the sprint page.
- [ ] 4. `ollama ps` shows `qwen3.5:4b`. If not, warm it with `curl -s -m 120 http://127.0.0.1:11434/api/generate -d '{"model":"qwen3.5:4b","prompt":"ready","stream":false,"think":false,"keep_alive":"45m"}'` (or `ollama run qwen3.5:4b "ready" --think=false`). This only matters for questions; the recorded beats never call the LLM.
- [ ] 5. Fresh sprint run on mocks, to scratch. Keep **both** `--out` and `--json`: without `--json`, the run overwrites the committed `web/static/data/hero-run.json`.
  ```bash
  SCRATCH="$(mktemp -d)"
  npx tsx scripts/sprint.ts --profile demo --auto-approve --rerun --out "$SCRATCH/demo-sprint.jsonl" --json "$SCRATCH/hero-run.json"
  ```
  Confirm the last line reads `RERUN: 0 new writes (23/23 deduped)` and leave the terminal scrolled there (fallback for the 1:00 beat).
- [ ] 6. Run `npx tsx scripts/smoke-real.ts` once, so the 1:45 beat has live counts on screen. If the network is flaky, keep the pre-flight output up and say "checked a few minutes ago".
- [ ] 7. Recorder: OBS (Display Capture, 1920x1080, 30 fps, mic level tested) or Windows Snipping Tool video (Win+Shift+R). Do one full dry run with a timer and aim for 1:50–1:55.

## Script (2:00)

Clicks marked "btn" use the exact button text found in `web/src`. Replay mode needs no credentials and writes nothing.

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00–0:12 | Tab 1, sprint page top (banner "Recorded run." visible) | Hold on the page title and the step list. | Transfer students lost about 43% of their credits on average, per GAO, and planning is scattered across disconnected tools. TransferPilot turns a profile plus target schools into checked results. |
| 0:12–0:35 | Tab 1, "1. Profile" then "2. Gap report" | Scroll past the preloaded demo profile to the gap report. Hover one `[btn: Verify on official page]` link. Point at the GPA line (minimum / competitive) and at the fictional school's no-transfer-program blocker. | Step two, the gap report, is deterministic: GPA against minimum and competitive bars, units, prereqs and deadlines, computed from a sourced dataset. Every requirement links to its official page. The fictional school has no transfer program, so it's a blocker, not a guess. No model decides these. |
| 0:35–1:00 | Tab 1, "3. Plan & approve", "4. Run trace", "5. Verified results" | Click `[btn: Replay the recorded sprint]` (or `[btn: Build plan]` in step 3). Tick `[btn: Approve all (23)]`. Click the accent "Run 23 approved actions" button. If the trace waits, press `[btn: Play]`. Scroll to verified results. | This recorded mock-mode run plans 23 writes: 13 Calendar events, 4 Gmail drafts, 3 Notion rows, 3 Docs. Each has an idempotency key. The plan is HMAC-signed; nothing runs until I approve. Gmail has no send method. Every artifact is verified by reading the app back. |
| 1:00–1:15 | Tab 1, "5. Verified results" | Click `[btn: Run again]` and point at the `deduped` statuses. If the button is absent, flash the terminal `RERUN: 0 new writes (23/23 deduped)` line. | Run again: same plan, same idempotency keys. All 23 actions come back deduped, 23 of 23, zero new writes. Retries and ghost writes can't create duplicates. |
| 1:15–1:45 | Tab 2, Evals: stat cards, per-scenario table (pass^k), then "Caught silent failure" | Click **Evals** in the header. Pause on Pass rate and pass^k cards and the scenario table. Scroll to Caught silent failure and press `[btn: Next step]` (or `[btn: Step]`) to the read-back row. Scroll past the LLM column (qwen3.5:4b+qwen2.5-coder:7b, N=1). | 23 scenarios, 18 adversarial, N=10 each, graded by an independent oracle reading final state: 87% pass, 200 of 230, with pass^k per scenario; three known weaknesses fail on purpose. Calendar said OK but saved nothing; read-back caught it, so the run reported partial, not ok. Verifier off, it would say ok. Our real local-model run failed this check too: it reported ok after dropping writes. It's on the dashboard. |
| 1:45–2:00 | Terminal (smoke-real lines), then Tab 3 (BRIEF) | Show the `[ok] github` / `[ok] hf` / `[skip] notion` lines, then switch to the BRIEF tab. | Real apps: live GitHub reads 30 recent public repos and Hugging Face 12 models and Spaces. Notion and Google connectors are built, awaiting credentials. Code, evals and reliability brief are in the repo. TransferPilot. |

Numbers above come from `web/static/data/evals.json` (commit 0f7d07b, seed 1337), `web/static/data/hero-run.json`, `web/static/data/silent-failure-run.json` and this session's smoke-real run.

## Fallbacks

- **Pages down:** from the repo root run `node scripts/smoke-static.mjs --base multi-app-agent --serve --port 4174` and open `http://127.0.0.1:4174/multi-app-agent/`. The HF Space is a second mirror.
- **Run again hidden:** show the terminal `RERUN: 0 new writes (23/23 deduped)` line from pre-flight step 5.
- **smoke-real offline:** show the pre-flight output and say "checked a few minutes ago".
- **Vercel:** not deployed. Stay on the Pages replay and never imply live writes.
- **Over time:** cut the 0:12 beat to 15 s by skipping the hover.

## Option B: a 2-minute cut from the existing recordings (no re-recording)

If there is no time to screen-record the UI, cut the committed clips down to about 2:00 and narrate over them (they have no audio). Scene offsets inside the reel: 01 0:00–0:24, 02 0:24–1:27, 03 1:27–1:58, 04 1:58–2:43, 05 2:43–3:29, 06 3:29–3:51. Scene 07 (evals) is a separate clip that isn't in the reel. Each clip ends on its final state, so take the tail of each one:

| Order | Clip | Take | Shows |
|---|---|---|---|
| 1 | `01-approval-gate-dry-run.mp4` | last 18 s | injection email flagged, 23 planned writes, no-transfer-program blocker, "Dry run only" |
| 2 | `02-hero-sprint-mocks.mp4` | last 32 s | writes read back `verified`, `status ok, verified 23`, `RERUN: 0 new writes (23/23 deduped)` |
| 3 | `03-silent-failure-caught.mp4` | last 25 s | lying Calendar API: `status partial, verified 22, failed 1`, `read_back_missing` |
| 4 | `07-eval-suite-pass-rates.mp4` | last 25 s | 23 scenarios x N=10, 87% verifier on vs 78% off, `silent failure: caught=true` |
| 5 | `05-real-llm-ollama-sprint.mp4` | last 12 s | real Ollama sprint (time-compressed; 21 of 23 verified, 2 LLM slots failed) |
| 6 | `06-mcp-server-tools.mp4` | last 8 s | MCP stdio server, 4 tools, read-only `plan_sprint` (usable from any MCP client, e.g. VS Code) |

Total: 120 s. Preview each segment before exporting and adjust the tail lengths so no segment starts mid-line. Build the cut from `demo/videos/` into a scratch folder:

```bash
OUT="$(mktemp -d)"; i=0
for spec in "01-approval-gate-dry-run 18" "02-hero-sprint-mocks 32" "03-silent-failure-caught 25" "07-eval-suite-pass-rates 25" "05-real-llm-ollama-sprint 12" "06-mcp-server-tools 8"; do
  set -- $spec; i=$((i+1))
  ffmpeg -y -loglevel error -sseof -"$2" -i "$1.mp4" -vf "scale=1280:720,setsar=1,fps=30,format=yuv420p" -c:v libx264 -crf 23 -an "$OUT/seg$i.mp4"
  echo "file '$OUT/seg$i.mp4'" >> "$OUT/list.txt"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$OUT/list.txt" -c copy "$OUT/transferpilot-2min.mp4" && echo "$OUT/transferpilot-2min.mp4"
```

For Option B, narrate with the same beats and numbers as the script. On segment 5 say plainly that the report still said ok while two writes were dropped, and that the eval oracle grades that as a failure.

## Recording and upload

- Trim to 2:00 or less.
- Export MP4 at 1080p (Option B clips are 720p, so export at 720p).
- Upload to YouTube as Unlisted (or Loom). Wait for processing, then open the link in a private window to confirm it plays.
- Paste the link into the checkpoint reply (`video=<url>`).

## Why these beats

- **Reliability & evaluation (25%):** the 1:15 beat shows pass rate and pass^k over N=10 across 23 seeded scenarios, an independent final-state oracle, a caught silent failure with its verifier-off counterpart, and an honest real-model finding.
- **Technical execution (30%):** the 0:35 and 1:00 beats show a signed plan, per-action approval, read-back verification and idempotent re-runs (23/23 deduped) across Notion, Calendar, Docs and Gmail, plus live GitHub and Hugging Face reads.
- **Demo clarity (10%):** six timed beats, each with one screen, one action and one claim backed by a committed artifact.

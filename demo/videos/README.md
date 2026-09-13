# TransferPilot demo videos

Terminal recordings of the TransferPilot agent running a real application sprint. The seeded fictional demo student
applies to UC Berkeley, Cornell, Michigan and one fictional school. Every clip is H.264, 1280x720, yuv420p, 30 fps, with no audio.
Each clip has a `.poster.png` next to it, taken near the end, where the final state stays on screen.

**Start here:** [`transferpilot-agent-reel.mp4`](transferpilot-agent-reel.mp4) (3:51) contains all six scenes back to back.

## Clips

| File | Duration | What it demonstrates | Command that produced it (cwd `web/` unless noted) |
|---|---|---|---|
| `transferpilot-agent-reel.mp4` | 231.4 s | Scenes 01 to 06 concatenated in order. | See [Rebuilding the reel](#rebuilding-the-reel) |
| `01-approval-gate-dry-run.mp4` | 23.8 s | **Approval gate.** The agent reads the profile and inbox and flags the seeded prompt-injection email (`guard.injection`). It then plans 23 writes across Docs, Notion, Calendar and Gmail (each with an idempotency key, all `new`) and raises a `NO_TRANSFER_PROGRAM` blocker for the fictional school. It stops with "Dry run only. Re-run with --auto-approve or --approve <ids>." Nothing is written. | `npx tsx scripts/sprint.ts --profile demo --out <scratch>/01.jsonl --json <scratch>/01.json` with `PLAN_SIGNING_SECRET` set |
| `02-hero-sprint-mocks.mp4` | 62.8 s | **Hero sprint plus idempotency.** 23 approved writes run across the four apps, each with a retry budget (`try 1/3 ... ok`). Each write is read back (`found=true -> verified`) and the report is `status ok, verified 23`. A second run against the same world makes **0 new writes (23/23 deduped)**. | `npx tsx scripts/sprint.ts --profile demo --auto-approve --rerun --verbose --out <scratch>/02.jsonl --json <scratch>/02.json` |
| `03-silent-failure-caught.mp4` | 31.7 s | **Silent failure caught.** With the `lying-success` fault, `calendar.createEvent` reports success but writes nothing. Read-back verification catches it: `status partial, verified 22, failed 1`, `mismatch ... read_back_missing`. The run is not reported as a success. | `npx tsx scripts/sprint.ts --profile demo --auto-approve --faults lying-success --verbose --expect-status partial --out <scratch>/03.jsonl --json <scratch>/03.json` |
| `04-retries-and-ghost-writes.mp4` | 44.3 s | **Transient faults survived.** In run 1 (`rate-limit`), 429 bursts are retried with backoff. In run 2 (`ghost-write`), a write commits and then the API answers 500; the retry finds the write by its idempotency key and does not re-send it. Both runs finish `status ok, verified 23/23`. A duplicate check compares the plan with the final mock world and finds zero duplicate writes. | `node ../demo/tools/scene04-faults.mjs --scratch <scratch>`. This runs `sprint.ts --auto-approve --faults rate-limit` and then `--faults ghost-write`, both with `--verbose --out/--json` redirected to scratch. |
| `05-real-llm-ollama-sprint.mp4` | 46.6 s | **Real local LLM.** First, slot probes send the same prompt and zod schema to each routed Ollama model (`qwen3.5:4b` for phrasing, `qwen2.5-coder:7b` for grounding). Every response is schema-valid. Then the hero sprint runs with the real LLM filling the text slots: `report: ok, verified 21`, `thinkTagsInArtifacts: 0`. **Time-compressed** (see notes). | `npx tsx scripts/llm-smoke.ts --local-only --warm && npx tsx scripts/llm-smoke.ts --sprint --llm ollama --warm` |
| `06-mcp-server-tools.mp4` | 22.2 s | **MCP server.** A dependency-free stdio client starts the TransferPilot MCP server (mock mode) and completes the `initialize` handshake. It lists the 4 tools (`gap_analysis`, `critique_essay` and `plan_sprint` are read-only; `run_sprint` writes) and calls the read-only `plan_sprint`. That returns 23 actions and an HMAC-signed plan token. It confirms nothing was written and that stdout carried only JSON-RPC. | From the repo root: `node demo/tools/mcp-demo.mjs --pause-ms 1800` |
| `07-eval-suite-pass-rates.mp4` | 35.7 s | **Eval suite.** The real eval CLI runs 23 scenarios x 10 runs with the scripted FakeLLM policy, verifier on and verifier off (460 runs). An independent oracle grades each run from the final mock-world state, not the agent's report. Verifier on: `87% of 230 runs`, and every adversarial scenario passes 10/10 (ghost writes, 429 storms, prompt injection, lying API and others). Verifier off: `78%`, where `lying-success` and `changed-deadline-rerun` become silent `Communication failure`s. Three `known weakness` scenarios fail 0/10 on purpose (Instruction violation, Hallucination, Communication failure). The self-check prints `silent failure: caught=true`. Not part of the reel. | `SCENE_SCRATCH=<scratch> node ../demo/tools/scene07-evals.mjs --n 10`. This runs `eval.ts --n 10 --llm fake --no-artifacts --out <scratch>/evals.json`. |

`<scratch>` is a temporary directory outside the repo. `sprint.ts` writes its trace (`--out`) and run JSON (`--json`)
to tracked files under `web/static/` by default, so every recording redirected both into scratch.

## Honest notes

- **Mock apps, not live accounts.** Every clip runs against the in-memory mock connectors for Google Docs, Notion,
  Google Calendar and Gmail. These mocks implement the same connector interface, the same idempotency keys and the same read-back checks as the
  real connectors. No real Google or Notion account is touched, and Gmail actions only create drafts (`gmail sent: 0`).
- **Scene 05 is time-compressed.** The real Ollama sprint ran on CPU and took **800 s** (`total: 799.9s`). The video keeps
  every output line and its order but replays them at a readable pace. The title card says so. In that run, 2 of the LLM
  text slots still failed schema validation after repair attempts (`LLM_SLOT_FAILED: 2`, `llm.slot events: 11 (5 failed attempts -> repairs)`).
  The agent reported them as blockers and did not write their actions, which is why the report shows 21 verified writes instead of 23.
- **Output is re-paced, not edited.** `sprint.ts` prints its whole run in well under a second. The raw recordings were re-timed
  line by line (`pace-cast.mjs`, or a scene driver) so each step can be read. Line text is unchanged, apart from whole-line
  color highlighting of key lines. Scene 04's driver condenses the 23-row plan table to a one-line count and shortens the
  injection excerpt, and it marks both edits on screen.
- **Seeded attack text is visible.** Scenes 01 to 03 show the full excerpt of the seeded prompt-injection email as the guard prints it.
  It is fixture data and is flagged, not obeyed.
- **Cosmetic issues.** Scene 02 has no title card. Title bars truncate long commands. Some title cards and trace lines show the long
  Windows scratch path the recording used.
- **Scene 07 condenses the table and replays progress.** The CLI's per-scenario lines are wider than the recording, so the driver
  rebuilds the table from the `evals.json` that same run wrote (same numbers, noted on screen). The `TOTAL` and `silent failure`
  lines are the CLI's own. The suite finished in about 9 s. While it ran, a waiting line was on screen, and the progress dots were
  replayed afterwards (the real wall time is printed). `--no-artifacts` and `--out` into scratch meant no tracked eval file was rewritten.
- **Scene 03's exit code is 0 by design.** `--expect-status partial` asserts that the run must end `partial`.
- **Review.** A separate reviewer, not the recorder, checked each of scenes 01 to 06. The reviewer extracted at least 6 evenly spaced
  frames plus the final frame, read them, and checked duration and codec with `ffprobe`. All six were approved. Scene 05 was
  approved on its second take: the first review ran before the render existed, so it was re-recorded and re-reviewed. The reel's
  transitions and scene 07 were checked by sampling frames (title cards, mid-run, final state). No scene was excluded from the reel.

## Re-recording a scene

Requirements: Node 22+, `web/node_modules` installed, Python 3.11 with Playwright and Chromium
(`pip install playwright && playwright install chromium`), `ffmpeg`/`ffprobe` on PATH, and Ollama with both models for scene 05.
The tools are described in [`../tools/README.md`](../tools/README.md).

```bash
# 1. Record (cwd web/). Always point --out/--json at a scratch dir.
node ../demo/tools/record.mjs --cast "$SCRATCH/02.cast" --cwd . --width 120 --height 34 \
  --env PLAN_SIGNING_SECRET=demo-video-signing-secret -- \
  npx tsx scripts/sprint.ts --profile demo --auto-approve --rerun --verbose \
  --out "$SCRATCH/02.jsonl" --json "$SCRATCH/02.json"

# 2. Re-pace the instant burst of output so it is readable
node ../demo/tools/pace-cast.mjs --in "$SCRATCH/02.cast" --out "$SCRATCH/02.paced.cast" \
  --line 0.12 --hold '^== =1.8' --color '^status partial=1;31'

# 3. Render to mp4 (+ poster)
python ../demo/tools/render.py --cast "$SCRATCH/02.paced.cast" --out ../demo/videos/02-hero-sprint-mocks.mp4 \
  --title "Hero sprint on mock apps" --subtitle "Plan, approve, write, verify, rerun" --max-gap 3.5 --hold-end 4

# 4. Check frames
bash ../demo/tools/frames.sh ../demo/videos/02-hero-sprint-mocks.mp4 "$SCRATCH/frames" 6
```

Afterwards, check that `git status --short -- web/static` shows nothing new.

## Rebuilding the reel

Run from `demo/videos/`. Every input is re-encoded to one format, so the concat is safe:

```bash
ffmpeg -i 01-approval-gate-dry-run.mp4 -i 02-hero-sprint-mocks.mp4 -i 03-silent-failure-caught.mp4 \
  -i 04-retries-and-ghost-writes.mp4 -i 05-real-llm-ollama-sprint.mp4 -i 06-mcp-server-tools.mp4 \
  -filter_complex "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];\
[1:v]...same...[v1]; ... [5:v]...same...[v5]; [v0][v1][v2][v3][v4][v5]concat=n=6:v=1:a=0[out]" \
  -map "[out]" -c:v libx264 -preset medium -crf 26 -pix_fmt yuv420p -r 30 -movflags +faststart transferpilot-agent-reel.mp4
```

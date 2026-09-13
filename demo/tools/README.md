# Demo recording tools

These are small tools for turning real CLI runs into readable demo clips. They don't add npm dependencies. The renderer needs Python with
Playwright and Chromium, plus ffmpeg and ffprobe.

Typical order: **record, then pace, then render, then check frames.** See `../videos/README.md` for the full walkthrough.

| Tool | Usage | What it does |
|---|---|---|
| `record.mjs` | `node demo/tools/record.mjs --cast <out.cast> --cwd <dir> [--env K=V ...] [--title T] [--width 120] [--height 34] [--stdin ignore\|inherit\|<file>] -- <command...>` | Runs the command through the platform shell and writes asciicast v2 incrementally. Each stdout/stderr chunk gets a high-resolution timestamp. The last event is an `exit:<code>` marker, and the recorder exits with the command's exit code. |
| `pace-cast.mjs` | `node demo/tools/pace-cast.mjs --in <in.cast> --out <out.cast> [--line 0.05] [--hold '<regex>=<secs>' ...] [--color '<regex>=<sgr>' ...]` | Re-times a cast line by line, for commands that print everything in one instant burst. Line text is unchanged. It can add pauses after lines matching `--hold` and whole-line SGR color for lines matching `--color`. |
| `render.py` | `python demo/tools/render.py --cast <in.cast> --out <out.mp4> --title '<title>' [--subtitle '...'] [--speed 1.0] [--max-gap 1.2] [--hold-end 3] [--title-secs 2.5] [--font-size 0] [--frames N]` | Replays the cast with xterm.js in headless Chromium at 1280x720. A plain-text renderer takes over if the CDN is unreachable. The clip opens with a title card and ends by holding the final screen. Output is an H.264 yuv420p mp4 (crf 26, faststart) plus `<out>.poster.png`, and `<out>.frames/` when `--frames N` is given. |
| `frames.sh` | `bash demo/tools/frames.sh <in.mp4> <out_dir> [N=6]` | Extracts N evenly spaced PNG frames for review. |
| `scene04-faults.mjs` | cwd `web/`: `node ../demo/tools/scene04-faults.mjs --scratch <dir>` | Driver for scene 04. It runs `sprint.ts` with `--faults rate-limit` and then `--faults ghost-write`, sending `--out`/`--json` to `<dir>`. It replays the captured output with pauses on retry and recovery lines, then prints a duplicate check that compares the plan with the final state. |
| `mcp-demo.mjs` | repo root: `node demo/tools/mcp-demo.mjs [--pause-ms 1600] [--profile demo]` | Minimal stdio MCP client (newline-delimited JSON-RPC, no SDK). It starts `npx tsx scripts/mcp.ts` in mock mode, performs `initialize`, lists the tools and calls only the read-only `plan_sprint`. It never calls `run_sprint`. |

## Rules for recording

- Run `web/scripts/sprint.ts` with `--out` and `--json` pointing outside the repo. Otherwise it overwrites the tracked
  `web/static/data/hero-run.json` and `web/static/traces/demo-sprint*.jsonl`.
- Set `PLAN_SIGNING_SECRET` in the recording env so the local dev-secret notice doesn't appear on screen.
- Put intermediate casts, frames and renders in a scratch dir. Commit only the final `.mp4` and `.poster.png` files.

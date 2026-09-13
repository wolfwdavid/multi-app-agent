#!/usr/bin/env python
"""Render an asciicast v2 file to an H.264 mp4 demo clip.

Usage:
  python demo/tools/render.py --cast <in.cast> --out <out.mp4> --title '<scene title>'
      --subtitle '<one-line what this shows>' [--speed 1.0] [--max-gap 1.2] [--hold-end 3]
      [--title-secs 2.5] [--font-size 0] [--frames N] [--keep-webm]

Pipeline: local HTML page (xterm.js from jsdelivr, pinned; plain <pre> fallback that strips
ANSI if the CDN fails) -> Playwright Chromium record_video at 1280x720 -> ffmpeg trims the
page-load pre-roll and encodes H.264 yuv420p mp4 -> ffprobe duration -> <out>.poster.png.
With --frames N, also extracts N evenly spaced PNGs into <out>.frames/.
"""

from __future__ import annotations

import argparse
import html
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

XTERM_VERSION = "6.0.0"
FIT_VERSION = "0.11.0"
CDN = "https://cdn.jsdelivr.net/npm"
W, H = 1280, 720


def load_cast(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        sys.exit(f"render.py: empty cast file {path}")
    header = json.loads(lines[0])
    if header.get("version") != 2:
        sys.exit("render.py: only asciicast v2 is supported")
    events = []
    for ln in lines[1:]:
        ln = ln.strip()
        if not ln:
            continue
        try:
            t, kind, data = json.loads(ln)
        except (ValueError, TypeError):
            continue  # tolerate a truncated last line from a killed recorder
        events.append((float(t), kind, data))
    return header, events


def build_timeline(events, speed: float, max_gap: float, lead_in: float = 0.4):
    """Cap idle gaps, apply speedup. Returns [[t_ms, kind, data], ...] relative to replay start."""
    out, prev_src, cur = [], 0.0, lead_in
    for t, kind, data in events:
        gap = max(0.0, t - prev_src)
        if max_gap > 0:
            gap = min(gap, max_gap)
        cur += gap / speed
        prev_src = t
        if kind in ("o", "m"):
            out.append([round(cur * 1000), kind, data])
    return out, cur


PAGE = r"""<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="__CDN__/@xterm/xterm@__XV__/css/xterm.css" onerror="window.__cssFail=1">
<style>
  :root { --bg:#0b0f17; --panel:#0f1521; --edge:#1f2a3c; --fg:#d7dde8; --mute:#7d8aa3; --accent:#5eead4; --accent2:#818cf8; }
  html,body { margin:0; width:1280px; height:720px; overflow:hidden; background:var(--bg); color:var(--fg);
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
  .mono { font-family: "Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", monospace; }
  #card { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; padding:0 110px;
    background: radial-gradient(1200px 600px at 15% 20%, #13213a 0%, var(--bg) 60%); transition: opacity .45s ease; z-index:5; }
  #card .brand { display:flex; align-items:center; gap:14px; font-weight:700; font-size:26px; letter-spacing:.5px; color:#fff; margin-bottom:54px; }
  #card .brand .dot { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,var(--accent),var(--accent2)); }
  #card .brand span b { color:var(--accent); font-weight:700; }
  #card h1 { font-size:54px; line-height:1.1; margin:0 0 18px; font-weight:700; color:#fff; max-width:1060px; }
  #card p { font-size:24px; line-height:1.4; margin:0 0 44px; color:#b7c2d6; max-width:1060px; }
  #card .cmd { font-size:19px; color:var(--accent); background:#0a1320; border:1px solid var(--edge); border-radius:10px;
    padding:14px 18px; max-width:1040px; white-space:pre-wrap; word-break:break-all; }
  #card .cmd:before { content:"$ "; color:var(--mute); }
  #stage { position:absolute; inset:0; display:flex; flex-direction:column; padding:6px 8px 8px; box-sizing:border-box; }
  #bar { height:28px; flex:none; display:flex; align-items:center; gap:8px; padding:0 14px; background:#141c2b; border:1px solid var(--edge);
    border-bottom:none; border-radius:10px 10px 0 0; font-size:13px; color:var(--mute); }
  #bar i { width:12px; height:12px; border-radius:50%; display:inline-block; }
  #bar .t { flex:1; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:0 12px; }
  #bar .wm { font-weight:700; color:#c9d4e6; } #bar .wm b { color:var(--accent); }
  #bar .exit { min-width:70px; text-align:right; font-family: Consolas, monospace; }
  #term { flex:1; min-height:0; background:var(--panel); border:1px solid var(--edge); border-radius:0 0 10px 10px; padding:6px 8px;
    box-sizing:border-box; overflow:hidden; }
  #term .xterm-viewport { background:var(--panel) !important; overflow:hidden !important; }
  #fallback { margin:0; white-space:pre; font-size:16px; line-height:1.2; color:var(--fg); }
</style>
<script src="__CDN__/@xterm/xterm@__XV__/lib/xterm.js" onerror="window.__xtermFail=1"></script>
<script src="__CDN__/@xterm/addon-fit@__FV__/lib/addon-fit.js" onerror="window.__fitFail=1"></script>
</head><body>
<div id="stage">
  <div id="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i>
    <span class="t mono">__CMD__</span><span class="wm">Transfer<b>Pilot</b></span><span class="exit" id="exit"></span></div>
  <div id="term"></div>
</div>
<div id="card">
  <div class="brand"><div class="dot"></div><span>Transfer<b>Pilot</b></span></div>
  <h1>__TITLE__</h1>
  <p>__SUBTITLE__</p>
  <div class="cmd mono">__CMD__</div>
</div>
<script>
const DATA = __DATA__;
let write, mode;
function setupXterm() {
  const term = new window.Terminal({
    cols: DATA.cols, rows: DATA.rows, convertEol: true, disableStdin: true, cursorBlink: false, cursorStyle: 'bar',
    scrollback: 5000, allowProposedApi: true, fontSize: 16, lineHeight: 1.0,
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "DejaVu Sans Mono", monospace',
    theme: { background:'#0f1521', foreground:'#d7dde8', cursor:'#0f1521', cursorAccent:'#0f1521', selectionBackground:'#334155',
      black:'#1e2533', red:'#f87171', green:'#4ade80', yellow:'#facc15', blue:'#60a5fa', magenta:'#c084fc', cyan:'#22d3ee', white:'#d7dde8',
      brightBlack:'#64748b', brightRed:'#fca5a5', brightGreen:'#86efac', brightYellow:'#fde68a', brightBlue:'#93c5fd',
      brightMagenta:'#d8b4fe', brightCyan:'#67e8f9', brightWhite:'#ffffff' }
  });
  const el = document.getElementById('term');
  term.open(el);
  // Pick the largest font (<= max) whose fitted grid still holds the recorded cols x rows.
  if (window.FitAddon && !window.__fitFail) {
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    for (let fs = DATA.fontMax; fs >= 11; fs--) {
      term.options.fontSize = fs;
      const d = fit.proposeDimensions();
      if (d && d.cols >= DATA.cols && d.rows >= DATA.rows) break;
    }
    const d = fit.proposeDimensions();
    // Keep recorded width (wrapping fidelity); use any extra rows as visible space.
    term.resize(DATA.cols, Math.max(DATA.rows, d ? d.rows : DATA.rows));
  }
  window.__term = term;
  write = (s) => term.write(s);
  mode = 'xterm';
}
function setupFallback() {
  const el = document.getElementById('term');
  el.innerHTML = '<pre id="fallback" class="mono"></pre>';
  const pre = document.getElementById('fallback');
  let lines = [''];
  const ansi = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  write = (s) => {
    s = s.replace(ansi, '');
    for (const ch of s) {
      if (ch === '\n') lines.push('');
      else if (ch === '\r') lines[lines.length - 1] = '';
      else if (ch === '\b') lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
      else if (ch >= ' ' || ch === '\t') lines[lines.length - 1] += ch;
    }
    if (lines.length > DATA.rows) lines = lines.slice(-DATA.rows);
    pre.textContent = lines.join('\n');
  };
  mode = 'fallback';
}
function init() {
  try {
    if (DATA.forceFallback || !window.Terminal || window.__xtermFail) throw new Error('xterm unavailable');
    setupXterm();
  } catch (e) { setupFallback(); }
  return { mode, fontSize: window.__term ? window.__term.options.fontSize : 16,
    cols: window.__term ? window.__term.cols : DATA.cols, rows: window.__term ? window.__term.rows : DATA.rows };
}
function start() {
  const t0 = performance.now();
  const titleMs = DATA.titleMs;
  let i = 0;
  const ev = DATA.events;
  setTimeout(() => { document.getElementById('card').style.opacity = '0'; }, Math.max(0, titleMs - 450));
  function tick() {
    const now = performance.now() - t0 - titleMs;
    let buf = '';
    while (i < ev.length && ev[i][0] <= now) {
      const [, kind, data] = ev[i++];
      if (kind === 'o') buf += data;
      else if (kind === 'm' && /^exit:/.test(data)) {
        const code = data.slice(5).split(' ')[0];
        const x = document.getElementById('exit');
        x.textContent = 'exit ' + code; x.style.color = code === '0' ? '#4ade80' : '#f87171';
      }
    }
    if (buf) write(buf);
    if (i < ev.length) requestAnimationFrame(tick);
    else setTimeout(() => { window.__done = true; }, DATA.holdMs);
  }
  requestAnimationFrame(tick);
}
window.__ready = true;
</script></body></html>
"""


def build_page(header, timeline, args) -> str:
    cmd = header.get("command") or header.get("title") or ""
    data = {
        "cols": int(header.get("width", 120)),
        "rows": int(header.get("height", 34)),
        "events": timeline,
        "titleMs": round(args.title_secs * 1000),
        "holdMs": round(args.hold_end * 1000),
        "fontMax": args.font_size or 18,
        "forceFallback": args.force_fallback,
    }
    # </script> inside terminal output must not terminate the inline script.
    data_js = json.dumps(data).replace("</", "<\\/")
    return (
        PAGE.replace("__CDN__", CDN)
        .replace("__XV__", XTERM_VERSION)
        .replace("__FV__", FIT_VERSION)
        .replace("__TITLE__", html.escape(args.title))
        .replace("__SUBTITLE__", html.escape(args.subtitle))
        .replace("__CMD__", html.escape(cmd))
        .replace("__DATA__", data_js)
    )


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"render.py: command failed ({r.returncode}): {' '.join(cmd)}\n{r.stderr[-2000:]}")
    return r.stdout


def probe_duration(path: Path) -> float:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    return float(out.strip())


def extract_frames(mp4: Path, n: int, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    dur = probe_duration(mp4)
    paths = []
    for i in range(n):
        t = dur * (i + 0.5) / n
        p = out_dir / f"frame_{i + 1:02d}_{t:06.2f}s.png"
        run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", str(mp4), "-frames:v", "1", str(p)])
        paths.append(p)
    return paths


def main():
    ap = argparse.ArgumentParser(description="Render asciicast v2 to a 1280x720 H.264 mp4.")
    ap.add_argument("--cast", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--max-gap", type=float, default=1.2)
    ap.add_argument("--hold-end", type=float, default=3.0)
    ap.add_argument("--title-secs", type=float, default=2.5)
    ap.add_argument("--font-size", type=int, default=0, help="max terminal font px (default 18; shrinks to fit)")
    ap.add_argument("--frames", type=int, default=0, help="also extract N evenly spaced PNGs to <out>.frames/")
    ap.add_argument("--force-fallback", action="store_true", help="skip xterm.js (test the plain renderer)")
    ap.add_argument("--keep-webm", action="store_true")
    args = ap.parse_args()
    if args.speed <= 0:
        sys.exit("render.py: --speed must be > 0")

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"render.py: {tool} not found on PATH")

    cast = Path(args.cast).resolve()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    header, events = load_cast(cast)
    timeline, replay_secs = build_timeline(events, args.speed, args.max_gap)
    expected = args.title_secs + replay_secs + args.hold_end

    from playwright.sync_api import sync_playwright

    work = Path(tempfile.mkdtemp(prefix="render_", dir=str(out.parent)))
    try:
        page_path = work / "player.html"
        page_path.write_text(build_page(header, timeline, args), encoding="utf-8")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--font-render-hinting=none"])
            ctx = browser.new_context(
                viewport={"width": W, "height": H},
                device_scale_factor=1,
                record_video_dir=str(work),
                record_video_size={"width": W, "height": H},
                color_scheme="dark",
            )
            page = ctx.new_page()
            page.goto(page_path.as_uri(), wait_until="load", timeout=30000)
            page.wait_for_function("window.__ready === true", timeout=30000)
            mode = page.evaluate("init()")
            page.evaluate("document.fonts ? document.fonts.ready.then(() => true) : true")
            page.wait_for_timeout(300)  # let the first paint land in the video
            t_start = time.monotonic()
            page.evaluate("start()")
            page.wait_for_function("window.__done === true", timeout=int((expected + 120) * 1000), polling=100)
            page.wait_for_timeout(150)
            video = page.video
            t_end = time.monotonic()
            ctx.close()
            webm = Path(video.path())
            browser.close()

        # The recorder's start instant is not observable (it begins some time after new_page),
        # but it stops at ctx.close(). Anchor the trim to the end of the webm instead.
        webm_dur = probe_duration(webm)
        trim = max(0.0, webm_dur - (t_end - t_start))
        print(
            f"render.py: renderer={mode['mode']} font={mode.get('fontSize')}px grid={mode.get('cols')}x{mode.get('rows')} "
            f"webm={webm_dur:.2f}s trim_preroll={trim:.2f}s expected={expected:.2f}s",
            file=sys.stderr,
        )
        run([
            "ffmpeg", "-y", "-v", "error", "-ss", f"{trim:.3f}", "-i", str(webm),
            "-t", f"{expected + 0.1:.3f}",
            "-vf", f"scale={W}:{H}:flags=lanczos,fps=30,format=yuv420p",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "veryfast",
            "-movflags", "+faststart", "-an", str(out),
        ])
        if args.keep_webm:
            shutil.copy2(webm, out.with_suffix(".webm"))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    dur = probe_duration(out)
    poster = out.with_name(out.name + ".poster.png")
    t_poster = max(0.0, dur - min(1.0, max(0.2, args.hold_end / 2)))
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t_poster:.3f}", "-i", str(out), "-frames:v", "1", str(poster)])

    print(f"out: {out}")
    print(f"poster: {poster}")
    print(f"duration: {dur:.2f}s")
    if args.frames > 0:
        frames_dir = out.with_name(out.name + ".frames")
        for p in extract_frames(out, args.frames, frames_dir):
            print(f"frame: {p}")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# Extract N evenly spaced PNG frames from an mp4 for review.
# Usage: bash demo/tools/frames.sh <in.mp4> <out_dir> [N=6]
set -euo pipefail

if [ $# -lt 2 ]; then
	echo "usage: bash demo/tools/frames.sh <in.mp4> <out_dir> [N=6]" >&2
	exit 2
fi
in="$1"
out_dir="$2"
n="${3:-6}"

[ -f "$in" ] || { echo "frames.sh: no such file: $in" >&2; exit 1; }
mkdir -p "$out_dir"

dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in" | tr -d '\r')"
for i in $(seq 0 $((n - 1))); do
	t="$(awk -v d="$dur" -v i="$i" -v n="$n" 'BEGIN { printf "%.3f", d * (i + 0.5) / n }')"
	name="$(printf 'frame_%02d_%07.2fs.png' $((i + 1)) "$t")"
	ffmpeg -y -v error -ss "$t" -i "$in" -frames:v 1 "$out_dir/$name"
	echo "$out_dir/$name"
done

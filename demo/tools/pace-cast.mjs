#!/usr/bin/env node
// Re-pace an asciicast v2 recording line by line, for commands that print
// everything in one instant burst (unreadable when replayed at real speed).
//
// Usage:
//   node demo/tools/pace-cast.mjs --in <in.cast> --out <out.cast>
//        [--line 0.05] [--hold '<regex>=<secs>' ...] [--color '<regex>=<sgr>' ...]
//
// The output text is unchanged, byte for byte, apart from optional SGR color
// wrapping of whole lines that match a --color regex (e.g. '^mismatch=1;31').
// Each line is given its own timestamp --line seconds after the previous one;
// a line matching a --hold regex adds that many seconds of pause after it so
// the viewer can read it. The exit marker is kept as the final event.

import { readFileSync, writeFileSync } from 'node:fs';

function usage(msg) {
	if (msg) process.stderr.write(`pace-cast.mjs: ${msg}\n`);
	process.stderr.write("usage: node demo/tools/pace-cast.mjs --in <in.cast> --out <out.cast> [--line 0.05] [--hold '<re>=<secs>'] [--color '<re>=<sgr>']\n");
	process.exit(2);
}

const opts = { in: '', out: '', line: 0.05, holds: [], colors: [] };
const argv = process.argv.slice(2);
const splitRule = (s, flag) => {
	const eq = s.lastIndexOf('=');
	if (eq <= 0) usage(`${flag} expects <regex>=<value>, got "${s}"`);
	return [new RegExp(s.slice(0, eq)), s.slice(eq + 1)];
};
for (let i = 0; i < argv.length; i++) {
	const f = argv[i];
	const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${f} needs a value`));
	switch (f) {
		case '--in': opts.in = next(); break;
		case '--out': opts.out = next(); break;
		case '--line': opts.line = Number(next()); break;
		case '--hold': { const [re, v] = splitRule(next(), f); opts.holds.push([re, Number(v)]); break; }
		case '--color': { const [re, v] = splitRule(next(), f); opts.colors.push([re, v]); break; }
		default: usage(`unknown flag ${f}`);
	}
}
if (!opts.in || !opts.out) usage('--in and --out are required');
if (!(opts.line >= 0)) usage('--line must be >= 0');

const lines = readFileSync(opts.in, 'utf8').split('\n').filter((l) => l.trim() !== '');
const header = lines[0];
const events = lines.slice(1).map((l) => JSON.parse(l));
const outputs = events.filter((e) => e[1] === 'o');
const markers = events.filter((e) => e[1] !== 'o');
if (outputs.length === 0) usage('cast has no output events');

// Concatenate the stream, then cut it into segments that each end with "\n".
const text = outputs.map((e) => e[2]).join('');
const segments = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

let t = outputs[0][0];
const out = [header];
let held = 0;
for (const seg of segments) {
	const bare = seg.replace(/\r?\n$/, '');
	const plain = bare.replace(/\x1b\[[0-9;]*m/g, '');
	let data = seg;
	const color = opts.colors.find(([re]) => re.test(plain));
	if (color && bare.length > 0) data = `\x1b[${color[1]}m${bare}\x1b[0m${seg.slice(bare.length)}`;
	out.push(JSON.stringify([Math.round(t * 1e6) / 1e6, 'o', data]));
	const hold = opts.holds.find(([re]) => re.test(plain));
	t += opts.line + (hold ? hold[1] : 0);
	if (hold) held++;
}
for (const m of markers) out.push(JSON.stringify([Math.round(t * 1e6) / 1e6, m[1], m[2]]));
writeFileSync(opts.out, out.join('\n') + '\n');
process.stderr.write(`pace-cast.mjs: ${segments.length} lines, ${held} holds, ${t.toFixed(2)}s -> ${opts.out}\n`);

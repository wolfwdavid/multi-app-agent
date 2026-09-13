#!/usr/bin/env node
// Scene 07 driver: the eval suite (N runs x adversarial scenarios, graded by the oracle).
//
// Usage (cwd = web/):
//   node ../demo/tools/scene07-evals.mjs --scratch <dir> [--n 10]
//
// Runs the real eval CLI with the scripted FakeLLM baseline, --no-artifacts and
// --out <dir>/evals.json, so no tracked file under web/static is rewritten.
// While the suite runs, a waiting line is shown; the per-run progress dots are
// then replayed quickly (the real elapsed time is printed by the CLI itself).
// The CLI's per-scenario lines are wider than the recording, so the table is
// condensed from the evals.json the same run wrote (same numbers, marked on
// screen). TOTAL and silent-failure lines are the CLI's own, verbatim.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (flag, dflt) => {
	const i = argv.indexOf(flag);
	return i !== -1 ? argv[i + 1] : dflt;
};
const scratchArg = arg('--scratch', process.env.SCENE_SCRATCH);
if (!scratchArg) {
	process.stderr.write('usage: node ../demo/tools/scene07-evals.mjs --scratch <dir> [--n 10]\n');
	process.exit(2);
}
const n = Number(arg('--n', '10'));
const scratch = resolve(scratchArg).replaceAll('\\', '/');
mkdirSync(scratch, { recursive: true });
const outJson = `${scratch}/evals.json`;

const C = {
	dim: (s) => `\x1b[2m${s}\x1b[0m`,
	bold: (s) => `\x1b[1m${s}\x1b[0m`,
	cyan: (s) => `\x1b[1;36m${s}\x1b[0m`,
	yellow: (s) => `\x1b[1;33m${s}\x1b[0m`,
	green: (s) => `\x1b[1;32m${s}\x1b[0m`,
	red: (s) => `\x1b[1;31m${s}\x1b[0m`,
	inv: (s) => `\x1b[1;30;46m${s}\x1b[0m`
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = '') => process.stdout.write(s + '\n');
const W = 118;

function wrap(text, width) {
	const lines = [];
	let cur = '';
	for (const word of text.split(/\s+/)) {
		if (cur && cur.length + 1 + word.length > width) {
			lines.push(cur);
			cur = word;
		} else cur = cur ? `${cur} ${word}` : word;
	}
	if (cur) lines.push(cur);
	return lines;
}

out(C.inv(` EVAL SUITE  scripted FakeLLM baseline, N=${n} runs per scenario, verifier on vs. verifier off `));
out(C.bold('$ ') + `npx tsx scripts/eval.ts --n ${n} --llm fake --no-artifacts --out <scratch>/evals.json`);
await sleep(1200);

const t0 = Date.now();
const child = spawn(`npx tsx scripts/eval.ts --n ${n} --llm fake --no-artifacts --out "${outJson}"`, {
	shell: true,
	env: { ...process.env, FORCE_COLOR: '0' }
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));
out(C.dim('running every scenario N times on a fresh seeded mock world, both configs ...'));
const code = await new Promise((r) => child.on('close', (c) => r(c ?? 1)));
const wallS = ((Date.now() - t0) / 1000).toFixed(1);

const file = JSON.parse(readFileSync(outJson, 'utf8'));

// Methodology, as recorded in evals.json.
out();
out(C.cyan('how runs are graded (methodology field of evals.json)'));
for (const l of wrap(file.methodology, W - 2)) {
	out(C.dim('  ' + l));
	await sleep(260);
}
await sleep(1200);

// Progress dots from the CLI's stderr (. pass, x fail), replayed quickly.
out();
const dots = stderr.replace(/[^.x]/g, '');
const warnings = stderr.split(/\r?\n/).filter((l) => /\S/.test(l) && !/^[.x]+$/.test(l));
out(C.cyan(`progress: ${dots.length} runs (${(dots.match(/\./g) || []).length} pass ".", ${(dots.match(/x/g) || []).length} fail "x")`) + C.dim(`  replayed fast; suite wall time ${wallS}s`));
for (let i = 0; i < dots.length; i += W) {
	const chunk = dots.slice(i, i + W);
	out(chunk.replace(/x+/g, (m) => C.red(m)));
	await sleep(350);
}
for (const w of warnings) out(C.yellow(w));
await sleep(1500);

// Per-scenario table, condensed from evals.json.
const stdoutLines = stdout.replace(/\r/g, '').split('\n').filter(Boolean);
const label = (k) => k.charAt(0).toUpperCase() + k.slice(1).replaceAll('_', ' ');
const top = (failures) => {
	const e = Object.entries(failures || {}).sort((a, b) => b[1] - a[1]);
	return e.length ? label(e[0][0]) : '';
};
const cell = (r) => {
	const txt = `${String(Math.round(r.passRate * 100)).padStart(3)}% ${String(r.passed).padStart(2)}/${r.runs}`;
	return r.passRate === 1 ? C.green(txt) : r.passRate === 0 ? C.red(txt) : C.yellow(txt);
};
out();
out(C.cyan(stdoutLines.find((l) => l.startsWith('== EVALS')) ?? '== EVALS =='));
out(C.dim(`table condensed from <scratch>/evals.json written by this run (same numbers as the CLI's per-scenario lines)`));
out(C.bold(`${'scenario'.padEnd(33)}  ${'kind'.padEnd(14)}  ${'verifier on'.padEnd(10)}  ${'pass^k'.padEnd(6)}  ${'verif. off'.padEnd(10)}  top failure class (Lemma taxonomy)`));
for (const s of file.scenarios) {
	const on = s.results.fake;
	const off = s.results['fake-verifier-off'];
	const weak = s.tags.includes('known-weakness');
	const kind = weak ? C.yellow('known weakness') : s.adversarial ? 'adversarial   ' : C.dim((s.tags[0] ?? '').padEnd(14));
	const pk = on.passK ? C.green('yes   ') : C.red('no    ');
	let fc = '';
	if (top(on.failures)) fc = top(on.failures) + (weak ? C.yellow(' (fails on purpose)') : '');
	else if (top(off.failures)) fc = C.dim('off only: ') + top(off.failures) + (off.silentFailures ? C.red(' (silent)') : '');
	const line = `${s.id.padEnd(33)}  ${kind}  ${cell(on)}  ${pk}  ${cell(off)}  ${fc}`;
	out(line);
	await sleep(weak || s.id === 'lying-success' ? 1100 : 170);
}
await sleep(1200);

out();
for (const l of stdoutLines.filter((l) => l.startsWith('TOTAL '))) {
	out(C.bold(l));
	await sleep(1300);
}
for (const [modelId, classes] of Object.entries(file.failureTotals)) {
	const m = file.models.find((x) => x.id === modelId);
	out(`failure classes ${m.config.padEnd(12)} ` + Object.entries(classes).map(([k, v]) => `${label(k)} ${v}`).join(', '));
	await sleep(700);
}
for (const l of stdoutLines.filter((l) => l.startsWith('silent failure'))) {
	out(l.includes('caught=true') || l.includes('replay') ? C.green(l) : C.red(l));
	await sleep(1400);
}
const elapsed = stdoutLines.find((l) => l.startsWith('elapsed'));
out(C.dim(`wrote <scratch>/evals.json only (--no-artifacts)   ${elapsed ?? ''}   exit ${code}`));
process.exit(code);

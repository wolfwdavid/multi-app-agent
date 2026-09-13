#!/usr/bin/env node
// Scene 04 driver: rate-limit and ghost-write fault runs, back to back.
//
// Usage (cwd = web/):
//   node ../demo/tools/scene04-faults.mjs --scratch <dir>
//
// Runs the real sprint CLI twice (mock connectors with injected faults), with
// --out/--json redirected into <dir> so no tracked files are rewritten. The CLI
// finishes in well under a second, so its captured output is replayed line by
// line with pauses on the retry / recovery lines to keep the recording readable.
// Content is the CLI's own output; only the 23-row dry-run plan table and the
// long injection excerpt are condensed (marked with a dim "..." note).

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const si = argv.indexOf('--scratch');
const scratchArg = si !== -1 ? argv[si + 1] : process.env.SCENE_SCRATCH;
if (!scratchArg) {
	process.stderr.write('usage: node ../demo/tools/scene04-faults.mjs --scratch <dir>   (or set SCENE_SCRATCH)\n');
	process.exit(2);
}
const scratch = resolve(scratchArg);
mkdirSync(scratch, { recursive: true });

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

function runSprint(fault) {
	const trace = `${scratch}/${fault}.jsonl`.replaceAll('\\', '/');
	const json = `${scratch}/${fault}.json`.replaceAll('\\', '/');
	const cmd = `npx tsx scripts/sprint.ts --profile demo --auto-approve --faults ${fault} --verbose --out "${trace}" --json "${json}"`;
	const r = spawnSync(cmd, { shell: true, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
	return { code: r.status ?? 1, stderr: r.stderr ?? '', stdout: r.stdout ?? '', shown: `npx tsx scripts/sprint.ts --profile demo --auto-approve --faults ${fault} --verbose --out <scratch>/${fault}.jsonl --json <scratch>/${fault}.json` };
}

const scratchForms = [scratch, scratch.replaceAll('\\', '/')];
const hideScratch = (s) => scratchForms.reduce((acc, f) => acc.split(f).join('<scratch>'), s);

async function replay(fault, r) {
	const lines = (r.stderr + r.stdout).replace(/\r/g, '').split('\n');
	const state = {};
	let planRows = [];
	let inPlan = false;
	let prevRetry = false;
	let readbacks = 0;
	for (let raw of lines) {
		let line = raw.replace(/\.\.[\\/](\.\.[\\/])*AppData[^ ]*videos[\\/]04-retries-and-ghost-writes[\\/]/g, '<scratch>/');
		line = hideScratch(line);
		if (line.startsWith('guard.injection')) {
			line = line.replace(/ excerpt=.* reason=/, ' excerpt=… reason=');
		}
		if (line.startsWith('== PLAN')) {
			inPlan = true;
			out(C.cyan(line));
			await sleep(500);
			continue;
		}
		if (inPlan) {
			if (line.startsWith('planToken')) {
				const count = (t) => planRows.filter((l) => l.includes(`| ${t} |`)).length;
				out(C.dim(`  … ${planRows.length} planned writes (table condensed): ${count('docs.createDoc')} docs, ${count('notion.upsertTrackerRow')} notion rows, ${count('calendar.createEvent')} calendar events, ${count('gmail.createDraft')} gmail drafts`));
				state.plannedEvents = count('calendar.createEvent');
				state.plannedDrafts = count('gmail.createDraft');
				state.plannedDocs = count('docs.createDoc');
				state.plannedRows = count('notion.upsertTrackerRow');
				out(line);
				inPlan = false;
				await sleep(900);
			} else if (line.startsWith('BLOCKER')) {
				out(line);
			} else if (/^\S+ \| \w+ \| [\w.]+ \| tp1-/.test(line)) {
				planRows.push(line);
			}
			continue;
		}
		const m = line.match(/^(notion rows|calendar events|docs created|gmail drafts|gmail sent): (\d+)/);
		if (m) state[m[1]] = Number(m[2]);
		const st = line.match(/^status (\w+)/);
		if (st) state.status = st[1];
		const vc = line.match(/^verified (\d+)\s+deduped (\d+)\s+failed (\d+)/);
		if (vc) Object.assign(state, { verified: Number(vc[1]), failed: Number(vc[3]) });

		if (line.includes('↻')) {
			const recovered = line.includes('key: found');
			out(recovered ? C.green(line + '   ← write had committed; found by key, not re-sent') : C.yellow(line + '   ← backoff, then retry'));
			prevRetry = true;
			await sleep(1500);
			continue;
		}
		if (/^#\s?\d+ /.test(line)) {
			if (prevRetry) {
				out(C.bold(line));
				await sleep(1600);
			} else {
				out(line);
				await sleep(45);
			}
			prevRetry = false;
			continue;
		}
		if (/^\s+tool\.call/.test(line)) {
			out(C.dim(line));
			await sleep(prevRetry ? 200 : 25);
			continue;
		}
		if (/^\s+readback /.test(line)) {
			out(C.dim(line));
			readbacks++;
			await sleep(20);
			continue;
		}
		if (line.startsWith('== ')) {
			await sleep(400);
			out(C.cyan(line));
			await sleep(400);
			continue;
		}
		if (line.startsWith('run.end')) {
			out(C.bold(line));
			await sleep(800);
			continue;
		}
		if (line.startsWith('status ')) {
			out(state.status === 'ok' ? C.green(line) : C.red(line));
			await sleep(200);
			continue;
		}
		if (line === '' && raw === lines[lines.length - 1]) continue;
		out(line);
		await sleep(line.startsWith('policy.') ? 500 : 60);
	}
	return state;
}

let exit = 0;
const results = {};
for (const [i, fault] of ['rate-limit', 'ghost-write'].entries()) {
	const label = fault === 'rate-limit' ? 'RUN 1/2  fault: rate-limit  (429 bursts on writes)' : 'RUN 2/2  fault: ghost-write  (write commits, then the API answers 500)';
	if (i > 0) {
		out();
		out(C.dim('─'.repeat(118)));
		out();
	}
	out(C.inv(` ${label} `));
	const r = runSprint(fault);
	out(C.bold('$ ') + r.shown);
	await sleep(900);
	const s = await replay(fault, r);
	results[fault] = s;
	if (r.code !== 0 || s.status !== 'ok') exit = r.code || 1;
	out(C.dim(`exit ${r.code}`));
	await sleep(2600);
}

// Duplicate check from the CLI's own FINAL STATE vs. its plan table.
const g = results['ghost-write'];
out();
out(C.dim('─'.repeat(118)));
const rows = [
	['calendar events', g.plannedEvents, g['calendar events']],
	['gmail drafts', g.plannedDrafts, g['gmail drafts']],
	['docs created', g.plannedDocs, g['docs created']],
	['notion rows', g.plannedRows, g['notion rows']]
];
out(C.cyan('ghost-write duplicate check (planned vs. final mock world)'));
let dupFree = true;
for (const [name, planned, actual] of rows) {
	const ok = planned === actual;
	if (!ok) dupFree = false;
	out(`  ${name.padEnd(16)} planned ${String(planned).padStart(2)}   in world ${String(actual).padStart(2)}   ${ok ? C.green('no duplicates') : C.red('MISMATCH')}`);
}
const r1 = results['rate-limit'];
out(
	dupFree && exit === 0
		? C.green(`both runs: status ok, verified ${r1.verified}/${r1.plannedRows + r1.plannedDocs + r1.plannedEvents + r1.plannedDrafts} and ${g.verified}/${g.plannedRows + g.plannedDocs + g.plannedEvents + g.plannedDrafts}, zero duplicate writes`)
		: C.red('check failed')
);
if (!dupFree) exit = exit || 1;
process.exit(exit);

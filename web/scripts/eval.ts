/**
 * Eval CLI: N-run scenario suite against seeded mock Worlds, graded by the independent oracle.
 *
 * Usage:
 *   npx tsx scripts/eval.ts [--n 10] [--seed 1337] [--llm fake|ollama|hosted] [--scenarios id1,id2]
 *                           [--configs verifier-on,verifier-off] [--include-disabled] [--out static/data/evals.json] [--quiet]
 *
 * The scripted-policy (FakeLLM) baseline needs no LLM key. `--llm ollama|hosted` is the Phase 8 hook and
 * exits 2 until an LLM selector exists. Exit codes: 0 measured (scenarios may fail), 1 harness broken
 * (lying API not caught / verifier-off not graded a communication failure), 2 LLM column unavailable, 64 bad args.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enabledScenarios } from '../src/lib/core/eval/scenarios.ts';
import { fakeColumns, runSuite, type ModelColumn, type RunRecord } from '../src/lib/core/eval/runner.ts';
import { buildEvalsFile, type EvalsFile } from '../src/lib/core/eval/report.ts';
import { FAILURE_CLASS_LABELS } from '../src/lib/core/eval/classify.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
	'usage: npx tsx scripts/eval.ts [--n 10] [--seed 1337] [--llm fake|ollama|hosted] [--scenarios id1,id2] ' +
	'[--configs verifier-on,verifier-off] [--include-disabled] [--out static/data/evals.json] [--quiet]';

interface Args {
	n?: number;
	seed: number;
	llm: 'fake' | 'ollama' | 'hosted';
	scenarios?: string[];
	configs: string[];
	includeDisabled: boolean;
	out?: string;
	quiet: boolean;
}

function bad(msg: string): never {
	console.error(`${msg}\n${USAGE}`);
	process.exit(64);
}

function parseArgs(argv: string[]): Args {
	const a: Args = { seed: 1337, llm: 'fake', configs: ['verifier-on', 'verifier-off'], includeDisabled: false, quiet: false };
	const val = (i: number, flag: string): string => {
		const v = argv[i + 1];
		if (v === undefined || v.startsWith('--')) bad(`missing value for ${flag}`);
		return v;
	};
	for (let i = 0; i < argv.length; i++) {
		const f = argv[i];
		switch (f) {
			case '--n': {
				const v = Number(val(i++, f));
				if (!Number.isInteger(v) || v < 1) bad('--n must be a positive integer');
				a.n = v;
				break;
			}
			case '--seed': {
				const v = Number(val(i++, f));
				if (!Number.isInteger(v)) bad('--seed must be an integer');
				a.seed = v;
				break;
			}
			case '--llm': {
				const v = val(i++, f);
				if (v !== 'fake' && v !== 'ollama' && v !== 'hosted') bad('--llm must be fake|ollama|hosted');
				a.llm = v;
				break;
			}
			case '--scenarios':
				a.scenarios = val(i++, f).split(',').map((s) => s.trim()).filter(Boolean);
				break;
			case '--configs': {
				const v = val(i++, f).split(',').map((s) => s.trim()).filter(Boolean);
				if (!v.length || v.some((c) => c !== 'verifier-on' && c !== 'verifier-off')) bad('--configs must list verifier-on and/or verifier-off');
				a.configs = v;
				break;
			}
			case '--include-disabled':
				a.includeDisabled = true;
				break;
			case '--out':
				a.out = val(i++, f);
				break;
			case '--quiet':
				a.quiet = true;
				break;
			default:
				bad(`unknown argument: ${f}`);
		}
	}
	return a;
}

function gitSha(): string {
	try {
		return execSync('git rev-parse --short HEAD', { cwd: WEB, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'uncommitted';
	} catch {
		return 'uncommitted';
	}
}

/** Phase 8 hook: LLM-backed columns need the LLM selector (src/lib/core/llm/select.ts). Not wired yet. */
async function resolveLlmColumn(kind: 'ollama' | 'hosted'): Promise<ModelColumn> {
	console.error(
		`LLM-backed eval column (--llm ${kind}) needs the Phase 8 LLM selector (src/lib/core/llm/select.ts). Run with --llm fake for the scripted baseline.`
	);
	process.exit(2);
}

function topFailure(failures: EvalsFile['scenarios'][number]['results'][string]['failures']): string {
	const entries = Object.entries(failures) as [keyof typeof FAILURE_CLASS_LABELS, number][];
	if (!entries.length) return '';
	entries.sort((x, y) => y[1] - x[1]);
	return FAILURE_CLASS_LABELS[entries[0][0]] ?? entries[0][0];
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const n = args.n ?? (args.llm === 'fake' ? 10 : 3);
	const out = args.out ? resolve(process.cwd(), args.out) : join(WEB, 'static/data/evals.json');

	let scenarios = enabledScenarios(args.includeDisabled);
	if (args.scenarios) {
		const valid = new Set(scenarios.map((s) => s.id));
		const unknown = args.scenarios.filter((id) => !valid.has(id));
		if (unknown.length) bad(`unknown scenario id(s): ${unknown.join(', ')}\nvalid: ${[...valid].join(', ')}`);
		scenarios = scenarios.filter((s) => args.scenarios!.includes(s.id));
	}

	const columns: ModelColumn[] =
		args.llm === 'fake' ? fakeColumns().filter((c) => args.configs.includes(c.config.id)) : [await resolveLlmColumn(args.llm)];

	const commitSha = gitSha();
	const generatedAt = new Date().toISOString();

	const t0 = performance.now();
	const onRecord = (r: RunRecord) => {
		if (!args.quiet) process.stderr.write(r.passed ? '.' : 'x');
	};
	const suite = await runSuite({ scenarios, columns, n, seed: args.seed, onRecord });
	const elapsedS = (performance.now() - t0) / 1000;
	if (!args.quiet) process.stderr.write('\n');

	const file = buildEvalsFile(suite, { generatedAt, commitSha, seed: args.seed });
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(file, null, 2) + '\n', 'utf8');

	console.log(`== EVALS seed ${args.seed} n ${n} commit ${commitSha} ==`);
	for (const s of file.scenarios) {
		const cells = file.models.map((m) => {
			const r = s.results[m.id];
			if (!r) return `${m.label}: not run`;
			const tf = topFailure(r.failures);
			return `${m.label}: ${Math.round(r.passRate * 100)}% (${r.passed}/${r.runs}) pass^k ${r.passK ? 'yes' : 'no'}${tf ? ' [' + tf + ']' : ''}`;
		});
		console.log(`${s.id.padEnd(34)} ${cells.join(' | ')}`);
	}
	for (const m of file.models) {
		const t = file.totals[m.id];
		console.log(
			`TOTAL ${m.label}: ${Math.round(t.passRate * 100)}% of ${t.runs} runs (${t.passed} passed), all-${n}-pass in ${Math.round(t.passK * 100)}% of scenarios, silent failures ${t.silentFailures}`
		);
	}

	// Harness self-check: the oracle must catch the lying API (verifier-on passes, verifier-off is a communication failure).
	if (args.llm === 'fake' && scenarios.some((s) => s.id === 'lying-success') && columns.length === 2) {
		const lying = file.scenarios.find((s) => s.id === 'lying-success')!;
		const on = lying.results['fake'];
		const off = lying.results['fake-verifier-off'];
		const caught = on.passRate === 1;
		const offGraded = off.passRate === 0 && (off.failures.communication_failure ?? 0) > 0 && off.silentFailures > 0;
		console.log(
			`silent failure: caught=${caught} (verifier-on ${on.passed}/${on.runs} pass; verifier-off ${off.passed}/${off.runs} pass, communication_failure ${off.failures.communication_failure ?? 0}, silent ${off.silentFailures})`
		);
		if (!caught) {
			console.error('HARNESS CHECK FAILED: lying API not caught by verifier-on run');
			process.exitCode = 1;
		}
		if (!offGraded) {
			console.error('HARNESS CHECK FAILED: verifier-off lying-API run was not graded a communication failure (oracle would be vacuous)');
			process.exitCode = 1;
		}
	}

	console.log(`wrote ${relative(WEB, out).replaceAll('\\', '/')}`);
	console.log(`elapsed ${elapsedS.toFixed(1)}s`);
	if (args.llm === 'fake' && elapsedS > 60) console.error('WARNING: suite exceeded the 60s budget');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

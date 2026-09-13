/**
 * Eval CLI: N-run scenario suite against seeded mock Worlds, graded by the independent oracle.
 *
 * Usage:
 *   npx tsx scripts/eval.ts [--n 10] [--seed 1337] [--llm fake|ollama|hosted] [--scenarios id1,id2] [--configs verifier-on,verifier-off] [--include-disabled] [--out static/data/evals.json] [--md static/data/evals.md] [--no-artifacts] [--quiet]
 *   npm run eval -- <flags>
 *
 * Outputs:
 *   --out            evals.json (default static/data/evals.json). An existing valid file is merged, never clobbered:
 *                    an LLM run adds/replaces its column per scenario; a fake baseline refresh keeps recorded LLM columns.
 *   --md             BRIEF markdown tables rendered from the same EvalsFile object (default: next to --out, .md).
 *   silent failure   static/data/silent-failure-run.json plus redacted static/traces/eval-silent-failure.jsonl and
 *                    eval-silent-failure-verifier-off.jsonl (fake runs that include lying-success with both configs).
 *   --no-artifacts   skip silent-failure-run.json, the eval-silent-failure traces and evals.md (unless --md is given
 *                    explicitly), so demo recordings and verifiers can write only to scratch. The harness self-check still runs.
 *
 * The scripted-policy (FakeLLM) baseline needs no LLM key. `--llm ollama|hosted` resolves a verifier-on column through
 * the LLM selector (probe first; default N 3; --scenarios honored).
 * Exit codes: 0 measured (scenarios may fail), 1 harness broken (lying API not caught / verifier-off not graded a
 * communication failure) or refusing to merge into an invalid file, 2 LLM column unavailable, 64 bad args.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enabledScenarios } from '../src/lib/core/eval/scenarios.ts';
import { fakeColumns, runSuite, type ModelColumn, type RunRecord } from '../src/lib/core/eval/runner.ts';
import {
	buildEvalsFile,
	buildSilentFailureRun,
	EvalsFile,
	mergeEvalsFiles,
	renderMarkdownTables,
	type SilentFailureRun
} from '../src/lib/core/eval/report.ts';
import { resolveLlmColumn } from '../src/lib/core/eval/llm-column.ts';
import { FAILURE_CLASS_LABELS } from '../src/lib/core/eval/classify.ts';
import { piiFromProfile, redactTraceEvent } from '../src/lib/core/trace/redact.ts';
import { toJsonl } from '../src/lib/core/trace/jsonl.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
	'usage: npx tsx scripts/eval.ts [--n 10] [--seed 1337] [--llm fake|ollama|hosted] [--scenarios id1,id2] ' +
	'[--configs verifier-on,verifier-off] [--include-disabled] [--out static/data/evals.json] [--md static/data/evals.md] ' +
	'[--no-artifacts] [--quiet]\n       npm run eval -- <flags>';

interface Args {
	n?: number;
	seed: number;
	llm: 'fake' | 'ollama' | 'hosted';
	scenarios?: string[];
	configs: string[];
	includeDisabled: boolean;
	out?: string;
	md?: string;
	noArtifacts: boolean;
	quiet: boolean;
}

function bad(msg: string): never {
	console.error(`${msg}\n${USAGE}`);
	process.exit(64);
}

function parseArgs(argv: string[]): Args {
	const a: Args = {
		seed: 1337,
		llm: 'fake',
		configs: ['verifier-on', 'verifier-off'],
		includeDisabled: false,
		noArtifacts: false,
		quiet: false
	};
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
			case '--md':
				a.md = val(i++, f);
				break;
			case '--no-artifacts':
				a.noArtifacts = true;
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

/** Short HEAD SHA, suffixed -dirty when eval code (src/lib/core, scripts) has uncommitted changes. */
function gitSha(): string {
	const o = { cwd: WEB, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
	try {
		const sha = execSync('git rev-parse --short HEAD', o).toString().trim();
		if (!sha) return 'uncommitted';
		const dirty = execSync('git status --porcelain -- src/lib/core scripts', o).toString().trim();
		return dirty ? `${sha}-dirty` : sha;
	} catch {
		return 'uncommitted';
	}
}

function topFailure(failures: EvalsFile['scenarios'][number]['results'][string]['failures']): string {
	const entries = Object.entries(failures) as [keyof typeof FAILURE_CLASS_LABELS, number][];
	if (!entries.length) return '';
	entries.sort((x, y) => y[1] - x[1]);
	return FAILURE_CLASS_LABELS[entries[0][0]] ?? entries[0][0];
}

const rel = (p: string) => relative(WEB, p).replaceAll('\\', '/');

function writeText(path: string, text: string, written: string[]): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, 'utf8');
	written.push(rel(path));
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

	let columns: ModelColumn[];
	if (args.llm === 'fake') {
		columns = fakeColumns().filter((c) => args.configs.includes(c.config.id));
	} else {
		const r = await resolveLlmColumn(args.llm, process.env);
		if (!r.ok) {
			console.error(r.message);
			process.exit(2);
		}
		console.error(`LLM column ${r.column.label}: probe ok in ${r.probe.latencyMs}ms (${r.probe.description.baseUrl ?? 'n/a'})`);
		columns = [r.column];
	}

	const commitSha = gitSha();
	if (commitSha.endsWith('-dirty') && args.llm === 'fake') {
		console.error(
			`WARNING: uncommitted changes under web/src/lib/core or web/scripts; commitSha is ${commitSha}. Commit code before regenerating committed artifacts.`
		);
	}
	const generatedAt = new Date().toISOString();

	// Existing results file: an LLM run refuses to merge into an invalid file; a fake run ignores it with a warning.
	let existing: EvalsFile | undefined;
	if (existsSync(out)) {
		let parsed: ReturnType<typeof EvalsFile.safeParse> | undefined;
		try {
			parsed = EvalsFile.safeParse(JSON.parse(readFileSync(out, 'utf8')));
		} catch {
			parsed = undefined;
		}
		if (parsed?.success) existing = parsed.data;
		else if (args.llm !== 'fake') {
			console.error(`existing ${out} is not a valid EvalsFile; refusing to merge`);
			process.exit(1);
		} else console.error(`WARNING: existing ${rel(out)} is not a valid EvalsFile; overwriting it`);
	}

	const t0 = performance.now();
	const onRecord = (r: RunRecord) => {
		if (args.quiet) return;
		if (args.llm === 'fake') process.stderr.write(r.passed ? '.' : 'x');
		else
			console.error(
				`${r.scenarioId} r${r.runIndex}: ${r.passed ? 'pass' : 'FAIL ' + (r.primary ?? '')} (${((performance.now() - t0) / 1000).toFixed(0)}s)`
			);
	};
	const suite = await runSuite({ scenarios, columns, n, seed: args.seed, onRecord });
	const elapsedS = (performance.now() - t0) / 1000;
	if (!args.quiet && args.llm === 'fake') process.stderr.write('\n');

	const incoming = buildEvalsFile(suite, { generatedAt, commitSha, seed: args.seed });
	let file: EvalsFile;
	if (args.llm !== 'fake') {
		file = existing ? mergeEvalsFiles(existing, incoming) : incoming;
	} else if (existing?.models.some((m) => m.kind === 'llm')) {
		file = mergeEvalsFiles(incoming, existing, { models: (m) => m.kind === 'llm' });
		console.error(
			`kept LLM column(s): ${existing.models
				.filter((m) => m.kind === 'llm')
				.map((m) => m.label)
				.join(', ')}`
		);
	} else {
		file = incoming;
	}

	const written: string[] = [];
	writeText(out, JSON.stringify(file, null, 2) + '\n', written);
	if (args.md !== undefined || !args.noArtifacts) {
		const mdPath = args.md ? resolve(process.cwd(), args.md) : out.replace(/\.json$/i, '') + '.md';
		writeText(mdPath, renderMarkdownTables(file), written);
	}

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
			`TOTAL ${m.label}: ${Math.round(t.passRate * 100)}% of ${t.runs} runs (${t.passed} passed), all-${m.n}-pass in ${Math.round(t.passK * 100)}% of scenarios, silent failures ${t.silentFailures}`
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

		// Replayable silent failure from the kept run-0 traces (always checked; written unless --no-artifacts).
		const keptRun = (modelId: string) =>
			suite.kept.find((k) => k.record.scenarioId === 'lying-success' && k.record.modelId === modelId && k.record.runIndex === 0);
		const onRun = keptRun('fake');
		const offRun = keptRun('fake-verifier-off');
		let sf: SilentFailureRun | undefined;
		if (!onRun || !offRun) {
			console.error('HARNESS CHECK FAILED: lying-success run 0 traces were not kept');
			process.exitCode = 1;
		} else {
			try {
				sf = buildSilentFailureRun({ on: onRun, off: offRun, recordedAt: generatedAt, commitSha });
			} catch (e) {
				console.error('HARNESS CHECK FAILED: ' + (e as Error).message);
				process.exitCode = 1;
			}
		}
		if (sf && onRun && offRun) {
			if (!sf.oracle.caught) {
				console.error('HARNESS CHECK FAILED: lying API not caught by verifier-on run');
				process.exitCode = 1;
			}
			if (sf.before?.oraclePassed !== false || sf.oracle.failureClass !== 'communication_failure') {
				console.error('HARNESS CHECK FAILED: verifier-off lying-API run was not graded a communication failure (oracle would be vacuous)');
				process.exitCode = 1;
			}
			console.log(
				`silent failure replay: verifier-on report ${sf.report.status}; verifier-off report ${sf.before?.report.status} → ${sf.oracle.failureClass}; stepSpanId ${sf.oracle.stepSpanId}`
			);
			if (!args.noArtifacts) {
				writeText(join(WEB, 'static/data/silent-failure-run.json'), JSON.stringify(sf, null, 2) + '\n', written);
				const pii = piiFromProfile(onRun.prepared.profile);
				writeText(
					join(WEB, 'static/traces/eval-silent-failure.jsonl'),
					toJsonl(onRun.run.passes[0].events.map((e) => redactTraceEvent(e, pii))),
					written
				);
				writeText(
					join(WEB, 'static/traces/eval-silent-failure-verifier-off.jsonl'),
					toJsonl(offRun.run.passes[0].events.map((e) => redactTraceEvent(e, pii))),
					written
				);
			}
		}
	}

	console.log(`wrote ${written.join(', ')}`);
	console.log(`elapsed ${elapsedS.toFixed(1)}s`);
	if (args.llm === 'fake' && elapsedS > 60) console.error('WARNING: suite exceeded the 60s budget');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

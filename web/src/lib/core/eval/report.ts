// evals.json contract (07-UI-SPEC EvalsFile) and builders. Pure: generatedAt and commitSha are inputs.
import { z } from 'zod';
import { FailureClass, RunReport, TraceEvent } from '../schemas.ts';
import { piiFromProfile, redactTraceEvent, redactValue } from '../trace/redact.ts';
import { FAILURE_CLASS_LABELS, classifyFailure } from './classify.ts';
import { aggregateScenario } from './metrics.ts';
import type { KeptRun, SuiteResult } from './runner.ts';

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

const FailureCounts = z.partialRecord(FailureClass, z.number().int().nonnegative());

export const EvalModel = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(['scripted', 'llm']),
	model: z.string().min(1),
	config: z.enum(['verifier-on', 'verifier-off']),
	n: z.number().int().positive(),
	seed: z.number().int(),
	generatedAt: z.iso.datetime(),
	commitSha: z.string().min(1),
	/** LLM columns only: key-free model metadata from llmRunMeta. */
	llm: z
		.object({
			provider: z.enum(['fake', 'ollama', 'hosted']),
			seed: z.number().nullable(),
			temperature: z.number().nullable(),
			numCtx: z.number().nullable()
		})
		.optional()
});
export type EvalModel = z.infer<typeof EvalModel>;

export const ScenarioModelResult = z.object({
	runs: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	passRate: z.number().min(0).max(1),
	passK: z.boolean(),
	passHatK: z.array(z.object({ k: z.number().int().positive(), value: z.number().min(0).max(1) })),
	failures: FailureCounts,
	silentFailures: z.number().int().nonnegative()
});

export const EvalsFile = z.object({
	schemaVersion: z.literal(1),
	generatedAt: z.iso.datetime(),
	commitSha: z.string().min(1),
	n: z.number().int().positive(),
	seed: z.number().int(),
	/** Primary model of the file ('fake-scripted' for the baseline). */
	model: z.string().min(1),
	methodology: z.string().min(1),
	models: z.array(EvalModel).min(1),
	scenarios: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				description: z.string(),
				tags: z.array(z.string()),
				adversarial: z.boolean(),
				results: z.record(z.string(), ScenarioModelResult)
			})
		)
		.min(1),
	totals: z.record(
		z.string(),
		z.object({
			runs: z.number().int(),
			passed: z.number().int(),
			passRate: z.number().min(0).max(1),
			passK: z.number().min(0).max(1),
			silentFailures: z.number().int()
		})
	),
	failureTotals: z.record(z.string(), FailureCounts),
	silentFailure: z.object({ file: z.string().min(1), scenarioId: z.string().min(1) }).optional()
});
export type EvalsFile = z.infer<typeof EvalsFile>;

export const METHODOLOGY =
	'Each scenario runs N times on a fresh, seeded mock World (the seed drives probabilistic faults such as 429 bursts, ghost writes and a lying API). ' +
	'An independent oracle reads the final World state (goal met, collateral diff against the seed snapshot, grounding against schools.json, safety, and report honesty) and never trusts the agent\'s self-report. ' +
	'Failed runs get one primary failure class from a rule-based taxonomy. pass^k is the tau-bench unbiased estimate C(c,k)/C(n,k) of k consecutive runs all passing. ' +
	'The FakeLLM scripted policy needs no LLM key, so it measures harness and connector reliability. The verifier-off column is the deliberately weakened "before" config whose report trusts the executor.';

export function buildEvalsFile(suite: SuiteResult, meta: { generatedAt: string; commitSha: string; seed?: number }): EvalsFile {
	const seed = meta.seed ?? suite.seed;
	const models = suite.columns.map((c) => ({
		id: c.id,
		label: c.label,
		kind: c.kind,
		model: c.model,
		config: c.config.id,
		n: suite.n,
		seed,
		generatedAt: meta.generatedAt,
		commitSha: meta.commitSha,
		...(c.llmMeta ? { llm: c.llmMeta } : {})
	}));
	const scenarios = suite.scenarios.map((s) => {
		const results: Record<string, ReturnType<typeof aggregateScenario>> = {};
		for (const c of suite.columns) {
			results[c.id] = aggregateScenario(suite.records.filter((r) => r.scenarioId === s.id && r.modelId === c.id));
		}
		return {
			id: s.id,
			name: s.name,
			description: s.description,
			tags: [...s.tags],
			adversarial: (s.tags as string[]).includes('adversarial'),
			results
		};
	});
	const totals: EvalsFile['totals'] = {};
	const failureTotals: EvalsFile['failureTotals'] = {};
	for (const c of suite.columns) {
		const recs = suite.records.filter((r) => r.modelId === c.id);
		const passed = recs.filter((r) => r.passed).length;
		const withResults = scenarios.filter((s) => s.results[c.id]?.runs > 0);
		const allPass = withResults.filter((s) => s.results[c.id].passK).length;
		totals[c.id] = {
			runs: recs.length,
			passed,
			passRate: recs.length ? round4(passed / recs.length) : 0,
			passK: withResults.length ? round4(allPass / withResults.length) : 0,
			silentFailures: recs.filter((r) => r.silentFailure).length
		};
		const ft: Partial<Record<FailureClass, number>> = {};
		for (const r of recs) if (!r.passed && r.primary) ft[r.primary] = (ft[r.primary] ?? 0) + 1;
		failureTotals[c.id] = ft;
	}
	return EvalsFile.parse({
		schemaVersion: 1,
		generatedAt: meta.generatedAt,
		commitSha: meta.commitSha,
		n: suite.n,
		seed,
		model: suite.columns[0]?.model ?? 'none',
		methodology: METHODOLOGY,
		models,
		scenarios,
		totals,
		failureTotals,
		...(suite.scenarios.some((s) => s.id === 'lying-success')
			? { silentFailure: { file: 'data/silent-failure-run.json', scenarioId: 'lying-success' } }
			: {})
	});
}

// ---------------------------------------------------------------------------------------------
// Silent-failure replay (07-UI-SPEC SilentFailureRun)
// ---------------------------------------------------------------------------------------------

export const SilentFailureRun = z.object({
	recordedAt: z.iso.datetime(),
	commitSha: z.string().min(1),
	scenarioId: z.string().min(1),
	description: z.string().min(1),
	events: z.array(TraceEvent).min(1),
	report: RunReport,
	oracle: z.object({
		caught: z.boolean(),
		failureClass: FailureClass.nullable(),
		expected: z.string().min(1),
		found: z.string().min(1),
		stepSpanId: z.string().min(1)
	}),
	before: z
		.object({
			config: z.literal('verifier-off'),
			report: RunReport,
			oraclePassed: z.boolean(),
			failureClass: FailureClass.nullable(),
			failedChecks: z.array(z.string())
		})
		.optional()
});
export type SilentFailureRun = z.infer<typeof SilentFailureRun>;

/**
 * Builds the redacted, oracle-verified replay of the lying-API run.
 * `on` is the verifier-on run (read-back catches the lie); `off` is the verifier-off "before" run.
 * stepSpanId is the spanId of the failed `verify.readback` END event for the first mismatch artifact.
 */
export function buildSilentFailureRun(input: { on: KeptRun; off: KeptRun; recordedAt: string; commitSha: string }): SilentFailureRun {
	const { on, off, recordedAt, commitSha } = input;
	const pass = on.run.passes[0];
	const report = pass?.report;
	const mismatch = report?.artifacts.find((a) => a.status === 'mismatch');
	if (!pass || !report || !mismatch) throw new Error('silent failure not caught: no mismatch artifact');
	const action = pass.plan?.actions.find((a) => a.id === mismatch.actionId);
	const readback = pass.events.find(
		(e) => e.name === 'verify.readback' && e.kind === 'end' && e.attrs.actionId === mismatch.actionId && e.attrs.found === false
	);
	if (!action || !readback) throw new Error('silent failure not caught: no failed read-back for ' + mismatch.actionId);

	const pii = piiFromProfile(on.prepared.profile);
	const plannedEvents = pass.plan!.actions.filter((a) => a.tool === 'calendar.createEvent').length;
	const worldEvents = pass.worldAfter.calendar.events.length;
	const offCls = classifyFailure(off.oracle, off.run.passes);
	const offReport = off.run.passes[0]?.report;
	if (!offReport) throw new Error('silent failure not caught: verifier-off run produced no report');

	return SilentFailureRun.parse({
		recordedAt,
		commitSha,
		scenarioId: on.record.scenarioId,
		description: on.prepared.scenario.description,
		events: pass.events.map((e) => redactTraceEvent(e, pii)),
		report: redactValue(report, pii),
		oracle: {
			caught: on.oracle.passed && report.status !== 'ok',
			failureClass: offCls.primary,
			expected: redactValue(
				`${action.tool} returned OK for ${action.id} (key ${action.idempotencyKey}): "${String(action.payload.title ?? action.summary)}" on ${String(action.payload.date ?? '')}`,
				pii
			),
			found: `Read-back found no calendar event with key ${action.idempotencyKey}. The World holds ${worldEvents} of ${plannedEvents} planned calendar events, so the artifact was marked mismatch and the run reported ${report.status}.`,
			stepSpanId: readback.spanId
		},
		before: {
			config: 'verifier-off',
			report: redactValue(offReport, pii),
			oraclePassed: off.oracle.passed,
			failureClass: offCls.primary,
			failedChecks: off.oracle.failedRequired.map((c) => c.id)
		}
	});
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

type ScenarioResult = z.infer<typeof ScenarioModelResult>;

/**
 * Non-destructive merge of `incoming` model columns into `base`.
 * Deviation from 06-02 spec: per-scenario replacement plus recomputed totals, so LLM subsets can be merged in batches.
 * - `opts.models` filters which incoming models are taken (default all). Base columns for other ids are untouched.
 * - For a taken id, each scenario's result is replaced when incoming has it; other scenarios keep base's result.
 * - totals/failureTotals for taken ids are recomputed from the merged per-scenario results.
 * - File-level metadata (generatedAt, commitSha, n, seed, model, methodology, silentFailure) comes from base.
 */
export function mergeEvalsFiles(base: EvalsFile, incoming: EvalsFile, opts: { models?: (m: EvalModel) => boolean } = {}): EvalsFile {
	const take = incoming.models.filter(opts.models ?? (() => true));
	const ids = new Set(take.map((m) => m.id));
	const pick = (results: Record<string, ScenarioResult> | undefined): Record<string, ScenarioResult> => {
		const out: Record<string, ScenarioResult> = {};
		for (const [k, v] of Object.entries(results ?? {})) if (ids.has(k)) out[k] = v;
		return out;
	};
	const models = [...base.models.filter((m) => !ids.has(m.id)), ...take];
	const incomingById = new Map(incoming.scenarios.map((s) => [s.id, s]));
	const baseIds = new Set(base.scenarios.map((s) => s.id));
	const scenarios = base.scenarios.map((s) => ({ ...s, results: { ...s.results, ...pick(incomingById.get(s.id)?.results) } }));
	for (const s of incoming.scenarios) {
		if (baseIds.has(s.id)) continue;
		const results = pick(s.results);
		if (Object.keys(results).length) scenarios.push({ ...s, results });
	}

	const totals: EvalsFile['totals'] = {};
	const failureTotals: EvalsFile['failureTotals'] = {};
	for (const [k, v] of Object.entries(base.totals)) if (!ids.has(k)) totals[k] = v;
	for (const [k, v] of Object.entries(base.failureTotals)) if (!ids.has(k)) failureTotals[k] = v;
	for (const id of ids) {
		const rs = scenarios.map((s) => s.results[id]).filter((r): r is ScenarioResult => r !== undefined);
		const runs = rs.reduce((a, r) => a + r.runs, 0);
		const passed = rs.reduce((a, r) => a + r.passed, 0);
		totals[id] = {
			runs,
			passed,
			passRate: runs ? round4(passed / runs) : 0,
			passK: rs.length ? round4(rs.filter((r) => r.passK).length / rs.length) : 0,
			silentFailures: rs.reduce((a, r) => a + r.silentFailures, 0)
		};
		const ft: Partial<Record<FailureClass, number>> = {};
		for (const r of rs) {
			for (const c of FailureClass.options) {
				const n = r.failures[c];
				if (n) ft[c] = (ft[c] ?? 0) + n;
			}
		}
		failureTotals[id] = ft;
	}

	return EvalsFile.parse({
		schemaVersion: base.schemaVersion,
		generatedAt: base.generatedAt,
		commitSha: base.commitSha,
		n: base.n,
		seed: base.seed,
		model: base.model,
		methodology: base.methodology,
		models,
		scenarios,
		totals,
		failureTotals,
		...(base.silentFailure ? { silentFailure: base.silentFailure } : {})
	});
}

// ---------------------------------------------------------------------------------------------
// Markdown (BRIEF source)
// Phase 12 BRIEF pastes table 1, Totals, table 2 and the footer verbatim. Do not reformat without updating 12-01.
// ---------------------------------------------------------------------------------------------

export function renderMarkdownTables(file: EvalsFile): string {
	const pct = (r: number) => Math.round(r * 100);
	const cell = (r: ScenarioResult) => `${pct(r.passRate)}% (${r.passed}/${r.runs})`;
	const label = (c: FailureClass) => FAILURE_CLASS_LABELS[c];
	const topClass = (failures: ScenarioResult['failures']): FailureClass | undefined => {
		let best: FailureClass | undefined;
		let max = 0;
		for (const c of FailureClass.options) {
			const n = failures[c] ?? 0;
			if (n > max) {
				max = n;
				best = c;
			}
		}
		return best;
	};
	const topLabel = (failures: ScenarioResult['failures']) => {
		const t = topClass(failures);
		return t ? label(t) : '—';
	};
	const kPart = (r: ScenarioResult) => {
		let ks = r.passHatK.filter((e) => e.k === 3 || e.k === r.runs);
		if (!ks.length) ks = r.passHatK;
		return ks.map((e) => `k=${e.k}: ${e.value.toFixed(2)}`).join(' · ');
	};
	const isKw = (s: EvalsFile['scenarios'][number]) => s.tags.includes('known-weakness');
	const primary = file.models.find((m) => m.kind === 'scripted' && m.config === 'verifier-on');
	const off = file.models.find((m) => m.kind === 'scripted' && m.config === 'verifier-off');
	const llm = file.models.find((m) => m.kind === 'llm');

	const lines: string[] = ['## Eval results', ''];

	// Table 1
	lines.push('| Scenario | N | FakeLLM pass rate | FakeLLM pass^k | Real-LLM pass rate | Real-LLM pass^k | Primary failure classes seen |');
	lines.push('|---|---|---|---|---|---|---|');
	for (const s of file.scenarios) {
		const pr = primary ? s.results[primary.id] : undefined;
		const lr = llm ? s.results[llm.id] : undefined;
		const classes: string[] = [];
		for (const m of file.models) {
			const r = s.results[m.id];
			if (!r) continue;
			for (const c of FailureClass.options) {
				const n = r.failures[c] ?? 0;
				if (n > 0) classes.push(`${label(c)} ×${n} (${m.label})`);
			}
		}
		lines.push(
			`| ${s.id} | ${pr?.runs ?? '—'} | ${pr ? cell(pr) : 'not run'} | ${pr ? kPart(pr) : 'not run'} | ${lr ? cell(lr) : 'not run'} | ${lr ? kPart(lr) : 'not run'} | ${classes.length ? classes.join('; ') : '—'} |`
		);
	}

	// Totals
	lines.push('', '**Totals:**');
	for (const m of file.models) {
		const t = file.totals[m.id];
		if (!t) continue;
		const scenariosRun = file.scenarios.filter((s) => s.results[m.id]).length;
		lines.push(
			`- ${m.label}: ${pct(t.passRate)}% of ${t.runs} runs over ${scenariosRun} scenarios, pass^k (all ${m.n} passed) in ${pct(t.passK)}% of them`
		);
	}

	// Silent failures
	lines.push('', '**Silent failures (the report claimed state the World does not hold):**');
	for (const m of file.models) {
		const t = file.totals[m.id];
		if (!t) continue;
		if (!t.silentFailures) {
			lines.push(`- ${m.label}: 0`);
			continue;
		}
		const src = file.scenarios.filter((s) => (s.results[m.id]?.silentFailures ?? 0) > 0);
		const parts = src.map((s) => `${s.id} ×${s.results[m.id].silentFailures}${isKw(s) ? ' (known weakness)' : ''}`);
		const allKw = src.length > 0 && src.every(isKw);
		lines.push(`- ${m.label}: ${t.silentFailures} (${parts.join('; ')})${allKw ? ' (all from known-weakness scenarios)' : ''}`);
	}

	// Seed note
	lines.push(
		'',
		`**Seed:** single base seed ${file.seed}, N=${file.n} per scenario for the scripted columns. Per-run seeds derive from the base seed, so probabilistic fault scenarios can give different counts under other base seeds.`
	);

	// Table 2: verifier on vs off
	if (primary && off) {
		const diff = file.scenarios.filter((s) => {
			const a = s.results[primary.id];
			const b = s.results[off.id];
			return a && b && a.passRate !== b.passRate;
		});
		if (diff.length) {
			lines.push('', '**Verifier on vs off (before/after):**', '');
			lines.push('| Scenario | Verifier on | Verifier off (before) | Before failure class |');
			lines.push('|---|---|---|---|');
			for (const s of diff) {
				const b = s.results[off.id];
				lines.push(`| ${s.id} | ${cell(s.results[primary.id])} | ${cell(b)} | ${topLabel(b.failures)} |`);
			}
		}
	}

	// Known weaknesses
	const kw = file.scenarios.filter(isKw);
	if (kw.length) {
		lines.push('', '**Known weaknesses (failing on purpose, Phase 5 W1-W3):**');
		for (const s of kw) {
			const r = primary ? s.results[primary.id] : undefined;
			lines.push(`- ${s.id}: ${r ? cell(r) : 'not run'}, ${r ? topLabel(r.failures) : '—'}`);
		}
	}

	// Below-100% notes
	const noteModels = file.models.filter((m) => m.config === 'verifier-on' && (m === primary || m.kind === 'llm'));
	const notes: string[] = [];
	for (const s of file.scenarios) {
		if (isKw(s)) continue;
		for (const m of noteModels) {
			const r = s.results[m.id];
			if (r && r.passRate < 1) notes.push(`- ${s.id} · ${m.label}: ${cell(r)}, ${topLabel(r.failures)}. ${s.description}`);
		}
	}
	if (notes.length) lines.push('', '**Below 100%, not known weaknesses:**', ...notes);

	// LLM columns
	const llms = file.models.filter((m) => m.kind === 'llm');
	if (llms.length) {
		lines.push('');
		for (const m of llms) {
			lines.push(
				`LLM columns: ${m.label}, model ${m.model}, N=${m.n}, commit ${m.commitSha}, generated ${m.generatedAt}, seed ${m.llm?.seed ?? 'n/a'}, temperature ${m.llm?.temperature ?? 'n/a'}.`
			);
		}
	}

	lines.push('', `Generated from static/data/evals.json (commit ${file.commitSha}, seed ${file.seed}, ${file.generatedAt}).`);
	return lines.join('\n') + '\n';
}

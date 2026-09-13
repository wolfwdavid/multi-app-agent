// evals.json contract (07-UI-SPEC EvalsFile) and builders. Pure: generatedAt and commitSha are inputs.
import { z } from 'zod';
import { FailureClass } from '../schemas.ts';
import { aggregateScenario } from './metrics.ts';
import type { SuiteResult } from './runner.ts';

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
	commitSha: z.string().min(1)
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
		commitSha: meta.commitSha
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
		failureTotals
	});
}

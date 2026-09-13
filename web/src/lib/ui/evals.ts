// Eval dashboard data contracts (07-UI-SPEC "Screen 2") and view helpers.
// Single adapter point for the Phase 6 JSON shape: components consume only the types exported here.
// Pure: no $app/svelte imports.
import { z } from 'zod';
import { FailureClass, RunReport, TraceEvent } from '../core/schemas.ts';
import { DATA_PATHS } from './config.ts';
import { fromSchema, type Parser } from './data.ts';

const FailureCounts = z.partialRecord(FailureClass, z.number().nonnegative());

// Loose objects: Phase 6 adds fields (passHatK, silentFailures, config, llm metadata) the UI may ignore.
const PassHatK = z.array(z.object({ k: z.number().int().positive(), value: z.number().min(0).max(1) }));

const ScenarioResult = z.looseObject({
	runs: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	passRate: z.number().min(0).max(1),
	passK: z.union([z.boolean(), z.number().min(0).max(1)]),
	/** tau-bench unbiased pass^k estimates C(c,k)/C(n,k), one entry per reported k. */
	passHatK: PassHatK.optional(),
	failures: FailureCounts
});

const EvalModel = z.looseObject({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(['scripted', 'llm']),
	model: z.string().optional(),
	config: z.string().optional(),
	n: z.number().int().nonnegative().optional(),
	generatedAt: z.string().optional(),
	commitSha: z.string().optional(),
	llm: z
		.looseObject({
			provider: z.string().optional(),
			seed: z.number().nullable().optional(),
			temperature: z.number().nullable().optional(),
			numCtx: z.number().nullable().optional()
		})
		.optional()
});

const EvalScenario = z.looseObject({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	tags: z.array(z.string()).optional(),
	adversarial: z.boolean().optional(),
	results: z.record(z.string(), ScenarioResult)
});

export const EvalsFile = z.looseObject({
	generatedAt: z.string().min(1),
	commitSha: z.string().min(1),
	n: z.number().int().nonnegative(),
	models: z.array(EvalModel).min(1),
	scenarios: z.array(EvalScenario),
	totals: z.record(
		z.string(),
		z.looseObject({
			runs: z.number().int().nonnegative(),
			passed: z.number().int().nonnegative(),
			passRate: z.number().min(0).max(1),
			passK: z.number().min(0).max(1)
		})
	),
	silentFailure: z.object({ file: z.string().min(1), scenarioId: z.string().min(1) }).optional()
});
export type EvalsFile = z.infer<typeof EvalsFile>;
export type EvalModel = z.infer<typeof EvalModel>;
export type EvalScenario = z.infer<typeof EvalScenario>;
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const SilentFailureRun = z.looseObject({
	recordedAt: z.string().min(1),
	commitSha: z.string().min(1),
	scenarioId: z.string().min(1),
	description: z.string(),
	events: z.array(TraceEvent).min(1),
	report: RunReport,
	oracle: z.object({
		caught: z.boolean(),
		failureClass: FailureClass.nullable(),
		expected: z.string(),
		found: z.string(),
		stepSpanId: z.string().min(1)
	})
});
export type SilentFailureRun = z.infer<typeof SilentFailureRun>;

// The committed Phase 6 files already use the UI-SPEC field names, so no renaming happens before safeParse.
export const parseEvalsFile: Parser<EvalsFile> = fromSchema(EvalsFile);
export const parseSilentFailureRun: Parser<SilentFailureRun> = fromSchema(SilentFailureRun);

export const FAILURE_LABELS: Record<FailureClass, { label: string; definition: string }> = {
	skipped_work: { label: 'Skipped work', definition: 'A required artifact was never created.' },
	out_of_scope_work: { label: 'Out-of-scope work', definition: 'Wrote something that was not in the approved plan.' },
	instruction_violation: {
		label: 'Instruction violation',
		definition: 'Broke a hard rule such as no-send or the recipient allowlist.'
	},
	integration_failure: { label: 'Integration failure', definition: 'An app error was not recovered or reported.' },
	retry_loop: { label: 'Retry loop', definition: 'Retried past the cap or repeated the same step.' },
	hallucination: { label: 'Hallucination', definition: 'Stated a fact or achievement with no evidence.' },
	communication_failure: {
		label: 'Communication failure',
		definition: 'The report did not match the real final state.'
	}
};

/** First scripted model (the no-key baseline), else the first model. */
export function primaryModel(evals: EvalsFile): EvalModel {
	return evals.models.find((m) => m.kind === 'scripted') ?? evals.models[0];
}

export function llmModel(evals: EvalsFile): EvalModel | null {
	return evals.models.find((m) => m.kind === 'llm') ?? null;
}

export interface TaxonomyEntry {
	cls: FailureClass;
	label: string;
	definition: string;
	count: number;
}

/** All 7 classes in enum order (zeros included), summed across scenarios for one model. */
export function taxonomy(evals: EvalsFile, modelId: string): { entries: TaxonomyEntry[]; max: number } {
	const entries = FailureClass.options.map((cls) => {
		let count = 0;
		for (const s of evals.scenarios) count += s.results[modelId]?.failures[cls] ?? 0;
		return { cls, ...FAILURE_LABELS[cls], count };
	});
	return { entries, max: Math.max(0, ...entries.map((e) => e.count)) };
}

/** Most frequent failure class across all models for a scenario; ties resolve by enum order. */
export function topFailure(scenario: EvalScenario): FailureClass | null {
	let best: FailureClass | null = null;
	let bestCount = 0;
	for (const cls of FailureClass.options) {
		let count = 0;
		for (const r of Object.values(scenario.results)) count += r.failures[cls] ?? 0;
		if (count > bestCount) {
			best = cls;
			bestCount = count;
		}
	}
	return best;
}

export function scenarioAllPassed(result: { passK: boolean | number }): boolean {
	return result.passK === true || (typeof result.passK === 'number' && result.passK >= 1);
}

/** Scenarios flagged adversarial; null when the file carries no adversarial/tags data. */
export function adversarialCount(evals: EvalsFile): number | null {
	const known = evals.scenarios.some((s) => typeof s.adversarial === 'boolean' || Array.isArray(s.tags));
	if (!known) return null;
	return evals.scenarios.filter((s) => s.adversarial === true || (s.tags ?? []).includes('adversarial')).length;
}

const KNOWN_WEAKNESS = 'known-weakness';

const numField = (o: object | undefined, key: string): number | null => {
	const v = (o as Record<string, unknown> | undefined)?.[key];
	return typeof v === 'number' ? v : null;
};

/** Scenarios tagged known-weakness that do not fully pass for a model. */
export function knownWeaknessFailing(evals: EvalsFile, modelId: string): number {
	return evals.scenarios.filter(
		(s) => (s.tags ?? []).includes(KNOWN_WEAKNESS) && s.results[modelId] !== undefined && s.results[modelId].passRate < 1
	).length;
}

export interface SilentFailureStats {
	/** Runs whose report claimed state the World does not hold, for the primary model. */
	uncaught: number;
	scenarios: number;
	knownWeaknessScenarios: number;
	/** Another scripted config (e.g. verifier off) for contrast, when the file carries one. */
	comparison: { label: string; uncaught: number } | null;
}

/** Null when the file predates per-model silentFailures totals. */
export function silentFailureStats(evals: EvalsFile): SilentFailureStats | null {
	const p = primaryModel(evals);
	const uncaught = numField(evals.totals[p.id], 'silentFailures');
	if (uncaught === null) return null;
	const hit = evals.scenarios.filter((s) => (numField(s.results[p.id], 'silentFailures') ?? 0) > 0);
	const other = evals.models.find(
		(m) => m.id !== p.id && m.kind === 'scripted' && numField(evals.totals[m.id], 'silentFailures') !== null
	);
	return {
		uncaught,
		scenarios: hit.length,
		knownWeaknessScenarios: hit.filter((s) => (s.tags ?? []).includes(KNOWN_WEAKNESS)).length,
		comparison: other ? { label: other.label, uncaught: numField(evals.totals[other.id], 'silentFailures')! } : null
	};
}

export function silentFailurePath(evals: EvalsFile): string {
	return evals.silentFailure?.file ?? DATA_PATHS.silentFailure;
}

export const isKnownWeakness = (s: EvalScenario): boolean => (s.tags ?? []).includes(KNOWN_WEAKNESS);

/** Runs per scenario a model was configured for (per-model n, else the file n). */
export const modelN = (evals: EvalsFile, m: EvalModel): number => m.n ?? evals.n;

/** Real pass^k entries for one result, sorted by k; null when the file predates passHatK. */
export function passHatK(r: ScenarioResult): { k: number; value: number }[] | null {
	if (!r.passHatK?.length) return null;
	return [...r.passHatK].sort((a, b) => a.k - b.k);
}

export interface KPoint {
	k: number;
	/** Mean pass^k over the scenarios that report this k. */
	mean: number;
	scenarios: number;
}

/** Mean pass^k per k across a model's scenarios (the k-curve); null without passHatK data. */
export function kCurve(evals: EvalsFile, modelId: string): KPoint[] | null {
	const byK = new Map<number, number[]>();
	for (const s of evals.scenarios) {
		const r = s.results[modelId];
		for (const e of r ? (passHatK(r) ?? []) : []) {
			const list = byK.get(e.k) ?? [];
			list.push(e.value);
			byK.set(e.k, list);
		}
	}
	if (byK.size === 0) return null;
	return [...byK.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([k, v]) => ({ k, mean: v.reduce((a, b) => a + b, 0) / v.length, scenarios: v.length }));
}

/** The pass^k point at k = N for a model (falls back to the largest reported k). */
export function headlinePassHatK(evals: EvalsFile, m: EvalModel): KPoint | null {
	const curve = kCurve(evals, m.id);
	if (!curve) return null;
	return curve.find((p) => p.k === modelN(evals, m)) ?? curve[curve.length - 1];
}

/** Most frequent failure class for one model's result, only when that result is below 100%. */
export function topFailureFor(r: ScenarioResult | undefined): FailureClass | null {
	if (!r || r.passRate >= 1) return null;
	let best: FailureClass | null = null;
	let bestCount = 0;
	for (const cls of FailureClass.options) {
		const count = r.failures[cls] ?? 0;
		if (count > bestCount) {
			best = cls;
			bestCount = count;
		}
	}
	return best;
}

export interface ModelCoverage {
	n: number;
	scenariosRun: number;
	scenariosTotal: number;
	runs: number;
	passed: number;
	passRate: number | null;
	/** Some scenarios have no result for this model. */
	partial: boolean;
}

/** Computed from per-scenario results, so a partial column is never padded with other models' numbers. */
export function modelCoverage(evals: EvalsFile, m: EvalModel): ModelCoverage {
	const rs = evals.scenarios.map((s) => s.results[m.id]).filter((r): r is ScenarioResult => r !== undefined);
	const runs = rs.reduce((a, r) => a + r.runs, 0);
	const passed = rs.reduce((a, r) => a + r.passed, 0);
	return {
		n: modelN(evals, m),
		scenariosRun: rs.length,
		scenariosTotal: evals.scenarios.length,
		runs,
		passed,
		passRate: runs > 0 ? passed / runs : null,
		partial: rs.length < evals.scenarios.length
	};
}

/** Short coverage tag for headers and selects: "N=1 · 2 of 23 scenarios" (scenario count only when partial). */
export function coverageTag(evals: EvalsFile, m: EvalModel): string {
	const c = modelCoverage(evals, m);
	return c.partial ? `N=${c.n} · ${c.scenariosRun} of ${c.scenariosTotal} scenarios` : `N=${c.n}`;
}

export interface LlmColumn {
	model: EvalModel;
	coverage: ModelCoverage;
	/** "ollama · qwen3.5:4b · temperature 0 · seed 7 · num_ctx 8192" (only fields present). */
	meta: string;
}

/** LLM columns, reported apart from the scripted baseline headline numbers. */
export function llmColumns(evals: EvalsFile): LlmColumn[] {
	return evals.models
		.filter((m) => m.kind === 'llm')
		.map((m) => {
			const parts: string[] = [];
			if (m.llm?.provider) parts.push(m.llm.provider);
			if (m.model) parts.push(m.model);
			if (typeof m.llm?.temperature === 'number') parts.push(`temperature ${m.llm.temperature}`);
			if (typeof m.llm?.seed === 'number') parts.push(`seed ${m.llm.seed}`);
			if (typeof m.llm?.numCtx === 'number') parts.push(`num_ctx ${m.llm.numCtx}`);
			return { model: m, coverage: modelCoverage(evals, m), meta: parts.join(' · ') };
		});
}

export interface ConfigTotals {
	label: string;
	runs: number;
	passed: number;
	passRate: number;
	silentFailures: number | null;
	passHatN: KPoint | null;
}

/** Verifier-on (primary) vs verifier-off scripted totals, straight from evals.json totals; null if either is absent. */
export function verifierComparison(evals: EvalsFile): { on: ConfigTotals; off: ConfigTotals } | null {
	const on = primaryModel(evals);
	if (on.kind !== 'scripted') return null;
	const off =
		evals.models.find((m) => m.kind === 'scripted' && m.config === 'verifier-off') ??
		evals.models.find((m) => m.kind === 'scripted' && m.id !== on.id && m.config === undefined);
	if (!off || off.id === on.id) return null;
	const pick = (m: EvalModel): ConfigTotals | null => {
		const t = evals.totals[m.id];
		if (!t) return null;
		return {
			label: m.label,
			runs: t.runs,
			passed: t.passed,
			passRate: t.passRate,
			silentFailures: numField(t, 'silentFailures'),
			passHatN: headlinePassHatK(evals, m)
		};
	};
	const a = pick(on);
	const b = pick(off);
	return a && b ? { on: a, off: b } : null;
}

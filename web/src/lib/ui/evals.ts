// Eval dashboard data contracts (07-UI-SPEC "Screen 2") and view helpers.
// Single adapter point for the Phase 6 JSON shape: components consume only the types exported here.
// Pure: no $app/svelte imports.
import { z } from 'zod';
import { FailureClass, RunReport, TraceEvent } from '../core/schemas.ts';
import { DATA_PATHS } from './config.ts';
import { fromSchema, type Parser } from './data.ts';

const FailureCounts = z.partialRecord(FailureClass, z.number().nonnegative());

// Loose objects: Phase 6 adds fields (passHatK, silentFailures, config, llm metadata) the UI may ignore.
const ScenarioResult = z.looseObject({
	runs: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	passRate: z.number().min(0).max(1),
	passK: z.union([z.boolean(), z.number().min(0).max(1)]),
	failures: FailureCounts
});

const EvalModel = z.looseObject({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.enum(['scripted', 'llm'])
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

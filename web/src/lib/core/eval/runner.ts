// N-run eval suite runner.
//
// - Seeded variation comes from runSeedFor, which drives the probabilistic fault rules (429 burst, ghost writes, lying API).
// - The FakeLLM column measures harness and connector reliability. LLM columns (Phase 8) measure model variance.
// - Runs are sequential and use per-run Worlds, so there is no cross-run contamination.
import type { LLM } from '../llm/types.ts';
import type { FailureClass } from '../schemas.ts';
import { runAgent, type AgentRun } from './agent.ts';
import { classifyFailure } from './classify.ts';
import { gradeRun } from './oracle.ts';
import { prepareRun, type PreparedRun } from './setup.ts';
import { AGENT_CONFIGS, type AgentConfig, type OracleResult, type Scenario } from './types.ts';

export interface ModelColumn {
	id: string;
	label: string;
	kind: 'scripted' | 'llm';
	config: AgentConfig;
	model: string;
	llm?: () => LLM;
	/** Key-free model metadata for LLM columns (written to evals.json models[].llm). Ignored by runSuite. */
	llmMeta?: { provider: 'fake' | 'ollama' | 'hosted'; seed: number | null; temperature: number | null; numCtx: number | null };
}
export interface RunRecord {
	scenarioId: string;
	modelId: string;
	runIndex: number;
	runSeed: number;
	passed: boolean;
	primary: FailureClass | null;
	secondary: FailureClass[];
	reasons: string[];
	failedChecks: string[];
	reportStatus: 'ok' | 'partial' | 'failed' | 'none';
	silentFailure: boolean;
}
export interface KeptRun {
	record: RunRecord;
	prepared: PreparedRun;
	run: AgentRun;
	oracle: OracleResult;
}
export interface SuiteResult {
	n: number;
	seed: number;
	columns: ModelColumn[];
	scenarios: Scenario[];
	records: RunRecord[];
	kept: KeptRun[];
}

export function fakeColumns(): ModelColumn[] {
	return [
		{ id: 'fake', label: 'FakeLLM (scripted policy)', kind: 'scripted', config: AGENT_CONFIGS['verifier-on'], model: 'fake-scripted' },
		{
			id: 'fake-verifier-off',
			label: 'FakeLLM, verifier off (before)',
			kind: 'scripted',
			config: AGENT_CONFIGS['verifier-off'],
			model: 'fake-scripted'
		}
	];
}

export async function runSuite(opts: {
	scenarios: Scenario[];
	columns: ModelColumn[];
	n: number;
	seed: number;
	onRecord?: (r: RunRecord) => void;
}): Promise<SuiteResult> {
	const { scenarios, columns, n, seed } = opts;
	const records: RunRecord[] = [];
	const kept: KeptRun[] = [];
	for (const scenario of scenarios) {
		for (const column of columns) {
			let keptFailure = false;
			for (let runIndex = 0; runIndex < n; runIndex++) {
				const prepared = await prepareRun(scenario, runIndex, seed);
				const run = await runAgent(prepared, column.config, column.llm ? { llm: column.llm } : undefined);
				const oracle = gradeRun({
					scenario,
					profile: prepared.profile,
					passes: prepared.passes,
					seedSnapshot: prepared.seedSnapshot,
					run
				});
				const cls = classifyFailure(oracle, run.passes);
				const record: RunRecord = {
					scenarioId: scenario.id,
					modelId: column.id,
					runIndex,
					runSeed: prepared.runSeed,
					passed: oracle.passed,
					primary: cls.primary,
					secondary: cls.secondary,
					reasons: cls.reasons,
					failedChecks: oracle.failedRequired.map((c) => c.id),
					reportStatus: run.passes.at(-1)?.report?.status ?? 'none',
					silentFailure: oracle.silentFailure
				};
				records.push(record);
				const firstFailure = !record.passed && !keptFailure;
				if (firstFailure) keptFailure = true;
				if (runIndex === 0 || firstFailure) kept.push({ record, prepared, run, oracle });
				opts.onRecord?.(record);
			}
		}
	}
	return { n, seed, columns, scenarios, records, kept };
}

import { beforeAll, describe, expect, it } from 'vitest';
import { aggregateScenario, kValues, passHatK } from './metrics.ts';
import { buildEvalsFile, EvalsFile } from './report.ts';
import { fakeColumns, runSuite, type SuiteResult } from './runner.ts';
import { getScenario } from './scenarios.ts';
import { runSeedFor } from './setup.ts';
import { AGENT_CONFIGS } from './types.ts';

describe('metrics', () => {
	it('passHatK matches tau-bench C(c,k)/C(n,k)', () => {
		expect(passHatK(10, 10, 10)).toBe(1);
		expect(passHatK(10, 9, 10)).toBe(0);
		expect(passHatK(10, 9, 1)).toBeCloseTo(0.9, 10);
		expect(passHatK(10, 8, 3)).toBeCloseTo(56 / 120, 10);
		expect(passHatK(5, 5, 3)).toBe(1);
		expect(passHatK(5, 2, 3)).toBe(0);
		expect(() => passHatK(3, 3, 5)).toThrow();
	});
	it('kValues', () => {
		expect(kValues(10)).toEqual([1, 3, 5, 10]);
		expect(kValues(3)).toEqual([1, 3]);
		expect(kValues(1)).toEqual([1]);
	});
	it('aggregateScenario', () => {
		const ok = { passed: true, primary: null, silentFailure: false };
		expect(aggregateScenario([ok, ok, ok, { passed: false, primary: 'integration_failure', silentFailure: false }])).toEqual({
			runs: 4,
			passed: 3,
			passRate: 0.75,
			passK: false,
			failures: { integration_failure: 1 },
			silentFailures: 0,
			passHatK: [
				{ k: 1, value: 0.75 },
				{ k: 3, value: 0.25 },
				{ k: 4, value: 0 }
			]
		});
	});
});

describe('runSuite', () => {
	const ids = ['happy-path', 'lying-success', 'retries-exhausted'];
	const opts = () => ({ scenarios: ids.map(getScenario), columns: fakeColumns(), n: 3, seed: 1337 });
	let suite: SuiteResult;
	beforeAll(async () => {
		suite = await runSuite(opts());
	}, 15000);

	it('fakeColumns', () => {
		expect(fakeColumns().map(({ llm: _l, ...c }) => c)).toEqual([
			{ id: 'fake', label: 'FakeLLM (scripted policy)', kind: 'scripted', config: AGENT_CONFIGS['verifier-on'], model: 'fake-scripted' },
			{ id: 'fake-verifier-off', label: 'FakeLLM, verifier off (before)', kind: 'scripted', config: AGENT_CONFIGS['verifier-off'], model: 'fake-scripted' }
		]);
	});
	it('runs every scenario x column x N with seeded run seeds', () => {
		expect(suite.records).toHaveLength(18);
		for (const r of suite.records) expect(r.runSeed).toBe(runSeedFor(1337, r.scenarioId, r.runIndex));
	});
	it('grades the lying API: verifier-on passes, verifier-off is a silent communication failure', () => {
		const of = (s: string, m: string) => suite.records.filter((r) => r.scenarioId === s && r.modelId === m);
		expect(of('happy-path', 'fake').every((r) => r.passed)).toBe(true);
		expect(of('happy-path', 'fake-verifier-off').every((r) => r.passed)).toBe(true);
		expect(of('lying-success', 'fake').every((r) => r.passed)).toBe(true);
		const off = of('lying-success', 'fake-verifier-off');
		expect(off.every((r) => !r.passed && r.primary === 'communication_failure' && r.silentFailure)).toBe(true);
		expect(of('retries-exhausted', 'fake').every((r) => r.passed)).toBe(true);
	});
	it('keeps runIndex 0 per scenario x column', () => {
		for (const s of ids)
			for (const c of ['fake', 'fake-verifier-off'])
				expect(suite.kept.some((k) => k.record.scenarioId === s && k.record.modelId === c && k.record.runIndex === 0)).toBe(true);
	});
	it('is deterministic', async () => {
		const again = await runSuite(opts());
		expect(again.records).toEqual(suite.records);
	}, 15000);
	it('buildEvalsFile produces a valid EvalsFile', () => {
		const f = buildEvalsFile(suite, { generatedAt: '2026-09-13T20:00:00.000Z', commitSha: 'abc1234', seed: 1337 });
		expect(EvalsFile.safeParse(f).success).toBe(true);
		expect(f.n).toBe(3);
		expect(f.models.map((m) => m.id)).toEqual(['fake', 'fake-verifier-off']);
		const lying = f.scenarios.find((s) => s.id === 'lying-success')!;
		expect(lying.adversarial).toBe(lying.tags.includes('adversarial'));
		expect(lying.results['fake'].passK).toBe(true);
		expect(f.failureTotals['fake-verifier-off'].communication_failure).toBe(3);
		const share = f.scenarios.filter((s) => s.results['fake'].passK).length / f.scenarios.length;
		expect(f.totals['fake'].passK).toBeCloseTo(share, 4);
	});
});

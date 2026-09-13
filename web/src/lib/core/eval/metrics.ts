// Eval metrics: pass rate and tau-bench pass^k. Pure, deterministic.
import type { FailureClass } from '../schemas.ts';

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** tau-bench pass^k: probability that k i.i.d. trials all pass, estimated without bias from c passes in n runs: C(c,k)/C(n,k). */
export function passHatK(n: number, c: number, k: number): number {
	if (!Number.isInteger(n) || !Number.isInteger(c) || !Number.isInteger(k)) throw new Error('passHatK: integers required');
	if (c < 0 || c > n) throw new Error(`passHatK: c must be in 0..n (n=${n}, c=${c})`);
	if (k < 1 || k > n) throw new Error(`passHatK: k must be in 1..n (n=${n}, k=${k})`);
	if (c < k) return 0;
	let p = 1;
	for (let i = 0; i < k; i++) p *= (c - i) / (n - i);
	return p;
}

/** [1, 3, 5, n] filtered to <= n, unique, ascending. */
export function kValues(n: number): number[] {
	return [...new Set([1, 3, 5, n].filter((k) => k >= 1 && k <= n))].sort((a, b) => a - b);
}

export interface ScenarioAggregate {
	runs: number;
	passed: number;
	passRate: number;
	passK: boolean;
	passHatK: { k: number; value: number }[];
	failures: Partial<Record<FailureClass, number>>;
	silentFailures: number;
}

export function aggregateScenario(
	records: ReadonlyArray<{ passed: boolean; primary: FailureClass | null; silentFailure: boolean }>
): ScenarioAggregate {
	const runs = records.length;
	const passed = records.filter((r) => r.passed).length;
	const failures: Partial<Record<FailureClass, number>> = {};
	for (const r of records) {
		if (r.passed || !r.primary) continue;
		failures[r.primary] = (failures[r.primary] ?? 0) + 1;
	}
	return {
		runs,
		passed,
		passRate: runs ? round4(passed / runs) : 0,
		passK: runs > 0 && passed === runs,
		passHatK: runs ? kValues(runs).map((k) => ({ k, value: round4(passHatK(runs, passed, k)) })) : [],
		failures,
		silentFailures: records.filter((r) => r.silentFailure).length
	};
}

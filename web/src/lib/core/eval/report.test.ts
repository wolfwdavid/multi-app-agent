import { beforeAll, describe, expect, it } from 'vitest';
import {
	buildEvalsFile,
	buildSilentFailureRun,
	EvalsFile,
	mergeEvalsFiles,
	renderMarkdownTables,
	SilentFailureRun
} from './report.ts';
import { fakeColumns, runSuite, type KeptRun, type ModelColumn, type SuiteResult } from './runner.ts';
import { getScenario } from './scenarios.ts';

const META = { generatedAt: '2026-09-13T20:00:00.000Z', commitSha: 'abc1234', seed: 1337 };
const ids = ['happy-path', 'lying-success', 'retries-exhausted'];

let suite: SuiteResult;
let file: EvalsFile;
let incA: EvalsFile;
let incB: EvalsFile;
let merged: EvalsFile;
const llmMeta = { provider: 'ollama' as const, seed: 42, temperature: 0, numCtx: 8192 };

const kept = (s: SuiteResult, scenarioId: string, modelId: string): KeptRun =>
	s.kept.find((k) => k.record.scenarioId === scenarioId && k.record.modelId === modelId && k.record.runIndex === 0)!;

beforeAll(async () => {
	suite = await runSuite({ scenarios: ids.map(getScenario), columns: fakeColumns(), n: 2, seed: 1337 });
	file = buildEvalsFile(suite, META);
	const llmCol: ModelColumn = { ...fakeColumns()[0], id: 'llm-ollama', label: 'm (ollama)', kind: 'llm', llmMeta };
	const sa = await runSuite({ scenarios: [getScenario('happy-path')], columns: [llmCol], n: 1, seed: 1337 });
	const sb = await runSuite({ scenarios: [getScenario('lying-success')], columns: [llmCol], n: 1, seed: 1337 });
	incA = buildEvalsFile(sa, META);
	incB = buildEvalsFile(sb, META);
	merged = mergeEvalsFiles(file, incA);
}, 15000);

describe('buildEvalsFile silentFailure pointer and model metadata', () => {
	it('points at the silent-failure replay when lying-success ran', () => {
		expect(file.silentFailure).toEqual({ file: 'data/silent-failure-run.json', scenarioId: 'lying-success' });
	});
	it('leaves the pointer undefined without lying-success', () => {
		const sub: SuiteResult = {
			...suite,
			scenarios: suite.scenarios.filter((s) => s.id !== 'lying-success'),
			records: suite.records.filter((r) => r.scenarioId !== 'lying-success')
		};
		expect(buildEvalsFile(sub, META).silentFailure).toBeUndefined();
	});
	it('fake models carry no llm key', () => {
		expect(file.models.every((m) => !('llm' in m))).toBe(true);
	});
});

describe('buildSilentFailureRun', () => {
	let sf: SilentFailureRun;
	beforeAll(() => {
		sf = buildSilentFailureRun({
			on: kept(suite, 'lying-success', 'fake'),
			off: kept(suite, 'lying-success', 'fake-verifier-off'),
			recordedAt: META.generatedAt,
			commitSha: 'abc1234'
		});
	});
	it('parses as SilentFailureRun', () => {
		expect(SilentFailureRun.safeParse(sf).success).toBe(true);
	});
	it('oracle block: caught communication failure', () => {
		expect(sf.oracle.caught).toBe(true);
		expect(sf.oracle.failureClass).toBe('communication_failure');
	});
	it('stepSpanId points at the failed read-back of the Berkeley deadline event', () => {
		// start and end events share a spanId; the replay step is the END event of that span
		const ev = sf.events.find((e) => e.spanId === sf.oracle.stepSpanId && e.kind === 'end');
		expect(ev).toBeDefined();
		expect(ev!.name).toBe('verify.readback');
		expect(ev!.kind).toBe('end');
		expect(ev!.attrs.found).toBe(false);
		expect(ev!.attrs.actionId).toBe('uc-berkeley-data-science-ba.event_deadline');
	});
	it('expected and found text', () => {
		expect(sf.oracle.expected).toContain('calendar.createEvent');
		expect(sf.oracle.expected).toContain('uc-berkeley-data-science-ba.event_deadline');
		expect(sf.oracle.found).toContain('no calendar event');
		expect(sf.oracle.found).toContain('9 of 13');
	});
	it('report and verifier-off before block', () => {
		expect(sf.report.status).toBe('partial');
		expect(sf.before?.config).toBe('verifier-off');
		expect(sf.before?.report.status).toBe('ok');
		expect(sf.before?.oraclePassed).toBe(false);
		expect(sf.before?.failureClass).toBe('communication_failure');
		expect(sf.before?.failedChecks).toContain('honesty.status_matches_state');
	});
	it('contains no student PII', () => {
		const s = JSON.stringify(sf);
		expect(s).not.toContain('Alex Rivera');
		expect(s).not.toContain('alex.rivera@example.com');
	});
	it('throws when the on-run has no mismatch artifact', () => {
		expect(() =>
			buildSilentFailureRun({
				on: kept(suite, 'happy-path', 'fake'),
				off: kept(suite, 'lying-success', 'fake-verifier-off'),
				recordedAt: META.generatedAt,
				commitSha: 'abc1234'
			})
		).toThrow(/silent failure not caught/);
	});
});

describe('mergeEvalsFiles', () => {
	it('keeps base columns untouched and appends the llm column', () => {
		expect(merged.scenarios.map((s) => s.results.fake)).toEqual(file.scenarios.map((s) => s.results.fake));
		expect(merged.totals.fake).toEqual(file.totals.fake);
		expect(merged.failureTotals['fake-verifier-off']).toEqual(file.failureTotals['fake-verifier-off']);
		expect(merged.models.map((m) => m.id)).toEqual(['fake', 'fake-verifier-off', 'llm-ollama']);
		expect(merged.models[2].llm).toEqual(llmMeta);
		expect(merged.scenarios.find((s) => s.id === 'happy-path')!.results['llm-ollama'].runs).toBe(1);
		expect(merged.scenarios.find((s) => s.id === 'retries-exhausted')!.results['llm-ollama']).toBeUndefined();
		expect(merged.totals['llm-ollama']).toEqual(incA.totals['llm-ollama']);
		expect(merged.generatedAt).toBe(file.generatedAt);
		expect(merged.commitSha).toBe(file.commitSha);
		expect(merged.n).toBe(file.n);
		expect(merged.seed).toBe(file.seed);
		expect(merged.silentFailure).toEqual(file.silentFailure);
	});
	it('accumulates llm subsets across batches and is idempotent', () => {
		const acc = mergeEvalsFiles(mergeEvalsFiles(file, incA), incB);
		expect(acc.scenarios.find((s) => s.id === 'happy-path')!.results['llm-ollama']).toBeDefined();
		expect(acc.scenarios.find((s) => s.id === 'lying-success')!.results['llm-ollama']).toBeDefined();
		const sum = (incA.totals['llm-ollama'].passed ?? 0) + (incB.totals['llm-ollama'].passed ?? 0);
		expect(acc.totals['llm-ollama'].runs).toBe(2);
		expect(acc.totals['llm-ollama'].passed).toBe(sum);
		expect(mergeEvalsFiles(merged, incA)).toEqual(merged);
	});
	it('filtered merge preserves an llm column on a fake refresh', () => {
		const refreshed = mergeEvalsFiles(file, merged, { models: (m) => m.kind === 'llm' });
		expect(refreshed.scenarios.map((s) => s.results.fake)).toEqual(file.scenarios.map((s) => s.results.fake));
		expect(refreshed.models.map((m) => m.id)).toEqual(['fake', 'fake-verifier-off', 'llm-ollama']);
		expect(refreshed.totals['llm-ollama']).toEqual(merged.totals['llm-ollama']);
	});
});

describe('renderMarkdownTables', () => {
	const HEADER =
		'| Scenario | N | FakeLLM pass rate | FakeLLM pass^k | Real-LLM pass rate | Real-LLM pass^k | Primary failure classes seen |';
	const row = (md: string, id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} |`))!;
	const cells = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim());

	it('table 1 header, one row per scenario, not-run LLM cells', () => {
		const md = renderMarkdownTables(file);
		expect(md.split('\n')).toContain(HEADER);
		for (const s of file.scenarios) expect(md.split('\n').filter((l) => l.startsWith(`| ${s.id} |`)).length).toBeGreaterThanOrEqual(1);
		const lying = row(md, 'lying-success');
		expect(lying).toContain('100% (2/2)');
		expect(cells(lying)[4]).toBe('not run');
		expect(cells(lying)[5]).toBe('not run');
		expect(md.endsWith('\n')).toBe(true);
	});
	it('table 2, totals, seed note, silent failures and footer', () => {
		const md = renderMarkdownTables(file);
		expect(md).toContain('| Scenario | Verifier on | Verifier off (before) | Before failure class |');
		const t2 = md.split('\n').filter((l) => l.startsWith('| lying-success |') && l.includes('Communication failure'));
		expect(t2.length).toBeGreaterThanOrEqual(1);
		expect(md).toContain('**Totals:**');
		expect(md).toContain('single base seed 1337');
		expect(md).toContain('**Silent failures');
		const offLine = md.split('\n').find((l) => l.startsWith('- FakeLLM, verifier off (before): ') && l.includes('×'));
		expect(offLine).toContain('lying-success ×2');
		expect(md.split('\n').some((l) => l.startsWith('Generated from static/data/evals.json (commit abc1234, seed 1337'))).toBe(true);
	});
	it('silent failure attribution and known weaknesses on a tagged clone', () => {
		const c = structuredClone(file);
		const re = c.scenarios.find((s) => s.id === 'retries-exhausted')!;
		re.tags.push('known-weakness');
		re.results.fake.silentFailures = 2;
		c.totals.fake.silentFailures = 2;
		const md = renderMarkdownTables(c);
		const fakeLine = md.split('\n').find((l) => l.startsWith('- FakeLLM (scripted policy): ') && l.includes('×'))!;
		expect(fakeLine).toContain('retries-exhausted ×2 (known weakness)');
		expect(fakeLine).toContain('(all from known-weakness scenarios)');
		expect(md).toContain('**Known weaknesses (failing on purpose, Phase 5 W1-W3):**');
		expect(md.split('\n').some((l) => l.startsWith('- retries-exhausted:'))).toBe(true);
		expect(renderMarkdownTables(file)).not.toContain('Known weaknesses');
	});
	it('below-100% notes for non-known-weakness scenarios', () => {
		const c = structuredClone(file);
		c.scenarios.find((s) => s.id === 'retries-exhausted')!.results.fake = {
			runs: 2,
			passed: 1,
			passRate: 0.5,
			passK: false,
			failures: { integration_failure: 1 },
			passHatK: [
				{ k: 1, value: 0.5 },
				{ k: 2, value: 0 }
			],
			silentFailures: 0
		};
		const md = renderMarkdownTables(c);
		expect(md).toContain('**Below 100%, not known weaknesses:**');
		expect(md.split('\n').some((l) => l.startsWith('- retries-exhausted · FakeLLM (scripted policy): 50% (1/2), Integration failure.'))).toBe(true);
		expect(renderMarkdownTables(file)).not.toContain('Below 100%');
	});
	it('fills Real-LLM cells from a merged llm column', () => {
		const md = renderMarkdownTables(merged);
		const hp = cells(row(md, 'happy-path'));
		expect(hp[4]).not.toBe('not run');
		expect(hp[4]).toMatch(/^\d+% \(\d\/1\)$/);
		expect(cells(row(md, 'lying-success'))[4]).toBe('not run');
		expect(md.split('\n').some((l) => l.startsWith('LLM columns:') && l.includes('m (ollama)'))).toBe(true);
	});
});

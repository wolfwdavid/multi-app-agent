import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FailureClass } from '../core/schemas.ts';
import { sampleEvals, sampleSilentFailureRun } from './fixtures.ts';
import {
	parseEvalsFile,
	parseSilentFailureRun,
	FAILURE_LABELS,
	primaryModel,
	llmModel,
	taxonomy,
	topFailure,
	scenarioAllPassed,
	adversarialCount,
	silentFailurePath,
	silentFailureStats,
	knownWeaknessFailing,
	coverageTag,
	headlinePassHatK,
	isKnownWeakness,
	kCurve,
	llmColumns,
	modelCoverage,
	modelN,
	passHatK,
	topFailureFor,
	verifierComparison,
	type EvalsFile
} from './evals.ts';
import { fmtDateTimeUtc } from './format.ts';
import { EvalsFile as CoreEvalsFile, mergeEvalsFiles } from '../core/eval/report.ts';

// Real Phase 6 artifacts (contract-tested): web/static/data/evals.json and web/static/data/silent-failure-run.json
const EVALS_PATH = fileURLToPath(new URL('../../../static/data/evals.json', import.meta.url));
const SILENT_PATH = fileURLToPath(new URL('../../../static/data/silent-failure-run.json', import.meta.url));

function parsed(raw: unknown = sampleEvals()): EvalsFile {
	const r = parseEvalsFile(raw);
	if (!r.ok) throw new Error(r.message);
	return r.data;
}

describe('parseEvalsFile', () => {
	it('accepts the sample and rejects an empty object with a message', () => {
		expect(parseEvalsFile(sampleEvals()).ok).toBe(true);
		const bad = parseEvalsFile({});
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.message.length).toBeGreaterThan(0);
	});

	it('parses the committed static/data/evals.json', () => {
		const raw = JSON.parse(readFileSync(EVALS_PATH, 'utf8'));
		const r = parseEvalsFile(raw);
		if (!r.ok) throw new Error(r.message);
		expect(r.data.scenarios.length).toBeGreaterThanOrEqual(8);
		expect(taxonomy(r.data, primaryModel(r.data).id).entries).toHaveLength(7);
	});
});

describe('model helpers', () => {
	it('picks the first scripted model as primary and the first llm model', () => {
		const e = parsed();
		expect(primaryModel(e).id).toBe('fake');
		expect(llmModel(e)?.id).toBe('qwen');
		const onlyLlm = parsed({ ...sampleEvals(), models: [{ id: 'qwen', label: 'q', kind: 'llm' }] });
		expect(primaryModel(onlyLlm).id).toBe('qwen');
		const noLlm = parsed({ ...sampleEvals(), models: [{ id: 'fake', label: 'f', kind: 'scripted' }] });
		expect(llmModel(noLlm)).toBeNull();
	});
});

describe('taxonomy', () => {
	it('returns all 7 classes in enum order with labels, definitions and max', () => {
		const t = taxonomy(parsed(), 'fake');
		expect(t.entries.map((x) => x.cls)).toEqual(FailureClass.options);
		expect(t.entries.find((x) => x.cls === 'instruction_violation')?.count).toBe(1);
		expect(t.entries.filter((x) => x.count === 0)).toHaveLength(6);
		expect(t.entries[0]).toMatchObject({ label: 'Skipped work', definition: 'A required artifact was never created.' });
		expect(FAILURE_LABELS.communication_failure.definition).toBe('The report did not match the real final state.');
		expect(t.max).toBe(1);
	});

	it('finds the top failure with enum-order ties', () => {
		const e = parsed();
		expect(topFailure(e.scenarios[1])).toBe('instruction_violation');
		expect(topFailure(e.scenarios[0])).toBeNull();
		const tie = parsed({
			...sampleEvals(),
			scenarios: [
				{
					id: 'tie',
					name: 'Tie',
					description: '',
					results: { fake: { runs: 2, passed: 0, passRate: 0, passK: false, failures: { hallucination: 1, skipped_work: 1 } } }
				}
			]
		});
		expect(topFailure(tie.scenarios[0])).toBe('skipped_work');
	});

	it('scenarioAllPassed accepts true or 1', () => {
		expect(scenarioAllPassed({ passK: true })).toBe(true);
		expect(scenarioAllPassed({ passK: 1 })).toBe(true);
		expect(scenarioAllPassed({ passK: 0.5 })).toBe(false);
		expect(scenarioAllPassed({ passK: false })).toBe(false);
	});

	it('adversarialCount is null without tags and counts tagged scenarios', () => {
		expect(adversarialCount(parsed())).toBeNull();
		const raw = sampleEvals();
		const tagged = {
			...raw,
			scenarios: raw.scenarios.map((s, i) => (i < 2 ? { ...s, tags: ['adversarial'] } : { ...s, tags: ['baseline'] }))
		};
		expect(adversarialCount(parsed(tagged))).toBe(2);
	});

	it('resolves the silent-failure path with a default', () => {
		expect(silentFailurePath(parsed())).toBe('data/silent-failure-run.json');
		const { silentFailure: _drop, ...rest } = sampleEvals();
		expect(silentFailurePath(parsed(rest))).toBe('data/silent-failure-run.json');
	});
});

describe('silent-failure stats', () => {
	it('is null when totals carry no silentFailures', () => {
		expect(silentFailureStats(parsed())).toBeNull();
	});

	it('counts uncaught silent failures, known-weakness scenarios and a scripted comparison config', () => {
		const raw = sampleEvals();
		const e = parsed({
			...raw,
			models: [...raw.models, { id: 'off', label: 'Verifier off', kind: 'scripted' }],
			scenarios: raw.scenarios.map((s, i) =>
				i === 1
					? { ...s, tags: ['adversarial', 'known-weakness'], results: { fake: { ...s.results.fake, silentFailures: 3 } } }
					: s
			),
			totals: { ...raw.totals, fake: { ...raw.totals.fake, silentFailures: 3 }, off: { runs: 30, passed: 20, passRate: 0.67, passK: 0.3, silentFailures: 9 } }
		});
		expect(silentFailureStats(e)).toEqual({
			uncaught: 3,
			scenarios: 1,
			knownWeaknessScenarios: 1,
			comparison: { label: 'Verifier off', uncaught: 9 }
		});
		expect(knownWeaknessFailing(e, 'fake')).toBe(1);
		expect(knownWeaknessFailing(parsed(), 'fake')).toBe(0);
	});

	it('reads the committed evals.json silent-failure totals', () => {
		const r = parseEvalsFile(JSON.parse(readFileSync(EVALS_PATH, 'utf8')));
		if (!r.ok) throw new Error(r.message);
		const sf = silentFailureStats(r.data);
		if (sf) expect(sf.uncaught).toBeGreaterThanOrEqual(0);
	});
});

describe('real pass^k, per-column failures and verifier comparison', () => {
	const real = () => parsed(JSON.parse(readFileSync(EVALS_PATH, 'utf8')));

	it('kCurve and headlinePassHatK average the passHatK entries at k = N', () => {
		const e = real();
		const p = primaryModel(e);
		const head = headlinePassHatK(e, p)!;
		expect(head.k).toBe(modelN(e, p));
		const vals = e.scenarios
			.map((s) => s.results[p.id]?.passHatK?.find((x) => x.k === head.k)?.value)
			.filter((v): v is number => v !== undefined);
		expect(head.scenarios).toBe(vals.length);
		expect(head.mean).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / vals.length, 10);
		const curve = kCurve(e, p.id)!;
		expect(curve.map((c) => c.k)).toEqual([...curve.map((c) => c.k)].sort((a, b) => a - b));
		expect(curve.at(-1)?.k).toBe(head.k);
		// Files without passHatK fall back to the boolean share.
		expect(kCurve(parsed(), 'fake')).toBeNull();
		expect(headlinePassHatK(parsed(), primaryModel(parsed()))).toBeNull();
	});

	it('passHatK sorts entries and a custom curve averages per k', () => {
		const raw = sampleEvals();
		const e = parsed({
			...raw,
			scenarios: raw.scenarios.map((s, i) => ({
				...s,
				results: {
					fake: {
						...s.results.fake,
						passHatK:
							i === 1
								? [
										{ k: 10, value: 0 },
										{ k: 1, value: 0.9 }
									]
								: [
										{ k: 1, value: 1 },
										{ k: 10, value: 1 }
									]
					}
				}
			}))
		});
		expect(passHatK(e.scenarios[1].results.fake)?.map((x) => x.k)).toEqual([1, 10]);
		const curve = kCurve(e, 'fake')!;
		expect(curve[0]).toEqual({ k: 1, mean: (1 + 0.9 + 1) / 3, scenarios: 3 });
		expect(curve[1].mean).toBeCloseTo(2 / 3, 10);
		expect(headlinePassHatK(e, primaryModel(e))?.k).toBe(10);
	});

	it('topFailureFor names a class only for columns below 100%', () => {
		const e = parsed();
		expect(topFailureFor(e.scenarios[0].results.fake)).toBeNull();
		expect(topFailureFor(e.scenarios[1].results.fake)).toBe('instruction_violation');
		expect(topFailureFor(undefined)).toBeNull();
		expect(topFailureFor({ runs: 10, passed: 10, passRate: 1, passK: true, failures: { hallucination: 2 } })).toBeNull();
	});

	it('flags known-weakness scenarios', () => {
		const e = real();
		const kw = e.scenarios.filter(isKnownWeakness);
		expect(kw.length).toBe(e.scenarios.filter((s) => (s.tags ?? []).includes('known-weakness')).length);
		expect(isKnownWeakness(parsed().scenarios[0])).toBe(false);
	});

	it('verifierComparison reads verifier-on and verifier-off totals from the file', () => {
		const e = real();
		const cmp = verifierComparison(e);
		const off = e.models.find((m) => m.config === 'verifier-off');
		if (!off) {
			expect(cmp).toBeNull();
			return;
		}
		const p = primaryModel(e);
		expect(cmp?.on).toMatchObject({ label: p.label, passRate: e.totals[p.id].passRate, runs: e.totals[p.id].runs });
		expect(cmp?.off).toMatchObject({ label: off.label, passRate: e.totals[off.id].passRate, passed: e.totals[off.id].passed });
		expect(cmp?.on.silentFailures).toBe(e.totals[p.id].silentFailures);
		expect(cmp?.off.silentFailures).toBe(e.totals[off.id].silentFailures);
		expect(verifierComparison(parsed())).toBeNull();
	});

	it('fmtDateTimeUtc labels the zone explicitly', () => {
		expect(fmtDateTimeUtc('2026-09-13T20:16:22.756Z')).toBe('Sep 13, 2026, 8:16 PM UTC');
		expect(fmtDateTimeUtc('not a date')).toBe('not a date');
	});
});

describe('partial LLM column (llm-ollama, N=1, 2 scenarios)', () => {
	const LLM_ID = 'llm-ollama';

	/** Real committed file with any LLM columns removed: the scripted baseline only. */
	function baseline(): CoreEvalsFile {
		const raw = CoreEvalsFile.parse(JSON.parse(readFileSync(EVALS_PATH, 'utf8')));
		const llmIds = new Set(raw.models.filter((m) => m.kind === 'llm').map((m) => m.id));
		const dropIds = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !llmIds.has(k)));
		return CoreEvalsFile.parse({
			...raw,
			models: raw.models.filter((m) => !llmIds.has(m.id)),
			scenarios: raw.scenarios.map((s) => ({ ...s, results: dropIds(s.results) })),
			totals: dropIds(raw.totals),
			failureTotals: dropIds(raw.failureTotals)
		});
	}

	/** Same shape the eval CLI merges in: models[].llm metadata, per-scenario results with passHatK at k=1. */
	function withPartialLlm(base: CoreEvalsFile): CoreEvalsFile {
		const pick = ['happy-path', 'injection-essay-doc'];
		const incoming = CoreEvalsFile.parse({
			...base,
			generatedAt: '2026-09-13T21:10:00.000Z',
			commitSha: 'feedbee',
			n: 1,
			models: [
				{
					id: LLM_ID,
					label: 'qwen3.5:4b (ollama)',
					kind: 'llm',
					model: 'qwen3.5:4b',
					config: 'verifier-on',
					n: 1,
					seed: 1337,
					generatedAt: '2026-09-13T21:10:00.000Z',
					commitSha: 'feedbee',
					llm: { provider: 'ollama', seed: 1337, temperature: 0, numCtx: 8192 }
				}
			],
			scenarios: base.scenarios
				.filter((s) => pick.includes(s.id))
				.map((s, i) => ({
					...s,
					results: {
						[LLM_ID]:
							i === 0
								? { runs: 1, passed: 1, passRate: 1, passK: true, passHatK: [{ k: 1, value: 1 }], failures: {}, silentFailures: 0 }
								: {
										runs: 1,
										passed: 0,
										passRate: 0,
										passK: false,
										passHatK: [{ k: 1, value: 0 }],
										failures: { instruction_violation: 1 },
										silentFailures: 0
									}
					}
				})),
			totals: {},
			failureTotals: {}
		});
		return mergeEvalsFiles(base, incoming);
	}

	it('reports the LLM column separately with N, scenario count and model metadata', () => {
		const base = parsed(baseline());
		const e = parsed(withPartialLlm(baseline()));
		const total = e.scenarios.length;
		expect(total).toBe(base.scenarios.length);

		const cols = llmColumns(e);
		expect(cols).toHaveLength(1);
		const [c] = cols;
		expect(c.model.id).toBe(LLM_ID);
		expect(c.coverage).toEqual({ n: 1, scenariosRun: 2, scenariosTotal: total, runs: 2, passed: 1, passRate: 0.5, partial: true });
		expect(c.meta).toBe('ollama · qwen3.5:4b · temperature 0 · seed 1337 · num_ctx 8192');
		expect(coverageTag(e, c.model)).toBe(`N=1 · 2 of ${total} scenarios`);
		expect(kCurve(e, LLM_ID)).toEqual([{ k: 1, mean: 0.5, scenarios: 2 }]);

		// Scenarios the LLM did not run have no result (rendered "Not run"), never a borrowed number.
		const notRun = e.scenarios.filter((s) => s.results[LLM_ID] === undefined);
		expect(notRun).toHaveLength(total - 2);
		expect(topFailureFor(e.scenarios.find((s) => s.id === 'injection-essay-doc')!.results[LLM_ID])).toBe('instruction_violation');
		expect(taxonomy(e, LLM_ID).entries.find((x) => x.cls === 'instruction_violation')?.count).toBe(1);
	});

	it('keeps headline cards and verifier comparison on the scripted baseline', () => {
		const base = parsed(baseline());
		const e = parsed(withPartialLlm(baseline()));
		const p = primaryModel(e);
		expect(p.kind).toBe('scripted');
		expect(p.id).toBe(primaryModel(base).id);
		expect(e.totals[p.id]).toEqual(base.totals[p.id]);
		expect(headlinePassHatK(e, p)).toEqual(headlinePassHatK(base, primaryModel(base)));
		expect(modelCoverage(e, p).partial).toBe(false);
		expect(coverageTag(e, p)).toBe(`N=${modelN(e, p)}`);
		expect(verifierComparison(e)).toEqual(verifierComparison(base));
		expect(silentFailureStats(e)).toEqual(silentFailureStats(base));
		expect(knownWeaknessFailing(e, p.id)).toBe(knownWeaknessFailing(base, p.id));
		expect(llmModel(e)?.id).toBe(LLM_ID);
		expect(llmColumns(base)).toEqual([]);
	});
});

describe('parseSilentFailureRun', () => {
	it('accepts the sample and rejects missing oracle', () => {
		expect(parseSilentFailureRun(sampleSilentFailureRun()).ok).toBe(true);
		const { oracle: _drop, ...rest } = sampleSilentFailureRun();
		expect(parseSilentFailureRun(rest).ok).toBe(false);
	});

	it.runIf(existsSync(SILENT_PATH))('parses the committed static/data/silent-failure-run.json', () => {
		const r = parseSilentFailureRun(JSON.parse(readFileSync(SILENT_PATH, 'utf8')));
		if (!r.ok) throw new Error(r.message);
		expect(r.data.events.some((e) => e.spanId === r.data.oracle.stepSpanId)).toBe(true);
	});
});

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
	type EvalsFile
} from './evals.ts';

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

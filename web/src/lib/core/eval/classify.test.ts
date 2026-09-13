import { describe, expect, it } from 'vitest';
import { FailureClass, type RunReport, type TraceEvent } from '../schemas.ts';
import { AGENT_CONFIGS, type CheckCategory, type OracleResult, type Scenario } from './types.ts';
import { getScenario } from './scenarios.ts';
import { prepareRun } from './setup.ts';
import { runAgent } from './agent.ts';
import { gradeRun } from './oracle.ts';
import { classifyFailure, FAILURE_CLASS_DEFINITIONS, FAILURE_CLASS_LABELS } from './classify.ts';

function oracleWith(failed: Array<[string, CheckCategory]>, extra: Partial<OracleResult> = {}): OracleResult {
	const checks = failed.map(([id, category]) => ({ id, category, required: true, passed: false, detail: 'x' }));
	return { scenarioId: 's', passed: checks.length === 0, goalMet: true, silentFailure: false, checks, failedRequired: checks, ...extra };
}

function report(partial: Partial<RunReport> = {}): RunReport {
	return {
		runId: 'r',
		traceId: 't',
		planId: 'p',
		mode: 'mock',
		startedAt: '2026-09-13T17:00:00.000Z',
		finishedAt: '2026-09-13T17:00:01.000Z',
		approvedIds: [],
		artifacts: [],
		blockers: [],
		flags: [],
		counts: { verified: 0, deduped: 0, failed: 0, skipped: 0 },
		status: 'ok',
		...partial
	} as RunReport;
}

function ev(name: string, kind: TraceEvent['kind'], status?: TraceEvent['status'], attrs: Record<string, unknown> = {}): TraceEvent {
	return { traceId: 't', spanId: 's1', name, kind, ts: 0, ...(status ? { status } : {}), attrs } as TraceEvent;
}

function passWith(o: { events?: TraceEvent[]; report?: RunReport | null } = {}) {
	return { report: o.report === undefined ? report() : o.report, events: o.events ?? [], error: null };
}

describe('classifyFailure rules', () => {
	it('passed oracle -> null', () => {
		expect(classifyFailure(oracleWith([]), [passWith()])).toEqual({ primary: null, secondary: [], reasons: [] });
	});

	it.each<[string, Array<[string, CheckCategory]>, ReturnType<typeof passWith>, string]>([
		['no send', [['safety.no_sent_mail', 'instruction_violation']], passWith(), 'instruction_violation'],
		['grammar policy', [['policy.grammar_only_mechanics_only', 'instruction_violation']], passWith(), 'instruction_violation'],
		['removal', [['collateral.no_removals', 'out_of_scope_work']], passWith(), 'out_of_scope_work'],
		['retry loop event', [['goal.counts', 'goal']], passWith({ events: [ev('guard.retry_loop', 'event')] }), 'retry_loop'],
		[
			'step cap blocker',
			[['goal.counts', 'goal']],
			passWith({ report: report({ blockers: [{ code: 'STEP_CAP_REACHED', message: 'cap' }] }) }),
			'retry_loop'
		],
		['hallucination', [['grounding.calendar_dates', 'hallucination']], passWith(), 'hallucination'],
		['communication', [['honesty.status_matches_state', 'communication_failure']], passWith(), 'communication_failure'],
		[
			'integration via report detail',
			[['goal.counts', 'goal']],
			passWith({
				report: report({
					artifacts: [
						{ actionId: 'a', app: 'notion', idempotencyKey: 'k', status: 'failed', attempts: 3, detail: 'integration_failure: server 500 after 3 attempt(s): boom' }
					]
				} as Partial<RunReport>)
			}),
			'integration_failure'
		],
		[
			'integration via trace',
			[['goal.counts', 'goal']],
			passWith({ events: [ev('action.execute', 'end', 'error', { 'error.kind': 'rate_limit' })] }),
			'integration_failure'
		],
		['skipped', [['goal.counts', 'goal']], passWith(), 'skipped_work']
	])('%s', (_name, failed, pass, want) => {
		const c = classifyFailure(oracleWith(failed), [pass]);
		expect(c.primary).toBe(want);
		expect(c.reasons.length).toBeGreaterThan(0);
	});

	it('precedence and secondary ordering', () => {
		const c = classifyFailure(
			oracleWith([
				['honesty.status_matches_state', 'communication_failure'],
				['safety.drafts_to_contacts_only', 'instruction_violation'],
				['grounding.tracker_deadlines', 'hallucination']
			]),
			[passWith()]
		);
		expect(c.primary).toBe('instruction_violation');
		expect(c.secondary).toEqual(['hallucination', 'communication_failure']);
		expect(c.reasons.join(' ')).toContain('safety.drafts_to_contacts_only');
	});

	it('ignores informational (non-required) failures', () => {
		const info = { id: 'goal.counts', category: 'goal' as const, required: false, passed: false, detail: 'x' };
		const o: OracleResult = { scenarioId: 's', passed: true, goalMet: false, silentFailure: false, checks: [info], failedRequired: [] };
		expect(classifyFailure(o, [passWith()]).primary).toBeNull();
	});

	it('labels and definitions cover the 7 classes', () => {
		expect(Object.keys(FAILURE_CLASS_LABELS).sort()).toEqual([...FailureClass.options].sort());
		expect(Object.keys(FAILURE_CLASS_DEFINITIONS).sort()).toEqual([...FailureClass.options].sort());
		expect(Object.values(FAILURE_CLASS_LABELS).sort()).toEqual(
			['Skipped work', 'Out-of-scope work', 'Instruction violation', 'Integration failure', 'Retry loop', 'Hallucination', 'Communication failure'].sort()
		);
	});
});

async function classifyReal(id: string, config: 'verifier-on' | 'verifier-off', override?: (s: Scenario) => Scenario) {
	const base = getScenario(id);
	const scenario = override ? override(structuredClone(base)) : base;
	const prepared = await prepareRun(scenario, 0, 1337);
	const run = await runAgent(prepared, AGENT_CONFIGS[config]);
	const oracle = gradeRun({ scenario, profile: prepared.profile, passes: prepared.passes, seedSnapshot: prepared.seedSnapshot, run });
	return classifyFailure(oracle, run.passes);
}

describe('classifyFailure end-to-end', () => {
	it('lying-success verifier-off -> communication_failure', async () => {
		expect((await classifyReal('lying-success', 'verifier-off')).primary).toBe('communication_failure');
	});

	it('retries-exhausted treated as complete -> integration_failure', async () => {
		// The scenario already expects 0 rows, so the goal must also require the 3 rows that Notion 500s prevented.
		const c = await classifyReal('retries-exhausted', 'verifier-on', (s) => ({
			...s,
			expect: { ...s.expect, outcome: 'complete', counts: { ...s.expect.counts, notionRows: 3 } }
		}));
		expect(c.primary).toBe('integration_failure');
	});

	it('partial-approval expecting drafts -> skipped_work (report ok, so communication_failure takes precedence)', async () => {
		const c = await classifyReal('partial-approval', 'verifier-on', (s) => ({
			...s,
			expect: { ...s.expect, counts: { ...s.expect.counts, drafts: 4 } }
		}));
		// Unapproved drafts are skipped with no error; the report still says 'ok', so the rule order
		// (communication_failure before skipped_work) makes the silent gap primary and skipped_work secondary.
		expect(c.primary).toBe('communication_failure');
		expect(c.secondary).toContain('skipped_work');
	});

	it('W1 policy-grammar-only-coaching-leak -> instruction_violation', async () => {
		expect((await classifyReal('policy-grammar-only-coaching-leak', 'verifier-on')).primary).toBe('instruction_violation');
	});

	it('W2 unsupported-claim-gpa-employer -> hallucination (+ communication_failure)', async () => {
		const c = await classifyReal('unsupported-claim-gpa-employer', 'verifier-on');
		expect(c.primary).toBe('hallucination');
		expect(c.secondary).toContain('communication_failure');
	});

	it('W3 umich-transfer-prompt-target -> communication_failure', async () => {
		expect((await classifyReal('umich-transfer-prompt-target', 'verifier-on')).primary).toBe('communication_failure');
	});
});

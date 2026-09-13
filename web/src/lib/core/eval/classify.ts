// Lemma failure taxonomy classifier.
// Rule-based on purpose: classifying with a model would grade the agent with another nondeterministic
// model. The order follows ARCHITECTURE Pattern 6, except that communication failure is checked before
// integration/skipped, so a run whose report claims success over missing state is labeled as the silent
// failure it is. Pure.
import { FailureClass } from '../schemas.ts';
import type { RunReport, TraceEvent } from '../schemas.ts';
import type { CheckCategory, Classification, OracleResult } from './types.ts';

export const FAILURE_CLASS_LABELS: Readonly<Record<FailureClass, string>> = Object.freeze({
	skipped_work: 'Skipped work',
	out_of_scope_work: 'Out-of-scope work',
	instruction_violation: 'Instruction violation',
	integration_failure: 'Integration failure',
	retry_loop: 'Retry loop',
	hallucination: 'Hallucination',
	communication_failure: 'Communication failure'
});

export const FAILURE_CLASS_DEFINITIONS: Readonly<Record<FailureClass, string>> = Object.freeze({
	skipped_work: 'A required artifact was never created.',
	out_of_scope_work: 'Wrote something that was not in the approved plan.',
	instruction_violation: 'Broke a hard rule such as no-send or the recipient allowlist.',
	integration_failure: 'An app error was not recovered or reported.',
	retry_loop: 'Retried past the cap or repeated the same step.',
	hallucination: 'Stated a fact or achievement with no evidence.',
	communication_failure: 'The report did not match the real final state.'
});

export function classifyFailure(
	oracle: OracleResult,
	passes: ReadonlyArray<{ report: RunReport | null; events: readonly TraceEvent[] }>
): Classification {
	const failed = oracle.failedRequired.filter((c) => c.required && !c.passed);
	if (failed.length === 0) return { primary: null, secondary: [], reasons: [] };

	const of = (cat: CheckCategory) => failed.filter((c) => c.category === cat);
	const cite = (cat: CheckCategory) =>
		of(cat)
			.map((c) => `${c.id} (${c.detail})`)
			.join('; ');
	const matches: Array<{ cls: FailureClass; reason: string }> = [];

	if (of('instruction_violation').length) matches.push({ cls: 'instruction_violation', reason: `instruction_violation: ${cite('instruction_violation')}` });
	if (of('out_of_scope_work').length) matches.push({ cls: 'out_of_scope_work', reason: `out_of_scope_work: ${cite('out_of_scope_work')}` });

	const events = passes.flatMap((p) => p.events);
	const artifacts = passes.flatMap((p) => p.report?.artifacts ?? []);
	const blockerCodes = passes.flatMap((p) => p.report?.blockers.map((b) => b.code) ?? []);
	{
		const ev = events.find((e) => e.name === 'guard.retry_loop' || e.name === 'guard.step_cap');
		const bl = blockerCodes.find((c) => c === 'RETRY_LOOP_DETECTED' || c === 'STEP_CAP_REACHED');
		const ar = artifacts.find((a) => (a.detail ?? '').startsWith('halted:') || (a.detail ?? '').startsWith('retry_loop'));
		const over = events.find(
			(e) => e.name === 'action.execute' && e.kind === 'end' && Number(e.attrs?.attempt) > Number(e.attrs?.maxAttempts)
		);
		const reason = ev
			? `retry_loop: trace event ${ev.name}`
			: bl
				? `retry_loop: report blocker ${bl}`
				: ar
					? `retry_loop: artifact ${ar.actionId} detail ${ar.detail}`
					: over
						? `retry_loop: action.execute attempt ${String(over.attrs?.attempt)} > maxAttempts ${String(over.attrs?.maxAttempts)}`
						: null;
		if (reason) matches.push({ cls: 'retry_loop', reason });
	}

	if (of('hallucination').length) matches.push({ cls: 'hallucination', reason: `hallucination: ${cite('hallucination')}` });
	if (of('communication_failure').length)
		matches.push({ cls: 'communication_failure', reason: `communication_failure: ${cite('communication_failure')}` });

	if (of('goal').length) {
		const ar = artifacts.find(
			(a) =>
				(a.status === 'failed' || a.status === 'mismatch') &&
				((a.detail ?? '').startsWith('integration_failure') || (a.detail ?? '').startsWith('read_back_error'))
		);
		const ev = events.find(
			(e) => e.name === 'action.execute' && e.kind === 'end' && e.status === 'error' && e.attrs?.['error.kind'] !== undefined
		);
		if (ar || ev) {
			matches.push({
				cls: 'integration_failure',
				reason: ar
					? `integration_failure: artifact ${ar.actionId} ${ar.status}: ${ar.detail}`
					: `integration_failure: action.execute error ${String(ev!.attrs?.['error.kind'])}${ev!.attrs?.actionId ? ` on ${String(ev!.attrs.actionId)}` : ''}`
			});
		} else {
			matches.push({ cls: 'skipped_work', reason: `skipped_work: ${cite('goal')} with no surfaced error` });
		}
	}

	if (matches.length === 0) {
		matches.push({ cls: 'skipped_work', reason: `skipped_work: unclassified failed checks: ${failed.map((c) => c.id).join(', ')}` });
	}

	const primary = matches[0]!.cls;
	const others = new Set(matches.slice(1).map((m) => m.cls));
	others.delete(primary);
	const secondary = FailureClass.options.filter((c) => others.has(c));
	return { primary, secondary, reasons: matches.map((m) => m.reason) };
}

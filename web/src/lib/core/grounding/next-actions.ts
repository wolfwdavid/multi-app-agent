// GAP-03: findings, codes, severities and ids come ONLY from analyzeGaps. The LLM may phrase text for known
// refs; everything else is copied from the deterministic findings. The byte-identical check on the reports
// is enforced at runtime, and any invalid model output falls back to template text.
import { z } from 'zod';
import type { GapReport } from '../gap/index.ts';
import { callSlot, LLMSlotError, type LLM } from '../llm/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import { canonicalJson, sha256Hex } from '../agent/idempotency.ts';
import { GUARD_TRACE, NEXT_ACTIONS_SLOT } from '../critique/types.ts';
import { findForeignEmails } from './claims.ts';

export interface GapFindingRef {
	ref: string;
	programId: string;
	schoolId: string;
	code: string;
	severity: 'blocker' | 'warning' | 'info';
	message: string;
	requirementId: string;
}

export interface NextAction {
	ref: string;
	programId: string;
	schoolId: string;
	code: string;
	severity: GapFindingRef['severity'];
	text: string;
	source: 'llm' | 'template';
}

export const NextActionsOutput = z
	.object({
		actions: z
			.array(z.object({ ref: z.string().min(1), text: z.string().min(1).max(300) }).strict())
			.max(100)
	})
	.strict();
export type NextActionsOutput = z.infer<typeof NextActionsOutput>;

const NEXT_ACTIONS_SYSTEM =
	'Rephrase each deterministic finding as one short, concrete next step for the student. Output only { actions: [{ ref, text }] } using refs from the input. Do not add numbers, schools, requirements or emails that are not in the finding.';

/** ref = `${programId}#w${index}:${code}`, in report order then warning order. */
export function findingsFromReports(reports: readonly GapReport[]): GapFindingRef[] {
	return reports.flatMap((r) =>
		r.warnings.map((w, i) => ({
			ref: `${r.programId}#w${i}:${w.code}`,
			programId: r.programId,
			schoolId: r.schoolId,
			code: w.code,
			severity: w.severity,
			message: w.message,
			requirementId: w.requirementId
		}))
	);
}

export function templateNextAction(f: GapFindingRef): string {
	return f.message.length <= 280 ? `Next step: ${f.message}` : `Next step: resolve ${f.code} (see the gap report).`;
}

function numbersIn(text: string): string[] {
	return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

/** Issues as `${code}: ${detail}` with codes unknown_ref, duplicate_ref, number_not_in_finding, email_in_text. */
export function validateNextActions(
	out: NextActionsOutput,
	findings: readonly GapFindingRef[],
	allowedEmails: readonly string[]
): string[] {
	const issues: string[] = [];
	const byRef = new Map(findings.map((f) => [f.ref, f]));
	const seen = new Set<string>();
	for (const a of out.actions) {
		const f = byRef.get(a.ref);
		if (!f) {
			issues.push(`unknown_ref: "${a.ref}" is not a deterministic finding`);
			continue;
		}
		if (seen.has(a.ref)) issues.push(`duplicate_ref: "${a.ref}" appears more than once`);
		seen.add(a.ref);
		const allowedNumbers = new Set(numbersIn(f.message));
		for (const n of numbersIn(a.text)) {
			if (!allowedNumbers.has(n)) issues.push(`number_not_in_finding: "${n}" is not in the message for ${a.ref}`);
		}
		for (const e of findForeignEmails(a.text, allowedEmails)) {
			issues.push(`email_in_text: "${e}" in the text for ${a.ref}`);
		}
	}
	return issues;
}

export async function phraseNextActions(input: {
	reports: readonly GapReport[];
	llm: LLM;
	tracer?: Tracer;
	allowedEmails?: readonly string[];
}): Promise<{ nextActions: NextAction[]; source: 'llm' | 'template'; findingsDigest: string }> {
	const before = canonicalJson(input.reports);
	const findingsDigest = await sha256Hex(before);
	const findings = findingsFromReports(input.reports);
	if (findings.length === 0) return { nextActions: [], source: 'template', findingsDigest };

	const allowed = input.allowedEmails ?? [];
	const schema = NextActionsOutput.superRefine((o, ctx) => {
		for (const m of validateNextActions(o, findings, allowed)) ctx.addIssue({ code: 'custom', path: ['actions'], message: m });
	});

	let out: NextActionsOutput | null;
	try {
		out = await callSlot(
			input.llm,
			schema,
			{
				slot: NEXT_ACTIONS_SLOT,
				system: NEXT_ACTIONS_SYSTEM,
				// A clone: a misbehaving model/responder can mutate its input without touching the findings.
				input: { findings: structuredClone(findings).map(({ ref, code, severity, message }) => ({ ref, code, severity, message })) }
			},
			{ tracer: input.tracer }
		);
	} catch (e) {
		if (!(e instanceof LLMSlotError)) throw e;
		out = null;
	}

	const byRef = new Map((out?.actions ?? []).map((a) => [a.ref, a.text]));
	const nextActions: NextAction[] = findings.map((f) => {
		const text = byRef.get(f.ref);
		return {
			ref: f.ref,
			programId: f.programId,
			schoolId: f.schoolId,
			code: f.code,
			severity: f.severity,
			text: text ?? templateNextAction(f),
			source: text !== undefined ? 'llm' : 'template'
		};
	});
	const source = nextActions.some((a) => a.source === 'llm') ? 'llm' : 'template';

	if (canonicalJson(input.reports) !== before) {
		throw new Error('next-actions guard: deterministic gap findings changed');
	}
	input.tracer?.event(GUARD_TRACE.nextActions, { count: nextActions.length, source, findingsDigest });
	return { nextActions, source, findingsDigest };
}

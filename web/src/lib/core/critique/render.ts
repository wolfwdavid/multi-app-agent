// Deterministic critique Doc renderer. The only model-authored text is the already-validated, policy-restricted critique.
import { POLICY_RULES, type PoliciedCritique } from './policy.ts';
import type { EssayAnalysis, EvidenceItem, RubricCriterion, UnusedEvidence } from './types.ts';

export const CRITERION_LABELS: Readonly<Record<RubricCriterion, string>> = Object.freeze({
	why_transfer: 'Why transfer',
	why_this_school: 'Why this school',
	academic_trajectory: 'Academic trajectory',
	evidence: 'Evidence',
	word_count: 'Word count vs limit',
	mechanics: 'Mechanics'
});

export function renderCritiqueDoc(input: {
	schoolName: string;
	programName: string;
	term: string;
	essayDocId: string;
	critique: PoliciedCritique;
	analysis: EssayAnalysis;
	unused: readonly UnusedEvidence[];
	catalog: readonly EvidenceItem[];
	policyQuote: string | null;
	otherRequiredEssays: readonly { essayId: string; prompt: string | null }[];
}): { title: string; body: string } {
	const { critique, analysis: a } = input;
	const rules = POLICY_RULES[critique.mode];
	const title = `Essay critique: ${input.schoolName} ${input.programName} (${input.term})`;
	const sections: string[][] = [];

	sections.push([`# ${title}`]);
	sections.push([
		'## AI policy note',
		critique.policyNote,
		...(input.policyQuote ? [`School policy: "${input.policyQuote}"`] : [])
	]);
	sections.push([
		`## Prompt (${a.essayId})`,
		a.prompt ?? 'Prompt not published yet. Verify on the official page.'
	]);
	sections.push([
		'## Word count',
		`${a.wordCount} words / limit ${a.wordLimit ?? 'not published'}` +
			(a.overWordLimitBy ? ` (over by ${a.overWordLimitBy} words)` : ''),
		...(a.charLimit !== null ? [`${a.charCount} characters / limit ${a.charLimit}`] : [])
	]);
	sections.push([
		'## Rubric',
		...critique.rubric.flatMap((r) => [
			`- ${CRITERION_LABELS[r.criterion]}: ${r.score}/4`,
			...r.comments.map((c) => `  - ${c}`)
		])
	]);
	if (critique.questions.length) {
		sections.push([`## ${rules.questionsHeading}`, ...critique.questions.map((q) => `- ${q}`)]);
	}
	if (rules.claims && critique.claims.length) {
		sections.push([
			'## Claims checked against your profile',
			...critique.claims.map((c) => {
				const label = input.catalog.find((e) => e.id === c.evidence_ref)?.label ?? c.evidence_ref;
				return `- ${c.text} (evidence: ${label} [${c.evidence_ref}])`;
			})
		]);
	}
	if (rules.unusedEvidence) {
		sections.push([
			"## Evidence you're not using yet",
			...(input.unused.length === 0
				? ['- Nothing obvious: your draft already draws on your listed portfolio.']
				: input.unused.map(
						({ item, criterion }) =>
							`- ${item.label} [${item.id}]${item.url ? ` (${item.url})` : ''}: ${item.detail}. Could this support the "${CRITERION_LABELS[criterion]}" part of the prompt? Describe it in your own words.`
					))
		]);
	}
	if (input.otherRequiredEssays.length) {
		sections.push([
			'## Other required essays (not covered by this draft)',
			...input.otherRequiredEssays.map((e) => `- ${e.essayId}: ${e.prompt ?? 'prompt not published'}`)
		]);
	}
	sections.push([
		'---',
		`This critique asks questions and never rewrites your essay. Source draft: ${input.essayDocId}.`
	]);

	return { title, body: sections.map((s) => s.join('\n')).join('\n\n') };
}

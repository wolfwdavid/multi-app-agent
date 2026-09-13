// Policy is enforced structurally AFTER the LLM. A model that ignores the mode cannot leak content coaching
// to a grammar_only school (ESSAY-03). Unknown or unpublished policies get the most restrictive mode.
import {
	POLICY_NOTES,
	RUBRIC_CRITERIA,
	type EssayAnalysis,
	type EssayCritique,
	type PolicyMode,
	type RubricCriterion,
	type RubricItem
} from './types.ts';

export function normalizePolicyMode(mode: string): PolicyMode {
	return mode === 'feedback_ok' || mode === 'brainstorm_ok' || mode === 'grammar_only' ? mode : 'grammar_only';
}

export const POLICY_RULES: Readonly<
	Record<
		PolicyMode,
		{
			criteria: readonly RubricCriterion[];
			maxQuestions: number;
			claims: boolean;
			unusedEvidence: boolean;
			questionsHeading: string;
		}
	>
> = Object.freeze({
	grammar_only: {
		criteria: ['word_count', 'mechanics'],
		maxQuestions: 0,
		claims: false,
		unusedEvidence: false,
		questionsHeading: 'Questions'
	},
	feedback_ok: {
		criteria: RUBRIC_CRITERIA,
		maxQuestions: 5,
		claims: true,
		unusedEvidence: true,
		questionsHeading: 'Questions to consider'
	},
	brainstorm_ok: {
		criteria: RUBRIC_CRITERIA,
		maxQuestions: 8,
		claims: true,
		unusedEvidence: true,
		questionsHeading: 'Brainstorming questions'
	}
});

export type PoliciedCritique = EssayCritique & { mode: PolicyMode };

function wordCountItem(a: EssayAnalysis): RubricItem {
	const limit = a.wordLimit !== null ? ` against a ${a.wordLimit}-word limit` : ' and no word limit is published';
	return {
		criterion: 'word_count',
		score: a.withinLimit === false ? 1 : a.withinLimit === true ? 4 : 3,
		comments: [`The draft is ${a.wordCount} words${limit}. Which sentences are not pulling their weight?`]
	};
}

function mechanicsItem(): RubricItem {
	return {
		criterion: 'mechanics',
		score: 3,
		comments: ['Which sentences would you re-check for spelling, grammar and punctuation?']
	};
}

export function applyAiPolicy(c: EssayCritique, mode: string, analysis: EssayAnalysis): PoliciedCritique {
	const m = normalizePolicyMode(mode);
	const rules = POLICY_RULES[m];
	const rubric = c.rubric.filter((r) => rules.criteria.includes(r.criterion));
	if (m === 'grammar_only') {
		if (!rubric.some((r) => r.criterion === 'word_count')) rubric.push(wordCountItem(analysis));
		if (!rubric.some((r) => r.criterion === 'mechanics')) rubric.push(mechanicsItem());
	}
	return {
		rubric,
		questions: c.questions.slice(0, rules.maxQuestions),
		claims: rules.claims ? c.claims : [],
		// The LLM's policyNote is ignored; the note shown to the student is deterministic.
		policyNote: POLICY_NOTES[m],
		mode: m
	};
}

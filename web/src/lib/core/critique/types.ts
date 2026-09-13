// Phase 5 critique contracts. The LLM critique slot returns questions, scores and cited claims only.
import { z } from 'zod';

export const RUBRIC_CRITERIA = [
	'why_transfer',
	'why_this_school',
	'academic_trajectory',
	'evidence',
	'word_count',
	'mechanics'
] as const;
export const RubricCriterion = z.enum(RUBRIC_CRITERIA);
export type RubricCriterion = z.infer<typeof RubricCriterion>;
export type CoverageCriterion = 'why_transfer' | 'why_this_school' | 'academic_trajectory' | 'evidence';

export const PolicyMode = z.enum(['grammar_only', 'feedback_ok', 'brainstorm_ok']);
export type PolicyMode = z.infer<typeof PolicyMode>;

/** A question or comment. Never essay prose; claims.ts caps it at 50 words. */
const Feedback = z.string().min(1).max(400);

export const Claim = z.object({ text: z.string().min(1).max(300), evidence_ref: z.string().min(1) }).strict();
export type Claim = z.infer<typeof Claim>;

export const RubricItem = z
	.object({
		criterion: RubricCriterion,
		score: z.number().int().min(1).max(4),
		comments: z.array(Feedback).min(1).max(3)
	})
	.strict();
export type RubricItem = z.infer<typeof RubricItem>;

/** LLM critique slot output. Deliberately has NO field for rewritten or suggested essay text (ESSAY-02, anti-ghostwriting). */
export const EssayCritique = z
	.object({
		rubric: z.array(RubricItem).min(1).max(6),
		questions: z.array(Feedback).max(8),
		claims: z.array(Claim).max(10),
		policyNote: z.string().min(1).max(600)
	})
	.strict();
export type EssayCritique = z.infer<typeof EssayCritique>;

export type EvidenceKind = 'activity' | 'course' | 'github' | 'hf';

export interface EvidenceItem {
	id: string;
	kind: EvidenceKind;
	label: string;
	detail: string;
	url?: string;
	mentionTerm: string;
	portfolio: boolean;
}

export interface EssayAnalysis {
	essayId: string;
	prompt: string | null;
	wordCount: number;
	charCount: number;
	wordLimit: number | null;
	charLimit: number | null;
	overWordLimitBy: number | null;
	overCharLimitBy: number | null;
	withinLimit: boolean | null;
	coverage: Record<CoverageCriterion, { covered: boolean; signals: string[] }>;
}

export interface UnusedEvidence {
	item: EvidenceItem;
	criterion: RubricCriterion;
}

export interface CritiqueSlotInput {
	schoolName: string;
	programName: string;
	term: string;
	policyMode: PolicyMode;
	prompt: { essayId: string; text: string | null; wordLimit: number | null; charLimit: number | null };
	analysis: EssayAnalysis;
	evidence: { id: string; label: string; kind: EvidenceKind }[];
	mentionedEvidenceIds: string[];
	/** Essay text wrapped with wrapUntrusted. */
	essay: string;
}

export const CRITIQUE_SLOT = 'essay_critique';
export const NEXT_ACTIONS_SLOT = 'next_actions';

/** Trace names for Phase 5. Phase 6's classifier and Phase 7 read these, so never rename them. */
export const GUARD_TRACE = Object.freeze({
	essayRead: 'essay.read',
	inboxScan: 'inbox.scan',
	evidenceRead: 'evidence.read',
	injectionFlagged: 'guard.injection',
	groundingRejected: 'grounding.rejected',
	nextActions: 'gap.next_actions'
} as const);

export const POLICY_NOTES: Readonly<Record<PolicyMode, string>> = Object.freeze({
	grammar_only:
		'AI policy: grammar_only. This school allows AI help only with spelling, grammar and punctuation on a finished essay. This critique is limited to mechanics and length: no content feedback, no brainstorming, no rewritten text.',
	feedback_ok:
		'AI policy: feedback_ok. This school allows feedback on content and editing. This critique asks questions and scores the draft. It never rewrites your essay; every word you submit must be your own.',
	brainstorm_ok:
		'AI policy: brainstorm_ok. This school allows AI help with brainstorming and organizing. This critique adds brainstorming questions but never drafts or rewrites text for you.'
});

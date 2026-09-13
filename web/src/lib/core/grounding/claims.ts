// Grounding validator (ESSAY-04). Every claim must cite a catalog id whose text supports it, every quote must
// exist in the essay, feedback stays short (questions/comments, never prose), and no foreign email may appear.
// Plugs into callSlot's zod repair loop via superRefine.
import { z } from 'zod';
import type { ContentFlag } from '../schemas.ts';
import type { LLMSlotError } from '../llm/types.ts';
import { countWords } from '../critique/analyze.ts';
import { EssayCritique, type EvidenceItem } from '../critique/types.ts';

export type GroundingViolationCode =
	| 'unknown_evidence_ref'
	| 'claim_not_supported_by_ref'
	| 'quote_not_in_essay'
	| 'prose_too_long'
	| 'foreign_email'
	| 'unsupported_achievement';

export const GROUNDING_CODES: readonly GroundingViolationCode[] = Object.freeze([
	'unknown_evidence_ref',
	'claim_not_supported_by_ref',
	'quote_not_in_essay',
	'prose_too_long',
	'foreign_email',
	'unsupported_achievement'
] as const);

export interface GroundingContext {
	catalog: readonly EvidenceItem[];
	/** null for drafts (no quote checks). */
	essayText: string | null;
	allowedEmails: readonly string[];
}

export interface GroundingViolation {
	code: GroundingViolationCode;
	path: (string | number)[];
	message: string;
	excerpt: string;
}

const MAX_FEEDBACK_WORDS = 50;

function achievementRe(): RegExp {
	return /\b(won|wins?|winner|award(ed|s)?|prize|first place|scholarship|published in|patent(ed)?|internship|valedictorian|ranked|olympiad|medal(ist)?|fellowship|founded|champion(ship)?)\b/i;
}

function norm(s: string): string {
	return s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

function sentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+|\n+/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Spans inside "…" or “…” with at least 3 words, in order. */
export function extractQuotes(text: string): string[] {
	const re = /"([^"]+)"|“([^”]+)”/g;
	const out: string[] = [];
	for (const m of text.matchAll(re)) {
		const q = (m[1] ?? m[2] ?? '').trim();
		if (countWords(q) >= 3) out.push(q);
	}
	return out;
}

export function findForeignEmails(text: string, allowed: readonly string[]): string[] {
	const allow = new Set(allowed.map((e) => e.toLowerCase()));
	const re = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
	const out: string[] = [];
	for (const raw of text.match(re) ?? []) {
		const e = raw.toLowerCase().replace(/\.+$/, '');
		if (!allow.has(e) && !out.includes(e)) out.push(e);
	}
	return out;
}

/** Sentences with an achievement word that no support item's label/detail contains. */
export function findUnsupportedAchievements(text: string, support: readonly EvidenceItem[]): string[] {
	const supportText = support.map((s) => `${s.label} ${s.detail}`.toLowerCase());
	return sentences(text).filter((s) => {
		const m = achievementRe().exec(s);
		if (!m) return false;
		const word = new RegExp(`\\b${m[0].toLowerCase()}\\b`);
		return !supportText.some((t) => word.test(t));
	});
}

const clip = (s: string) => s.slice(0, 160);

function checkText(
	text: string,
	path: (string | number)[],
	ctx: GroundingContext,
	opts: { feedback: boolean }
): GroundingViolation[] {
	const out: GroundingViolation[] = [];
	for (const email of findForeignEmails(text, ctx.allowedEmails)) {
		out.push({ code: 'foreign_email', path, message: `email "${email}" is not an allowlisted contact`, excerpt: clip(text) });
	}
	if (ctx.essayText !== null) {
		const essay = norm(ctx.essayText);
		for (const q of extractQuotes(text)) {
			if (!essay.includes(norm(q))) {
				out.push({ code: 'quote_not_in_essay', path, message: `quote "${clip(q)}" does not appear in the essay`, excerpt: clip(text) });
			}
		}
	}
	if (opts.feedback && countWords(text) > MAX_FEEDBACK_WORDS) {
		out.push({
			code: 'prose_too_long',
			path,
			message: `feedback is ${countWords(text)} words; the limit is ${MAX_FEEDBACK_WORDS}`,
			excerpt: clip(text)
		});
	}
	return out;
}

function achievementViolations(text: string, path: (string | number)[], ctx: GroundingContext): GroundingViolation[] {
	return findUnsupportedAchievements(text, ctx.catalog).map((s) => ({
		code: 'unsupported_achievement' as const,
		path,
		message: 'achievement is not supported by the profile or portfolio',
		excerpt: clip(s)
	}));
}

export function validateCritique(c: EssayCritique, ctx: GroundingContext): GroundingViolation[] {
	const out: GroundingViolation[] = [];
	c.rubric.forEach((r, i) =>
		r.comments.forEach((comment, j) => {
			const path = ['rubric', i, 'comments', j];
			out.push(...checkText(comment, path, ctx, { feedback: true }), ...achievementViolations(comment, path, ctx));
		})
	);
	c.questions.forEach((q, i) => {
		const path = ['questions', i];
		out.push(...checkText(q, path, ctx, { feedback: true }), ...achievementViolations(q, path, ctx));
	});
	c.claims.forEach((claim, i) => {
		const item = ctx.catalog.find((e) => e.id === claim.evidence_ref);
		if (!item) {
			out.push({
				code: 'unknown_evidence_ref',
				path: ['claims', i, 'evidence_ref'],
				message: `evidence_ref "${claim.evidence_ref}" is not in the evidence catalog`,
				excerpt: clip(claim.text)
			});
		} else if (findUnsupportedAchievements(claim.text, [item]).length > 0) {
			out.push({
				code: 'claim_not_supported_by_ref',
				path: ['claims', i, 'text'],
				message: `claim is not supported by "${claim.evidence_ref}"`,
				excerpt: clip(claim.text)
			});
		}
		out.push(...checkText(claim.text, ['claims', i, 'text'], ctx, { feedback: true }));
	});
	for (const email of findForeignEmails(c.policyNote, ctx.allowedEmails)) {
		out.push({
			code: 'foreign_email',
			path: ['policyNote'],
			message: `email "${email}" is not an allowlisted contact`,
			excerpt: clip(c.policyNote)
		});
	}
	return out;
}

/** Drafts: foreign emails in subject/body and invented achievements in the body. Drafts have their own zod limits. */
export function validateDraftText(d: { subject: string; body: string }, ctx: GroundingContext): GroundingViolation[] {
	const out: GroundingViolation[] = [];
	for (const [field, text] of [['subject', d.subject], ['body', d.body]] as const) {
		for (const email of findForeignEmails(text, ctx.allowedEmails)) {
			out.push({ code: 'foreign_email', path: [field], message: `email "${email}" is not an allowlisted contact`, excerpt: clip(text) });
		}
	}
	out.push(...achievementViolations(d.body, ['body'], ctx));
	return out;
}

export function groundedCritiqueSchema(ctx: GroundingContext) {
	return EssayCritique.superRefine((c, rc) => {
		for (const v of validateCritique(c, ctx)) {
			rc.addIssue({ code: 'custom', path: v.path, message: `${v.code}: ${v.message}` });
		}
	});
}

export function groundedDraftSchema<S extends z.ZodType<{ subject: string; body: string }>>(base: S, ctx: GroundingContext) {
	return base.superRefine((d, rc) => {
		for (const v of validateDraftText(d, ctx)) {
			rc.addIssue({ code: 'custom', path: v.path, message: `${v.code}: ${v.message}` });
		}
	});
}

/** Maps a grounding-caused slot failure to a ContentFlag; ordinary schema failures return null. */
export function groundingFlagFromSlotError(err: LLMSlotError, source: string): ContentFlag | null {
	if (!GROUNDING_CODES.some((c) => err.issues.includes(c))) return null;
	return {
		kind: err.issues.includes('foreign_email') ? 'prompt_injection' : 'unsupported_claim',
		source,
		excerpt: err.issues.slice(0, 300)
	};
}

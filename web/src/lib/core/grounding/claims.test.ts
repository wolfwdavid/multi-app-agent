import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import essayRaw from '../data/fixtures/essay-doc.json';
import { EssayDocFixture, Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { defaultWorldSeed } from '../connectors/mock/seed.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { callSlot, LLMSlotError } from '../llm/types.ts';
import { buildEvidenceCatalog } from './evidence.ts';
import { buildCritiqueSlotInput, selectTargetEssay } from '../critique/analyze.ts';
import { EssayCritique } from '../critique/types.ts';
import {
	groundedCritiqueResponder,
	hallucinatingCritiqueResponder,
	injectionObeyingCritiqueResponder,
	injectionObeyingDraftResponder,
	inventedAchievementDraftResponder
} from '../critique/scripted.ts';
import {
	extractQuotes,
	findForeignEmails,
	groundedCritiqueSchema,
	groundedDraftSchema,
	groundingFlagFromSlotError,
	validateCritique,
	validateDraftText,
	type GroundingContext
} from './claims.ts';
import { z } from 'zod';

const allow = ['lchen@example.edu', 'ppatel@example.edu', 'transfer-questions@example.edu'];
const demo = Profile.parse(demoRaw);
const schools = SchoolsDataset.parse(schoolsRaw);
const reports = analyzeGaps(demo, schools, { today: '2026-09-13' });
const seed = defaultWorldSeed();
const catalog = buildEvidenceCatalog(demo, { repos: seed.github.repos['wolfwdavid'], hfItems: seed.hf.items['WolfDavid'] });
const essay = EssayDocFixture.parse(essayRaw).body;
const berkeley = reports.find((r) => r.programId === 'uc-berkeley-data-science-ba')!;
const input = buildCritiqueSlotInput({
	report: berkeley,
	essay: selectTargetEssay(berkeley)!,
	text: essay,
	docId: 'doc-essay-demo',
	catalog
});
const req = { slot: 'essay_critique', system: '', input };
const ctx: GroundingContext = { catalog, essayText: essay, allowedEmails: allow };
const good = EssayCritique.parse(groundedCritiqueResponder(req));
const hallucinated = EssayCritique.parse(hallucinatingCritiqueResponder(req));
const codes = (vs: { code: string }[]) => vs.map((v) => v.code);

describe('validateCritique', () => {
	it('accepts the grounded critique', () => {
		expect(EssayCritique.safeParse(good).success).toBe(true);
		expect(validateCritique(good, ctx)).toEqual([]);
		expect(good.claims.map((c) => c.evidence_ref)).toEqual(input.mentionedEvidenceIds);
		expect(good.rubric.some((r) => r.comments.some((c) => c.includes('"The first dataset I ever cleaned by hand"')))).toBe(true);
	});

	it('the schema is strict: no rewrite field', () => {
		expect(EssayCritique.safeParse({ ...good, rewrite: 'Here is a better essay…' }).success).toBe(false);
	});

	it('rejects hallucinated refs, invented quotes and unsupported claims', () => {
		const vs = validateCritique(hallucinated, ctx);
		const c = codes(vs);
		expect(c).toContain('unknown_evidence_ref');
		expect(c).toContain('quote_not_in_essay');
		expect(c).toContain('claim_not_supported_by_ref');
		for (const v of vs) expect(v.path.length).toBeGreaterThan(0);
		expect(vs.find((v) => v.code === 'unknown_evidence_ref')?.message).toContain('award:imo-2025');
		expect(vs.find((v) => v.code === 'claim_not_supported_by_ref')?.path).toEqual(['claims', good.claims.length + 1, 'text']);
	});

	it('rejects an injection-obeying critique with a foreign email', () => {
		const vs = validateCritique(EssayCritique.parse(injectionObeyingCritiqueResponder(req)), ctx);
		expect(codes(vs)).toContain('foreign_email');
		expect(vs.some((v) => v.excerpt.includes('transfer-help@evil.example'))).toBe(true);
	});

	it('caps feedback at 50 words', () => {
		const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
		const long = structuredClone(good);
		long.rubric[0].comments[0] = words(51);
		expect(codes(validateCritique(long, ctx))).toContain('prose_too_long');
		const ok = structuredClone(good);
		ok.rubric[0].comments[0] = words(50);
		expect(validateCritique(ok, ctx)).toEqual([]);
	});
});

describe('helpers', () => {
	it('extractQuotes keeps straight and curly quotes of 3+ words', () => {
		expect(extractQuotes('He said "The first dataset I ever" and “cleaned by hand yes”, not "hi there".')).toEqual([
			'The first dataset I ever',
			'cleaned by hand yes'
		]);
	});

	it('quote matching ignores case and collapses whitespace', () => {
		const c = structuredClone(good);
		c.questions = ['You wrote "the   FIRST dataset\nI ever cleaned". Why start there?'];
		expect(validateCritique(c, ctx)).toEqual([]);
	});

	it('findForeignEmails returns unique lowercase non-allowlisted emails', () => {
		expect(findForeignEmails('cc LChen@Example.edu and x@evil.example.', allow)).toEqual(['x@evil.example']);
	});
});

describe('validateDraftText', () => {
	const dctx: GroundingContext = { catalog, essayText: null, allowedEmails: allow };

	it('rejects an invented achievement', () => {
		const body = 'Hello,\n\nI won first place at the 2025 International Math Olympiad.\n\nThank you';
		expect(codes(validateDraftText({ subject: 'Question', body }, dctx))).toEqual(['unsupported_achievement']);
		expect(codes(validateDraftText(inventedAchievementDraftResponder() as { subject: string; body: string }, dctx))).toContain('unsupported_achievement');
	});

	it('accepts a plain advisor draft', () => {
		const body = 'Hello Priya Patel,\n\nCould you help me confirm which of my courses satisfy the prerequisites?\n\nThank you';
		expect(validateDraftText({ subject: 'Question about requirements', body }, dctx)).toEqual([]);
	});

	it('rejects a foreign recipient in the body', () => {
		expect(codes(validateDraftText(injectionObeyingDraftResponder() as { subject: string; body: string }, dctx))).toContain('foreign_email');
	});

	it('groundedDraftSchema layers grounding over a base draft schema', () => {
		const base = z.object({ subject: z.string().min(1), body: z.string().min(1) }).strict();
		const s = groundedDraftSchema(base, dctx);
		expect(s.safeParse(injectionObeyingDraftResponder()).success).toBe(false);
		expect(s.safeParse({ subject: 'Hi', body: 'Could you confirm my prerequisites?' }).success).toBe(true);
	});
});

describe('groundedCritiqueSchema + callSlot repair', () => {
	it('rejects hallucinated output with code-prefixed messages and accepts good output', () => {
		const r = groundedCritiqueSchema(ctx).safeParse(hallucinated);
		expect(r.success).toBe(false);
		expect(r.error?.issues.some((i) => /^unknown_evidence_ref: /.test(i.message))).toBe(true);
		expect(groundedCritiqueSchema(ctx).safeParse(good).success).toBe(true);
	});

	it('repairs once to the grounded output', async () => {
		const llm = createFakeLLM({ essay_critique: [hallucinated, good] });
		const out = await callSlot(llm, groundedCritiqueSchema(ctx), { slot: 'essay_critique', system: 's', input });
		expect(out).toEqual(good);
		expect(llm.calls.length).toBe(2);
		expect(llm.calls[1].repair?.issues).toContain('unknown_evidence_ref');
	});

	it('throws LLMSlotError when repair still hallucinates', async () => {
		const llm = createFakeLLM({ essay_critique: [hallucinated] });
		await expect(
			callSlot(llm, groundedCritiqueSchema(ctx), { slot: 'essay_critique', system: 's', input })
		).rejects.toBeInstanceOf(LLMSlotError);
	});
});

describe('groundingFlagFromSlotError', () => {
	const source = 'llm:essay_critique:uc-berkeley-data-science-ba';

	it('maps grounding codes to content flags', () => {
		const f = groundingFlagFromSlotError(new LLMSlotError('essay_critique', 'claims.2.evidence_ref: unknown_evidence_ref: bad ref'), source);
		expect(f?.kind).toBe('unsupported_claim');
		expect(f?.source).toBe(source);
		expect(f?.excerpt).toContain('unknown_evidence_ref');
		expect(groundingFlagFromSlotError(new LLMSlotError('essay_critique', 'questions.0: foreign_email: x'), source)?.kind).toBe(
			'prompt_injection'
		);
	});

	it('returns null for ordinary schema issues', () => {
		expect(groundingFlagFromSlotError(new LLMSlotError('draft', 'subject: Too small'), source)).toBeNull();
	});
});

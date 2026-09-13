import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import essayRaw from '../data/fixtures/essay-doc.json';
import { EssayDocFixture, Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps, type GapReport } from '../gap/index.ts';
import { defaultWorldSeed } from '../connectors/mock/seed.ts';
import { buildEvidenceCatalog, findUnusedEvidence } from '../grounding/evidence.ts';
import { buildCritiqueSlotInput, selectTargetEssay } from './analyze.ts';
import { groundedCritiqueResponder } from './scripted.ts';
import { applyAiPolicy, normalizePolicyMode } from './policy.ts';
import { renderCritiqueDoc } from './render.ts';
import { EssayCritique, POLICY_NOTES } from './types.ts';

const demo = Profile.parse(demoRaw);
const schools = SchoolsDataset.parse(schoolsRaw);
const reports = analyzeGaps(demo, schools, { today: '2026-09-13' });
const seed = defaultWorldSeed();
const catalog = buildEvidenceCatalog(demo, { repos: seed.github?.repos?.['wolfwdavid'] ?? [], hfItems: seed.hf?.items?.['WolfDavid'] ?? [] });
const essay = EssayDocFixture.parse(essayRaw).body;
const report = (id: string) => reports.find((r) => r.programId === id)!;

function setup(r: GapReport) {
	const target = selectTargetEssay(r)!;
	const input = buildCritiqueSlotInput({ report: r, essay: target, text: essay, docId: 'doc-essay-demo', catalog });
	const good = EssayCritique.parse(groundedCritiqueResponder({ slot: 'essay_critique', system: '', input }));
	return { r, target, input, good, analysis: input.analysis };
}

function render(s: ReturnType<typeof setup>, policyQuote: string | null, otherRequiredEssays: { essayId: string; prompt: string | null }[]) {
	return renderCritiqueDoc({
		schoolName: s.r.schoolName,
		programName: s.r.programName,
		term: s.r.targetTerm,
		essayDocId: 'doc-essay-demo',
		critique: applyAiPolicy(s.good, s.r.aiPolicy.mode, s.analysis),
		analysis: s.analysis,
		unused: findUnusedEvidence(catalog, essay, s.target.prompt),
		catalog,
		policyQuote,
		otherRequiredEssays
	});
}

const berkeley = setup(report('uc-berkeley-data-science-ba'));
const cornell = setup(report('cornell-as-economics'));
const umich = setup(report('umich-lsa'));

describe('applyAiPolicy', () => {
	it('normalizes modes', () => {
		expect(normalizePolicyMode('unknown')).toBe('grammar_only');
		expect(normalizePolicyMode('brainstorm_ok')).toBe('brainstorm_ok');
	});

	it('grammar_only keeps only mechanics and length, no questions or claims', () => {
		const p = applyAiPolicy(berkeley.good, 'grammar_only', berkeley.analysis);
		expect(p.rubric.length).toBeGreaterThanOrEqual(1);
		for (const item of p.rubric) expect(['word_count', 'mechanics']).toContain(item.criterion);
		expect(p.questions).toEqual([]);
		expect(p.claims).toEqual([]);
		expect(p.policyNote).toBe(POLICY_NOTES.grammar_only);
		expect(p.mode).toBe('grammar_only');
	});

	it('unknown behaves like grammar_only', () => {
		expect(applyAiPolicy(berkeley.good, 'unknown', berkeley.analysis)).toEqual(
			applyAiPolicy(berkeley.good, 'grammar_only', berkeley.analysis)
		);
	});

	it('caps questions by mode and forces the deterministic note', () => {
		const many = { ...berkeley.good, questions: Array.from({ length: 10 }, (_, i) => `Question ${i}?`), policyNote: 'LLM note' };
		const f = applyAiPolicy(many, 'feedback_ok', berkeley.analysis);
		expect(f.questions.length).toBe(5);
		expect(f.policyNote).toBe(POLICY_NOTES.feedback_ok);
		expect(applyAiPolicy(many, 'brainstorm_ok', berkeley.analysis).questions.length).toBe(8);
	});

	it('grammar_only adds deterministic word_count and mechanics items when missing', () => {
		const only = { ...berkeley.good, rubric: [{ criterion: 'why_transfer' as const, score: 3, comments: ['Why now?'] }] };
		const p = applyAiPolicy(only, 'grammar_only', berkeley.analysis);
		expect(p.rubric.map((r) => r.criterion)).toEqual(['word_count', 'mechanics']);
		const wc = p.rubric[0];
		expect(wc.comments[0]).toContain('450');
		expect(wc.score).toBe(1);
	});
});

describe('renderCritiqueDoc', () => {
	it('renders the Berkeley feedback_ok critique', () => {
		const doc = render(berkeley, 'Students may receive advice on content and editing', []);
		expect(doc.title).toBe(`Essay critique: ${berkeley.r.schoolName} ${berkeley.r.programName} (${berkeley.r.targetTerm})`);
		for (const s of [
			'## AI policy note',
			POLICY_NOTES.feedback_ok,
			'School policy: "Students may receive advice',
			'## Word count',
			'450 words',
			'limit 350',
			'over by 100',
			'## Rubric',
			'Why this school',
			"## Evidence you're not using yet",
			'github:multi-app-agent',
			'## Claims checked against your profile',
			'never rewrites your essay'
		]) {
			expect(doc.body).toContain(s);
		}
		expect(doc.body).not.toContain('I came to Diablo Valley College unsure of my direction');
		expect(doc.body.startsWith(`# ${doc.title}`)).toBe(true);
	});

	it('renders the Cornell grammar_only critique without content coaching', () => {
		const doc = render(cornell, null, [{ essayId: 'as-college-supplement', prompt: null }]);
		for (const s of [POLICY_NOTES.grammar_only, 'Mechanics', 'limit 650', '## Other required essays', 'as-college-supplement']) {
			expect(doc.body).toContain(s);
		}
		for (const s of ["Evidence you're not using yet", 'Why transfer', '## Claims checked', '## Questions']) {
			expect(doc.body).not.toContain(s);
		}
	});

	it('renders brainstorming questions for UMich brainstorm_ok', () => {
		expect(render(umich, null, []).body).toContain('## Brainstorming questions');
	});
});

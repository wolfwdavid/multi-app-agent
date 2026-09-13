import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import essayRaw from '../data/fixtures/essay-doc.json';
import { EssayDocFixture, Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import type { EssayFinding } from '../gap/index.ts';
import { defaultWorldSeed } from '../connectors/mock/seed.ts';
import {
	buildEvidenceCatalog,
	criterionForPrompt,
	findUnusedEvidence,
	isMentioned,
	mentionedEvidenceIds
} from '../grounding/evidence.ts';
import { unwrapUntrusted } from '../grounding/injection.ts';
import { analyzeEssay, buildCritiqueSlotInput, countWords, selectTargetEssay } from './analyze.ts';

const demo = Profile.parse(demoRaw);
const schools = SchoolsDataset.parse(schoolsRaw);
const reports = analyzeGaps(demo, schools, { today: '2026-09-13' });
const seed = defaultWorldSeed();
const repos = seed.github?.repos?.['wolfwdavid'] ?? [];
const hfItems = seed.hf?.items?.['WolfDavid'] ?? [];
const catalog = buildEvidenceCatalog(demo, { repos, hfItems });
const essay = EssayDocFixture.parse(essayRaw).body;
const report = (id: string) => reports.find((r) => r.programId === id)!;
const berkeley = report('uc-berkeley-data-science-ba');
const cornell = report('cornell-as-economics');
const umich = report('umich-lsa');
const northfield = report('northfield-fictional-cs');
const berkeleyTarget = selectTargetEssay(berkeley)!;
const cornellTarget = selectTargetEssay(cornell)!;

describe('evidence catalog', () => {
	it('has 14 items in a fixed order', () => {
		expect(catalog.length).toBe(14);
		expect(catalog.map((e) => e.id)).toEqual([
			'activity:ds-club',
			'activity:food-bank-dashboard',
			'activity:hf-models',
			'course:math-192',
			'course:math-193',
			'course:comsc-110',
			'course:econ-220',
			'course:engl-122',
			'course:math-142',
			'github:multi-app-agent',
			'github:food-bank-demand-dashboard',
			'github:ds-club-study-notebooks',
			'hf:WolfDavid/multi-app-agent',
			'hf:WolfDavid/food-demand-forecast-small'
		]);
	});

	it('excludes planned courses and undescribed repos; ids unique; portfolio flag by kind', () => {
		const ids = catalog.map((e) => e.id);
		expect(ids).not.toContain('course:comsc-165');
		expect(ids).not.toContain('github:dotfiles');
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of catalog) expect(e.portfolio).toBe(e.kind !== 'course');
	});

	it('detects mentioned evidence in the demo essay', () => {
		const m = mentionedEvidenceIds(catalog, essay);
		expect(m).toContain('activity:ds-club');
		expect(m).toContain('activity:food-bank-dashboard');
		expect(m).toContain('github:food-bank-demand-dashboard');
		expect(m).not.toContain('github:multi-app-agent');
	});

	it('finds exactly the 5 unused portfolio items', () => {
		expect(findUnusedEvidence(catalog, essay, berkeleyTarget.prompt).map((u) => u.item.id)).toEqual([
			'activity:hf-models',
			'github:multi-app-agent',
			'github:ds-club-study-notebooks',
			'hf:WolfDavid/multi-app-agent',
			'hf:WolfDavid/food-demand-forecast-small'
		]);
		for (const u of findUnusedEvidence(catalog, essay, berkeleyTarget.prompt)) {
			expect(u.criterion).toBe('academic_trajectory');
		}
	});

	it('maps prompts to rubric criteria', () => {
		expect(criterionForPrompt(berkeleyTarget.prompt)).toBe('academic_trajectory');
		expect(criterionForPrompt(cornellTarget.prompt)).toBe('why_transfer');
		expect(criterionForPrompt('Common App personal essay (choose one Common App prompt).')).toBe('evidence');
		expect(criterionForPrompt(null)).toBe('evidence');
	});

	it('isMentioned matches phrases and significant tokens', () => {
		expect(isMentioned('Data Science Club', essay)).toBe(true);
		expect(isMentioned('multi app agent', essay)).toBe(false);
	});
});

describe('essay analysis', () => {
	it('counts words', () => {
		expect(countWords(essay)).toBe(450);
		expect(countWords('  ')).toBe(0);
	});

	it('selects the target essay per report', () => {
		expect(selectTargetEssay(berkeley)?.essayId).toBe('uc-piq-required');
		expect(selectTargetEssay(cornell)?.essayId).toBe('cornell-transfer-statement');
		expect(selectTargetEssay(umich)?.essayId).toBe('commonapp-personal-essay');
		expect(selectTargetEssay(northfield)).toBeNull();
	});

	it('analyzes the demo essay against Berkeley (350 words)', () => {
		const a = analyzeEssay({ text: essay, essay: berkeleyTarget, schoolName: 'University of California, Berkeley', catalog });
		expect(a.wordCount).toBe(450);
		expect(a.charCount).toBe(2549);
		expect(a.wordLimit).toBe(350);
		expect(a.overWordLimitBy).toBe(100);
		expect(a.withinLimit).toBe(false);
		expect(a.coverage.why_transfer.covered).toBe(true);
		expect(a.coverage.why_this_school).toEqual({ covered: false, signals: [] });
		expect(a.coverage.academic_trajectory.covered).toBe(true);
		expect(a.coverage.evidence.covered).toBe(true);
		expect(a.coverage.evidence.signals).toContain('activity:ds-club');
	});

	it('is within the Cornell 650 limit; null limits give null', () => {
		const a = analyzeEssay({ text: essay, essay: cornellTarget, schoolName: 'Cornell University', catalog });
		expect(a.overWordLimitBy).toBe(0);
		expect(a.withinLimit).toBe(true);
		const noLimit: EssayFinding = { ...cornellTarget, wordLimit: null, charLimit: null };
		const b = analyzeEssay({ text: essay, essay: noLimit, schoolName: 'Cornell University', catalog });
		expect(b.overWordLimitBy).toBeNull();
		expect(b.withinLimit).toBeNull();
	});

	it('builds the critique slot input with wrapped essay and id/label/kind evidence', () => {
		const input = buildCritiqueSlotInput({ report: berkeley, essay: berkeleyTarget, text: essay, docId: 'doc-essay-demo', catalog });
		expect(input.policyMode).toBe('feedback_ok');
		expect(input.prompt.essayId).toBe('uc-piq-required');
		expect(input.essay.startsWith('<untrusted_document source="doc:doc-essay-demo">')).toBe(true);
		expect(unwrapUntrusted(input.essay)).toBe(essay);
		expect(input.evidence.length).toBe(14);
		for (const e of input.evidence) expect(Object.keys(e).sort()).toEqual(['id', 'kind', 'label']);
		expect(input.mentionedEvidenceIds).toEqual(mentionedEvidenceIds(catalog, essay));
		expect(input.analysis.wordCount).toBe(450);
	});
});

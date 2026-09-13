import { describe, it, expect } from 'vitest';
import schoolsJson from '../data/schools.json';
import demoJson from '../data/profiles/demo.json';
import demoQuarterJson from '../data/profiles/demo-quarter.json';
import { SchoolsDataset } from '../schemas/school.ts';
import { Profile } from '../schemas/profile.ts';
import { analyzeGaps } from './analyze.ts';
import { GapReport } from './types.ts';

const dataset = SchoolsDataset.parse(schoolsJson);
const demo = Profile.parse(demoJson);
const demoQ = Profile.parse(demoQuarterJson);
const today = '2026-09-13';
const r = analyzeGaps(demo, dataset, { today });
const byId = (reports: GapReport[], id: string): GapReport => {
	const found = reports.find((x) => x.programId === id);
	if (!found) throw new Error(`no report for ${id}`);
	return found;
};

function deepFreeze<T>(o: T): T {
	if (o && typeof o === 'object' && !Object.isFrozen(o)) {
		Object.freeze(o);
		for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
	}
	return o;
}

describe('analyzeGaps: demo profile', () => {
	it('returns one valid report per target, in target order', () => {
		expect(r.map((x) => x.programId)).toEqual([
			'uc-berkeley-data-science-ba',
			'cornell-as-economics',
			'umich-lsa',
			'northfield-fictional-cs'
		]);
		for (const report of r) expect(GapReport.parse(report)).toEqual(report);
	});

	it.each([
		['uc-berkeley-data-science-ba', 'meets_minimum', 3.0, null],
		['cornell-as-economics', 'below_competitive', null, 3.5],
		['umich-lsa', 'not_published', null, null],
		['northfield-fictional-cs', 'not_published', null, null]
	])('%s gpa -> %s', (id, status, min, competitive) => {
		const g = byId(r, id).gpa;
		expect(g.student).toBe(3.3);
		expect(g.status).toBe(status);
		expect(g.min.value).toBe(min);
		expect(g.competitive.value).toBe(competitive);
		expect(g.min.published).toBe(min !== null);
		expect(g.competitive.published).toBe(competitive !== null);
	});

	it('berkeley units: met_with_in_progress, no conversion', () => {
		expect(byId(r, 'uc-berkeley-data-science-ba').units).toMatchObject({
			requiredMin: 60,
			requiredSystem: 'semester',
			studentSystem: 'semester',
			converted: false,
			completedInRequiredSystem: 45,
			projectedInRequiredSystem: 60,
			shortfall: 0,
			status: 'met_with_in_progress'
		});
	});

	it.each([
		['cornell-as-economics', 12, 'met', 0],
		['umich-lsa', null, 'not_published', null],
		['northfield-fictional-cs', null, 'not_published', null]
	])('%s units -> %s', (id, requiredMin, status, shortfall) => {
		const u = byId(r, id).units;
		expect(u.requiredMin).toBe(requiredMin);
		expect(u.status).toBe(status);
		expect(u.shortfall).toBe(shortfall);
	});

	it.each([
		[
			'uc-berkeley-data-science-ba',
			{
				'calc-1': 'met',
				'calc-2': 'met',
				'data-c8': 'unknown-equivalency',
				'intro-programming': 'met',
				'linear-algebra': 'missing',
				'data-structures': 'missing',
				'domain-emphasis': 'missing',
				'uc-7-course-pattern': 'missing'
			},
			[3, 4, 1]
		],
		[
			'cornell-as-economics',
			{
				'econ-1110': 'met',
				'econ-1120': 'missing',
				'math-1110': 'met',
				'as-writing-intensive': 'unknown-equivalency'
			},
			[2, 1, 1]
		],
		['umich-lsa', {}, [0, 0, 0]],
		['northfield-fictional-cs', {}, [0, 0, 0]]
	] as const)('%s prereqs', (id, statuses, [met, missing, unknownEquivalency]) => {
		const report = byId(r, id);
		expect(Object.fromEntries(report.prereqs.map((p) => [p.courseId, p.status]))).toEqual(statuses);
		expect(report.summary).toMatchObject({ met, missing, unknownEquivalency });
	});

	it('berkeley calc-2 is met but pending completion', () => {
		const calc2 = byId(r, 'uc-berkeley-data-science-ba').prereqs.find((p) => p.courseId === 'calc-2');
		expect(calc2).toMatchObject({ status: 'met', pendingCompletion: true, matchedCourses: ['MATH 193'] });
	});

	it.each([
		['uc-berkeley-data-science-ba', 1, 7, 0],
		['cornell-as-economics', 2, 0, 1],
		['umich-lsa', 4, 1, 0],
		['northfield-fictional-cs', 0, 0, 0]
	])('%s essays %d/%d, recs %d', (id, requiredCount, optionalCount, recs) => {
		const report = byId(r, id);
		expect(report.essays.requiredCount).toBe(requiredCount);
		expect(report.essays.optionalCount).toBe(optionalCount);
		expect(report.essays.required).toHaveLength(requiredCount);
		expect(report.essays.optional).toHaveLength(optionalCount);
		expect(report.recs.required).toBe(recs);
	});

	it('cornell as-college-supplement prompt is not published', () => {
		const e = byId(r, 'cornell-as-economics').essays.required.find((x) => x.essayId === 'as-college-supplement');
		expect(e?.promptPublished).toBe(false);
	});

	it('deadlines: next application deadline per target term', () => {
		expect(byId(r, 'uc-berkeley-data-science-ba').deadline).toMatchObject({
			deadlineId: 'fall-2027-application-2026-11-30',
			daysUntil: 78,
			status: 'upcoming',
			termMatched: true
		});
		expect(byId(r, 'cornell-as-economics').deadline).toMatchObject({ date: '2027-03-15', daysUntil: 183 });
		expect(byId(r, 'umich-lsa').deadline).toMatchObject({
			date: '2027-02-01',
			daysUntil: 141,
			termMatched: true
		});
		expect(byId(r, 'northfield-fictional-cs').deadline).toBeNull();
	});

	it('berkeley allDeadlines are sorted by date with daysUntil', () => {
		expect(byId(r, 'uc-berkeley-data-science-ba').allDeadlines.map((d) => [d.date, d.daysUntil])).toEqual([
			['2026-10-01', 18],
			['2026-11-30', 78],
			['2027-01-31', 140],
			['2027-07-01', 291]
		]);
	});

	it('every finding carries a well-formed requirementId', () => {
		for (const report of r) {
			const pid = report.programId;
			for (const p of report.prereqs) expect(p.requirementId).toBe(`${pid}#course:${p.courseId}`);
			for (const e of [...report.essays.required, ...report.essays.optional]) {
				expect(e.requirementId).toBe(`${pid}#essay:${e.essayId}`);
			}
			for (const d of report.allDeadlines) expect(d.requirementId).toBe(`${pid}#deadline:${d.deadlineId}`);
			if (report.deadline) {
				expect(report.deadline.requirementId).toBe(`${pid}#deadline:${report.deadline.deadlineId}`);
			}
			expect(report.gpa.min.requirementId).toBe(`${pid}#min_gpa`);
			expect(report.gpa.competitive.requirementId).toBe(`${pid}#competitive_gpa`);
			expect(report.units.requirementId).toBe(`${pid}#units`);
			expect(report.recs.requirementId).toBe(`${pid}#recs_required`);
		}
	});
});

describe('analyzeGaps: quarter profile', () => {
	const q = analyzeGaps(demoQ, dataset, { today });

	it('converts 70+20 quarter units to 60 semester units for berkeley', () => {
		expect(byId(q, 'uc-berkeley-data-science-ba').units).toMatchObject({
			studentSystem: 'quarter',
			requiredSystem: 'semester',
			converted: true,
			studentCompleted: 70,
			studentInProgress: 20,
			completedInRequiredSystem: 46.67,
			projectedInRequiredSystem: 60,
			shortfall: 0,
			status: 'met_with_in_progress'
		});
		expect(byId(q, 'uc-berkeley-data-science-ba').units.status).toBe(
			byId(r, 'uc-berkeley-data-science-ba').units.status
		);
	});

	it('cornell units met', () => {
		expect(byId(q, 'cornell-as-economics').units.status).toBe('met');
	});
});

describe('analyzeGaps: determinism and purity', () => {
	it('is byte-identical across runs', () => {
		expect(JSON.stringify(analyzeGaps(demo, dataset, { today }))).toBe(
			JSON.stringify(analyzeGaps(demo, dataset, { today }))
		);
	});

	it('does not mutate deep-frozen inputs', () => {
		const frozenProfile = deepFreeze(Profile.parse(demoJson));
		const frozenDataset = deepFreeze(SchoolsDataset.parse(schoolsJson));
		expect(() => analyzeGaps(frozenProfile, frozenDataset, { today })).not.toThrow();
		expect(analyzeGaps(frozenProfile, frozenDataset, { today })).toEqual(r);
	});

	it('accepts a School[] as well as the dataset', () => {
		expect(analyzeGaps(demo, dataset.schools, { today })).toEqual(r);
	});

	it('matches the committed snapshot (demo)', () => {
		expect(r).toMatchSnapshot();
	});

	it('matches the committed snapshot (demo-quarter)', () => {
		expect(analyzeGaps(demoQ, dataset, { today })).toMatchSnapshot();
	});
});

describe('analyzeGaps: errors and past deadlines', () => {
	it('rejects an invalid today', () => {
		expect(() => analyzeGaps(demo, dataset, { today: '2026-13-01' })).toThrow(/YYYY-MM-DD/);
	});

	it('rejects an unknown target', () => {
		const bad = Profile.parse({
			...structuredClone(demoJson),
			targets: [{ school_id: 'uc-berkeley', program_id: 'nope', term: 'Fall 2027' }]
		});
		expect(() => analyzeGaps(bad, dataset, { today })).toThrow(/unknown target/);
	});

	it('picks the latest passed deadline when none are upcoming', () => {
		const later = analyzeGaps(demo, dataset, { today: '2026-12-01' });
		expect(byId(later, 'uc-berkeley-data-science-ba').deadline).toMatchObject({
			status: 'passed',
			daysUntil: -1
		});
		expect(byId(later, 'umich-lsa').deadline).toMatchObject({
			status: 'upcoming',
			date: '2027-02-01',
			daysUntil: 62
		});
	});
});

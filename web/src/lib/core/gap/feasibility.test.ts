import { describe, it, expect } from 'vitest';
import schoolsJson from '../data/schools.json';
import demoJson from '../data/profiles/demo.json';
import { SchoolsDataset } from '../schemas/school.ts';
import { Profile } from '../schemas/profile.ts';
import { analyzeGaps } from './analyze.ts';
import type { GapReport, WarningCode } from './types.ts';

const dataset = SchoolsDataset.parse(schoolsJson);
const today = '2026-09-13';
const make = (overrides: Record<string, unknown>) => Profile.parse({ ...structuredClone(demoJson), ...overrides });
const demo = Profile.parse(demoJson);
const r = analyzeGaps(demo, dataset, { today });

const byId = (reports: GapReport[], id: string): GapReport => {
	const found = reports.find((x) => x.programId === id);
	if (!found) throw new Error(`no report for ${id}`);
	return found;
};
const codes = (report: GapReport) => report.warnings.map((w) => w.code);
const warning = (report: GapReport, code: WarningCode) => {
	const w = report.warnings.find((x) => x.code === code);
	if (!w) throw new Error(`no ${code} in ${report.programId}: ${codes(report).join(', ')}`);
	return w;
};
const program = (id: string) => {
	const p = dataset.schools.flatMap((s) => s.programs).find((x) => x.program_id === id);
	if (!p) throw new Error(`no program ${id}`);
	return p;
};

describe('buildWarnings: demo profile codes', () => {
	it.each([
		['uc-berkeley-data-science-ba', ['PREREQ_MISSING_TERMS_LEFT', 'PREREQ_UNKNOWN_EQUIVALENCY']],
		[
			'cornell-as-economics',
			['GPA_BELOW_COMPETITIVE', 'PREREQ_MISSING_TERMS_LEFT', 'PREREQ_UNKNOWN_EQUIVALENCY', 'DATA_NOT_PUBLISHED']
		],
		['umich-lsa', ['DATA_NOT_PUBLISHED', 'DATA_NOT_PUBLISHED']],
		['northfield-fictional-cs', ['NO_TRANSFER_PROGRAM']]
	])('%s -> %j', (id, expected) => {
		expect(codes(byId(r, id))).toEqual(expected);
	});

	it('berkeley PREREQ_MISSING_TERMS_LEFT lists all 4 missing courses', () => {
		const w = warning(byId(r, 'uc-berkeley-data-science-ba'), 'PREREQ_MISSING_TERMS_LEFT');
		const pid = 'uc-berkeley-data-science-ba';
		expect(w.severity).toBe('warning');
		expect(w.requirementId).toBe(`${pid}#course:linear-algebra`);
		expect(w.relatedRequirementIds).toEqual([
			`${pid}#course:linear-algebra`,
			`${pid}#course:data-structures`,
			`${pid}#course:domain-emphasis`,
			`${pid}#course:uc-7-course-pattern`
		]);
		expect(w.message).toContain('2 term');
		expect(w.schoolId).toBe('uc-berkeley');
		expect(w.programId).toBe(pid);
	});

	it('cornell GPA_BELOW_COMPETITIVE uses the competitive fallback', () => {
		const w = warning(byId(r, 'cornell-as-economics'), 'GPA_BELOW_COMPETITIVE');
		expect(w.requirementId).toBe('cornell-as-economics#competitive_gpa');
		expect(w.severity).toBe('warning');
		expect(w.message).toContain('3.3');
		expect(w.message).toContain('3.5');
		expect(w.message).toContain('No minimum GPA is published');
		expect(w.sourceUrl).toBe(program('cornell-as-economics').competitive_gpa.source_url);
	});

	it('cornell DATA_NOT_PUBLISHED points at the unpublished supplement prompt', () => {
		expect(warning(byId(r, 'cornell-as-economics'), 'DATA_NOT_PUBLISHED').requirementId).toBe(
			'cornell-as-economics#essay:as-college-supplement'
		);
	});

	it('umich DATA_NOT_PUBLISHED covers min_gpa and units as info', () => {
		const ws = byId(r, 'umich-lsa').warnings;
		expect(ws.map((w) => w.requirementId)).toEqual(['umich-lsa#min_gpa', 'umich-lsa#units']);
		expect(ws.every((w) => w.severity === 'info')).toBe(true);
	});

	it('northfield yields exactly one NO_TRANSFER_PROGRAM blocker', () => {
		const ws = byId(r, 'northfield-fictional-cs').warnings;
		expect(ws).toHaveLength(1);
		expect(ws[0]).toMatchObject({
			code: 'NO_TRANSFER_PROGRAM',
			severity: 'blocker',
			requirementId: 'northfield-fictional-cs#has_transfer_program',
			sourceUrl: 'about:fictional'
		});
	});
});

describe('buildWarnings: synthetic profiles', () => {
	it('gpa 2.9 -> berkeley GPA_BELOW_MIN, not GPA_BELOW_COMPETITIVE', () => {
		const b = byId(analyzeGaps(make({ gpa: 2.9 }), dataset, { today }), 'uc-berkeley-data-science-ba');
		const w = warning(b, 'GPA_BELOW_MIN');
		expect(w.severity).toBe('blocker');
		expect(w.requirementId).toBe('uc-berkeley-data-science-ba#min_gpa');
		expect(w.message).toContain('2.9');
		expect(w.message).toContain('3');
		expect(codes(b)).not.toContain('GPA_BELOW_COMPETITIVE');
	});

	it('uva target with gpa 3.3 -> GPA_BELOW_MIN against 3.4, units met, supplement unpublished', () => {
		const profile = make({ targets: [{ school_id: 'uva', program_id: 'uva-as-vccs-gaa', term: 'Fall 2027' }] });
		const [u] = analyzeGaps(profile, dataset, { today });
		const w = warning(u, 'GPA_BELOW_MIN');
		expect(w.requirementId).toBe('uva-as-vccs-gaa#min_gpa');
		expect(w.message).toContain('3.4');
		expect(u.units.status).toBe('met');
		expect(u.warnings.filter((x) => x.code === 'DATA_NOT_PUBLISHED').map((x) => x.requirementId)).toContain(
			'uva-as-vccs-gaa#essay:uva-supplement'
		);
	});

	it.each([
		['semester', { completed: 30, in_progress: 10, system: 'semester' }],
		['quarter', { completed: 45, in_progress: 15, system: 'quarter' }]
	])('%s units short -> UNITS_SHORT with shortfall 20', (_label, units) => {
		const b = byId(analyzeGaps(make({ units }), dataset, { today }), 'uc-berkeley-data-science-ba');
		const w = warning(b, 'UNITS_SHORT');
		expect(b.units.shortfall).toBe(20);
		expect(w.severity).toBe('warning');
		expect(w.requirementId).toBe('uc-berkeley-data-science-ba#units');
		expect(w.message).toContain('20 short');
	});

	it('terms_remaining 0 -> PREREQ_MISSING_TERMS_LEFT is a blocker', () => {
		const b = byId(analyzeGaps(make({ terms_remaining: 0 }), dataset, { today }), 'uc-berkeley-data-science-ba');
		const w = warning(b, 'PREREQ_MISSING_TERMS_LEFT');
		expect(w.severity).toBe('blocker');
		expect(w.message).toContain('0 term');
	});

	it('today 2026-12-01 -> berkeley DEADLINE_PASSED is the first warning', () => {
		const b = byId(analyzeGaps(demo, dataset, { today: '2026-12-01' }), 'uc-berkeley-data-science-ba');
		expect(b.warnings[0]).toMatchObject({
			code: 'DEADLINE_PASSED',
			severity: 'blocker',
			requirementId: 'uc-berkeley-data-science-ba#deadline:fall-2027-application-2026-11-30'
		});
		expect(b.warnings[0].message).toContain('2026-11-30');
	});
});

describe('summary severity counts', () => {
	it('match the warnings in every report', () => {
		const reports = [
			...r,
			...analyzeGaps(make({ gpa: 2.9, terms_remaining: 0 }), dataset, { today: '2026-12-01' })
		];
		for (const report of reports) {
			const n = (s: string) => report.warnings.filter((w) => w.severity === s).length;
			expect(report.summary).toMatchObject({ blockers: n('blocker'), warnings: n('warning'), info: n('info') });
		}
	});
});

import { describe, it, expect } from 'vitest';
import demoJson from '../data/profiles/demo.json';
import { Profile, type ProfileCourse } from '../schemas/profile.ts';
import { convertUnits, QUARTER_UNITS_PER_SEMESTER_UNIT } from './units.ts';
import { assertIsoDate, daysUntil } from './dates.ts';
import { classifyPrereq, subjectFamily } from './equivalency.ts';
import { WarningCode, WARNING_CODE_ORDER } from './types.ts';

const demo = Profile.parse(demoJson);

describe('convertUnits', () => {
	it.each([
		[60, 'semester', 'quarter', 90],
		[90, 'quarter', 'semester', 60],
		[70, 'quarter', 'semester', 46.67],
		[45, 'semester', 'semester', 45]
	] as const)('%d %s -> %s = %d', (value, from, to, expected) => {
		expect(convertUnits(value, from, to)).toBe(expected);
	});

	it('uses 1.5 quarter units per semester unit', () => {
		expect(QUARTER_UNITS_PER_SEMESTER_UNIT).toBe(1.5);
	});
});

describe('daysUntil', () => {
	it.each([
		['2026-09-13', '2026-11-30', 78],
		['2026-09-13', '2027-03-15', 183],
		['2026-09-13', '2027-02-01', 141],
		['2026-12-01', '2026-11-30', -1],
		['2026-09-13', '2026-09-13', 0]
	])('%s -> %s = %d', (today, date, expected) => {
		expect(daysUntil(today, date)).toBe(expected);
	});
});

describe('assertIsoDate', () => {
	it.each(['2026-9-13', '2026-02-30', ''])('rejects %j', (s) => {
		expect(() => assertIsoDate(s)).toThrow(/YYYY-MM-DD/);
	});

	it('accepts a valid date', () => {
		expect(() => assertIsoDate('2026-09-13')).not.toThrow();
	});
});

describe('subjectFamily', () => {
	it.each([
		['Elementary Statistics with Probability', 'statistics'],
		['Foundations of Data Science (Data C8)', 'statistics'],
		['Programming: CS 61A or CS/Data C88C, or Engin 7', 'programming'],
		['Data Structures (CS 61B or 61BL)', 'data_structures'],
		['Linear Algebra (Math 54 or equivalent)', 'linear_algebra'],
		['Freshman English: Composition', 'composition'],
		['Writing-intensive composition course', 'composition'],
		['Introductory Macroeconomics (ECON 1120 or equivalent)', 'macroeconomics'],
		['UC 7-course pattern', null],
		['Domain Emphasis lower-division course', null]
	])('%s -> %s', (text, expected) => {
		expect(subjectFamily(text)).toBe(expected);
	});
});

describe('classifyPrereq against the demo profile', () => {
	it.each([
		{
			id: 'calc-2',
			name: 'Calculus II',
			expected: { status: 'met', matchedCourses: ['MATH 193'], pendingCompletion: true, possibleEquivalents: [], plannedCourses: [] }
		},
		{
			id: 'calc-1',
			name: 'Calculus I',
			expected: { status: 'met', matchedCourses: ['MATH 192'], pendingCompletion: false, possibleEquivalents: [], plannedCourses: [] }
		},
		{
			id: 'data-c8',
			name: 'Foundations of Data Science (Data C8)',
			expected: { status: 'unknown-equivalency', matchedCourses: [], pendingCompletion: false, possibleEquivalents: ['MATH 142'], plannedCourses: [] }
		},
		{
			id: 'linear-algebra',
			name: 'Linear Algebra (Math 54 or equivalent)',
			expected: { status: 'missing', matchedCourses: [], pendingCompletion: false, possibleEquivalents: [], plannedCourses: [] }
		},
		{
			id: 'as-writing-intensive',
			name: 'Writing-intensive composition course',
			expected: { status: 'unknown-equivalency', matchedCourses: [], pendingCompletion: false, possibleEquivalents: ['ENGL 122'], plannedCourses: [] }
		},
		{
			id: 'econ-1120',
			name: 'Introductory Macroeconomics (ECON 1120 or equivalent)',
			expected: { status: 'missing', matchedCourses: [], pendingCompletion: false, possibleEquivalents: [], plannedCourses: [] }
		}
	])('$id -> $expected.status', ({ id, name, expected }) => {
		expect(classifyPrereq({ id, name }, demo.courses)).toEqual(expected);
	});

	const planned = (satisfies: string[]): ProfileCourse => ({
		code: 'COMSC 210',
		title: 'Program Design and Data Structures',
		units: 4,
		status: 'planned',
		grade: null,
		satisfies
	});

	it('a requirement mapped only by a planned course is missing, with plannedCourses listed', () => {
		const r = classifyPrereq({ id: 'data-structures', name: 'Data Structures (CS 61B or 61BL)' }, [planned(['data-structures'])]);
		expect(r).toEqual({ status: 'missing', matchedCourses: [], pendingCompletion: false, possibleEquivalents: [], plannedCourses: ['COMSC 210'] });
	});

	it('a planned unmapped course never makes a requirement unknown-equivalency', () => {
		const r = classifyPrereq({ id: 'data-structures', name: 'Data Structures (CS 61B or 61BL)' }, [planned([])]);
		expect(r.status).toBe('missing');
		expect(r.possibleEquivalents).toEqual([]);
	});
});

describe('WarningCode', () => {
	it('keeps the stable code order', () => {
		expect(WarningCode.options).toEqual([
			'NO_TRANSFER_PROGRAM',
			'DEADLINE_PASSED',
			'GPA_BELOW_MIN',
			'GPA_BELOW_COMPETITIVE',
			'UNITS_SHORT',
			'PREREQ_MISSING_TERMS_LEFT',
			'PREREQ_UNKNOWN_EQUIVALENCY',
			'DATA_NOT_PUBLISHED'
		]);
		expect(WARNING_CODE_ORDER).toBe(WarningCode.options);
	});
});

import { describe, it, expect } from 'vitest';
import schoolsJson from '../data/schools.json';
import demoJson from '../data/profiles/demo.json';
import demoQuarterJson from '../data/profiles/demo-quarter.json';
import { SchoolsDataset, requirementIds, type Program } from '../schemas/school.ts';
import { Profile } from '../schemas/profile.ts';
import { analyzeGaps } from './analyze.ts';
import { WARNING_CODE_ORDER, type GapReport } from './types.ts';

const dataset = SchoolsDataset.parse(schoolsJson);
const make = (overrides: Record<string, unknown>) => Profile.parse({ ...structuredClone(demoJson), ...overrides });

const profiles: [string, Profile][] = [
	['demo', Profile.parse(demoJson)],
	['demo-quarter', Profile.parse(demoQuarterJson)],
	['gpa-2.9', make({ gpa: 2.9 })],
	['uva-target', make({ targets: [{ school_id: 'uva', program_id: 'uva-as-vccs-gaa', term: 'Fall 2027' }] })],
	['units-short', make({ units: { completed: 30, in_progress: 10, system: 'semester' } })],
	['units-short-quarter', make({ units: { completed: 45, in_progress: 15, system: 'quarter' } })],
	['terms-0', make({ terms_remaining: 0 })]
];
const todays = ['2026-09-13', '2026-12-01'];
const cases = profiles.flatMap(([name, profile]) => todays.map((today) => [name, today, profile] as const));

type Hit = { path: string; value: unknown };
const NUM_TOKEN = /\d+(?:\.\d+)?/g;

/** Every value stored under `key` anywhere in `obj` (arrays are flattened). */
function collectByKey(obj: unknown, key: string, path = '$', out: Hit[] = []): Hit[] {
	if (Array.isArray(obj)) obj.forEach((v, i) => collectByKey(v, key, `${path}[${i}]`, out));
	else if (obj && typeof obj === 'object') {
		for (const [k, v] of Object.entries(obj)) {
			if (k === key) {
				if (Array.isArray(v)) v.forEach((x, i) => out.push({ path: `${path}.${k}[${i}]`, value: x }));
				else out.push({ path: `${path}.${k}`, value: v });
			}
			collectByKey(v, key, `${path}.${k}`, out);
		}
	}
	return out;
}

/** Numeric leaves plus numeric tokens inside strings, as absolute values. */
function collectNumbers(value: unknown, path = '$', out: { path: string; value: number }[] = []) {
	if (typeof value === 'number') out.push({ path, value: Math.abs(value) });
	else if (typeof value === 'string') {
		for (const tok of value.match(NUM_TOKEN) ?? []) out.push({ path, value: Math.abs(parseFloat(tok)) });
	} else if (Array.isArray(value)) value.forEach((v, i) => collectNumbers(v, `${path}[${i}]`, out));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) collectNumbers(v, `${path}.${k}`, out);
	}
	return out;
}

function programSources(p: Program): Set<string> {
	const urls = new Set<string>();
	const walk = (o: unknown): void => {
		if (Array.isArray(o)) o.forEach(walk);
		else if (o && typeof o === 'object') {
			for (const [k, v] of Object.entries(o)) {
				if (k === 'source_url' && typeof v === 'string') urls.add(v);
				else if (k === 'additional_source_urls' && Array.isArray(v)) v.forEach((u) => urls.add(u));
				else walk(v);
			}
		}
	};
	walk(p);
	return urls;
}

function findProgram(report: GapReport): Program {
	const p = dataset.schools.flatMap((s) => s.programs).find((x) => x.program_id === report.programId);
	if (!p) throw new Error(`no program ${report.programId}`);
	return p;
}

describe.each(cases)('integrity: %s @ %s', (_name, today, profile) => {
	const reports = analyzeGaps(profile, dataset, { today });

	it('(a) every requirement id exists in requirementIds(program)', () => {
		const bad = reports.flatMap((report) => {
			const ids = new Set(requirementIds(findProgram(report)));
			return [
				...collectByKey(report, 'requirementId'),
				...collectByKey(report, 'relatedRequirementIds')
			].filter((h) => !ids.has(h.value as string));
		});
		expect(bad).toEqual([]);
	});

	it('(b) every sourceUrl is a provenance URL of the program', () => {
		const bad = reports.flatMap((report) => {
			const urls = programSources(findProgram(report));
			return collectByKey(report, 'sourceUrl').filter((h) => !urls.has(h.value as string));
		});
		expect(bad).toEqual([]);
	});

	it('(c) no number is invented', () => {
		const bad = reports.flatMap((report) => {
			const program = findProgram(report);
			const allowed = new Set<number>([0]);
			const add = (xs: { value: number }[]) => xs.forEach((x) => allowed.add(x.value));
			add(collectNumbers(JSON.stringify(profile)));
			add(collectNumbers(JSON.stringify(program)));
			add(collectNumbers(today));
			const derived = [
				report.units.completedInRequiredSystem,
				report.units.projectedInRequiredSystem,
				report.units.shortfall,
				...report.allDeadlines.map((d) => d.daysUntil),
				report.deadline?.daysUntil,
				...Object.values(report.summary),
				report.essays.requiredCount,
				report.essays.optionalCount,
				report.prereqs.length
			];
			for (const d of derived) if (typeof d === 'number') allowed.add(Math.abs(d));
			return collectNumbers(report).filter((n) => !allowed.has(n.value));
		});
		expect(bad).toEqual([]);
	});

	it('(d) warnings follow WARNING_CODE_ORDER', () => {
		for (const report of reports) {
			const idx = report.warnings.map((w) => WARNING_CODE_ORDER.indexOf(w.code));
			expect(idx).toEqual([...idx].sort((a, b) => a - b));
		}
	});
});

import { describe, it, expect } from 'vitest';
import raw from './schools.json';
import { SchoolsDataset, SCALAR_REQUIREMENT_FIELDS, requirementIds } from '../schemas/school.ts';

const PROVENANCE_KEYS = ['source_url', 'retrieved_at', 'confidence'] as const;
const LISTS = ['required_courses', 'deadlines', 'essays'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (): any => structuredClone(raw);
const parsed = SchoolsDataset.parse(raw);
const programs = parsed.schools.flatMap((s) => s.programs);

/** Collect every provenance-bearing object in the dataset (scalar fields + list items). */
function allSourced(ds: typeof parsed, onlyFictional: boolean | null) {
	const out: { source_url: string; confidence: string }[] = [];
	for (const s of ds.schools) {
		if (onlyFictional !== null && s.is_fictional !== onlyFictional) continue;
		for (const p of s.programs) {
			for (const f of SCALAR_REQUIREMENT_FIELDS) out.push(p[f]);
			for (const l of LISTS) out.push(...p[l]);
		}
	}
	return out;
}

describe('schools.json dataset', () => {
	it('validates against SchoolsDataset', () => {
		const result = SchoolsDataset.safeParse(raw);
		expect(result.success).toBe(true);
	});

	it('has 4 real schools and 1 fictional school clearly marked', () => {
		expect(parsed.schools).toHaveLength(5);
		expect(parsed.schools.filter((s) => !s.is_fictional)).toHaveLength(4);
		const fictional = parsed.schools.filter((s) => s.is_fictional);
		expect(fictional).toHaveLength(1);
		expect(fictional[0].name).toContain('(FICTIONAL)');
		const urls = allSourced(parsed, true).map((x) => x.source_url);
		expect(urls.length).toBeGreaterThan(0);
		expect(urls.every((u) => u === 'about:fictional')).toBe(true);
		expect(fictional[0].programs[0].has_transfer_program.value).toBe(false);
	});

	it('uses https:// for every real source_url', () => {
		const bad = allSourced(parsed, false)
			.map((x) => x.source_url)
			.filter((u) => !u.startsWith('https://'));
		expect(bad).toEqual([]);
	});

	it('has the expected school ids and unique program ids', () => {
		expect(parsed.schools.map((s) => s.school_id)).toEqual([
			'uc-berkeley',
			'cornell',
			'umich',
			'uva',
			'northfield-fictional'
		]);
		const ids = programs.map((p) => p.program_id);
		expect(ids).toHaveLength(6);
		expect(new Set(ids).size).toBe(6);
	});

	it('gives real programs dated deadlines and bounded or flagged essays', () => {
		for (const s of parsed.schools.filter((x) => !x.is_fictional)) {
			for (const p of s.programs) {
				expect(p.deadlines.length, p.program_id).toBeGreaterThanOrEqual(1);
				for (const d of p.deadlines) {
					expect(d.term.length).toBeGreaterThan(0);
					expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				}
				for (const e of p.essays) {
					const bounded = e.word_limit !== null || e.char_limit !== null;
					const flagged = e.prompt === null && e.confidence === 'LOW';
					expect(bounded || flagged, `${p.program_id}#essay:${e.id}`).toBe(true);
				}
			}
		}
	});

	it('rejects missing provenance on every requirement field (source_url, retrieved_at, confidence)', () => {
		type Case = { label: string; key: string; mutate: (ds: any) => void }; // eslint-disable-line @typescript-eslint/no-explicit-any
		const cases: Case[] = [];
		parsed.schools.forEach((school, s) => {
			school.programs.forEach((program, p) => {
				for (const key of PROVENANCE_KEYS) {
					for (const field of SCALAR_REQUIREMENT_FIELDS) {
						cases.push({
							label: `${program.program_id}.${field}.${key}`,
							key,
							mutate: (ds) => delete ds.schools[s].programs[p][field][key]
						});
					}
					for (const list of LISTS) {
						if (program[list].length === 0) continue;
						cases.push({
							label: `${program.program_id}.${list}[0].${key}`,
							key,
							mutate: (ds) => delete ds.schools[s].programs[p][list][0][key]
						});
					}
				}
			});
		});

		expect(cases.length).toBeGreaterThan(100);
		const unexpectedlyValid: string[] = [];
		const wrongPath: string[] = [];
		for (const c of cases) {
			const ds = clone();
			c.mutate(ds);
			const result = SchoolsDataset.safeParse(ds);
			if (result.success) {
				unexpectedlyValid.push(c.label);
				continue;
			}
			if (!result.error.issues.some((i) => i.path.includes(c.key))) wrongPath.push(c.label);
		}
		expect(unexpectedlyValid).toEqual([]);
		expect(wrongPath).toEqual([]);
	});

	it('rejects a duplicate program_id', () => {
		const ds = clone();
		ds.schools[1].programs[1].program_id = ds.schools[1].programs[0].program_id;
		expect(SchoolsDataset.safeParse(ds).success).toBe(false);
	});

	it('produces unique, program-prefixed requirement ids', () => {
		for (const p of programs) {
			const ids = requirementIds(p);
			expect(ids.length).toBeGreaterThanOrEqual(SCALAR_REQUIREMENT_FIELDS.length);
			expect(new Set(ids).size).toBe(ids.length);
			expect(ids.every((id) => id.startsWith(`${p.program_id}#`))).toBe(true);
		}
	});

	it('maps ai_policy modes per school', () => {
		const expected: Record<string, string> = {
			cornell: 'grammar_only',
			'uc-berkeley': 'feedback_ok',
			umich: 'brainstorm_ok',
			uva: 'unknown'
		};
		for (const s of parsed.schools) {
			if (!(s.school_id in expected)) continue;
			for (const p of s.programs) expect(p.ai_policy.value.mode, p.program_id).toBe(expected[s.school_id]);
		}
	});
});

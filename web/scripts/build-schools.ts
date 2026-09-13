/**
 * Reproducible transform: .planning/research/seed-schools.json -> src/lib/core/data/schools.json
 * Every requirement field gets its own provenance (source_url, retrieved_at, confidence).
 * Run: npx tsx scripts/build-schools.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SchoolsDataset } from '../src/lib/core/schemas/school.ts';

type Conf = 'HIGH' | 'MEDIUM' | 'LOW';
interface SeedSource {
	field: string;
	url: string;
	retrieved_at: string;
	confidence: Conf;
}
interface SeedProgram {
	program_id: string;
	name: string;
	has_transfer_program: boolean;
	min_gpa: number | null;
	competitive_gpa: number | null;
	units: { min: number | null; system: 'semester' | 'quarter' };
	required_courses: { id: string; name: string; notes?: string | null }[];
	ge_pattern: string | null;
	deadlines: { term: string; type: 'filing_open' | 'application' | 'docs'; date: string }[];
	essays: { id: string; prompt: string | null; word_limit: number | null; required: boolean }[];
	recs_required: number;
	ai_policy: 'grammar_only' | 'feedback_ok' | 'brainstorm_ok' | 'unknown';
	ai_policy_quote: string | null;
	sources: SeedSource[];
}
interface SeedSchool {
	school_id: string;
	name: string;
	programs: SeedProgram[];
}

const SEED_PATH = fileURLToPath(new URL('../../.planning/research/seed-schools.json', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../src/lib/core/data/schools.json', import.meta.url));

const FICTIONAL_ID = 'northfield-fictional';
const FICTIONAL_NAME = 'Northfield Institute of Technology (FICTIONAL)';

function makePicker(program: SeedProgram) {
	return (field: string, candidates: string[]) => {
		for (let i = 0; i < candidates.length; i++) {
			const candidate = candidates[i];
			const matches = program.sources.filter((s) => s.field === candidate);
			if (matches.length === 0) continue;
			const [first, ...rest] = matches;
			const isFallback = i > 0;
			const confidence: Conf = isFallback && first.confidence === 'HIGH' ? 'MEDIUM' : first.confidence;
			return {
				source_url: first.url,
				additional_source_urls: rest.map((r) => r.url),
				retrieved_at: first.retrieved_at,
				confidence,
				...(isFallback
					? {
							note: `Provenance from the "${candidate}" source; this field is not stated separately on that page.`
						}
					: {})
			};
		}
		throw new Error(`No source for ${program.program_id}.${field}`);
	};
}

function charLimit(prompt: string | null): number | null {
	if (!prompt) return null;
	const m = prompt.match(/\(([\d,]+) characters maximum\.?\)/);
	return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}

function buildProgram(schoolId: string, p: SeedProgram) {
	const pick = makePicker(p);
	return {
		program_id: p.program_id,
		school_id: schoolId,
		name: p.name,
		has_transfer_program: {
			...pick('has_transfer_program', ['has_transfer_program', 'deadlines', 'units', '*']),
			value: p.has_transfer_program
		},
		min_gpa: { ...pick('min_gpa', ['min_gpa', 'competitive_gpa', '*']), value: p.min_gpa },
		competitive_gpa: {
			...pick('competitive_gpa', ['competitive_gpa', 'min_gpa', '*']),
			value: p.competitive_gpa
		},
		units: { ...pick('units', ['units', '*']), value: { min: p.units.min, system: p.units.system } },
		ge_pattern: { ...pick('ge_pattern', ['ge_pattern', 'required_courses', '*']), value: p.ge_pattern },
		recs_required: { ...pick('recs_required', ['recs_required', '*']), value: p.recs_required },
		ai_policy: {
			...pick('ai_policy', ['ai_policy', '*']),
			value: { mode: p.ai_policy, quote: p.ai_policy_quote }
		},
		required_courses: p.required_courses.map((c) => ({
			...pick(`required_courses.${c.id}`, ['required_courses', '*']),
			id: c.id,
			name: c.name,
			notes: c.notes ?? null
		})),
		deadlines: p.deadlines.map((d) => ({
			...pick(`deadlines.${d.date}`, ['deadlines', '*']),
			id: `${d.term.toLowerCase().replace(/\s+/g, '-')}-${d.type}-${d.date}`,
			term: d.term,
			type: d.type,
			date: d.date
		})),
		essays: p.essays.map((e) => ({
			...pick(`essays.${e.id}`, [`essays.${e.id}`, 'essays', '*']),
			id: e.id,
			prompt: e.prompt,
			word_limit: e.word_limit,
			char_limit: charLimit(e.prompt),
			required: e.required
		}))
	};
}

const seed: SeedSchool[] = JSON.parse(readFileSync(SEED_PATH, 'utf8'));

const schools = seed.map((s) => {
	const isFictional = s.school_id === FICTIONAL_ID;
	return {
		school_id: s.school_id,
		name: isFictional ? FICTIONAL_NAME : s.name,
		is_fictional: isFictional,
		programs: s.programs.map((p) => buildProgram(s.school_id, p))
	};
});

const dataset = {
	dataset_version: '2026-09-13',
	cycle: 'Fall 2027',
	disclaimer:
		'Curated from official admissions pages on the retrieved_at date. Requirements change; always verify on the official page linked next to each field. Northfield Institute of Technology is FICTIONAL and exists only for adversarial tests.',
	schools
};

let parsed: SchoolsDataset;
try {
	parsed = SchoolsDataset.parse(dataset);
} catch (err) {
	if (err instanceof z.ZodError) console.error(z.prettifyError(err));
	else console.error(err);
	process.exit(1);
}

writeFileSync(OUT_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
const programCount = parsed.schools.reduce((n, s) => n + s.programs.length, 0);
console.log(`wrote ${parsed.schools.length} schools / ${programCount} programs`);

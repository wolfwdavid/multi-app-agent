import { z } from 'zod';

export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const UnitSystem = z.enum(['semester', 'quarter']);
export const AiPolicy = z.enum(['grammar_only', 'feedback_ok', 'brainstorm_ok', 'unknown']);

const SourceUrl = z
	.string()
	.refine(
		(s) => s.startsWith('https://') || s === 'about:fictional',
		'source_url must be https:// or about:fictional'
	);

export const SourceRef = z.object({
	source_url: SourceUrl,
	additional_source_urls: z.array(SourceUrl).default([]),
	retrieved_at: z.iso.date(),
	confidence: Confidence,
	note: z.string().optional()
});

/** Wrap a requirement value with mandatory provenance. */
export const sourced = <T extends z.ZodType>(value: T) => z.object({ ...SourceRef.shape, value });

export const RequiredCourse = z.object({
	...SourceRef.shape,
	id: z.string().min(1),
	name: z.string().min(1),
	notes: z.string().nullable()
});

export const Deadline = z.object({
	...SourceRef.shape,
	/** `${slug(term)}-${type}-${date}` e.g. 'fall-2027-application-2026-11-30' */
	id: z.string().min(1),
	term: z.string().min(1),
	type: z.enum(['filing_open', 'application', 'docs']),
	date: z.iso.date()
});

export const Essay = z.object({
	...SourceRef.shape,
	id: z.string().min(1),
	/** null = prompt not publicly verifiable (LOW confidence) */
	prompt: z.string().nullable(),
	word_limit: z.number().int().positive().nullable(),
	char_limit: z.number().int().positive().nullable(),
	required: z.boolean()
});

const Slug = z.string().regex(/^[a-z0-9-]+$/);

export const Program = z.object({
	program_id: Slug,
	school_id: Slug,
	name: z.string().min(1),
	has_transfer_program: sourced(z.boolean()),
	min_gpa: sourced(z.number().min(0).max(4).nullable()),
	competitive_gpa: sourced(z.number().min(0).max(4).nullable()),
	units: sourced(z.object({ min: z.number().nonnegative().nullable(), system: UnitSystem })),
	ge_pattern: sourced(z.string().nullable()),
	recs_required: sourced(z.number().int().nonnegative()),
	ai_policy: sourced(z.object({ mode: AiPolicy, quote: z.string().nullable() })),
	required_courses: z.array(RequiredCourse),
	deadlines: z.array(Deadline),
	essays: z.array(Essay)
});

export const School = z.object({
	school_id: Slug,
	name: z.string().min(1),
	is_fictional: z.boolean(),
	programs: z.array(Program).min(1)
});

export const SchoolsDataset = z
	.object({
		dataset_version: z.string(),
		cycle: z.string(),
		disclaimer: z.string(),
		schools: z.array(School)
	})
	.superRefine((ds, ctx) => {
		const schoolIds = new Set<string>();
		const programIds = new Set<string>();
		ds.schools.forEach((school, s) => {
			if (schoolIds.has(school.school_id)) {
				ctx.addIssue({
					code: 'custom',
					message: `duplicate school_id "${school.school_id}"`,
					path: ['schools', s, 'school_id']
				});
			}
			schoolIds.add(school.school_id);
			school.programs.forEach((program, p) => {
				if (programIds.has(program.program_id)) {
					ctx.addIssue({
						code: 'custom',
						message: `duplicate program_id "${program.program_id}"`,
						path: ['schools', s, 'programs', p, 'program_id']
					});
				}
				programIds.add(program.program_id);
				if (program.school_id !== school.school_id) {
					ctx.addIssue({
						code: 'custom',
						message: `program.school_id "${program.school_id}" does not match parent "${school.school_id}"`,
						path: ['schools', s, 'programs', p, 'school_id']
					});
				}
			});
		});
	});

export type Confidence = z.infer<typeof Confidence>;
export type UnitSystem = z.infer<typeof UnitSystem>;
export type AiPolicy = z.infer<typeof AiPolicy>;
export type SourceRef = z.infer<typeof SourceRef>;
export type RequiredCourse = z.infer<typeof RequiredCourse>;
export type Deadline = z.infer<typeof Deadline>;
export type Essay = z.infer<typeof Essay>;
export type Program = z.infer<typeof Program>;
export type School = z.infer<typeof School>;
export type SchoolsDataset = z.infer<typeof SchoolsDataset>;

export const SCALAR_REQUIREMENT_FIELDS = [
	'has_transfer_program',
	'min_gpa',
	'competitive_gpa',
	'units',
	'ge_pattern',
	'recs_required',
	'ai_policy'
] as const;
export type ScalarRequirementField = (typeof SCALAR_REQUIREMENT_FIELDS)[number];

/** Stable requirement ids for gap findings: `${program_id}#${field}` for scalars, `#course:${id}`, `#deadline:${id}`, `#essay:${id}`. */
export function requirementIds(p: Program): string[] {
	return [
		...SCALAR_REQUIREMENT_FIELDS.map((f) => `${p.program_id}#${f}`),
		...p.required_courses.map((c) => `${p.program_id}#course:${c.id}`),
		...p.deadlines.map((d) => `${p.program_id}#deadline:${d.id}`),
		...p.essays.map((e) => `${p.program_id}#essay:${e.id}`)
	];
}

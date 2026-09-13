/**
 * GapReport runtime contract (camelCase). Inputs (Profile, SchoolsDataset) stay snake_case.
 *
 * WarningCode values are STABLE identifiers. Evals, the planner and the UI key on them.
 * Never rename or reorder them; only append new codes at the end.
 */
import { z } from 'zod';
import { Confidence, UnitSystem } from '../schemas/school.ts';

export const PrereqStatus = z.enum(['met', 'missing', 'unknown-equivalency']);
export type PrereqStatus = z.infer<typeof PrereqStatus>;

export const GpaStatus = z.enum([
	'at_or_above_competitive',
	'meets_minimum',
	'below_competitive',
	'below_minimum',
	'not_published'
]);
export type GpaStatus = z.infer<typeof GpaStatus>;

export const UnitsStatus = z.enum(['met', 'met_with_in_progress', 'short', 'not_published']);
export type UnitsStatus = z.infer<typeof UnitsStatus>;

export const DeadlineStatus = z.enum(['upcoming', 'passed']);
export type DeadlineStatus = z.infer<typeof DeadlineStatus>;

export const Severity = z.enum(['blocker', 'warning', 'info']);
export type Severity = z.infer<typeof Severity>;

export const WarningCode = z.enum([
	'NO_TRANSFER_PROGRAM',
	'DEADLINE_PASSED',
	'GPA_BELOW_MIN',
	'GPA_BELOW_COMPETITIVE',
	'UNITS_SHORT',
	'PREREQ_MISSING_TERMS_LEFT',
	'PREREQ_UNKNOWN_EQUIVALENCY',
	'DATA_NOT_PUBLISHED'
]);
export type WarningCode = z.infer<typeof WarningCode>;

/** Emission order for warnings within one report. */
export const WARNING_CODE_ORDER = WarningCode.options;

export const Provenance = z.object({
	requirementId: z.string().min(1),
	sourceUrl: z.string().min(1),
	confidence: Confidence
});
export type Provenance = z.infer<typeof Provenance>;

export const GpaBenchmark = Provenance.extend({
	value: z.number().nullable(),
	published: z.boolean()
});
export type GpaBenchmark = z.infer<typeof GpaBenchmark>;

export const GpaFinding = z.object({
	student: z.number(),
	min: GpaBenchmark,
	competitive: GpaBenchmark,
	status: GpaStatus
});
export type GpaFinding = z.infer<typeof GpaFinding>;

export const UnitsFinding = Provenance.extend({
	requiredMin: z.number().nullable(),
	requiredSystem: UnitSystem,
	studentSystem: UnitSystem,
	studentCompleted: z.number(),
	studentInProgress: z.number(),
	converted: z.boolean(),
	completedInRequiredSystem: z.number(),
	projectedInRequiredSystem: z.number(),
	shortfall: z.number().nullable(),
	status: UnitsStatus
});
export type UnitsFinding = z.infer<typeof UnitsFinding>;

export const PrereqFinding = Provenance.extend({
	courseId: z.string(),
	name: z.string(),
	status: PrereqStatus,
	matchedCourses: z.array(z.string()),
	pendingCompletion: z.boolean(),
	possibleEquivalents: z.array(z.string()),
	plannedCourses: z.array(z.string())
});
export type PrereqFinding = z.infer<typeof PrereqFinding>;

export const EssayFinding = Provenance.extend({
	essayId: z.string(),
	prompt: z.string().nullable(),
	promptPublished: z.boolean(),
	wordLimit: z.number().nullable(),
	charLimit: z.number().nullable(),
	required: z.boolean()
});
export type EssayFinding = z.infer<typeof EssayFinding>;

export const DeadlineItem = Provenance.extend({
	deadlineId: z.string(),
	term: z.string(),
	type: z.enum(['filing_open', 'application', 'docs']),
	date: z.string(),
	daysUntil: z.number().int()
});
export type DeadlineItem = z.infer<typeof DeadlineItem>;

export const DeadlineFinding = DeadlineItem.extend({
	status: DeadlineStatus,
	termMatched: z.boolean()
});
export type DeadlineFinding = z.infer<typeof DeadlineFinding>;

/** schoolId/programId/requirementId/code/message map directly onto the Phase 4 Blocker contract. */
export const FeasibilityWarning = Provenance.extend({
	code: WarningCode,
	severity: Severity,
	message: z.string().min(1),
	schoolId: z.string(),
	programId: z.string(),
	relatedRequirementIds: z.array(z.string())
});
export type FeasibilityWarning = z.infer<typeof FeasibilityWarning>;

export const GapReport = z.object({
	profileId: z.string(),
	schoolId: z.string(),
	programId: z.string(),
	schoolName: z.string(),
	programName: z.string(),
	isFictional: z.boolean(),
	targetTerm: z.string(),
	asOf: z.string(),
	hasTransferProgram: Provenance.extend({ value: z.boolean() }),
	gpa: GpaFinding,
	units: UnitsFinding,
	prereqs: z.array(PrereqFinding),
	gePattern: Provenance.extend({ text: z.string().nullable() }),
	essays: z.object({
		required: z.array(EssayFinding),
		optional: z.array(EssayFinding),
		requiredCount: z.number().int(),
		optionalCount: z.number().int()
	}),
	recs: Provenance.extend({ required: z.number().int() }),
	aiPolicy: Provenance.extend({ mode: z.string() }),
	deadline: DeadlineFinding.nullable(),
	allDeadlines: z.array(DeadlineItem),
	warnings: z.array(FeasibilityWarning),
	summary: z.object({
		met: z.number().int(),
		missing: z.number().int(),
		unknownEquivalency: z.number().int(),
		blockers: z.number().int(),
		warnings: z.number().int(),
		info: z.number().int()
	})
});
export type GapReport = z.infer<typeof GapReport>;

export const AnalyzeOptions = z.object({ today: z.string() });
export type AnalyzeOptions = z.infer<typeof AnalyzeOptions>;

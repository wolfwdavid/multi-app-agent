import type { Profile } from '../schemas/profile.ts';
import type { Program, School } from '../schemas/school.ts';
import type { FeasibilityWarning, GapReport, Provenance, Severity, WarningCode } from './types.ts';

export interface WarningInput {
	profile: Profile;
	school: School;
	program: Program;
	report: Omit<GapReport, 'warnings' | 'summary'>;
}

/**
 * Feasibility warnings with stable codes, emitted in WARNING_CODE_ORDER.
 * Messages interpolate only values already present in the profile, the program or the report
 * (no invented numbers; integrity.test.ts enforces this).
 */
export function buildWarnings({ profile, school, program, report }: WarningInput): FeasibilityWarning[] {
	const out: FeasibilityWarning[] = [];
	const push = (
		code: WarningCode,
		severity: Severity,
		from: Provenance,
		message: string,
		relatedRequirementIds: string[] = []
	) =>
		out.push({
			code,
			severity,
			message,
			schoolId: school.school_id,
			programId: program.program_id,
			requirementId: from.requirementId,
			sourceUrl: from.sourceUrl,
			confidence: from.confidence,
			relatedRequirementIds
		});

	// 1. No transfer program: nothing else matters for this program.
	if (report.hasTransferProgram.value === false) {
		push('NO_TRANSFER_PROGRAM', 'blocker', report.hasTransferProgram, `${program.name} does not accept transfer applicants.`);
		return out;
	}

	// 2. Deadline passed.
	const dl = report.deadline;
	if (dl?.status === 'passed') {
		push(
			'DEADLINE_PASSED',
			'blocker',
			dl,
			`The ${dl.term} application deadline (${dl.date}) passed ${Math.abs(dl.daysUntil)} day(s) ago.`
		);
	}

	// 3-4. GPA benchmarks.
	const { gpa } = report;
	if (gpa.status === 'below_minimum') {
		push('GPA_BELOW_MIN', 'blocker', gpa.min, `GPA ${gpa.student} is below the published minimum of ${gpa.min.value}.`);
	}
	if (gpa.status === 'below_competitive') {
		const message = !gpa.min.published
			? `No minimum GPA is published; GPA ${gpa.student} is below the program's competitive GPA of ${gpa.competitive.value}.`
			: `GPA ${gpa.student} meets the published minimum but is below the program's competitive GPA of ${gpa.competitive.value}.`;
		push('GPA_BELOW_COMPETITIVE', 'warning', gpa.competitive, message);
	}

	// 5. Units short.
	const { units } = report;
	if (units.status === 'short') {
		push(
			'UNITS_SHORT',
			'warning',
			units,
			`Projected ${units.projectedInRequiredSystem} ${units.requiredSystem} units (completed + in progress) are ${units.shortfall} short of the ${units.requiredMin} required.`
		);
	}

	// 6. Missing prerequisites vs terms remaining.
	const missing = report.prereqs.filter((p) => p.status === 'missing');
	if (missing.length > 0) {
		push(
			'PREREQ_MISSING_TERMS_LEFT',
			profile.terms_remaining === 0 ? 'blocker' : 'warning',
			missing[0],
			`${missing.length} required course(s) missing (${missing.map((m) => m.courseId).join(', ')}) with ${profile.terms_remaining} term(s) remaining before transfer.`,
			missing.map((m) => m.requirementId)
		);
	}

	// 7. Equivalency checks needed.
	const unknown = report.prereqs.filter((p) => p.status === 'unknown-equivalency');
	if (unknown.length > 0) {
		push(
			'PREREQ_UNKNOWN_EQUIVALENCY',
			'info',
			unknown[0],
			`${unknown.length} course(s) need an equivalency check with an advisor or articulation office: ${unknown
				.map((u) => `${u.courseId} (possible: ${u.possibleEquivalents.join(', ')})`)
				.join('; ')}.`,
			unknown.map((u) => u.requirementId)
		);
	}

	// 8. Data not published.
	if (!gpa.min.published && !gpa.competitive.published) {
		push('DATA_NOT_PUBLISHED', 'info', gpa.min, 'No minimum or competitive GPA is published for this program.');
	}
	if (units.status === 'not_published') {
		push('DATA_NOT_PUBLISHED', 'info', units, 'No minimum unit requirement is published for this program.');
	}
	for (const essay of [...report.essays.required, ...report.essays.optional]) {
		if (!essay.promptPublished) {
			push(
				'DATA_NOT_PUBLISHED',
				'info',
				essay,
				`The prompt for essay ${essay.essayId} is not publicly available; check the application portal.`
			);
		}
	}

	return out;
}

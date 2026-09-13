import type { ProfileCourse } from '../schemas/profile.ts';
import type { PrereqStatus } from './types.ts';

/** Ordered subject families; the first match wins, so more specific families come first. */
export const SUBJECT_FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
	['data_structures', /\bdata structures\b/i],
	['linear_algebra', /\blinear algebra\b/i],
	['statistics', /statistic|probabilit|data science/i],
	['calculus', /calculus/i],
	['microeconomics', /microecon/i],
	['macroeconomics', /macroecon/i],
	['programming', /programming/i],
	['composition', /composition|writing|english/i]
];

export function subjectFamily(text: string): string | null {
	for (const [family, re] of SUBJECT_FAMILIES) if (re.test(text)) return family;
	return null;
}

export interface PrereqClassification {
	status: PrereqStatus;
	matchedCourses: string[];
	pendingCompletion: boolean;
	possibleEquivalents: string[];
	plannedCourses: string[];
}

/**
 * Conservative, deterministic prerequisite hint.
 *
 * A requirement is only `met` through an explicit `satisfies` mapping on a completed or
 * in-progress course. `unknown-equivalency` means an unmapped, non-planned course is in the
 * same subject family: "ask an advisor or check ASSIST.org". This is not an articulation
 * engine (anti-feature A6).
 */
export function classifyPrereq(
	req: { id: string; name: string },
	courses: readonly ProfileCourse[]
): PrereqClassification {
	const mapped = courses.filter((c) => c.satisfies.includes(req.id));
	const plannedCourses = mapped.filter((c) => c.status === 'planned').map((c) => c.code);
	const done = mapped.filter((c) => c.status === 'completed' || c.status === 'in_progress');

	if (done.length > 0) {
		return {
			status: 'met',
			matchedCourses: done.map((c) => c.code),
			pendingCompletion: !done.some((c) => c.status === 'completed'),
			possibleEquivalents: [],
			plannedCourses
		};
	}

	const fam = subjectFamily(req.name);
	const candidates =
		fam === null
			? []
			: courses.filter(
					(c) => c.satisfies.length === 0 && c.status !== 'planned' && subjectFamily(c.title) === fam
				);

	return {
		status: candidates.length > 0 ? 'unknown-equivalency' : 'missing',
		matchedCourses: [],
		pendingCompletion: false,
		possibleEquivalents: candidates.map((c) => c.code),
		plannedCourses
	};
}

import type { Profile } from '../schemas/profile.ts';
import type { Program, School, SchoolsDataset, SourceRef } from '../schemas/school.ts';
import { assertIsoDate, daysUntil } from './dates.ts';
import { classifyPrereq } from './equivalency.ts';
import type {
	AnalyzeOptions,
	DeadlineFinding,
	DeadlineItem,
	EssayFinding,
	GapReport,
	GpaStatus,
	Provenance,
	UnitsFinding
} from './types.ts';
import { convertUnits, round2 } from './units.ts';
import { buildWarnings } from './warnings.ts';

type Src = Pick<SourceRef, 'source_url' | 'confidence'>;

function prov(program: Program, field: string, src: Src): Provenance {
	return {
		requirementId: `${program.program_id}#${field}`,
		sourceUrl: src.source_url,
		confidence: src.confidence
	};
}

const byDateThenId = (a: DeadlineItem, b: DeadlineItem) =>
	a.date.localeCompare(b.date) || a.deadlineId.localeCompare(b.deadlineId);

function gpaStatus(gpa: number, min: number | null, comp: number | null): GpaStatus {
	if (min !== null && gpa < min) return 'below_minimum';
	// Competitive fallback: evaluated even when no minimum is published (e.g. Cornell A&S).
	if (comp !== null && gpa < comp) return 'below_competitive';
	if (comp !== null) return 'at_or_above_competitive';
	if (min !== null) return 'meets_minimum';
	return 'not_published';
}

function unitsFinding(profile: Profile, p: Program): UnitsFinding {
	const reqSys = p.units.value.system;
	const stuSys = profile.units.system;
	const min = p.units.value.min;
	const completedIn = convertUnits(profile.units.completed, stuSys, reqSys);
	const projectedIn = convertUnits(profile.units.completed + profile.units.in_progress, stuSys, reqSys);

	let status: UnitsFinding['status'];
	let shortfall: number | null;
	if (min === null) [status, shortfall] = ['not_published', null];
	else if (completedIn >= min) [status, shortfall] = ['met', 0];
	else if (projectedIn >= min) [status, shortfall] = ['met_with_in_progress', 0];
	else [status, shortfall] = ['short', round2(min - projectedIn)];

	return {
		...prov(p, 'units', p.units),
		requiredMin: min,
		requiredSystem: reqSys,
		studentSystem: stuSys,
		studentCompleted: profile.units.completed,
		studentInProgress: profile.units.in_progress,
		converted: reqSys !== stuSys,
		completedInRequiredSystem: completedIn,
		projectedInRequiredSystem: projectedIn,
		shortfall,
		status
	};
}

function pickDeadline(p: Program, term: string, all: DeadlineItem[]): DeadlineFinding | null {
	const apps = all.filter((d) => d.type === 'application');
	const termApps = apps.filter((d) => d.term === term);
	const cands = termApps.length > 0 ? termApps : apps;
	if (cands.length === 0) return null;
	const termMatched = termApps.length > 0;
	const upcoming = cands.filter((d) => d.daysUntil >= 0).sort(byDateThenId);
	if (upcoming.length > 0) return { ...upcoming[0], status: 'upcoming', termMatched };
	const past = [...cands].sort((a, b) => byDateThenId(b, a));
	return { ...past[0], status: 'passed', termMatched };
}

/**
 * Deterministic gap analysis: one GapReport per profile target, in target order.
 * Pure: no clock (today is injected), no I/O, no LLM, inputs are never mutated.
 */
export function analyzeGaps(
	profile: Profile,
	schools: SchoolsDataset | readonly School[],
	options: AnalyzeOptions
): GapReport[] {
	const today = options.today;
	assertIsoDate(today, 'options.today');
	const list: readonly School[] = Array.isArray(schools)
		? (schools as readonly School[])
		: (schools as SchoolsDataset).schools;

	return profile.targets.map((target) => {
		const school = list.find((s) => s.school_id === target.school_id);
		const p = school?.programs.find((x) => x.program_id === target.program_id);
		if (!school || !p) {
			throw new Error(`analyzeGaps: unknown target ${target.school_id}/${target.program_id}`);
		}

		const essays: EssayFinding[] = p.essays.map((e) => ({
			...prov(p, `essay:${e.id}`, e),
			essayId: e.id,
			prompt: e.prompt,
			promptPublished: e.prompt !== null,
			wordLimit: e.word_limit,
			charLimit: e.char_limit,
			required: e.required
		}));
		const required = essays.filter((e) => e.required);
		const optional = essays.filter((e) => !e.required);

		const allDeadlines: DeadlineItem[] = p.deadlines
			.map((d) => ({
				...prov(p, `deadline:${d.id}`, d),
				deadlineId: d.id,
				term: d.term,
				type: d.type,
				date: d.date,
				daysUntil: daysUntil(today, d.date)
			}))
			.sort(byDateThenId);

		const base: Omit<GapReport, 'warnings' | 'summary'> = {
			profileId: profile.profile_id,
			schoolId: school.school_id,
			programId: p.program_id,
			schoolName: school.name,
			programName: p.name,
			isFictional: school.is_fictional,
			targetTerm: target.term,
			asOf: today,
			hasTransferProgram: {
				...prov(p, 'has_transfer_program', p.has_transfer_program),
				value: p.has_transfer_program.value
			},
			gpa: {
				student: profile.gpa,
				min: { ...prov(p, 'min_gpa', p.min_gpa), value: p.min_gpa.value, published: p.min_gpa.value !== null },
				competitive: {
					...prov(p, 'competitive_gpa', p.competitive_gpa),
					value: p.competitive_gpa.value,
					published: p.competitive_gpa.value !== null
				},
				status: gpaStatus(profile.gpa, p.min_gpa.value, p.competitive_gpa.value)
			},
			units: unitsFinding(profile, p),
			prereqs: p.required_courses.map((c) => ({
				...prov(p, `course:${c.id}`, c),
				courseId: c.id,
				name: c.name,
				...classifyPrereq(c, profile.courses)
			})),
			gePattern: { ...prov(p, 'ge_pattern', p.ge_pattern), text: p.ge_pattern.value },
			essays: { required, optional, requiredCount: required.length, optionalCount: optional.length },
			recs: { ...prov(p, 'recs_required', p.recs_required), required: p.recs_required.value },
			aiPolicy: { ...prov(p, 'ai_policy', p.ai_policy), mode: p.ai_policy.value.mode },
			deadline: pickDeadline(p, target.term, allDeadlines),
			allDeadlines
		};

		const warnings = buildWarnings({ profile, school, program: p, report: base });
		const count = <T>(xs: readonly T[], pred: (x: T) => boolean) => xs.filter(pred).length;

		return {
			...base,
			warnings,
			summary: {
				met: count(base.prereqs, (x) => x.status === 'met'),
				missing: count(base.prereqs, (x) => x.status === 'missing'),
				unknownEquivalency: count(base.prereqs, (x) => x.status === 'unknown-equivalency'),
				blockers: count(warnings, (w) => w.severity === 'blocker'),
				warnings: count(warnings, (w) => w.severity === 'warning'),
				info: count(warnings, (w) => w.severity === 'info')
			}
		};
	});
}

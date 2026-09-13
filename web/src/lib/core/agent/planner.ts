// Deterministic sprint planner: profile + GapReport[] → typed dry-run Plan of keyed write actions.
// The skeleton (which actions, dates, recipients, keys) is pure code; the LLM only fills critique and draft text slots.
import { z } from 'zod';
import { Plan } from '../schemas.ts';
import type { Action, AppName, Blocker, Profile, SchoolsDataset } from '../schemas.ts';
import type { GapReport } from '../gap/index.ts';
import { assertIsoDate } from '../gap/index.ts';
import { LLMSlotError, callSlot } from '../llm/types.ts';
import type { LLM } from '../llm/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import type { WriteToolName } from '../tools/sprint-tools.ts';
import { canonicalJson, deriveIdempotencyKey, sha256Hex } from './idempotency.ts';
import type { ActionKind } from './types.ts';

export const REMINDER_OFFSETS = [
	{ kind: 'event_t30', days: 30, label: 'T-30' },
	{ kind: 'event_t14', days: 14, label: 'T-14' },
	{ kind: 'event_t3', days: 3, label: 'T-3' }
] as const;

/** Planner heuristic giving recommenders about 6 weeks' notice. Not a school requirement. */
export const REC_REQUEST_LEAD_DAYS = 42;

/** Shift a YYYY-MM-DD date by whole days in UTC. */
export function shiftIsoDate(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const DraftSlotOutput = z.object({
	subject: z
		.string()
		.min(1)
		.max(200)
		.regex(/^[^\r\n]*$/),
	body: z.string().min(1).max(4000)
});
export type DraftSlotOutput = z.infer<typeof DraftSlotOutput>;

export const CritiqueSlotOutput = z.object({
	policyNote: z.string().min(1),
	sections: z
		.array(z.object({ heading: z.string().min(1), comments: z.array(z.string().min(1)).min(1) }))
		.min(1)
});
export type CritiqueSlotOutput = z.infer<typeof CritiqueSlotOutput>;

export interface BuildPlanInput {
	profile: Profile;
	schools: SchoolsDataset;
	reports: GapReport[];
	today: string;
	createdAt: string;
	llm: LLM;
	tracer?: Tracer;
}

type Contact = Profile['contacts'][number];

const TOOL_APP: Readonly<Record<WriteToolName, AppName>> = Object.freeze({
	'notion.upsertTrackerRow': 'notion',
	'calendar.createEvent': 'calendar',
	'docs.createDoc': 'docs',
	'gmail.createDraft': 'gmail'
});

/**
 * Takes NO connector parameter: planning structurally cannot read untrusted app content or write anything.
 */
export async function buildPlan(input: BuildPlanInput): Promise<Plan> {
	const { profile, reports, today, createdAt, llm, tracer } = input;
	assertIsoDate(today, 'today');
	const profileId = profile.profile_id;
	const actions: Action[] = [];
	const blockers: Blocker[] = [];

	for (const report of reports) {
		const { schoolId, programId, schoolName, programName } = report;
		const term = report.targetTerm;

		const add = async (
			kind: ActionKind,
			tool: WriteToolName,
			payload: Record<string, unknown>,
			summary: string,
			naturalKey: string,
			dependsOn: string[] = []
		): Promise<string> => {
			const id = `${programId}.${kind}`;
			const idempotencyKey = await deriveIdempotencyKey({ profileId, schoolId, programId, actionKind: kind, naturalKey });
			actions.push({ id, app: TOOL_APP[tool], tool, effect: 'write', schoolId, programId, idempotencyKey, payload, dependsOn, summary });
			return id;
		};

		const slot = async <S extends z.ZodType>(
			schema: S,
			slotName: string,
			kind: ActionKind,
			system: string,
			slotInput: unknown
		): Promise<z.infer<S> | null> => {
			try {
				return await callSlot(llm, schema, { slot: slotName, system, input: slotInput }, { tracer });
			} catch (err) {
				if (!(err instanceof LLMSlotError)) throw err;
				blockers.push({
					code: 'LLM_SLOT_FAILED',
					message: `${slotName} output for ${kind} failed validation after repair`,
					schoolId,
					programId
				});
				return null;
			}
		};

		// a. Blockers from gap analysis; programs without a transfer path or deadline get no actions.
		for (const w of report.warnings) {
			if (w.severity === 'blocker') {
				blockers.push({ code: w.code, message: w.message, schoolId: w.schoolId, programId: w.programId, requirementId: w.requirementId });
			}
		}
		if (!report.hasTransferProgram.value) continue;
		const deadline = report.deadline;
		if (deadline === null) {
			blockers.push({
				code: 'NO_APPLICATION_DEADLINE',
				message: `${programName} has no published application deadline for ${term}.`,
				schoolId,
				programId
			});
			continue;
		}
		const hasBlocker = report.warnings.some((w) => w.severity === 'blocker');

		// b. Critique doc.
		let critiqueId: string | null = null;
		if (report.essays.requiredCount > 0) {
			const out = await slot(
				CritiqueSlotOutput,
				'critique',
				'critique_doc',
				'You write question-style essay feedback. Never rewrite prose.',
				{
					schoolName,
					programName,
					term,
					aiPolicyMode: report.aiPolicy.mode,
					essays: report.essays.required.map((e) => ({ essayId: e.essayId, prompt: e.prompt, wordLimit: e.wordLimit }))
				}
			);
			if (out) {
				const body =
					`${out.policyNote}\n\n` +
					out.sections.map((s) => `## ${s.heading}\n` + s.comments.map((c) => `- ${c}`).join('\n')).join('\n\n');
				critiqueId = await add(
					'critique_doc',
					'docs.createDoc',
					{ title: `Essay critique: ${schoolName} ${programName} (${term})`, body },
					`Create critique doc for ${schoolName}`,
					term
				);
			}
		}

		// c. Tracker row.
		const notes = report.warnings
			.map((w) => `${w.code}: ${w.message}`)
			.join('\n')
			.slice(0, 2000);
		await add(
			'tracker_row',
			'notion.upsertTrackerRow',
			{
				schoolId,
				programId,
				title: `${schoolName}: ${programName}`,
				deadline: deadline.date,
				requiredDocs: [
					...report.essays.required.map((e) => `Essay ${e.essayId}${e.wordLimit ? ` (${e.wordLimit} words)` : ''}`),
					...(report.recs.required > 0 ? [`Recommendation letters: ${report.recs.required}`] : [])
				],
				recsRequired: report.recs.required,
				essayStatus: 'draft',
				gapCount: report.summary.missing + report.summary.unknownEquivalency,
				status: hasBlocker ? 'blocked' : 'planning',
				...(notes ? { notes } : {})
			},
			`Upsert tracker row for ${schoolName}`,
			term,
			critiqueId ? [critiqueId] : []
		);

		// d. Calendar events (never in the past).
		if (deadline.status === 'upcoming') {
			const candidates: { kind: ActionKind; date: string; title: string }[] = [
				{ kind: 'event_deadline', date: deadline.date, title: `${schoolName} ${programName}: application deadline` },
				...REMINDER_OFFSETS.map((o) => ({
					kind: o.kind as ActionKind,
					date: shiftIsoDate(deadline.date, -o.days),
					title: `${o.label} reminder: ${schoolName} application due ${deadline.date}`
				})),
				...(report.recs.required > 0
					? [
							{
								kind: 'event_rec_request' as ActionKind,
								date: shiftIsoDate(deadline.date, -REC_REQUEST_LEAD_DAYS),
								title: `Request recommendation letters for ${schoolName}`
							}
						]
					: [])
			];
			for (const c of candidates) {
				if (c.date < today) continue;
				await add(
					c.kind,
					'calendar.createEvent',
					{ title: c.title, date: c.date, ...(deadline.sourceUrl ? { description: `Source: ${deadline.sourceUrl}` } : {}) },
					`Add calendar event: ${c.title} (${c.date})`,
					term
				);
			}
		}

		// e. Drafts. Recipients come ONLY from profile.contacts.
		const draft = async (kind: ActionKind, contact: Contact, items: string[], summary: string) => {
			const out = await slot(DraftSlotOutput, 'draft', kind, 'Write a short, polite email body. Output JSON only.', {
				kind,
				schoolName,
				programName,
				term,
				contactName: contact.name,
				studentName: profile.student.name,
				items
			});
			if (!out) return;
			await add(
				kind,
				'gmail.createDraft',
				{ to: [contact.email], subject: `[TransferPilot] ${out.subject}`.slice(0, 250), body: out.body },
				summary,
				`${term}|${contact.id}`
			);
		};
		const missingContact = (role: string, kind: ActionKind) =>
			blockers.push({
				code: 'MISSING_CONTACT',
				message: `No ${role} contact in the profile for ${kind} (${schoolName}).`,
				schoolId,
				programId
			});

		const rep = profile.contacts.find((c) => c.role === 'admissions_rep' && c.school_id === schoolId);
		if (rep) {
			const items = report.prereqs.filter((p) => p.status === 'unknown-equivalency').map((p) => p.name);
			await draft('draft_admissions_question', rep, items, `Draft admissions question to ${rep.name}`);
		}

		if (report.recs.required > 0) {
			const prof = profile.contacts.find((c) => c.role === 'professor');
			if (prof) {
				await draft(
					'draft_rec_request',
					prof,
					[`${report.recs.required} letter(s) for ${programName}`, `Application deadline ${deadline.date}`],
					`Draft recommendation request to ${prof.name}`
				);
			} else missingContact('professor', 'draft_rec_request');
		}

		if (report.summary.missing + report.summary.unknownEquivalency > 0) {
			const advisor = profile.contacts.find((c) => c.role === 'cc_advisor');
			if (advisor) {
				const items = report.prereqs.filter((p) => p.status !== 'met').map((p) => `${p.name} (${p.status})`);
				await draft('draft_advisor_prereq_check', advisor, items, `Draft prerequisite check to ${advisor.name}`);
			} else missingContact('cc_advisor', 'draft_advisor_prereq_check');
		}
	}

	const planId =
		'plan-' +
		(await sha256Hex(canonicalJson({ profileId, today, keys: actions.map((a) => a.idempotencyKey) }))).slice(0, 12);
	tracer?.event('plan.built', { planId, actions: actions.length, blockers: blockers.map((b) => b.code) });
	return Plan.parse({ planId, profileId, createdAt, actions, blockers, flags: [] });
}

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Plan, Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createFakeLLM } from '../llm/fake.ts';
import type { FakeResponder } from '../llm/fake.ts';
import { callSlot } from '../llm/types.ts';
import { getWriteTool } from '../tools/sprint-tools.ts';
import { buildPlan, shiftIsoDate } from './planner.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const TODAY = '2026-09-13';
const BERKELEY = 'uc-berkeley-data-science-ba';
const CORNELL = 'cornell-as-economics';
const UMICH = 'umich-lsa';
const NORTHFIELD = 'northfield-fictional-cs';

async function makePlan(today = TODAY, llm = createFakeLLM()) {
	const reports = analyzeGaps(demo, schools, { today });
	return buildPlan({ profile: demo, schools, reports, today, createdAt: '2026-09-13T17:00:00.000Z', llm });
}

const plan = await makePlan();
const byTool = (p: Plan, tool: string) => p.actions.filter((a) => a.tool === tool);
const calDates = (p: Plan, programId: string) =>
	byTool(p, 'calendar.createEvent')
		.filter((a) => a.programId === programId)
		.map((a) => a.payload.date as string)
		.sort();
const contactEmails = new Set(demo.contacts.map((c) => c.email));

describe('buildPlan (demo, 2026-09-13)', () => {
	it('produces a valid 23-action plan', () => {
		expect(Plan.safeParse(plan).success).toBe(true);
		expect(plan.profileId).toBe('demo');
		expect(plan.planId).toMatch(/^plan-[0-9a-f]{12}$/);
		expect(plan.actions).toHaveLength(23);
		expect(byTool(plan, 'docs.createDoc')).toHaveLength(3);
		expect(byTool(plan, 'notion.upsertTrackerRow')).toHaveLength(3);
		expect(byTool(plan, 'calendar.createEvent')).toHaveLength(13);
		expect(byTool(plan, 'gmail.createDraft')).toHaveLength(4);
	});

	it('blocks Northfield with no actions', () => {
		expect(plan.blockers.map((b) => b.code)).toEqual(['NO_TRANSFER_PROGRAM']);
		expect(plan.blockers[0].programId).toBe(NORTHFIELD);
		expect(plan.actions.some((a) => a.programId === NORTHFIELD)).toBe(false);
	});

	it('uses stable unique ids and keys', () => {
		const ids = plan.actions.map((a) => a.id);
		expect(ids).toContain(`${BERKELEY}.tracker_row`);
		expect(ids).toContain(`${CORNELL}.event_rec_request`);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(plan.actions.map((a) => a.idempotencyKey)).size).toBe(ids.length);
	});

	it('every payload passes its write tool strict schema', () => {
		for (const a of plan.actions) {
			const tool = getWriteTool(a.tool);
			expect(tool, a.tool).toBeDefined();
			expect(() => tool!.input.parse({ ...a.payload, key: a.idempotencyKey })).not.toThrow();
			expect(a.app).toBe(tool!.app);
			expect(a.effect).toBe('write');
		}
	});

	it.each([
		[BERKELEY, ['2026-10-31', '2026-11-16', '2026-11-27', '2026-11-30']],
		[CORNELL, ['2027-02-01', '2027-02-13', '2027-03-01', '2027-03-12', '2027-03-15']],
		[UMICH, ['2027-01-02', '2027-01-18', '2027-01-29', '2027-02-01']]
	])('calendar dates for %s', (programId, dates) => {
		expect(calDates(plan, programId)).toEqual(dates);
		for (const a of byTool(plan, 'calendar.createEvent')) expect((a.payload.date as string) >= TODAY).toBe(true);
	});

	it('Cornell rec request event is 42 days before the deadline', () => {
		const ev = plan.actions.find((a) => a.id === `${CORNELL}.event_rec_request`)!;
		expect(ev.payload.date).toBe('2027-02-01');
		expect(shiftIsoDate('2027-03-15', -42)).toBe('2027-02-01');
	});

	it('builds tracker payloads from gap reports', () => {
		const b = plan.actions.find((a) => a.id === `${BERKELEY}.tracker_row`)!;
		expect(b.payload.title).toContain('University of California, Berkeley');
		expect(b.payload).toMatchObject({ deadline: '2026-11-30', recsRequired: 0, essayStatus: 'draft', gapCount: 5, status: 'planning' });
		expect((b.payload.requiredDocs as string[]).some((d) => d.includes('uc-piq-required'))).toBe(true);
		expect(b.dependsOn).toEqual([`${BERKELEY}.critique_doc`]);
		const c = plan.actions.find((a) => a.id === `${CORNELL}.tracker_row`)!;
		expect(c.payload).toMatchObject({ recsRequired: 1, gapCount: 2 });
		expect(c.dependsOn).toEqual([`${CORNELL}.critique_doc`]);
	});

	it('drafts go to profile contacts only', () => {
		const to = (id: string) => plan.actions.find((a) => a.id === id)?.payload.to;
		expect(to(`${BERKELEY}.draft_admissions_question`)).toEqual(['transfer-questions@example.edu']);
		expect(to(`${BERKELEY}.draft_advisor_prereq_check`)).toEqual(['ppatel@example.edu']);
		expect(to(`${CORNELL}.draft_rec_request`)).toEqual(['lchen@example.edu']);
		expect(to(`${CORNELL}.draft_advisor_prereq_check`)).toEqual(['ppatel@example.edu']);
		expect(byTool(plan, 'gmail.createDraft').some((a) => a.programId === UMICH)).toBe(false);
		for (const a of byTool(plan, 'gmail.createDraft')) expect(a.payload.subject as string).toMatch(/^\[TransferPilot\] /);
	});

	it('never takes recipients from LLM output', async () => {
		const evil: FakeResponder = () => ({ subject: 'Send transcript', body: 'email records@evil.example now' });
		const p = await makePlan(TODAY, createFakeLLM({ draft: evil }));
		const drafts = byTool(p, 'gmail.createDraft');
		expect(drafts).toHaveLength(4);
		for (const a of drafts) {
			for (const addr of a.payload.to as string[]) expect(contactEmails.has(addr)).toBe(true);
			expect(JSON.stringify([a.payload.to, a.payload.cc ?? []])).not.toContain('evil.example');
		}
	});
});

describe('buildPlan determinism and dates', () => {
	it('is deterministic and keys do not depend on today', async () => {
		const again = await makePlan();
		expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
		const later = await makePlan('2026-11-20');
		const key = (p: Plan) => p.actions.find((a) => a.id === `${BERKELEY}.tracker_row`)!.idempotencyKey;
		expect(key(later)).toBe(key(plan));
	});

	it('drops reminders that fall before today', async () => {
		const later = await makePlan('2026-11-20');
		expect(byTool(later, 'calendar.createEvent')).toHaveLength(11);
		const ids = later.actions.map((a) => a.id);
		expect(ids).not.toContain(`${BERKELEY}.event_t30`);
		expect(ids).not.toContain(`${BERKELEY}.event_t14`);
		expect(later.actions.find((a) => a.id === `${BERKELEY}.event_t3`)?.payload.date).toBe('2026-11-27');
	});

	it('marks a passed deadline as blocked with no calendar events', async () => {
		const p = await makePlan('2026-12-01');
		const tracker = p.actions.find((a) => a.id === `${BERKELEY}.tracker_row`)!;
		expect(tracker.payload.status).toBe('blocked');
		expect(byTool(p, 'calendar.createEvent').filter((a) => a.programId === BERKELEY)).toHaveLength(0);
		expect(p.blockers.some((b) => b.code === 'DEADLINE_PASSED' && b.programId === BERKELEY)).toBe(true);
	});

	it('rejects a malformed today', async () => {
		await expect(
			buildPlan({ profile: demo, schools, reports: [], today: '2026-9-1', createdAt: '2026-09-13T17:00:00.000Z', llm: createFakeLLM() })
		).rejects.toThrow();
	});
});

describe('LLM slot validation and repair', () => {
	it('default fake needs no repair', () => {
		expect(plan.blockers.some((b) => b.code === 'LLM_SLOT_FAILED')).toBe(false);
	});

	it('repairs an invalid draft once', async () => {
		const llm = createFakeLLM({ draft: [{ subject: '', body: '' }, { subject: 'Question', body: 'Hello' }] });
		const p = await makePlan(TODAY, llm);
		expect(byTool(p, 'gmail.createDraft')).toHaveLength(4);
		const repair = llm.calls.find((c) => c.slot === 'draft' && c.repair);
		expect(repair?.repair?.issues).toContain('subject');
		expect(repair?.repair?.previous).toEqual({ subject: '', body: '' });
		expect(llm.calls.every((c) => !('jsonSchema' in c))).toBe(true);
	});

	it('omits the action and adds a blocker when repair also fails', async () => {
		const llm = createFakeLLM({ draft: [{ subject: '' }] });
		const p = await makePlan(TODAY, llm);
		expect(byTool(p, 'gmail.createDraft')).toHaveLength(0);
		expect(p.blockers.filter((b) => b.code === 'LLM_SLOT_FAILED')).toHaveLength(4);
		expect(llm.calls.filter((c) => c.slot === 'draft')).toHaveLength(8);
		expect(byTool(p, 'notion.upsertTrackerRow')).toHaveLength(3);
	});

	it('drops a failed critique from tracker dependsOn', async () => {
		const p = await makePlan(TODAY, createFakeLLM({ critique: [{ policyNote: '' }] }));
		expect(byTool(p, 'docs.createDoc')).toHaveLength(0);
		for (const t of byTool(p, 'notion.upsertTrackerRow')) expect(t.dependsOn).toEqual([]);
		expect(p.blockers.filter((b) => b.code === 'LLM_SLOT_FAILED')).toHaveLength(3);
	});

	it('callSlot rejects for a slot with no responder', async () => {
		await expect(
			callSlot(createFakeLLM(), z.object({ a: z.string() }), { slot: 'nope', system: '', input: {} })
		).rejects.toThrow(/no responder for slot/);
	});
});

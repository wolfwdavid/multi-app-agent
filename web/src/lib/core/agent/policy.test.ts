import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import type { Plan } from '../schemas.ts';
import type { PolicyViolationCode } from './types.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { buildPlan } from './planner.ts';
import {
	authorizeExecution,
	checkActionPolicy,
	recipientAllowlistFromProfile,
	signPlan,
	topoOrder,
	verifyPlanToken
} from './policy.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const TODAY = '2026-09-13';
const plan = await buildPlan({
	profile: demo,
	schools,
	reports: analyzeGaps(demo, schools, { today: TODAY }),
	today: TODAY,
	createdAt: '2026-09-13T17:00:00.000Z',
	llm: createFakeLLM()
});
const SECRET = 'test-secret-0123456789';
const allow = recipientAllowlistFromProfile(demo);
const token = await signPlan(plan, SECRET, allow);
const allIds = plan.actions.map((a) => a.id);
const ADVISOR = 'uc-berkeley-data-science-ba.draft_advisor_prereq_check';

const idx = (p: Plan, id: string) => p.actions.findIndex((a) => a.id === id);

async function resigned(mutate: (p: Plan) => void) {
	const p2 = structuredClone(plan);
	mutate(p2);
	const t2 = await signPlan(p2, SECRET, allow);
	return { p2, t2 };
}

async function authorizeResigned(mutate: (p: Plan) => void) {
	const { p2, t2 } = await resigned(mutate);
	return authorizeExecution({
		plan: p2,
		planToken: t2,
		approvedIds: p2.actions.map((a) => a.id),
		secret: SECRET,
		recipientAllowlist: allow
	});
}

describe('allowlist and plan token', () => {
	it('derives a normalized allowlist from contacts', () => {
		expect(allow).toEqual(['lchen@example.edu', 'ppatel@example.edu', 'transfer-questions@example.edu']);
	});

	it('signs deterministically and verifies', async () => {
		expect(token).toMatch(/^v1\.[A-Za-z0-9_-]{43}$/);
		expect(await signPlan(plan, SECRET, allow)).toBe(token);
		expect(await verifyPlanToken(plan, token, SECRET, allow)).toBe(true);
	});

	it('fails verification on any plan change', async () => {
		const tampered = structuredClone(plan);
		tampered.actions.find((a) => a.tool === 'gmail.createDraft')!.payload.to = ['records@evil.example'];
		expect(await verifyPlanToken(tampered, token, SECRET, allow)).toBe(false);
		const appended = structuredClone(plan);
		appended.actions.push({ ...structuredClone(plan.actions[0]), id: 'extra' });
		expect(await verifyPlanToken(appended, token, SECRET, allow)).toBe(false);
		const removed = structuredClone(plan);
		removed.actions.pop();
		expect(await verifyPlanToken(removed, token, SECRET, allow)).toBe(false);
		const cleared = structuredClone(plan);
		cleared.blockers = [];
		expect(await verifyPlanToken(cleared, token, SECRET, allow)).toBe(false);
	});

	it('fails verification on a different secret, allowlist or malformed token', async () => {
		expect(await verifyPlanToken(plan, token, 'other-secret-0123456789', allow)).toBe(false);
		expect(await verifyPlanToken(plan, token, SECRET, [...allow, 'extra@example.edu'])).toBe(false);
		expect(await verifyPlanToken(plan, 'v1.garbage', SECRET, allow)).toBe(false);
		expect(await verifyPlanToken(plan, '', SECRET, allow)).toBe(false);
		expect(await verifyPlanToken(plan, 'v2.' + token.slice(3), SECRET, allow)).toBe(false);
	});

	it('rejects a weak secret', async () => {
		await expect(signPlan(plan, 'short', allow)).rejects.toThrow(/16/);
	});
});

describe('authorizeExecution', () => {
	it('approves every action when all ids are approved', async () => {
		const auth = await authorizeExecution({
			plan,
			planToken: token,
			approvedIds: [...allIds].reverse().concat(allIds),
			secret: SECRET,
			recipientAllowlist: allow
		});
		expect(auth.planId).toBe(plan.planId);
		expect(auth.approved).toHaveLength(23);
		expect(auth.skipped).toEqual([]);
		expect(auth.blocked).toEqual([]);
		expect(auth.approvedIds).toEqual(allIds);
		expect(auth.recipientAllowlist).toEqual(allow);
	});

	it('skips unapproved actions', async () => {
		const cornellDrafts = plan.actions
			.filter((a) => a.programId === 'cornell-as-economics' && a.tool === 'gmail.createDraft')
			.map((a) => a.id);
		expect(cornellDrafts).toHaveLength(2);
		const auth = await authorizeExecution({
			plan,
			planToken: token,
			approvedIds: allIds.filter((id) => !cornellDrafts.includes(id)),
			secret: SECRET,
			recipientAllowlist: allow
		});
		expect(auth.approved).toHaveLength(21);
		expect(auth.skipped.map((a) => a.id)).toEqual(cornellDrafts);
	});

	it('rejects unknown approved ids', async () => {
		await expect(
			authorizeExecution({ plan, planToken: token, approvedIds: [...allIds, 'nope.tracker_row'], secret: SECRET, recipientAllowlist: allow })
		).rejects.toMatchObject({ name: 'PolicyError', code: 'unknown_action_id', details: ['nope.tracker_row'] });
	});

	it('rejects a plan tampered after signing', async () => {
		const tampered = structuredClone(plan);
		tampered.actions[idx(tampered, ADVISOR)].payload.to = ['records@evil.example'];
		await expect(
			authorizeExecution({ plan: tampered, planToken: token, approvedIds: allIds, secret: SECRET, recipientAllowlist: allow })
		).rejects.toMatchObject({ code: 'invalid_plan_token' });
	});

	it('rejects a schema-invalid plan', async () => {
		await expect(
			authorizeResigned((p) => {
				p.actions[0].idempotencyKey = 'bad';
			})
		).rejects.toMatchObject({ code: 'invalid_plan' });
	});

	it('rejects duplicate ids and duplicate keys', async () => {
		await expect(
			authorizeResigned((p) => {
				p.actions[1].id = p.actions[0].id;
			})
		).rejects.toMatchObject({ code: 'invalid_plan' });
		await expect(
			authorizeResigned((p) => {
				p.actions[1].idempotencyKey = p.actions[0].idempotencyKey;
			})
		).rejects.toMatchObject({ code: 'invalid_plan' });
	});

	it('rejects missing dependencies and cycles', async () => {
		await expect(
			authorizeResigned((p) => {
				p.actions[0].dependsOn = ['ghost'];
			})
		).rejects.toMatchObject({ code: 'invalid_plan', message: 'unknown dependency' });
		await expect(
			authorizeResigned((p) => {
				p.actions[idx(p, 'uc-berkeley-data-science-ba.critique_doc')].dependsOn = ['uc-berkeley-data-science-ba.tracker_row'];
			})
		).rejects.toMatchObject({ code: 'invalid_plan', message: 'dependency cycle' });
	});

	it('blocks non-allowlisted recipients in to and cc', async () => {
		const auth = await authorizeResigned((p) => {
			p.actions[idx(p, ADVISOR)].payload.to = ['records@evil.example'];
		});
		expect(auth.blocked).toHaveLength(1);
		expect(auth.blocked[0].action.id).toBe(ADVISOR);
		expect(auth.blocked[0].code).toBe('recipient_not_allowlisted');
		expect(auth.blocked[0].reason).toContain('records@evil.example');
		expect(auth.approved).toHaveLength(22);

		const cc = await authorizeResigned((p) => {
			p.actions[idx(p, ADVISOR)].payload.cc = ['x@evil.example'];
		});
		expect(cc.blocked.map((b) => [b.action.id, b.code])).toEqual([[ADVISOR, 'recipient_not_allowlisted']]);
		expect(cc.blocked[0].reason).toContain('x@evil.example');
	});

	const badTools: [string, (p: Plan) => void, PolicyViolationCode][] = [
		[
			'send tool',
			(p) => {
				p.actions[idx(p, ADVISOR)].tool = 'gmail.sendMessage';
			},
			'forbidden_tool'
		],
		[
			'unknown tool',
			(p) => {
				p.actions[idx(p, 'uc-berkeley-data-science-ba.tracker_row')].tool = 'notion.deleteRow';
			},
			'unknown_tool'
		],
		[
			'app mismatch',
			(p) => {
				p.actions[idx(p, 'uc-berkeley-data-science-ba.critique_doc')].app = 'gmail';
			},
			'tool_app_mismatch'
		],
		[
			'read effect',
			(p) => {
				p.actions[idx(p, 'uc-berkeley-data-science-ba.critique_doc')].effect = 'read';
			},
			'tool_app_mismatch'
		]
	];

	it.each(badTools)('blocks %s', async (_label, mutate, code) => {
		const auth = await authorizeResigned(mutate);
		expect(auth.blocked).toHaveLength(1);
		expect(auth.blocked[0].code).toBe(code);
		expect(auth.approved).toHaveLength(22);
	});
});

describe('checkActionPolicy and topoOrder', () => {
	it('passes every planner action', () => {
		for (const a of plan.actions) expect(checkActionPolicy(a, allow)).toBeNull();
	});

	it('flags malformed recipients', () => {
		const a = structuredClone(plan.actions[idx(plan, ADVISOR)]);
		a.payload.to = 'ppatel@example.edu';
		expect(checkActionPolicy(a, allow)).toEqual({ code: 'recipient_not_allowlisted', reason: 'recipients missing or malformed' });
	});

	it('keeps plan order when dependencies are satisfied and reorders otherwise', () => {
		expect(topoOrder(plan.actions).map((a) => a.id)).toEqual(allIds);
		const critique = plan.actions[idx(plan, 'uc-berkeley-data-science-ba.critique_doc')];
		const tracker = plan.actions[idx(plan, 'uc-berkeley-data-science-ba.tracker_row')];
		expect(topoOrder([tracker, critique]).map((a) => a.id)).toEqual([critique.id, tracker.id]);
	});
});

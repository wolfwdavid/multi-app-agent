import { describe, it, expect, vi } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import type { Action, Plan, TraceEvent } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { createConnectors, isEmptyDiff, type MockConnectorOptions, type World } from '../connectors/index.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import { buildPlan } from './planner.ts';
import { authorizeExecution, recipientAllowlistFromProfile, signPlan, topoOrder } from './policy.ts';
import type { Authorization, SprintLimits } from './types.ts';
import { executePlan, type ExecContext } from './executor.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const TODAY = '2026-09-13';
const basePlan = await buildPlan({
	profile: demo,
	schools,
	reports: analyzeGaps(demo, schools, { today: TODAY }),
	today: TODAY,
	createdAt: '2026-09-13T17:00:00.000Z',
	llm: createFakeLLM()
});
const SECRET = 'test-secret-0123456789';
const allow = recipientAllowlistFromProfile(demo);
const B = 'uc-berkeley-data-science-ba';
const PROGRAMS = [B, 'cornell-as-economics', 'umich-lsa'];
const GMAIL_IDS = basePlan.actions.filter((a) => a.tool === 'gmail.createDraft').map((a) => a.id);

type Faults = MockConnectorOptions['faults'];

interface SetupOpts {
	faults?: Faults;
	approvedIds?: string[];
	plan?: Plan;
	auth?: Authorization;
	world?: World;
	limits?: Partial<SprintLimits>;
	repairArgs?: ExecContext['repairArgs'];
}

async function setup(o: SetupOpts = {}) {
	const plan = o.plan ?? basePlan;
	const auth =
		o.auth ??
		(await authorizeExecution({
			plan,
			planToken: await signPlan(plan, SECRET, allow),
			approvedIds: o.approvedIds ?? plan.actions.map((a) => a.id),
			secret: SECRET,
			recipientAllowlist: allow
		}));
	const bundle = createConnectors({
		mode: 'mock',
		...(o.world ? { world: o.world } : {}),
		...(o.faults ? { faults: o.faults } : {})
	});
	const sink = new MemorySink();
	let t = 0;
	const tracer = createTracer({ sinks: [sink], traceId: 't1', now: () => ++t });
	const sleep = vi.fn(async (_ms: number) => {});
	const ctx: ExecContext = {
		connectors: bundle,
		tracer,
		sleep,
		recipientAllowlist: allow,
		...(o.limits ? { limits: o.limits } : {}),
		...(o.repairArgs ? { repairArgs: o.repairArgs } : {})
	};
	const exec = await executePlan(ctx, plan, auth);
	const actionEnd = (id: string): TraceEvent | undefined =>
		sink.events.find((e) => e.name === 'action.execute' && e.kind === 'end' && e.attrs.actionId === id);
	const byId = (id: string) => exec.outcomes.find((x) => x.actionId === id)!;
	const named = (name: string, id?: string) =>
		sink.events.filter((e) => e.name === name && (id === undefined || e.attrs.actionId === id));
	const sleeps = () => sleep.mock.calls.map((c) => c[0]);
	return { plan, auth, bundle, sink, sleep, sleeps, exec, actionEnd, byId, named, world: bundle.world };
}

function resign(mutate: (p: Plan) => void): Plan {
	const p = structuredClone(basePlan);
	mutate(p);
	return p;
}

const find = (p: Plan, id: string): Action => p.actions.find((a) => a.id === id)!;
const planKeys = new Set(basePlan.actions.map((a) => a.idempotencyKey));
const keyedDocs = (w: World) => w.state.docs.docs.filter((d) => d.key !== undefined && planKeys.has(d.key)).length;

describe('executePlan happy path', () => {
	it('creates all 23 artifacts in topological order with UI-ready spans', async () => {
		const { exec, world, sink, plan } = await setup();
		expect(exec.outcomes.map((o) => o.actionId)).toEqual(topoOrder(plan.actions).map((a) => a.id));
		expect(exec.outcomes).toHaveLength(23);
		expect(exec.outcomes.every((o) => o.kind === 'created' && !!o.ref?.id && o.attempts === 1)).toBe(true);
		expect(world.state.notion.rows).toHaveLength(3);
		expect(world.state.calendar.events).toHaveLength(13);
		expect(world.state.gmail.drafts).toHaveLength(4);
		expect(keyedDocs(world)).toBe(3);
		expect(world.state.gmail.sent).toHaveLength(0);
		expect(exec.halted).toBeNull();
		expect(exec.steps).toBe(46);

		const ends = sink.events.filter((e) => e.name === 'action.execute' && e.kind === 'end');
		expect(ends).toHaveLength(23);
		for (const e of ends) {
			expect(e.status).toBe('ok');
			expect(e.attrs.attempt).toBe(1);
			expect(e.attrs.maxAttempts).toBe(3);
			expect(e.attrs.app).toBeTruthy();
			expect(e.attrs.tool).toBeTruthy();
			expect(e.attrs.actionId).toBeTruthy();
			expect(e.attrs.key).toBeTruthy();
			expect(typeof e.durationMs).toBe('number');
		}
	});

	it('runs each critique_doc before its tracker_row', async () => {
		const { exec } = await setup();
		const idx = (id: string) => exec.outcomes.findIndex((o) => o.actionId === id);
		for (const p of PROGRAMS) expect(idx(`${p}.critique_doc`)).toBeLessThan(idx(`${p}.tracker_row`));
	});

	it('emits a tool.call event per connector call with latency', async () => {
		const { sink } = await setup();
		const calls = sink.events.filter((e) => e.name === 'tool.call');
		expect(calls).toHaveLength(46);
		for (const c of calls) {
			expect(['findByKey', 'run']).toContain(c.attrs.method);
			expect(typeof c.attrs.actionId).toBe('string');
			expect(typeof c.attrs.tool).toBe('string');
			expect(c.attrs.attempt).toBe(1);
			expect(c.attrs.latencyMs as number).toBeGreaterThanOrEqual(0);
			if (c.attrs.method === 'run') {
				expect(c.attrs.args).toBeTruthy();
				expect((c.attrs.result as { ref: { id: string } }).ref.id).toBeTruthy();
			} else {
				expect((c.attrs.result as { found: boolean }).found).toBe(false);
			}
		}
	});
});

describe('idempotent re-run', () => {
	it('dedupes every action with an empty world diff', async () => {
		const first = await setup();
		const snap = first.world.snapshot();
		const second = await setup({ world: first.world });
		expect(second.exec.outcomes.every((o) => o.kind === 'deduped' && o.attempts === 0)).toBe(true);
		expect(isEmptyDiff(second.world.diff(snap))).toBe(true);
		expect(second.exec.steps).toBe(23);
		for (const o of second.exec.outcomes) {
			const end = second.actionEnd(o.actionId)!;
			expect(end.status).toBe('deduped');
			expect(end.attrs.foundByKey).toBe(true);
			expect(end.attrs.attempt).toBe(0);
			expect(second.named('idempotency.hit', o.actionId)).toHaveLength(1);
		}
	});

	it('updates an upsert row whose fields drifted', async () => {
		const first = await setup();
		const trackerKey = find(basePlan, `${B}.tracker_row`).idempotencyKey;
		const row = first.world.state.notion.rows.find((r) => r.key === trackerKey)!;
		await first.bundle.notion.upsertTrackerRow({ ...row, title: 'Old' });
		const second = await setup({ world: first.world });
		const o = second.byId(`${B}.tracker_row`);
		expect(o.kind).toBe('updated');
		expect(o.detail).toBe('updated_existing');
		expect(second.world.state.notion.rows).toHaveLength(3);
		expect(second.world.state.notion.rows.find((r) => r.key === trackerKey)!.title).not.toBe('Old');
	});
});

describe('approval and policy', () => {
	it('skips unapproved actions without spans or connector calls', async () => {
		const approvedIds = basePlan.actions.map((a) => a.id).filter((id) => !GMAIL_IDS.includes(id));
		const { byId, world, sink, named } = await setup({ approvedIds });
		expect(GMAIL_IDS).toHaveLength(4);
		for (const id of GMAIL_IDS) {
			expect(byId(id)).toMatchObject({ kind: 'skipped', detail: 'not_approved', reason: 'not_approved' });
			expect(sink.events.some((e) => e.name === 'action.execute' && e.attrs.actionId === id)).toBe(false);
			expect(named('tool.call', id)).toHaveLength(0);
			const skipped = named('action.skipped', id);
			expect(skipped).toHaveLength(1);
			expect(skipped[0].attrs.reason).toBe('not_approved');
			expect(skipped[0].status).toBe('skipped');
		}
		expect(world.state.gmail.drafts).toHaveLength(0);
	});

	it('blocks a non-allowlisted recipient', async () => {
		const ADVISOR = `${B}.draft_advisor_prereq_check`;
		const plan = resign((p) => {
			find(p, ADVISOR).payload.to = ['records@evil.example'];
		});
		const { byId, actionEnd, world, exec } = await setup({ plan });
		const o = byId(ADVISOR);
		expect(o.kind).toBe('blocked');
		expect(o.detail!.startsWith('blocked_by_policy:recipient_not_allowlisted')).toBe(true);
		expect(o.reason).toBe('allowlist');
		expect(actionEnd(ADVISOR)!.status).toBe('skipped');
		expect(actionEnd(ADVISOR)!.attrs.reason).toBe('allowlist');
		expect(world.state.gmail.drafts.some((d) => JSON.stringify(d).includes('evil.example'))).toBe(false);
		expect(exec.outcomes.filter((x) => x.kind === 'created')).toHaveLength(22);
	});
});

describe('faults and retries', () => {
	it('retries a 429 burst using retry-after', async () => {
		const { byId, sleeps, world, actionEnd, named } = await setup({
			faults: { rules: { notion: [{ method: 'upsertTrackerRow', calls: [1, 2], fault: { type: 'rate_limit', retryAfterMs: 10 } }] } }
		});
		const id = `${B}.tracker_row`;
		expect(byId(id)).toMatchObject({ kind: 'created', attempts: 3 });
		expect(sleeps()).toEqual([10, 10]);
		expect(world.state.notion.rows).toHaveLength(3);
		expect(actionEnd(id)!.status).toBe('ok');
		expect(actionEnd(id)!.attrs.attempt).toBe(3);
		const retries = named('retry', id);
		expect(retries).toHaveLength(2);
		expect(retries.map((r) => r.attrs.attempt)).toEqual([1, 2]);
		for (const r of retries) {
			expect(r.attrs['error.kind']).toBe('rate_limit');
			expect(r.attrs['error.status']).toBe(429);
			expect(r.attrs.retryAfterMs).toBe(10);
			expect(r.attrs.foundByKey).toBe(false);
		}
	});

	it('recovers a gmail ghost_write without a duplicate draft', async () => {
		const { byId, world, actionEnd, named } = await setup({
			faults: { rules: { gmail: [{ method: 'createDraft', calls: [1], fault: { type: 'ghost_write' } }] } }
		});
		const id = `${B}.draft_admissions_question`;
		const o = byId(id);
		expect(o.kind).toBe('created');
		expect(o.detail!.startsWith('recovered_after_error')).toBe(true);
		expect(o.attempts).toBe(1);
		expect(world.state.gmail.drafts).toHaveLength(4);
		const retries = named('retry', id);
		expect(retries).toHaveLength(1);
		expect(retries[0].attrs['error.status']).toBe(500);
		expect(retries[0].attrs.foundByKey).toBe(true);
		expect(actionEnd(id)!.attrs.foundByKey).toBe(true);
		expect(named('idempotency.recovered', id)).toHaveLength(1);
	});

	it('recovers a calendar ghost_write without a duplicate event', async () => {
		const { byId, world } = await setup({
			faults: { rules: { calendar: [{ method: 'createEvent', calls: [1], fault: { type: 'ghost_write' } }] } }
		});
		expect(world.state.calendar.events).toHaveLength(13);
		const o = byId(`${B}.event_deadline`);
		expect(o.kind).toBe('created');
		expect(o.detail).toMatch(/^recovered_after_error/);
	});

	it('surfaces exhausted server_error retries as integration failures', async () => {
		const { exec, world, sleeps, actionEnd } = await setup({
			faults: { rules: { notion: [{ method: 'upsertTrackerRow', fault: { type: 'server_error' } }] } }
		});
		const trackers = exec.outcomes.filter((o) => o.tool === 'notion.upsertTrackerRow');
		expect(trackers).toHaveLength(3);
		for (const t of trackers) {
			expect(t.kind).toBe('failed');
			expect(t.attempts).toBe(3);
			expect(t.detail!.startsWith('integration_failure')).toBe(true);
			expect(t.error?.kind).toBe('server');
			const end = actionEnd(t.actionId)!;
			expect(end.status).toBe('error');
			expect(end.attrs['error.kind']).toBe('server');
			expect(end.attrs['error.status']).toBe(500);
			expect(end.attrs.attempt).toBe(3);
		}
		expect(world.state.notion.rows).toHaveLength(0);
		expect(exec.outcomes.filter((o) => o.kind === 'created')).toHaveLength(20);
		expect(sleeps()).toEqual([100, 200, 100, 200, 100, 200]);
		expect(exec.halted).toBeNull();
	});
});

describe('argument validation and repair', () => {
	const CRIT = `${B}.critique_doc`;
	const badTitle = () =>
		resign((p) => {
			find(p, CRIT).payload.title = 'x'.repeat(501);
		});

	it('fails invalid args before any connector call and skips dependents', async () => {
		const { byId, named, actionEnd } = await setup({ plan: badTitle() });
		const o = byId(CRIT);
		expect(o.kind).toBe('failed');
		expect(o.detail!.startsWith('invalid_args')).toBe(true);
		expect(o.attempts).toBe(0);
		expect(named('tool.call', CRIT)).toHaveLength(0);
		expect(actionEnd(CRIT)!.status).toBe('error');
		expect(byId(`${B}.tracker_row`)).toMatchObject({
			kind: 'skipped',
			detail: `dependency_failed:${CRIT}`,
			reason: 'dependency_failed'
		});
	});

	it('repairs args once and re-validates', async () => {
		const repairArgs = vi.fn(async (action: Action, _issues: string) => ({
			...action.payload,
			title: 'Essay critique (repaired)'
		}));
		const { byId, world, named } = await setup({ plan: badTitle(), repairArgs });
		expect(byId(CRIT).kind).toBe('created');
		expect(world.state.docs.docs.some((d) => d.title === 'Essay critique (repaired)')).toBe(true);
		expect(repairArgs).toHaveBeenCalledTimes(1);
		expect(repairArgs.mock.calls[0][1]).toContain('title');
		expect(named('args.repair', CRIT)).toHaveLength(1);
	});

	it('re-checks the allowlist on repaired args', async () => {
		const DRAFT = `${B}.draft_admissions_question`;
		const plan = resign((p) => {
			find(p, DRAFT).payload.subject = 'a\nb';
		});
		const repairArgs = vi.fn(async (action: Action) => ({
			...action.payload,
			to: ['records@evil.example'],
			subject: 'ok'
		}));
		const { byId, world } = await setup({ plan, repairArgs });
		const o = byId(DRAFT);
		expect(o.kind).toBe('blocked');
		expect(o.detail).toContain('recipient_not_allowlisted');
		expect(world.state.gmail.drafts.some((d) => JSON.stringify(d).includes('evil.example'))).toBe(false);
	});
});

describe('guards', () => {
	it('halts at the step cap and skips the rest', async () => {
		const { exec, named } = await setup({ limits: { maxSteps: 5 } });
		expect(exec.halted?.reason).toBe('step_cap');
		expect(exec.steps).toBe(5);
		expect(exec.outcomes.slice(0, 2).every((o) => o.kind === 'created')).toBe(true);
		const rest = exec.outcomes.slice(2);
		expect(rest.length).toBe(21);
		expect(rest.every((o) => o.kind === 'skipped' && o.detail === 'halted:step_cap' && o.reason === 'step_cap')).toBe(
			true
		);
		expect(named('guard.step_cap')).toHaveLength(1);
	});

	it('halts on an identical call repeated past maxAttempts', async () => {
		const a = { ...structuredClone(find(basePlan, `${B}.tracker_row`)), dependsOn: [] };
		const a2 = { ...structuredClone(a), id: `${a.id}.dup` };
		const plan: Plan = { ...structuredClone(basePlan), actions: [a, a2] };
		const auth: Authorization = {
			planId: plan.planId,
			approvedIds: [a.id, a2.id],
			approved: [a, a2],
			skipped: [],
			blocked: [],
			recipientAllowlist: allow
		};
		const { exec, byId, named } = await setup({
			plan,
			auth,
			faults: { rules: { notion: [{ method: 'upsertTrackerRow', fault: { type: 'rate_limit', retryAfterMs: 0 } }] } }
		});
		expect(byId(a.id)).toMatchObject({ kind: 'failed', attempts: 3 });
		expect(byId(a2.id).kind).toBe('failed');
		expect(byId(a2.id).detail!.startsWith('retry_loop')).toBe(true);
		expect(exec.halted?.reason).toBe('retry_loop');
		expect(named('guard.retry_loop')).toHaveLength(1);
	});

	it('throws on an authorization that references unknown actions', async () => {
		const plan: Plan = { ...structuredClone(basePlan), actions: basePlan.actions.slice(0, 1) };
		const auth: Authorization = {
			planId: plan.planId,
			approvedIds: [basePlan.actions[1].id],
			approved: [basePlan.actions[1]],
			skipped: [],
			blocked: [],
			recipientAllowlist: allow
		};
		await expect(setup({ plan, auth })).rejects.toThrow(/not in plan/);
	});
});

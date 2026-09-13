import { describe, it, expect, vi } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, RunReport, SchoolsDataset } from '../schemas.ts';
import type { Action, Plan, TraceEvent } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createFakeLLM } from '../llm/fake.ts';
import {
	ConnectorError,
	createConnectors,
	type Connectors,
	type MockConnectorOptions,
	type World
} from '../connectors/index.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import { buildPlan } from './planner.ts';
import { authorizeExecution, recipientAllowlistFromProfile, signPlan, topoOrder } from './policy.ts';
import type { SprintLimits } from './types.ts';
import { executePlan } from './executor.ts';
import { buildRunReport, verifyOutcomes } from './verifier.ts';

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
const GMAIL_IDS = basePlan.actions.filter((a) => a.tool === 'gmail.createDraft').map((a) => a.id);

interface SetupOpts {
	faults?: MockConnectorOptions['faults'];
	approvedIds?: string[];
	plan?: Plan;
	world?: World;
	limits?: Partial<SprintLimits>;
	/** Mutate state between execute and verify. */
	between?: (world: World, plan: Plan) => void;
	/** Wrap connectors used for read-back only. */
	readConnectors?: (c: Connectors) => Connectors;
}

async function setup(o: SetupOpts = {}) {
	const plan = o.plan ?? basePlan;
	const auth = await authorizeExecution({
		plan,
		planToken: await signPlan(plan, SECRET, allow),
		approvedIds: o.approvedIds ?? plan.actions.map((a) => a.id),
		secret: SECRET,
		recipientAllowlist: allow
	});
	const bundle = createConnectors({
		mode: 'mock',
		...(o.world ? { world: o.world } : {}),
		...(o.faults ? { faults: o.faults } : {})
	});
	const sink = new MemorySink();
	let t = 0;
	const tracer = createTracer({ sinks: [sink], traceId: 't1', now: () => ++t });
	const sleep = vi.fn(async (_ms: number) => {});
	const exec = await executePlan(
		{ connectors: bundle, tracer, sleep, recipientAllowlist: allow, ...(o.limits ? { limits: o.limits } : {}) },
		plan,
		auth
	);
	o.between?.(bundle.world, plan);
	const readConnectors = o.readConnectors ? o.readConnectors(bundle) : bundle;
	const artifacts = await verifyOutcomes({ connectors: readConnectors, tracer, sleep }, plan, exec);
	const report = buildRunReport({
		runId: 'r1',
		traceId: 't1',
		plan,
		auth,
		exec,
		artifacts,
		mode: 'mock',
		startedAt: '2026-09-13T17:00:00.000Z',
		finishedAt: '2026-09-13T17:00:01.000Z'
	});
	expect(RunReport.parse(report)).toEqual(report);
	expect(report.artifacts.map((a) => a.actionId)).toEqual(topoOrder(plan.actions).map((a) => a.id));
	const art = (id: string) => artifacts.find((a) => a.actionId === id)!;
	const readbackEnd = (id: string): TraceEvent | undefined =>
		sink.events.find((e) => e.name === 'verify.readback' && e.kind === 'end' && e.attrs.actionId === id);
	const readbackEnds = () => sink.events.filter((e) => e.name === 'verify.readback' && e.kind === 'end');
	return { plan, auth, bundle, world: bundle.world, exec, artifacts, report, art, readbackEnd, readbackEnds, sink };
}

const find = (p: Plan, id: string): Action => p.actions.find((a) => a.id === id)!;
function resign(mutate: (p: Plan) => void): Plan {
	const p = structuredClone(basePlan);
	mutate(p);
	return p;
}
const failAll = (): MockConnectorOptions['faults'] => ({
	rules: {
		docs: [{ method: 'createDoc', fault: { type: 'server_error' } }],
		notion: [{ method: 'upsertTrackerRow', fault: { type: 'server_error' } }],
		calendar: [{ method: 'createEvent', fault: { type: 'server_error' } }],
		gmail: [{ method: 'createDraft', fault: { type: 'server_error' } }]
	}
});

describe('verifyOutcomes + buildRunReport', () => {
	it('verifies every artifact on the happy path', async () => {
		const { artifacts, report, readbackEnds } = await setup();
		expect(artifacts).toHaveLength(23);
		expect(artifacts.every((a) => a.status === 'verified')).toBe(true);
		expect(report.counts).toEqual({ verified: 23, deduped: 0, failed: 0, skipped: 0 });
		expect(report.status).toBe('ok');
		expect(report.blockers.map((b) => b.code)).toEqual(['NO_TRANSFER_PROGRAM']);
		expect(report.approvedIds).toHaveLength(23);
		const ends = readbackEnds();
		expect(ends).toHaveLength(23);
		for (const e of ends) {
			expect(e.attrs.found).toBe(true);
			expect(e.status).toBe('ok');
			expect(e.attrs.actionId).toBeTruthy();
			expect(e.attrs.app).toBeTruthy();
			expect(e.attrs.tool).toBeTruthy();
			expect(e.attrs.key).toBeTruthy();
		}
	});

	it('reports a re-run as all deduped', async () => {
		const first = await setup();
		const { artifacts, report, readbackEnds } = await setup({ world: first.world });
		expect(artifacts.every((a) => a.status === 'deduped')).toBe(true);
		expect(report.counts.deduped).toBe(23);
		expect(report.status).toBe('ok');
		expect(readbackEnds().every((e) => e.status === 'deduped')).toBe(true);
	});

	it('catches a lying_success write as mismatch', async () => {
		const id = `${B}.critique_doc`;
		const { exec, art, report, readbackEnd } = await setup({
			faults: { rules: { docs: [{ method: 'createDoc', calls: [1], fault: { type: 'lying_success' } }] } }
		});
		expect(exec.outcomes.find((o) => o.actionId === id)!.kind).toBe('created');
		expect(art(id).status).toBe('mismatch');
		expect(art(id).detail!.startsWith('read_back_missing')).toBe(true);
		expect(report.counts.failed).toBe(1);
		expect(report.status).toBe('partial');
		expect(readbackEnd(id)!.attrs.found).toBe(false);
		expect(readbackEnd(id)!.status).toBe('error');
	});

	it('flags changed fields as read_back_mismatch', async () => {
		const id = `${B}.event_deadline`;
		const { art, report, readbackEnd } = await setup({
			between: (world, plan) => {
				const key = find(plan, id).idempotencyKey;
				world.state.calendar.events.find((e) => e.key === key)!.title = 'tampered';
			}
		});
		expect(art(id).status).toBe('mismatch');
		expect(art(id).detail).toBe('read_back_mismatch: title');
		expect(readbackEnd(id)!.attrs.found).toBe(true);
		expect(readbackEnd(id)!.status).toBe('error');
		expect(report.counts.failed).toBe(1);
		expect(report.status).toBe('partial');
	});

	it('marks unapproved actions skipped without read-back', async () => {
		const approvedIds = basePlan.actions.map((a) => a.id).filter((id) => !GMAIL_IDS.includes(id));
		const { art, report, readbackEnd } = await setup({ approvedIds });
		for (const id of GMAIL_IDS) {
			expect(art(id).status).toBe('skipped');
			expect(art(id).detail).toBe('not_approved');
			expect(readbackEnd(id)).toBeUndefined();
		}
		expect(report.counts.skipped).toBe(GMAIL_IDS.length);
		expect(report.counts.verified).toBe(19);
		expect(report.status).toBe('ok');
	});

	it('reports a policy-blocked recipient as failed with a POLICY_BLOCKED blocker', async () => {
		const id = `${B}.draft_advisor_prereq_check`;
		const plan = resign((p) => {
			find(p, id).payload.to = ['records@evil.example'];
		});
		const { art, report } = await setup({ plan });
		expect(art(id).status).toBe('failed');
		expect(art(id).detail!.startsWith('blocked_by_policy')).toBe(true);
		const blocker = report.blockers.find((b) => b.code === 'POLICY_BLOCKED');
		expect(blocker).toBeDefined();
		expect(blocker!.message).toContain(id);
		expect(report.status).toBe('partial');
	});

	it('does not read back failed integration outcomes', async () => {
		const { artifacts, report, readbackEnd } = await setup({
			faults: { rules: { notion: [{ method: 'upsertTrackerRow', fault: { type: 'server_error' } }] } }
		});
		const trackers = artifacts.filter((a) => a.app === 'notion');
		expect(trackers).toHaveLength(3);
		for (const t of trackers) {
			expect(t.status).toBe('failed');
			expect(t.detail).toMatch(/integration_failure/);
			expect(t.attempts).toBe(3);
			expect(readbackEnd(t.actionId)).toBeUndefined();
		}
		expect(report.status).toBe('partial');
	});

	it('adds STEP_CAP_REACHED and keeps halted actions skipped', async () => {
		const { artifacts, report } = await setup({ limits: { maxSteps: 5 } });
		expect(report.blockers.map((b) => b.code)).toContain('STEP_CAP_REACHED');
		expect(report.counts.verified).toBe(2);
		expect(report.status).toBe('partial');
		expect(artifacts.slice(2).every((a) => a.status === 'skipped')).toBe(true);
	});

	it('reports failed when a step cap halts before anything verifies', async () => {
		const { report } = await setup({ limits: { maxSteps: 1 } });
		expect(report.counts.verified + report.counts.deduped).toBe(0);
		expect(report.status).toBe('failed');
	});

	it('reports failed when every write fails', async () => {
		const { report } = await setup({ faults: failAll() });
		expect(report.counts.verified).toBe(0);
		expect(report.status).toBe('failed');
	});

	it('turns read-back errors into failed artifacts', async () => {
		const { artifacts, readbackEnd } = await setup({
			readConnectors: (c) => ({
				...c,
				docs: {
					...c.docs,
					findByKey: async () => {
						throw new ConnectorError('server', 'read failed', { status: 500 });
					}
				}
			})
		});
		const docs = artifacts.filter((a) => a.app === 'docs');
		expect(docs).toHaveLength(3);
		for (const d of docs) {
			expect(d.status).toBe('failed');
			expect(d.detail!.startsWith('read_back_error')).toBe(true);
			expect(readbackEnd(d.actionId)!.status).toBe('error');
			expect(readbackEnd(d.actionId)!.attrs.found).toBe(false);
		}
	});
});

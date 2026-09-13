import { describe, it, expect, vi } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, RunReport, SchoolsDataset } from '../schemas.ts';
import type { Plan, TraceEvent } from '../schemas.ts';
import { createConnectors, isEmptyDiff, type MockConnectorOptions, type MockConnectors } from '../connectors/index.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import { piiFromProfile, redactTraceEvent } from '../trace/redact.ts';
import { parseJsonl, toJsonl } from '../trace/jsonl.ts';
import { recipientAllowlistFromProfile, signPlan } from './policy.ts';
import { allActionIds, executeSprint, planSprint, type SprintRuntime } from './sprint.ts';
import { buildHeroRunFile, HeroRunFile, preflightPlan } from './recording.ts';
import type { SprintLimits } from './types.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const TODAY = '2026-09-13';
const createdAt = '2026-09-13T17:00:00.000Z';
const SECRET = 'test-secret-0123456789';
const allow = recipientAllowlistFromProfile(demo);
const B = 'uc-berkeley-data-science-ba';
const C = 'cornell-as-economics';
const GPA_LEAK = /GPA[^0-9\n]{0,24}3\.3/;

function newRuntime(bundle: MockConnectors, sink: MemorySink, limits?: Partial<SprintLimits>) {
	const sleep = vi.fn(async (_ms: number) => {});
	const rt: SprintRuntime & { sleep: typeof sleep } = {
		connectors: bundle,
		mode: 'mock',
		llm: createFakeLLM(),
		tracer: createTracer({ sinks: [sink], traceId: 'sprint-test' }),
		planSecret: SECRET,
		today: TODAY,
		sleep,
		...(limits ? { limits } : {})
	};
	return rt;
}

type FaultRules = NonNullable<MockConnectorOptions['faults']>['rules'];

async function setup(o: { faults?: FaultRules; limits?: Partial<SprintLimits> } = {}) {
	const sink = new MemorySink();
	const sleepRef: { fn?: (ms: number) => Promise<void> } = {};
	const bundle = createConnectors({
		mode: 'mock',
		...(o.faults ? { faults: { rules: o.faults, seed: 1, sleep: (ms: number) => sleepRef.fn!(ms) } } : {})
	});
	const rt = newRuntime(bundle, sink, o.limits);
	sleepRef.fn = rt.sleep;
	const planned = await planSprint(rt, { profile: demo, schools, createdAt });
	return { sink, bundle, world: bundle.world, rt, ...planned };
}

/** Collection counts restricted to this plan's idempotency keys (the seed holds unrelated fixtures). */
function keyed(bundle: MockConnectors, plan: Plan) {
	const keys = new Set(plan.actions.map((a) => a.idempotencyKey));
	const s = bundle.world.state;
	return {
		rows: s.notion.rows.filter((r) => keys.has(r.key)),
		events: s.calendar.events.filter((e) => keys.has(e.key)),
		docs: s.docs.docs.filter((d) => d.key !== undefined && keys.has(d.key)),
		drafts: s.gmail.drafts.filter((d) => keys.has(d.key))
	};
}

const art = (r: RunReport, id: string) => r.artifacts.find((a) => a.actionId === id)!;
const ends = (events: TraceEvent[], name: string) => events.filter((e) => e.name === name && e.kind === 'end');

describe('planSprint / executeSprint (end to end on mocks)', () => {
	it('1. happy path: plans without writes, executes and verifies all 23 artifacts', async () => {
		const sink = new MemorySink();
		const bundle = createConnectors({ mode: 'mock' });
		const rt = newRuntime(bundle, sink);
		const before = bundle.world.snapshot();
		const { plan, planToken, reports } = await planSprint(rt, { profile: demo, schools, createdAt });
		expect(reports).toHaveLength(4);
		expect(plan.actions).toHaveLength(23);
		expect(isEmptyDiff(bundle.world.diff(before))).toBe(true);

		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(RunReport.parse(report)).toEqual(report);
		expect(report.status).toBe('ok');
		expect(report.counts).toEqual({ verified: 23, deduped: 0, failed: 0, skipped: 0 });

		const k = keyed(bundle, plan);
		expect(k.rows).toHaveLength(3);
		expect(new Set(k.rows.map((r) => r.programId)).size).toBe(3);
		expect(k.events).toHaveLength(13);
		expect(k.events.every((e) => e.date >= TODAY)).toBe(true);
		expect(k.docs).toHaveLength(3);
		expect(k.drafts).toHaveLength(4);
		expect(k.drafts.every((d) => d.to.every((t) => allow.includes(t.toLowerCase())))).toBe(true);
		expect(bundle.world.state.gmail.sent.length).toBe(0);
		expect(report.blockers.map((b) => b.code)).toContain('NO_TRANSFER_PROGRAM');
	});

	it("2. rerun on the same world: every artifact 'deduped', empty world diff", async () => {
		const first = await setup();
		await executeSprint(first.rt, {
			plan: first.plan,
			planToken: first.planToken,
			approvedIds: allActionIds(first.plan),
			profile: demo
		});
		const bundle2 = createConnectors({ mode: 'mock', world: first.world });
		const rt2 = newRuntime(bundle2, new MemorySink());
		const snap = bundle2.world.snapshot();
		const p2 = await planSprint(rt2, { profile: demo, schools, createdAt: '2026-09-13T17:01:00.000Z' });
		const report2 = await executeSprint(rt2, {
			plan: p2.plan,
			planToken: p2.planToken,
			approvedIds: allActionIds(p2.plan),
			profile: demo
		});
		expect(report2.artifacts.every((a) => a.status === 'deduped')).toBe(true);
		expect(report2.counts.deduped).toBe(23);
		expect(report2.status).toBe('ok');
		expect(isEmptyDiff(bundle2.world.diff(snap))).toBe(true);
		const k = keyed(bundle2, p2.plan);
		expect([k.rows.length, k.events.length, k.drafts.length]).toEqual([3, 13, 4]);
	});

	it('3. an unapproved action is not executed', async () => {
		const { rt, plan, planToken, bundle } = await setup();
		const id = `${C}.draft_rec_request`;
		const report = await executeSprint(rt, {
			plan,
			planToken,
			approvedIds: allActionIds(plan).filter((x) => x !== id),
			profile: demo
		});
		expect(art(report, id).status).toBe('skipped');
		expect(art(report, id).detail).toBe('not_approved');
		expect(bundle.world.state.gmail.drafts.some((d) => d.to.includes('lchen@example.edu'))).toBe(false);
		expect(report.status).toBe('ok');
	});

	it('4. tampered plan, unknown id and swapped contacts are rejected before any write', async () => {
		const { rt, plan, planToken, world, sink } = await setup();
		const before = world.snapshot();

		const tampered = structuredClone(plan);
		tampered.actions.find((a) => a.id === `${B}.draft_advisor_prereq_check`)!.payload.to = ['records@evil.example'];
		await expect(
			executeSprint(rt, { plan: tampered, planToken, approvedIds: allActionIds(plan), profile: demo })
		).rejects.toMatchObject({ name: 'PolicyError', code: 'invalid_plan_token' });
		expect(isEmptyDiff(world.diff(before))).toBe(true);

		await expect(
			executeSprint(rt, { plan, planToken, approvedIds: ['x.y'], profile: demo })
		).rejects.toMatchObject({ name: 'PolicyError', code: 'unknown_action_id' });
		expect(isEmptyDiff(world.diff(before))).toBe(true);

		const swapped = structuredClone(demo);
		swapped.contacts[2].email = 'x@evil.example';
		await expect(
			executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: swapped })
		).rejects.toMatchObject({ name: 'PolicyError', code: 'invalid_plan_token' });
		expect(isEmptyDiff(world.diff(before))).toBe(true);

		expect(sink.events.filter((e) => e.name === 'policy.rejected')).toHaveLength(3);
	});

	it('5. a 429 rate_limit burst recovers without duplicates', async () => {
		const { rt, plan, planToken, bundle, sink } = await setup({
			faults: {
				notion: [{ method: 'upsertTrackerRow', calls: [1, 2], fault: { type: 'rate_limit', retryAfterMs: 10 } }],
				calendar: [{ method: 'createEvent', calls: [1], fault: { type: 'rate_limit', retryAfterMs: 10 } }]
			}
		});
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(report.status).toBe('ok');
		const k = keyed(bundle, plan);
		expect(k.rows).toHaveLength(3);
		expect(k.events).toHaveLength(13);
		const tracker = report.artifacts.find((a) => a.actionId.endsWith('.tracker_row'))!;
		expect(tracker.attempts).toBe(3);
		expect(rt.sleep.mock.calls.filter(([ms]) => ms === 10).length).toBeGreaterThanOrEqual(3);
		const end = ends(sink.events, 'action.execute').find((e) => e.attrs.actionId === tracker.actionId)!;
		expect(end.attrs.attempt).toBe(3);
		expect(end.status).toBe('ok');
	});

	it('6. a ghost_write is recovered by key, never duplicated', async () => {
		const { rt, plan, planToken, bundle, sink } = await setup({
			faults: {
				gmail: [{ method: 'createDraft', calls: [1], fault: { type: 'ghost_write' } }],
				docs: [{ method: 'createDoc', calls: [2], fault: { type: 'ghost_write' } }]
			}
		});
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(report.status).toBe('ok');
		const k = keyed(bundle, plan);
		expect(k.drafts).toHaveLength(4);
		expect(k.docs).toHaveLength(3);
		expect(report.artifacts.filter((a) => a.detail?.startsWith('recovered_after_error'))).toHaveLength(2);
		expect(sink.events.some((e) => e.name === 'retry' && e.attrs.foundByKey === true)).toBe(true);
	});

	it("7. a lying_success write is caught by read-back as 'mismatch'", async () => {
		const { rt, plan, planToken, bundle, sink } = await setup({
			faults: { calendar: [{ method: 'createEvent', calls: [1], fault: { type: 'lying_success' } }] }
		});
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(report.status).toBe('partial');
		const mismatches = report.artifacts.filter((a) => a.status === 'mismatch');
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0].detail!.startsWith('read_back_missing')).toBe(true);
		expect(keyed(bundle, plan).events).toHaveLength(12);
		expect(report.counts.verified).toBe(22);
		expect(report.counts.failed).toBe(1);
		const rb = ends(sink.events, 'verify.readback').find((e) => e.attrs.actionId === mismatches[0].actionId)!;
		expect(rb.attrs.found).toBe(false);
	});

	it('8. a non-allowlisted recipient is blocked_by_policy even on a validly signed plan', async () => {
		const { rt, plan, bundle } = await setup();
		const id = `${B}.draft_admissions_question`;
		const p2 = structuredClone(plan);
		p2.actions.find((a) => a.id === id)!.payload.to = ['transfer-help@evil.example'];
		const token = await signPlan(p2, SECRET, recipientAllowlistFromProfile(demo));
		const report = await executeSprint(rt, { plan: p2, planToken: token, approvedIds: allActionIds(p2), profile: demo });
		expect(art(report, id).status).toBe('failed');
		expect(art(report, id).detail!.startsWith('blocked_by_policy')).toBe(true);
		expect(bundle.world.state.gmail.drafts.some((d) => d.to.some((t) => t.includes('evil.example')))).toBe(false);
		expect(report.blockers.map((b) => b.code)).toContain('POLICY_BLOCKED');
		expect(report.status).toBe('partial');
	});

	it('9. exhausted retries are reported as integration failures', async () => {
		const { rt, plan, planToken } = await setup({
			faults: { notion: [{ method: 'upsertTrackerRow', fault: { type: 'server_error' } }] }
		});
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(report.status).toBe('partial');
		const failed = report.artifacts.filter((a) => a.status === 'failed');
		expect(failed).toHaveLength(3);
		expect(failed.every((a) => a.detail?.startsWith('integration_failure'))).toBe(true);
		expect(report.counts.verified).toBe(20);
	});

	it('10. records a structured trace that exports as redacted JSONL', async () => {
		const { rt, plan, planToken, sink } = await setup();
		await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(sink.events.some((e) => e.name === 'plan.built')).toBe(true);
		const actionEnds = ends(sink.events, 'action.execute');
		expect(actionEnds).toHaveLength(23);
		expect(actionEnds.every((e) => typeof e.durationMs === 'number')).toBe(true);
		const calls = sink.events.filter((e) => e.name === 'tool.call');
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((e) => typeof e.attrs.latencyMs === 'number')).toBe(true);
		expect(ends(sink.events, 'verify.readback')).toHaveLength(23);

		const redacted = sink.events.map((e) => redactTraceEvent(e, piiFromProfile(demo)));
		const text = toJsonl(redacted);
		expect(parseJsonl(text)).toEqual(redacted);
		expect(text).not.toContain('Alex Rivera');
		expect(text.toLowerCase()).not.toContain('alex.rivera@example.com');
		expect(GPA_LEAK.test(text)).toBe(false);
	});

	it('11. the step cap halts a runaway run', async () => {
		const { rt, plan, planToken } = await setup({ limits: { maxSteps: 10 } });
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		expect(report.status).toBe('partial');
		expect(report.blockers.map((b) => b.code)).toContain('STEP_CAP_REACHED');
		expect(report.artifacts.some((a) => a.status === 'skipped' && a.detail === 'halted:step_cap')).toBe(true);
	});

	it('12. recording contract: preflight new/exists and a redacted HeroRunFile', async () => {
		const { rt, plan, planToken, bundle, world, sink } = await setup();
		const before = world.snapshot();
		const preflight = await preflightPlan(bundle, plan);
		expect(Object.keys(preflight)).toHaveLength(23);
		expect(Object.values(preflight).every((v) => v === 'new')).toBe(true);
		expect(isEmptyDiff(world.diff(before))).toBe(true);

		const run1Start = sink.events.length;
		const report = await executeSprint(rt, { plan, planToken, approvedIds: allActionIds(plan), profile: demo });
		const runEvents = sink.events.slice(run1Start);
		const after = await preflightPlan(bundle, plan);
		expect(Object.values(after).every((v) => v === 'exists')).toBe(true);

		const rt2 = { ...rt, connectors: createConnectors({ mode: 'mock', world }) };
		const p2 = await planSprint(rt2, { profile: demo, schools, createdAt: '2026-09-13T17:01:00.000Z' });
		const rerunStart = sink.events.length;
		const report2 = await executeSprint(rt2, {
			plan: p2.plan,
			planToken: p2.planToken,
			approvedIds: allActionIds(p2.plan),
			profile: demo
		});
		const rerunEvents = sink.events.slice(rerunStart);

		const file = buildHeroRunFile({
			recordedAt: createdAt,
			commitSha: 'abc1234',
			profile: demo,
			plan,
			preflight,
			events: runEvents,
			report,
			rerun: { events: rerunEvents, report: report2 }
		});
		expect(HeroRunFile.parse(file)).toEqual(file);
		expect(file.profileId).toBe('demo');
		expect(file.events.some((e) => e.name === 'action.execute' && e.kind === 'end')).toBe(true);
		expect(file.rerun!.report.counts.deduped).toBe(23);
		const json = JSON.stringify(file);
		expect(json).not.toContain('Alex Rivera');
		expect(json.toLowerCase()).not.toContain('alex.rivera@example.com');
		expect(GPA_LEAK.test(json)).toBe(false);
		for (const a of file.plan.actions.filter((x) => x.app === 'gmail')) {
			const orig = plan.actions.find((x) => x.id === a.id)!;
			expect(a.payload.to).toEqual(orig.payload.to);
		}
	});
});

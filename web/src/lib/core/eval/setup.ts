// Per-run World preparation: fixtures, patches, pre-existing keyed artifacts and seeded faults.
import demoProfile from '../data/profiles/demo.json';
import demoQuarterProfile from '../data/profiles/demo-quarter.json';
import schoolsJson from '../data/schools.json';
import { Profile, SchoolsDataset, type Plan } from '../schemas.ts';
import {
	createConnectors,
	createWorld,
	defaultWorldSeed,
	DEFAULT_CLOCK,
	type MockConnectors,
	type World,
	type WorldState
} from '../connectors/index.ts';
import { allActionIds, planSprint } from '../agent/sprint.ts';
import { getWriteTool } from '../tools/sprint-tools.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { createTracer } from '../trace/tracer.ts';
import type { Scenario, SchoolsPatch } from './types.ts';

export const EVAL_TODAY = '2026-09-13';
/** Mock-only HMAC key for signing eval plans. Not a credential. */
export const EVAL_PLAN_SECRET = 'eval-harness-mock-only-plan-secret';

export function runSeedFor(baseSeed: number, scenarioId: string, runIndex: number): number {
	let h = 2166136261;
	for (let i = 0; i < scenarioId.length; i++) {
		h ^= scenarioId.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h ^ (baseSeed + Math.imul(runIndex + 1, 0x9e3779b1))) >>> 0;
}

export function loadProfile(id: 'demo' | 'demo-quarter'): Profile {
	return Profile.parse(structuredClone(id === 'demo' ? demoProfile : demoQuarterProfile));
}

export function loadSchools(): SchoolsDataset {
	return SchoolsDataset.parse(structuredClone(schoolsJson));
}

export function applySchoolsPatch(ds: SchoolsDataset, patches: SchoolsPatch[] = []): SchoolsDataset {
	const clone = structuredClone(ds);
	for (const p of patches) {
		const program = clone.schools.flatMap((s) => s.programs).find((pr) => pr.program_id === p.programId);
		const deadline = program?.deadlines.find((d) => d.id === p.deadlineId);
		if (!program || !deadline) {
			throw new Error(`applySchoolsPatch: unknown program/deadline ${p.programId}/${p.deadlineId}`);
		}
		deadline.date = p.date;
	}
	return SchoolsDataset.parse(clone);
}

export const noSleep = async (_ms: number): Promise<void> => {};

export function tickClock(): () => number {
	let t = Date.parse(DEFAULT_CLOCK);
	return () => {
		t += 5;
		return t;
	};
}

export interface PreparedPass {
	today: string;
	schools: SchoolsDataset;
}
export interface PreparedRun {
	scenario: Scenario;
	runIndex: number;
	runSeed: number;
	profile: Profile;
	passes: PreparedPass[];
	world: World;
	seedSnapshot: WorldState;
	/** i === 0: scenario.faults seeded with runSeed + noSleep; i > 0: no faults; always over `world`. */
	connectorsForPass(i: number): MockConnectors;
	approvedIdsFor(plan: Plan): string[];
}

export async function prepareRun(scenario: Scenario, runIndex: number, baseSeed: number): Promise<PreparedRun> {
	const profile = Profile.parse({ ...loadProfile(scenario.profile), ...(scenario.profilePatch ?? {}) });
	const today = scenario.today ?? EVAL_TODAY;
	const schools0 = applySchoolsPatch(loadSchools(), scenario.schoolsPatch);
	const passes: PreparedPass[] = [{ today, schools: schools0 }];
	if (scenario.rerun) {
		passes.push({ today: scenario.rerun.today ?? today, schools: applySchoolsPatch(schools0, scenario.rerun.schoolsPatch) });
	}

	const seed = defaultWorldSeed({ adversarial: true });
	const w = scenario.world ?? {};
	const docs = [...(seed.docs?.docs ?? [])].filter((d) => w.essayDoc === 'injected' || d.id !== 'doc-essay-demo-injected');
	if (w.essayDoc === 'empty') docs.push({ id: 'doc-essay-empty', title: 'Transfer essay draft (empty)', body: '' });
	seed.docs = { ...(seed.docs ?? {}), docs };
	if (w.inbox !== 'injected') seed.gmail = { ...(seed.gmail ?? {}), inbox: [] };
	const world = createWorld(seed);

	if (w.preexisting && w.preexisting.length > 0) {
		const plain = createConnectors({ mode: 'mock', world });
		const clock = tickClock();
		const { plan } = await planSprint(
			{
				connectors: createConnectors({ mode: 'mock', seed: structuredClone(seed) }),
				mode: 'mock',
				llm: createFakeLLM(),
				tracer: createTracer({ sinks: [], traceId: 'eval-seed', now: tickClock() }),
				planSecret: EVAL_PLAN_SECRET,
				today,
				now: clock,
				sleep: noSleep
			},
			{ profile, schools: schools0, createdAt: `${today}T17:00:00.000Z` }
		);
		for (const p of w.preexisting) {
			const action = plan.actions.find((a) => a.id === p.actionId);
			if (!action) throw new Error(`prepareRun: preexisting action ${p.actionId} not in plan`);
			const tool = getWriteTool(action.tool);
			if (!tool) throw new Error(`prepareRun: unknown write tool ${action.tool}`);
			await tool.run(
				{ connectors: plain },
				tool.input.parse({ ...action.payload, ...(p.override ?? {}), key: action.idempotencyKey })
			);
		}
	}

	const seedSnapshot = world.snapshot();
	const runSeed = runSeedFor(baseSeed, scenario.id, runIndex);

	return {
		scenario,
		runIndex,
		runSeed,
		profile,
		passes,
		world,
		seedSnapshot,
		connectorsForPass(i: number): MockConnectors {
			return createConnectors({
				mode: 'mock',
				world,
				...(i === 0 && scenario.faults ? { faults: { rules: scenario.faults, seed: runSeed, sleep: noSleep } } : {})
			});
		},
		approvedIdsFor(plan: Plan): string[] {
			const a = scenario.approve;
			if (a === undefined || a === 'all') return allActionIds(plan);
			return plan.actions.filter((x) => !a.exceptTools.includes(x.tool)).map((x) => x.id);
		}
	};
}

import { describe, expect, it } from 'vitest';
import { Profile } from '../schemas.ts';
import { AGENT_CONFIGS } from './types.ts';
import { EVAL01_COVERAGE, SCENARIOS, enabledScenarios, getScenario } from './scenarios.ts';
import { buildLlmScript } from './llm-scripts.ts';
import { applySchoolsPatch, loadSchools, prepareRun, runSeedFor } from './setup.ts';
import { runAgent, selfReportArtifacts } from './agent.ts';
import type { ExecutionResult } from '../agent/index.ts';

const B = 'uc-berkeley-data-science-ba';

function deadlineDate(ds: ReturnType<typeof loadSchools>, programId: string, deadlineId: string): string | undefined {
	return ds.schools
		.flatMap((s) => s.programs)
		.find((p) => p.program_id === programId)
		?.deadlines.find((d) => d.id === deadlineId)?.date;
}

describe('scenario registry', () => {
	it('has 22 scenarios, >= 21 enabled, unique kebab ids, full coverage', () => {
		expect(SCENARIOS.length).toBe(22);
		expect(enabledScenarios().length).toBeGreaterThanOrEqual(21);
		const ids = SCENARIOS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		const enabled = new Set(enabledScenarios().map((s) => s.id));
		for (const list of Object.values(EVAL01_COVERAGE)) for (const id of list) expect(enabled.has(id)).toBe(true);
	});

	it('tag counts and required fields', () => {
		const en = enabledScenarios();
		const count = (t: string) => en.filter((s) => (s.tags as string[]).includes(t)).length;
		expect(count('fault')).toBeGreaterThanOrEqual(4);
		expect(count('injection')).toBeGreaterThanOrEqual(2);
		expect(count('idempotency')).toBeGreaterThanOrEqual(2);
		expect(count('data')).toBeGreaterThanOrEqual(4);
		expect(count('known-weakness')).toBe(3);
		for (const s of SCENARIOS) {
			expect(s.name.length).toBeGreaterThan(0);
			expect(s.description.length).toBeGreaterThan(0);
			expect(['complete', 'honest_failure', 'complete_or_honest']).toContain(s.expect.outcome);
		}
	});

	it('forbiddenDocPhrases only targets grammar_only programs; W3 marker present', () => {
		const ds = loadSchools();
		const programs = ds.schools.flatMap((s) => s.programs);
		let seen = 0;
		for (const s of SCENARIOS) {
			for (const pid of Object.keys(s.expect.forbiddenDocPhrases ?? {})) {
				seen++;
				expect(programs.find((p) => p.program_id === pid)?.ai_policy.value.mode).toBe('grammar_only');
			}
		}
		expect(seen).toBeGreaterThan(0);
		expect(getScenario('umich-transfer-prompt-target').expect.docsInclude?.['umich-lsa']).toContain('## Prompt (um-transfer-reasons)');
		expect(() => getScenario('nope')).toThrow();
	});

	it('LLM scripts target the right slots', () => {
		for (const id of ['obedient-injection', 'grammar-only-coaching-leak'] as const) {
			const s = buildLlmScript(id);
			expect(s).toHaveProperty('essay_critique');
			expect(s).not.toHaveProperty('critique');
		}
		expect(buildLlmScript('hallucinating-draft')).toHaveProperty('draft');
		expect(buildLlmScript('unsupported-claim-gpa-employer')).toHaveProperty('draft');
		expect(buildLlmScript('default')).toEqual({});
	});
});

describe('prepareRun', () => {
	it.each(enabledScenarios())('prepares $id', async (s) => {
		const prepared = await prepareRun(s, 0, 1337);
		expect(Profile.safeParse(prepared.profile).success).toBe(true);
		expect(prepared.seedSnapshot.gmail.sent).toEqual([]);
		expect(prepared.passes.length).toBe(s.rerun ? 2 : 1);
	});

	it('is deterministic', async () => {
		const s = getScenario('duplicate-tracker-row');
		const a = await prepareRun(s, 3, 1337);
		const b = await prepareRun(s, 3, 1337);
		expect(a.seedSnapshot).toEqual(b.seedSnapshot);
		const r = runSeedFor(1337, 'happy-path', 0);
		expect(r).toBe(runSeedFor(1337, 'happy-path', 0));
		expect(r).not.toBe(runSeedFor(1337, 'happy-path', 1));
		expect(r).not.toBe(runSeedFor(1337, 'lying-success', 0));
		for (const v of [r, runSeedFor(0, 'x', 99), runSeedFor(0xffffffff, 'lying-success', 7)]) {
			expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
		}
	});

	it('selects fixtures per scenario', async () => {
		const happy = await prepareRun(getScenario('happy-path'), 0, 1337);
		expect(happy.seedSnapshot.docs.docs.some((d) => d.id === 'doc-essay-demo-injected')).toBe(false);
		expect(happy.seedSnapshot.gmail.inbox).toEqual([]);

		const injDoc = await prepareRun(getScenario('injection-essay-doc'), 0, 1337);
		expect(injDoc.profile.essay_doc_id).toBe('doc-essay-demo-injected');
		expect(injDoc.seedSnapshot.docs.docs.some((d) => d.id === 'doc-essay-demo-injected')).toBe(true);

		const injInbox = await prepareRun(getScenario('injection-inbox-email'), 0, 1337);
		expect(injInbox.seedSnapshot.gmail.inbox.some((m) => m.id === 'msg-inj-001')).toBe(true);

		const missing = await prepareRun(getScenario('missing-essay-doc'), 0, 1337);
		expect(missing.seedSnapshot.docs.docs.some((d) => d.id === missing.profile.essay_doc_id)).toBe(false);

		const empty = await prepareRun(getScenario('empty-essay-doc'), 0, 1337);
		expect(empty.seedSnapshot.docs.docs.find((d) => d.id === empty.profile.essay_doc_id)?.body).toBe('');
	});

	it('seeds pre-existing keyed artifacts for duplicate-tracker-row', async () => {
		const p = await prepareRun(getScenario('duplicate-tracker-row'), 0, 1337);
		expect(p.seedSnapshot.notion.rows.length).toBe(1);
		const row = p.seedSnapshot.notion.rows[0]!;
		expect(row.key).toMatch(/^tp1-[0-9a-f]{16}$/);
		expect(row.programId).toBe(B);
		expect(row.title).toBe('Berkeley (added by hand last week)');
		expect(p.seedSnapshot.calendar.events.length).toBe(1);
	});

	it('patches deadlines for the rerun without mutating inputs', async () => {
		const p = await prepareRun(getScenario('changed-deadline-rerun'), 0, 1337);
		expect(deadlineDate(p.passes[1]!.schools, B, 'fall-2027-application-2026-11-30')).toBe('2026-12-04');
		expect(deadlineDate(p.passes[0]!.schools, B, 'fall-2027-application-2026-11-30')).toBe('2026-11-30');
		const ds = loadSchools();
		const before = structuredClone(ds);
		applySchoolsPatch(ds, [{ programId: B, deadlineId: 'fall-2027-application-2026-11-30', date: '2026-12-25' }]);
		expect(ds).toEqual(before);
		expect(() => applySchoolsPatch(ds, [{ programId: 'x', deadlineId: 'y', date: '2026-01-01' }])).toThrow(/applySchoolsPatch/);
	});
});

describe('runAgent', () => {
	it('verifier-on happy path writes the full sprint', async () => {
		const run = await runAgent(await prepareRun(getScenario('happy-path'), 0, 1337), AGENT_CONFIGS['verifier-on']);
		const p = run.passes[0]!;
		expect(p.error).toBeNull();
		expect(p.report?.status).toBe('ok');
		expect(p.worldAfter.notion.rows.length).toBe(3);
		expect(p.worldAfter.calendar.events.length).toBe(13);
		expect(p.worldAfter.gmail.drafts.length).toBe(4);
		expect(p.worldAfter.gmail.sent.length).toBe(0);
		expect(p.events.some((e) => e.name === 'action.execute' && e.kind === 'end')).toBe(true);
	});

	it('verifier-off trusts a lying API; verifier-on does not', async () => {
		const s = getScenario('lying-success');
		const off = await runAgent(await prepareRun(s, 0, 1337), AGENT_CONFIGS['verifier-off']);
		expect(off.passes[0]!.report?.status).toBe('ok');
		expect(off.passes[0]!.worldAfter.calendar.events.length).toBeLessThan(13);

		const on = await runAgent(await prepareRun(s, 0, 1337), AGENT_CONFIGS['verifier-on']);
		expect(on.passes[0]!.report?.status).not.toBe('ok');
		expect(on.passes[0]!.report?.artifacts.some((a) => a.status === 'mismatch')).toBe(true);
	});

	it('selfReportArtifacts maps executor kinds', () => {
		const mk = (kind: string, i: number) => ({
			actionId: `a${i}`,
			app: 'notion' as const,
			tool: 'notion.upsertTrackerRow',
			idempotencyKey: `k${i}`,
			kind,
			attempts: i + 1,
			ref: { app: 'notion', id: `r${i}` },
			detail: `d${i}`
		});
		const kinds = ['created', 'updated', 'deduped', 'failed', 'blocked', 'skipped'];
		const exec = { outcomes: kinds.map(mk), steps: 6, halted: null } as unknown as ExecutionResult;
		const out = selfReportArtifacts(exec);
		expect(out.map((a) => a.status)).toEqual(['verified', 'verified', 'deduped', 'failed', 'failed', 'skipped']);
		expect(out[2]).toMatchObject({ idempotencyKey: 'k2', app: 'notion', attempts: 3, ref: { id: 'r2' }, detail: 'd2' });
	});
});

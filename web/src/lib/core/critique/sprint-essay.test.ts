import { describe, it, expect, vi } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import type { Plan } from '../schemas.ts';
import {
	allActionIds,
	buildPlan,
	canonicalJson,
	executeSprint,
	planSprint,
	recipientAllowlistFromProfile,
	type SprintRuntime
} from '../agent/index.ts';
import {
	POLICY_NOTES,
	findingsFromReports,
	groundedCritiqueResponder,
	hallucinatingCritiqueResponder,
	injectionObeyingCritiqueResponder,
	injectionObeyingDraftResponder,
	inventedAchievementDraftResponder,
	mutatingNextActionsResponder
} from './index.ts';
import { createConnectors, defaultWorldSeed, type MockConnectors } from '../connectors/index.ts';
import { analyzeGaps } from '../gap/index.ts';
import { WRITE_TOOLS } from '../tools/sprint-tools.ts';
import { createFakeLLM, type FakeLLM } from '../llm/fake.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const TODAY = '2026-09-13';
const createdAt = '2026-09-13T17:00:00.000Z';
const B = 'uc-berkeley-data-science-ba';
const C = 'cornell-as-economics';
const U = 'umich-lsa';
const allow = recipientAllowlistFromProfile(demo);
const inj = { ...demo, essay_doc_id: 'doc-essay-demo-injected' };

function rt(bundle: MockConnectors, sink: MemorySink, llm: FakeLLM = createFakeLLM()): SprintRuntime {
	return {
		connectors: bundle,
		mode: 'mock',
		llm,
		tracer: createTracer({ sinks: [sink], traceId: 'essay-test' }),
		planSecret: 'test-secret-0123456789',
		today: TODAY,
		sleep: vi.fn(async () => {})
	};
}

async function run(profile: Profile, llm?: FakeLLM, bundle: MockConnectors = createConnectors({ mode: 'mock' })) {
	const sink = new MemorySink();
	const r = rt(bundle, sink, llm);
	const res = await planSprint(r, { profile, schools, createdAt });
	return { sink, bundle, world: bundle.world, r, ...res };
}

const exec = (x: Awaited<ReturnType<typeof run>>, profile: Profile) =>
	executeSprint(x.r, { plan: x.plan, planToken: x.planToken, approvedIds: allActionIds(x.plan), profile });

const named = (sink: MemorySink, name: string) => sink.events.filter((e) => e.name === name);
const byTool = (plan: Plan, tool: string) => plan.actions.filter((a) => a.tool === tool);
const proj = (p: Plan) =>
	p.actions.map((a) => ({
		id: a.id,
		app: a.app,
		tool: a.tool,
		key: a.idempotencyKey,
		to: a.payload.to ?? null,
		cc: a.payload.cc ?? null,
		dependsOn: a.dependsOn
	}));

describe('Phase 5 sprint: essay critique, grounding and injection containment', () => {
	it('1. ESSAY-01: reads only the profile essay doc, once, and traces it', async () => {
		const bundle = createConnectors({ mode: 'mock' });
		const spy = vi.spyOn(bundle.docs, 'readDoc');
		const x = await run(demo, undefined, bundle);
		await exec(x, demo);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith('doc-essay-demo');
		expect(named(x.sink, 'essay.read')).toHaveLength(1);
		const calls = named(x.sink, 'tool.call');
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((e) => ['findByKey', 'run'].includes(String(e.attrs.method)))).toBe(true);
	});

	it('2a. missing essay doc: ESSAY_DOC_MISSING per essay program, no critique docs, 20 actions', async () => {
		const profile = { ...demo, essay_doc_id: 'doc-missing' };
		const x = await run(profile);
		expect(byTool(x.plan, 'docs.createDoc')).toHaveLength(0);
		expect(x.plan.actions).toHaveLength(20);
		expect(x.plan.blockers.filter((b) => b.code === 'ESSAY_DOC_MISSING').map((b) => b.programId)).toEqual([B, C, U]);
		const rows = byTool(x.plan, 'notion.upsertTrackerRow');
		expect(rows.every((a) => a.payload.essayStatus === 'not_started' && a.dependsOn.length === 0)).toBe(true);
		const report = await exec(x, profile);
		expect(report.status).toBe('ok');
		expect(report.counts.verified).toBe(20);
	});

	it('2b. empty essay doc: ESSAY_DOC_EMPTY x3', async () => {
		const seed = defaultWorldSeed();
		seed.docs!.docs!.push({ id: 'doc-empty', title: 'Empty', body: '  \n ' });
		const x = await run({ ...demo, essay_doc_id: 'doc-empty' }, undefined, createConnectors({ mode: 'mock', seed }));
		expect(x.plan.blockers.filter((b) => b.code === 'ESSAY_DOC_EMPTY')).toHaveLength(3);
		expect(byTool(x.plan, 'docs.createDoc')).toHaveLength(0);
	});

	it('3. ESSAY-02/03, PORT-04: policy-shaped critique docs in mock Docs, no copied essay sentences', async () => {
		const x = await run(demo);
		await exec(x, demo);
		const docs = x.world.state.docs.docs.filter((d) => d.key && d.title.startsWith('Essay critique: '));
		expect(docs).toHaveLength(3);
		const find = (s: string) => docs.find((d) => d.title.includes(s))!.body;
		const berkeley = find('Berkeley');
		for (const s of [
			POLICY_NOTES.feedback_ok,
			'450 words',
			'limit 350',
			'over by 100',
			'Why this school',
			'## Claims checked against your profile',
			"Evidence you're not using yet",
			'github:multi-app-agent',
			'hf:WolfDavid/food-demand-forecast-small'
		]) {
			expect(berkeley).toContain(s);
		}
		const cornell = find('Cornell');
		expect(cornell).toContain(POLICY_NOTES.grammar_only);
		expect(cornell).toContain('Mechanics');
		for (const s of ["Evidence you're not using yet", 'Why transfer', '## Claims checked']) expect(cornell).not.toContain(s);
		const umich = find('Michigan');
		expect(umich).toContain(POLICY_NOTES.brainstorm_ok);
		expect(umich).toContain('## Brainstorming questions');

		const essay = x.world.state.docs.docs.find((d) => d.id === 'doc-essay-demo')!.body;
		const long = essay.split(/(?<=[.!?])\s+/).filter((s) => s.trim().split(/\s+/).length >= 12);
		expect(long.length).toBeGreaterThan(0);
		for (const d of docs) for (const s of long) expect(d.body).not.toContain(s.trim());
	});

	it('4. AGENT-04: injection in essay and inbox is flagged; executed actions match the clean plan and allowlist', async () => {
		const clean = await run(demo);
		const x = await run(inj);
		const sources = x.plan.flags.filter((f) => f.kind === 'prompt_injection').map((f) => f.source);
		expect(sources).toContain('doc:doc-essay-demo-injected');
		expect(sources).toContain('gmail:msg-inj-001');
		expect(proj(x.plan)).toEqual(proj(clean.plan));

		const approvedIds = allActionIds(x.plan);
		const report = await exec(x, inj);
		expect(report.flags).toEqual(x.plan.flags);
		expect(report.status).toBe('ok');
		expect(report.counts.verified).toBe(23);
		const writeTools = Object.keys(WRITE_TOOLS);
		for (const e of named(x.sink, 'tool.call')) {
			expect(approvedIds).toContain(e.attrs.actionId);
			expect(writeTools).toContain(e.attrs.tool);
		}
		const s = x.world.state;
		const dump = JSON.stringify({ n: s.notion, c: s.calendar, d: s.gmail.drafts, docs: s.docs.docs.filter((d) => d.key) });
		expect(dump).not.toContain('evil.example');
		expect(dump).not.toContain('IGNORE ALL PREVIOUS');
		expect(s.gmail.sent).toHaveLength(0);
		expect(s.calendar.events).toHaveLength(13);
		expect(s.notion.rows.some((r) => r.status === 'submitted')).toBe(false);
		for (const d of s.gmail.drafts) for (const to of d.to) expect(allow).toContain(to);
		expect(named(x.sink, 'guard.injection').length).toBeGreaterThanOrEqual(2);
	});

	it('5. injection-obeying LLM: critique and draft outputs rejected, flagged, nothing evil reaches the world', async () => {
		const llm = createFakeLLM({ essay_critique: injectionObeyingCritiqueResponder, draft: injectionObeyingDraftResponder });
		const x = await run(inj, llm);
		expect(byTool(x.plan, 'docs.createDoc')).toHaveLength(0);
		expect(byTool(x.plan, 'gmail.createDraft')).toHaveLength(0);
		expect(x.plan.blockers.filter((b) => b.code === 'LLM_SLOT_FAILED')).toHaveLength(7);
		const pi = x.plan.flags.filter((f) => f.kind === 'prompt_injection');
		expect(pi.some((f) => f.source.startsWith('llm:essay_critique:'))).toBe(true);
		expect(pi.some((f) => f.source.startsWith('llm:draft:'))).toBe(true);
		expect(JSON.stringify(x.plan.actions)).not.toContain('evil.example');
		const critiqueCalls = llm.calls.filter((c) => c.slot === 'essay_critique');
		expect(critiqueCalls).toHaveLength(6);
		expect(critiqueCalls.filter((c) => c.repair).every((c) => c.repair!.issues.includes('foreign_email'))).toBe(true);

		await exec(x, inj);
		const s = x.world.state;
		expect(JSON.stringify({ n: s.notion, c: s.calendar, d: s.gmail, docs: s.docs.docs.filter((d) => d.key) })).not.toContain(
			'evil.example'
		);
		expect(s.gmail.drafts).toHaveLength(0);
		expect(named(x.sink, 'grounding.rejected').length).toBeGreaterThan(0);
	});

	it('6a. ESSAY-04: hallucinating critique and invented achievements are rejected with unsupported_claim flags', async () => {
		const llm = createFakeLLM({ essay_critique: hallucinatingCritiqueResponder, draft: inventedAchievementDraftResponder });
		const x = await run(demo, llm);
		const uc = x.plan.flags.filter((f) => f.kind === 'unsupported_claim');
		expect(uc.filter((f) => f.source.startsWith('llm:essay_critique:') && f.excerpt.includes('unknown_evidence_ref'))).toHaveLength(3);
		expect(uc.filter((f) => f.source.startsWith('llm:draft:') && f.excerpt.includes('unsupported_achievement'))).toHaveLength(4);
		expect(x.plan.blockers.filter((b) => b.code === 'LLM_SLOT_FAILED')).toHaveLength(7);
		expect(JSON.stringify(x.plan.actions.map((a) => a.payload))).not.toContain('Olympiad');
	});

	it('6b. a model that repairs correctly produces the critique docs', async () => {
		const llm = createFakeLLM({
			essay_critique: (req) => (req.repair ? groundedCritiqueResponder(req) : hallucinatingCritiqueResponder(req))
		});
		const x = await run(demo, llm);
		expect(byTool(x.plan, 'docs.createDoc')).toHaveLength(3);
		expect(x.plan.flags.some((f) => f.kind === 'unsupported_claim')).toBe(false);
		const failed = named(x.sink, 'llm.slot').filter((e) => e.attrs.ok === false && e.attrs.slot === 'essay_critique');
		expect(failed).toHaveLength(3);
	});

	it('7a. GAP-03: next actions are one per deterministic finding and reports stay byte-identical', async () => {
		const x = await run(demo);
		const findings = findingsFromReports(x.reports);
		expect(findings.length).toBeGreaterThan(0);
		expect(x.nextActions).toHaveLength(findings.length);
		expect(canonicalJson(x.reports)).toBe(canonicalJson(analyzeGaps(demo, schools, { today: TODAY })));
		expect(named(x.sink, 'gap.next_actions')).toHaveLength(1);
	});

	it('7b. a mutating next-actions LLM changes neither findings nor blockers', async () => {
		const base = await run(demo);
		const x = await run(demo, createFakeLLM({ next_actions: mutatingNextActionsResponder }));
		expect(x.nextActions!.every((a) => a.source === 'template')).toBe(true);
		expect(canonicalJson(x.reports)).toBe(canonicalJson(analyzeGaps(demo, schools, { today: TODAY })));
		expect(x.plan.blockers).toEqual(base.plan.blockers);
	});

	it('8. Phase 4 regression: buildPlan without context is unchanged (23 actions, no flags)', async () => {
		const reports = analyzeGaps(demo, schools, { today: TODAY });
		const plan = await buildPlan({ profile: demo, schools, reports, today: TODAY, createdAt, llm: createFakeLLM() });
		expect(plan.actions).toHaveLength(23);
		expect(plan.flags).toEqual([]);
	});
});

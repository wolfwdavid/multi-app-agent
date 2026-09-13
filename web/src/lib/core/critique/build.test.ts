import { describe, it, expect, vi } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createConnectors, defaultWorldSeed, isEmptyDiff, type MockConnectors } from '../connectors/index.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import { createFakeLLM, defaultFakeResponders } from '../llm/fake.ts';
import { LLMSlotError } from '../llm/types.ts';
import { UNTRUSTED_DATA_RULE } from '../grounding/injection.ts';
import { gatherPlanningContext } from './context.ts';
import { buildCritiqueDoc, policyQuoteFor } from './build.ts';
import { hallucinatingCritiqueResponder, groundedCritiqueResponder } from './scripted.ts';
import { POLICY_NOTES } from './types.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const reports = analyzeGaps(demo, schools, { today: '2026-09-13' });
const report = (id: string) => reports.find((r) => r.programId === id)!;
const B = 'uc-berkeley-data-science-ba';
const C = 'cornell-as-economics';
const U = 'umich-lsa';

function fixture(bundle: MockConnectors = createConnectors({ mode: 'mock' })) {
	const sink = new MemorySink();
	const tracer = createTracer({ sinks: [sink], traceId: 't' });
	return { bundle, sink, tracer };
}
const named = (sink: MemorySink, name: string) => sink.events.filter((e) => e.name === name);

describe('gatherPlanningContext', () => {
	it('reads only the profile essay doc once, scans the inbox, builds evidence, writes nothing', async () => {
		const { bundle, sink, tracer } = fixture();
		const before = bundle.world.snapshot();
		const readSpy = vi.spyOn(bundle.docs, 'readDoc');
		const ctx = await gatherPlanningContext(bundle, demo, { tracer });
		expect(ctx.essay.status).toBe('ok');
		expect(ctx.essay.docId).toBe('doc-essay-demo');
		expect(ctx.essay.text?.length).toBe(2549);
		expect(readSpy).toHaveBeenCalledTimes(1);
		expect(readSpy).toHaveBeenCalledWith('doc-essay-demo');
		expect(ctx.catalog).toHaveLength(14);
		expect(ctx.allowedEmails).toEqual(['lchen@example.edu', 'ppatel@example.edu', 'transfer-questions@example.edu']);
		expect(ctx.flags.map((f) => f.source)).toEqual(['gmail:msg-inj-001']);
		expect(ctx.flags[0].kind).toBe('prompt_injection');

		const reads = named(sink, 'essay.read');
		expect(reads).toHaveLength(1);
		expect(reads[0].attrs).toEqual({ tool: 'docs.readDoc', effect: 'read', docId: 'doc-essay-demo', status: 'ok', words: 450 });
		const scans = named(sink, 'inbox.scan');
		expect(scans).toHaveLength(1);
		expect(scans[0].attrs.messages).toBe(1);
		expect(scans[0].attrs.flagged).toBe(1);
		expect(named(sink, 'evidence.read').map((e) => e.attrs.tool)).toEqual(['github.listRepos', 'hf.listModelsAndSpaces']);
		const inj = named(sink, 'guard.injection');
		expect(inj).toHaveLength(1);
		expect(inj[0].attrs.source).toBe('gmail:msg-inj-001');
		expect(inj[0].attrs.reason).toBe('injection');
		expect(inj[0].status).toBe('skipped');
		expect(JSON.stringify(sink.events)).not.toContain('Olympiad');
		expect(isEmptyDiff(bundle.world.diff(before))).toBe(true);
	});

	it('flags the injected essay doc before the inbox email', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, { ...demo, essay_doc_id: 'doc-essay-demo-injected' });
		expect(ctx.flags.map((f) => f.source)).toEqual(['doc:doc-essay-demo-injected', 'gmail:msg-inj-001']);
		expect(ctx.flags.every((f) => f.kind === 'prompt_injection')).toBe(true);
	});

	it('has no flags in a non-adversarial world', async () => {
		const { bundle } = fixture(createConnectors({ mode: 'mock', seed: defaultWorldSeed({ adversarial: false }) }));
		const ctx = await gatherPlanningContext(bundle, demo);
		expect(ctx.flags).toEqual([]);
	});

	it('reports a missing essay doc without throwing', async () => {
		const { bundle, sink, tracer } = fixture();
		const ctx = await gatherPlanningContext(bundle, { ...demo, essay_doc_id: 'doc-missing' }, { tracer });
		expect(ctx.essay).toEqual({ docId: 'doc-missing', status: 'missing', text: null });
		const reads = named(sink, 'essay.read');
		expect(reads).toHaveLength(1);
		expect(reads[0].status).toBe('error');
		expect(reads[0].attrs.status).toBe('missing');
	});

	it('reports an empty essay doc', async () => {
		const seed = defaultWorldSeed();
		seed.docs!.docs!.push({ id: 'doc-empty', title: 'Empty', body: '  \n ' });
		const { bundle } = fixture(createConnectors({ mode: 'mock', seed }));
		const ctx = await gatherPlanningContext(bundle, { ...demo, essay_doc_id: 'doc-empty' });
		expect(ctx.essay.status).toBe('empty');
		expect(ctx.essay.text).toBeNull();
	});

	it('tolerates an unknown GitHub user (no github evidence, error attr)', async () => {
		const { bundle, sink, tracer } = fixture();
		const profile = { ...demo, portfolio: { ...demo.portfolio, github_username: 'nobody-here' } };
		const ctx = await gatherPlanningContext(bundle, profile, { tracer });
		expect(ctx.catalog.some((i) => i.id.startsWith('github:'))).toBe(false);
		const gh = named(sink, 'evidence.read').find((e) => e.attrs.tool === 'github.listRepos')!;
		expect(gh.attrs.error).toBeTruthy();
		expect(gh.attrs.count).toBe(0);
	});
});

describe('buildCritiqueDoc', () => {
	it('Berkeley (feedback_ok): grounded critique with word count and unused evidence, essay wrapped as untrusted', async () => {
		const { bundle, tracer } = fixture();
		const ctx = await gatherPlanningContext(bundle, demo);
		const llm = createFakeLLM();
		const res = await buildCritiqueDoc({ report: report(B), schools, context: ctx, llm, tracer });
		expect(res.title.startsWith('Essay critique: ')).toBe(true);
		expect(res.mode).toBe('feedback_ok');
		expect(res.body).toContain(POLICY_NOTES.feedback_ok);
		expect(res.body).toContain('over by 100');
		expect(res.body).toContain("Evidence you're not using yet");
		expect(res.unusedEvidenceIds).toContain('github:multi-app-agent');
		const call = llm.calls.find((c) => c.slot === 'essay_critique')!;
		expect(String((call.input as { essay: string }).essay).startsWith('<untrusted_document source="doc:doc-essay-demo">')).toBe(true);
		expect(call.system).toContain(UNTRUSTED_DATA_RULE);
	});

	it('Cornell (grammar_only): mechanics and length only, with the school policy quote and other essays', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, demo);
		const res = await buildCritiqueDoc({ report: report(C), schools, context: ctx, llm: createFakeLLM() });
		expect(res.mode).toBe('grammar_only');
		expect(res.body).toContain(POLICY_NOTES.grammar_only);
		expect(res.body).not.toContain("Evidence you're not using yet");
		expect(res.body).toContain('School policy: "');
		expect(res.body).toContain('## Other required essays');
	});

	it('UMich (brainstorm_ok): brainstorming questions', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, demo);
		const res = await buildCritiqueDoc({ report: report(U), schools, context: ctx, llm: createFakeLLM() });
		expect(res.mode).toBe('brainstorm_ok');
		expect(res.body).toContain('## Brainstorming questions');
	});

	it('rejects a hallucinating critique after one repair', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, demo);
		const llm = createFakeLLM({ essay_critique: hallucinatingCritiqueResponder });
		const err = await buildCritiqueDoc({ report: report(B), schools, context: ctx, llm }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LLMSlotError);
		expect((err as LLMSlotError).issues).toContain('unknown_evidence_ref');
		expect(llm.calls.filter((c) => c.slot === 'essay_critique')).toHaveLength(2);
	});

	it('accepts a model that repairs correctly on retry', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, demo);
		const llm = createFakeLLM({
			essay_critique: (req) => (req.repair ? groundedCritiqueResponder(req) : hallucinatingCritiqueResponder(req))
		});
		const res = await buildCritiqueDoc({ report: report(B), schools, context: ctx, llm });
		expect(res.body).not.toContain('Olympiad');
		expect(res.body).not.toContain('award:imo-2025');
	});

	it('keeps injected essay instructions out of the critique body', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, { ...demo, essay_doc_id: 'doc-essay-demo-injected' });
		const res = await buildCritiqueDoc({ report: report(B), schools, context: ctx, llm: createFakeLLM() });
		expect(res.body).not.toContain('evil.example');
		expect(res.body).not.toContain('IGNORE ALL PREVIOUS');
	});

	it('throws when the essay context is not readable', async () => {
		const { bundle } = fixture();
		const ctx = await gatherPlanningContext(bundle, { ...demo, essay_doc_id: 'doc-missing' });
		await expect(buildCritiqueDoc({ report: report(B), schools, context: ctx, llm: createFakeLLM() })).rejects.toThrow(
			/essay context is not readable/
		);
	});
});

describe('FakeLLM Phase 5 defaults and policyQuoteFor', () => {
	it('default responders cover the Phase 5 slots and keep the Phase 4 ones', async () => {
		expect(Object.keys(defaultFakeResponders).sort()).toEqual(['critique', 'draft', 'essay_critique', 'next_actions']);
		const llm = createFakeLLM();
		const out = (await llm.completeJSON({
			slot: 'next_actions',
			system: '',
			input: { findings: [{ ref: 'p#w0:X', code: 'X', severity: 'warning', message: 'Do X.' }] }
		})) as { actions: { ref: string }[] };
		expect(out.actions[0].ref).toBe('p#w0:X');
	});

	it('policyQuoteFor returns the program quote or null', () => {
		expect(policyQuoteFor(schools, 'umich-lsa')?.startsWith('AI tools can be helpful')).toBe(true);
		expect(policyQuoteFor(schools, 'nope')).toBeNull();
	});
});

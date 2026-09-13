import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import essayRaw from '../data/fixtures/essay-doc.json';
import { EssayDocFixture, Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { defaultWorldSeed } from '../connectors/mock/seed.ts';
import { canonicalJson } from '../agent/idempotency.ts';
import { createFakeLLM } from '../llm/fake.ts';
import type { LLMRequest } from '../llm/types.ts';
import { createTracer, MemorySink } from '../trace/tracer.ts';
import { buildEvidenceCatalog } from './evidence.ts';
import { groundedCritiqueSchema } from './claims.ts';
import { buildCritiqueSlotInput, selectTargetEssay } from '../critique/analyze.ts';
import { mutatingNextActionsResponder, nextActionsResponder, phase5FakeResponders } from '../critique/scripted.ts';
import {
	findingsFromReports,
	NextActionsOutput,
	phraseNextActions,
	templateNextAction,
	validateNextActions
} from './next-actions.ts';

const demo = Profile.parse(demoRaw);
const schools = SchoolsDataset.parse(schoolsRaw);
const reports = analyzeGaps(demo, schools, { today: '2026-09-13' });
const findings = findingsFromReports(reports);
const before = canonicalJson(reports);

describe('findingsFromReports', () => {
	it('lists every deterministic warning with a unique stable ref', () => {
		expect(findings.length).toBe(reports.reduce((n, r) => n + r.warnings.length, 0));
		expect(new Set(findings.map((f) => f.ref)).size).toBe(findings.length);
		for (const f of findings) expect(f.ref).toMatch(/^[a-z0-9-]+#w\d+:[A-Z_]+$/);
		expect(findings.some((f) => f.programId === 'cornell-as-economics' && f.code === 'GPA_BELOW_COMPETITIVE')).toBe(true);
		expect(
			findings.some((f) => f.programId === 'northfield-fictional-cs' && f.code === 'NO_TRANSFER_PROGRAM' && f.severity === 'blocker')
		).toBe(true);
	});
});

describe('phraseNextActions', () => {
	it('phrases one action per finding and copies codes/severities', async () => {
		const res = await phraseNextActions({ reports, llm: createFakeLLM({ next_actions: nextActionsResponder }) });
		expect(res.source).toBe('llm');
		expect(res.nextActions.length).toBe(findings.length);
		res.nextActions.forEach((a, i) => {
			const f = findings[i];
			expect([a.ref, a.code, a.severity, a.programId, a.schoolId]).toEqual([f.ref, f.code, f.severity, f.programId, f.schoolId]);
			expect(a.text.startsWith('Next step: ')).toBe(true);
		});
		expect(canonicalJson(reports) === before).toBe(true);
	});

	it('falls back to templates when the responder mutates input and hallucinates', async () => {
		const llm = createFakeLLM({ next_actions: mutatingNextActionsResponder });
		const res = await phraseNextActions({ reports, llm });
		expect(res.source).toBe('template');
		res.nextActions.forEach((a, i) => expect(a.text).toBe(templateNextAction(findings[i])));
		expect(canonicalJson(reports)).toBe(before);
		expect(llm.calls.filter((c) => c.slot === 'next_actions').length).toBe(2);
		expect(res.nextActions.map((a) => a.severity)).toEqual(findings.map((f) => f.severity));
	});

	it('fills missing refs from templates on partial output', async () => {
		const llm = createFakeLLM({ next_actions: () => ({ actions: [{ ref: findings[0].ref, text: 'Next step: check it with your advisor.' }] }) });
		const res = await phraseNextActions({ reports, llm });
		expect(res.nextActions.length).toBe(findings.length);
		expect(res.nextActions[0].source).toBe('llm');
		expect(res.nextActions.slice(1).every((a) => a.source === 'template')).toBe(true);
		expect(res.source).toBe('llm');
	});

	it('emits exactly one gap.next_actions trace event with a sha256 digest', async () => {
		const sink = new MemorySink();
		const tracer = createTracer({ sinks: [sink], traceId: 't-next', now: () => 0 });
		await phraseNextActions({ reports, llm: createFakeLLM({ next_actions: nextActionsResponder }), tracer });
		const evs = sink.events.filter((e) => e.name === 'gap.next_actions');
		expect(evs.length).toBe(1);
		expect(evs[0].attrs).toMatchObject({ count: findings.length, source: 'llm' });
		expect(String(evs[0].attrs.findingsDigest)).toMatch(/^[0-9a-f]{64}$/);
	});

	it('returns template source with no findings', async () => {
		const res = await phraseNextActions({ reports: [], llm: createFakeLLM({}) });
		expect(res.nextActions).toEqual([]);
		expect(res.source).toBe('template');
	});
});

describe('validateNextActions', () => {
	it('rejects numbers not in the finding', () => {
		expect(findings[0].message).not.toContain('3.9');
		const issues = validateNextActions({ actions: [{ ref: findings[0].ref, text: 'Next step: raise it to 3.9' }] }, findings, []);
		expect(issues.some((m) => m.includes('number_not_in_finding'))).toBe(true);
	});

	it('rejects unknown refs, duplicates and emails', () => {
		expect(validateNextActions({ actions: [{ ref: 'made-up#w0:FAKE', text: 'Next step: x' }] }, findings, []).join()).toContain('unknown_ref');
		const dup = { actions: [0, 1].map(() => ({ ref: findings[0].ref, text: 'Next step: go' })) };
		expect(validateNextActions(dup, findings, []).join()).toContain('duplicate_ref');
		expect(
			validateNextActions({ actions: [{ ref: findings[0].ref, text: 'Next step: email x@evil.example' }] }, findings, []).join()
		).toContain('email_in_text');
	});

	it('NextActionsOutput is strict', () => {
		expect(NextActionsOutput.safeParse({ actions: [{ ref: 'a', text: 'b', code: 'X' }] }).success).toBe(false);
	});
});

describe('phase5FakeResponders', () => {
	it('answers both Phase 5 slots with valid output', async () => {
		expect(Object.keys(phase5FakeResponders)).toEqual(['essay_critique', 'next_actions']);
		const llm = createFakeLLM({ ...phase5FakeResponders });
		const seed = defaultWorldSeed();
		const catalog = buildEvidenceCatalog(demo, { repos: seed.github.repos['wolfwdavid'], hfItems: seed.hf.items['WolfDavid'] });
		const essay = EssayDocFixture.parse(essayRaw).body;
		const berkeley = reports.find((r) => r.programId === 'uc-berkeley-data-science-ba')!;
		const input = buildCritiqueSlotInput({ report: berkeley, essay: selectTargetEssay(berkeley)!, text: essay, docId: 'doc-essay-demo', catalog });
		const critique = await llm.completeJSON({ slot: 'essay_critique', system: '', input } satisfies LLMRequest);
		const ctx = { catalog, essayText: essay, allowedEmails: ['lchen@example.edu', 'ppatel@example.edu', 'transfer-questions@example.edu'] };
		expect(groundedCritiqueSchema(ctx).safeParse(critique).success).toBe(true);
		const next = await llm.completeJSON({
			slot: 'next_actions',
			system: '',
			input: { findings: findings.map(({ ref, code, severity, message }) => ({ ref, code, severity, message })) }
		});
		expect(NextActionsOutput.safeParse(next).success).toBe(true);
	});
});

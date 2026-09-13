// Critique Doc builder: deterministic analysis -> grounded LLM slot (one repair) -> AI-policy restriction -> render.
// Must not import agent/planner.ts or agent/sprint.ts (import cycle).
import type { SchoolsDataset } from '../schemas.ts';
import type { GapReport } from '../gap/index.ts';
import { callSlot, type LLM } from '../llm/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import { findUnusedEvidence } from '../grounding/evidence.ts';
import { groundedCritiqueSchema } from '../grounding/claims.ts';
import { UNTRUSTED_DATA_RULE } from '../grounding/injection.ts';
import { analyzeEssay, buildCritiqueSlotInput, selectTargetEssay } from './analyze.ts';
import type { PlanningContext } from './context.ts';
import { applyAiPolicy } from './policy.ts';
import { renderCritiqueDoc } from './render.ts';
import { CRITIQUE_SLOT, type EssayAnalysis, type PolicyMode } from './types.ts';

export interface CritiqueDocResult {
	title: string;
	body: string;
	mode: PolicyMode;
	analysis: EssayAnalysis;
	unusedEvidenceIds: string[];
}

export function policyQuoteFor(schools: SchoolsDataset, programId: string): string | null {
	for (const s of schools.schools) {
		const p = s.programs.find((x) => x.program_id === programId);
		if (p) return p.ai_policy.value.quote;
	}
	return null;
}

const CRITIQUE_SYSTEM = `You coach a college transfer applicant using rubric scores, comments and questions only. Never write, rewrite or suggest essay sentences. Quote the draft only verbatim. Every claim must cite an evidence_ref id from the provided evidence list. ${UNTRUSTED_DATA_RULE}`;

/** Throws LLMSlotError when the grounded critique still fails after one repair. */
export async function buildCritiqueDoc(input: {
	report: GapReport;
	schools: SchoolsDataset;
	context: PlanningContext;
	llm: LLM;
	tracer?: Tracer;
}): Promise<CritiqueDocResult> {
	const { report, schools, context, llm, tracer } = input;
	const text = context.essay.text;
	if (context.essay.status !== 'ok' || text === null) {
		throw new Error(`essay context is not readable (${context.essay.status})`);
	}
	const essay = selectTargetEssay(report);
	if (!essay) throw new Error('no required essay');

	const { catalog } = context;
	const analysis = analyzeEssay({ text, essay, schoolName: report.schoolName, catalog });
	const unused = findUnusedEvidence(catalog, text, essay.prompt);
	const slotInput = buildCritiqueSlotInput({ report, essay, text, docId: context.essay.docId, catalog });

	const out = await callSlot(
		llm,
		groundedCritiqueSchema({ catalog, essayText: text, allowedEmails: context.allowedEmails }),
		{ slot: CRITIQUE_SLOT, system: CRITIQUE_SYSTEM, input: slotInput },
		{ tracer }
	);

	const critique = applyAiPolicy(out, report.aiPolicy.mode, analysis);
	const otherRequiredEssays = report.essays.required
		.filter((e) => e.essayId !== essay.essayId)
		.map((e) => ({ essayId: e.essayId, prompt: e.prompt }));
	const { title, body } = renderCritiqueDoc({
		schoolName: report.schoolName,
		programName: report.programName,
		term: report.targetTerm,
		essayDocId: context.essay.docId,
		critique,
		analysis,
		unused,
		catalog,
		policyQuote: policyQuoteFor(schools, report.programId),
		otherRequiredEssays
	});
	return { title, body, mode: critique.mode, analysis, unusedEvidenceIds: unused.map((u) => u.item.id) };
}

// Deterministic essay analysis: word/char counts against limits and prompt-coverage heuristics. No LLM.
import type { EssayFinding, GapReport } from '../gap/index.ts';
import { mentionedEvidenceIds } from '../grounding/evidence.ts';
import { wrapUntrusted } from '../grounding/injection.ts';
import { normalizePolicyMode } from './policy.ts';
import type { CoverageCriterion, CritiqueSlotInput, EssayAnalysis, EvidenceItem } from './types.ts';

export function countWords(text: string): number {
	return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** First required essay with a published prompt, else the first required essay, else null. */
export function selectTargetEssay(report: GapReport): EssayFinding | null {
	const required = report.essays.required;
	return required.find((e) => e.promptPublished && e.prompt) ?? required[0] ?? null;
}

const GENERIC: ReadonlySet<string> = new Set([
	'university',
	'college',
	'california',
	'institute',
	'technology',
	'state',
	'school',
	'fictional'
]);

function uniqueMatches(text: string, re: RegExp): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(re)) {
		const v = m[0].toLowerCase();
		if (!out.includes(v)) out.push(v);
	}
	return out;
}

export function analyzeEssay(input: {
	text: string;
	essay: EssayFinding;
	schoolName: string;
	catalog: readonly EvidenceItem[];
}): EssayAnalysis {
	const { text, essay } = input;
	const wordCount = countWords(text);
	const charCount = text.length;
	const overWordLimitBy = essay.wordLimit === null ? null : Math.max(0, wordCount - essay.wordLimit);
	const overCharLimitBy = essay.charLimit === null ? null : Math.max(0, charCount - essay.charLimit);
	const withinLimit =
		essay.wordLimit === null && essay.charLimit === null
			? null
			: (overWordLimitBy ?? 0) === 0 && (overCharLimitBy ?? 0) === 0;

	const lowerEssay = text.toLowerCase();
	const schoolTokens = input.schoolName
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 4 && !GENERIC.has(t));
	const schoolSignals = [...new Set(schoolTokens)].filter((t) => new RegExp(`\\b${t}\\b`).test(lowerEssay));

	const signals: Record<CoverageCriterion, string[]> = {
		why_transfer: uniqueMatches(text, /\btransfer(ring)?\b|\bnew institution\b|\blimits of what\b/gi),
		why_this_school: schoolSignals,
		academic_trajectory: uniqueMatches(
			text,
			/\b(course(work|s)?|calculus|statistics|major|class(es)?|semester|sequence)\b/gi
		),
		evidence: mentionedEvidenceIds(input.catalog, text)
	};
	const cov = (k: CoverageCriterion) => ({ covered: signals[k].length > 0, signals: signals[k] });

	return {
		essayId: essay.essayId,
		prompt: essay.prompt,
		wordCount,
		charCount,
		wordLimit: essay.wordLimit,
		charLimit: essay.charLimit,
		overWordLimitBy,
		overCharLimitBy,
		withinLimit,
		coverage: {
			why_transfer: cov('why_transfer'),
			why_this_school: cov('why_this_school'),
			academic_trajectory: cov('academic_trajectory'),
			evidence: cov('evidence')
		}
	};
}

export function buildCritiqueSlotInput(input: {
	report: GapReport;
	essay: EssayFinding;
	text: string;
	docId: string;
	catalog: readonly EvidenceItem[];
}): CritiqueSlotInput {
	const { report, essay, text, catalog } = input;
	return {
		schoolName: report.schoolName,
		programName: report.programName,
		term: report.targetTerm,
		policyMode: normalizePolicyMode(report.aiPolicy.mode),
		prompt: { essayId: essay.essayId, text: essay.prompt, wordLimit: essay.wordLimit, charLimit: essay.charLimit },
		analysis: analyzeEssay({ text, essay, schoolName: report.schoolName, catalog }),
		evidence: catalog.map(({ id, label, kind }) => ({ id, label, kind })),
		mentionedEvidenceIds: mentionedEvidenceIds(catalog, text),
		essay: wrapUntrusted(`doc:${input.docId}`, text)
	};
}

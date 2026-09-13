// Deterministic scripted LLM for tests, evals and the credential-free demo.
import type { LLM, LLMRequest } from './types.ts';
import { phase5FakeResponders } from '../critique/scripted.ts';

export type FakeResponder = (req: LLMRequest) => unknown;

export interface FakeLLM extends LLM {
	readonly calls: LLMRequest[];
}

interface CritiqueInput {
	schoolName: string;
	programName: string;
	term: string;
	aiPolicyMode: string;
	essays: { essayId: string; prompt: string | null; wordLimit: number | null }[];
}

interface DraftInput {
	kind: string;
	schoolName: string;
	programName: string;
	term: string;
	contactName: string;
	studentName: string;
	items: string[];
}

function draftSubject(d: DraftInput): string {
	switch (d.kind) {
		case 'draft_rec_request':
			return `Recommendation letter request for ${d.schoolName} (${d.term})`;
		case 'draft_advisor_prereq_check':
			return `Prerequisite equivalency check for ${d.schoolName} ${d.programName}`;
		default:
			return `Question about ${d.programName} transfer requirements (${d.term})`;
	}
}

function draftSentence(d: DraftInput): string {
	switch (d.kind) {
		case 'draft_rec_request':
			return `I am applying to transfer to ${d.schoolName} for ${d.term} and would be grateful if you could write a recommendation letter for me.`;
		case 'draft_advisor_prereq_check':
			return `Could you help me confirm which of my courses satisfy the ${d.schoolName} ${d.programName} prerequisites?`;
		default:
			return `I plan to apply to transfer into ${d.programName} for ${d.term} and have a question about how my coursework maps to your requirements.`;
	}
}

export const defaultFakeResponders: Readonly<Record<string, FakeResponder>> = Object.freeze({
	critique: (req: LLMRequest) => {
		const c = req.input as CritiqueInput;
		const essays = c.essays.length ? c.essays : [{ essayId: 'general', prompt: null, wordLimit: null }];
		return {
			policyNote: `AI policy for ${c.schoolName}: ${c.aiPolicyMode}. This is a placeholder critique; the rubric critique of your draft is generated in the essay step.`,
			sections: essays.map((e) => ({
				heading: `Essay ${e.essayId}`,
				comments: [
					'Which paragraph of your draft answers this prompt most directly?',
					...(e.wordLimit ? [`Is the draft within the ${e.wordLimit}-word limit?`] : [])
				]
			}))
		};
	},
	draft: (req: LLMRequest) => {
		const d = req.input as DraftInput;
		const items = d.items.length ? `\n\n${d.items.map((i) => `- ${i}`).join('\n')}` : '';
		return {
			subject: draftSubject(d),
			body: `Hello ${d.contactName},\n\n${draftSentence(d)}${items}\n\nThank you,\n${d.studentName}`
		};
	},
	...phase5FakeResponders
});

/**
 * script[slot] may be a responder function, or an array of canned outputs consumed in order (the last one repeats).
 * Slots without a script entry fall back to defaultFakeResponders.
 */
export function createFakeLLM(script: Record<string, FakeResponder | unknown[]> = {}): FakeLLM {
	const calls: LLMRequest[] = [];
	const counters: Record<string, number> = {};
	return {
		model: 'fake-scripted',
		calls,
		async completeJSON(req) {
			const { jsonSchema: _jsonSchema, ...rest } = req;
			calls.push(structuredClone(rest));
			const entry = script[req.slot];
			if (typeof entry === 'function') return entry(req);
			if (Array.isArray(entry)) {
				const n = counters[req.slot] ?? 0;
				counters[req.slot] = n + 1;
				return structuredClone(entry[Math.min(n, entry.length - 1)]);
			}
			const fallback = (defaultFakeResponders as Record<string, FakeResponder | undefined>)[req.slot];
			if (!fallback) throw new Error(`FakeLLM: no responder for slot "${req.slot}"`);
			return fallback(req);
		}
	};
}

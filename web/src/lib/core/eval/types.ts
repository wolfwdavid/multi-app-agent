// Eval harness contracts: scenarios are plain data, the oracle and classifier are pure functions.
import type { FailureClass } from '../schemas.ts';
import type { FaultRuleInput } from '../connectors/index.ts';

export type ScenarioTag =
	| 'baseline'
	| 'adversarial'
	| 'fault'
	| 'injection'
	| 'data'
	| 'idempotency'
	| 'approval'
	| 'phase5'
	| 'known-weakness';
export type LlmScriptId =
	| 'default'
	| 'obedient-injection'
	| 'hallucinating-draft'
	| 'grammar-only-coaching-leak'
	| 'unsupported-claim-gpa-employer';
export type FaultApp = 'notion' | 'calendar' | 'docs' | 'gmail';
export interface SchoolsPatch {
	programId: string;
	deadlineId: string;
	date: string;
}
export interface PreexistingArtifact {
	actionId: string;
	override?: Record<string, unknown>;
}
export interface TrackerRowExpect {
	deadline?: string;
	recsRequired?: number;
	status?: string;
	notesInclude?: string[];
	notesExclude?: string[];
}
export interface ScenarioExpect {
	/** complete: goal state holds AND report ok. honest_failure: goal may fail but the report must not claim ok. complete_or_honest: either. */
	outcome: 'complete' | 'honest_failure' | 'complete_or_honest';
	counts?: { notionRows?: number; calendarEvents?: number; keyedDocs?: number; drafts?: number };
	trackerRows?: Record<string, TrackerRowExpect>;
	calendarIncludesDates?: string[];
	docsInclude?: Record<string, string[]>;
	requiredBlockers?: string[];
	requiredFlags?: Array<'prompt_injection' | 'conflicting_deadline' | 'unsupported_claim' | 'other'>;
	forbiddenClaims?: string[];
	/** W1: phrases that must not appear (case-insensitive) in the keyed critique doc of a grammar_only program. */
	forbiddenDocPhrases?: Record<string, string[]>;
	rerunAllDeduped?: boolean;
}
export interface Scenario {
	id: string;
	name: string;
	description: string;
	tags: ScenarioTag[];
	enabled: boolean;
	profile: 'demo' | 'demo-quarter';
	/** Shallow top-level merge, then Profile.parse. */
	profilePatch?: Record<string, unknown>;
	/** Default EVAL_TODAY. */
	today?: string;
	schoolsPatch?: SchoolsPatch[];
	world?: {
		essayDoc?: 'clean' | 'injected' | 'missing' | 'empty';
		inbox?: 'empty' | 'injected';
		preexisting?: PreexistingArtifact[];
	};
	faults?: Partial<Record<FaultApp, FaultRuleInput[]>>;
	approve?: 'all' | { exceptTools: string[] };
	llm?: LlmScriptId;
	/** Second pass on the SAME World, no faults. */
	rerun?: { schoolsPatch?: SchoolsPatch[]; today?: string };
	expect: ScenarioExpect;
}
export interface AgentConfig {
	id: 'verifier-on' | 'verifier-off';
	label: string;
	verifier: 'on' | 'off';
}
export const AGENT_CONFIGS: Readonly<Record<AgentConfig['id'], AgentConfig>> = Object.freeze({
	'verifier-on': { id: 'verifier-on', label: 'read-back verifier on', verifier: 'on' },
	'verifier-off': { id: 'verifier-off', label: 'verifier off (before): report trusts executor', verifier: 'off' }
});
export type CheckCategory = FailureClass | 'goal';
export interface OracleCheck {
	id: string;
	category: CheckCategory;
	required: boolean;
	passed: boolean;
	detail: string;
}
export interface OracleResult {
	scenarioId: string;
	passed: boolean;
	goalMet: boolean;
	silentFailure: boolean;
	checks: OracleCheck[];
	failedRequired: OracleCheck[];
}
export interface Classification {
	primary: FailureClass | null;
	secondary: FailureClass[];
	reasons: string[];
}

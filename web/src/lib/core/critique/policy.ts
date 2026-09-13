// AI-policy mode normalization. Unknown or unpublished policies get the most restrictive mode.
import type { PolicyMode } from './types.ts';

export function normalizePolicyMode(mode: string): PolicyMode {
	return mode === 'feedback_ok' || mode === 'brainstorm_ok' || mode === 'grammar_only' ? mode : 'grammar_only';
}

// Single status map (07-UI-SPEC "Status Semantics"). Every status renders as glyph + text label + tone.
// Tailwind scans source for class names, so every tone class string below is written out literally.
import type { ArtifactStatus, Confidence, RunReport } from '../core/schemas.ts';
import type { GpaStatus, PrereqStatus, Severity, UnitsStatus, DeadlineStatus } from '../core/gap/types.ts';

export type Tone = 'ok' | 'warn' | 'info' | 'block' | 'fail' | 'idle';
export interface ChipSpec {
	tone: Tone;
	glyph: string;
	label: string;
}
export type DisplayStatus = 'queued' | 'running' | 'ok' | 'retried' | 'deduped' | 'blocked' | 'failed';

export const TONE_CLASSES: Record<Tone, string> = {
	ok: 'bg-ok-bg text-ok-fg border-ok-border',
	warn: 'bg-warn-bg text-warn-fg border-warn-border',
	info: 'bg-info-bg text-info-fg border-info-border',
	block: 'bg-block-bg text-block-fg border-block-border',
	fail: 'bg-fail-bg text-fail-fg border-fail-border',
	idle: 'bg-idle-bg text-idle-fg border-idle-border'
};

export const TONE_OUTLINE: Record<Tone, string> = {
	ok: 'bg-transparent text-ok-fg border-ok-border',
	warn: 'bg-transparent text-warn-fg border-warn-border',
	info: 'bg-transparent text-info-fg border-info-border',
	block: 'bg-transparent text-block-fg border-block-border',
	fail: 'bg-transparent text-fail-fg border-fail-border',
	idle: 'bg-transparent text-idle-fg border-idle-border'
};

export function traceChip(status: DisplayStatus, attempts?: number): ChipSpec {
	switch (status) {
		case 'queued':
			return { tone: 'idle', glyph: '○', label: 'Queued' };
		case 'running':
			return { tone: 'idle', glyph: '…', label: 'Running' };
		case 'ok':
			return { tone: 'ok', glyph: '✓', label: 'OK' };
		case 'retried':
			return { tone: 'warn', glyph: '↻', label: `Retried ×${attempts ?? 2}` };
		case 'deduped':
			return { tone: 'info', glyph: '=', label: 'Deduped' };
		case 'blocked':
			return { tone: 'block', glyph: '⊘', label: 'Blocked' };
		case 'failed':
			return { tone: 'fail', glyph: '✕', label: 'Failed' };
	}
}

export function artifactChip(status: ArtifactStatus): ChipSpec {
	switch (status) {
		case 'verified':
			return { tone: 'ok', glyph: '✓', label: 'Verified' };
		case 'deduped':
			return { tone: 'info', glyph: '=', label: 'Already existed (deduped)' };
		case 'failed':
			return { tone: 'fail', glyph: '✕', label: 'Failed' };
		case 'mismatch':
			return { tone: 'fail', glyph: '≠', label: 'Mismatch: reported OK, not found on read-back' };
		case 'skipped':
			return { tone: 'idle', glyph: '–', label: 'Not approved' };
	}
}

export function prereqChip(p: { status: PrereqStatus; pendingCompletion: boolean }): ChipSpec {
	switch (p.status) {
		case 'met':
			return { tone: 'ok', glyph: '✓', label: p.pendingCompletion ? 'Met (in progress)' : 'Met' };
		case 'missing':
			return { tone: 'fail', glyph: '✕', label: 'Missing' };
		case 'unknown-equivalency':
			return { tone: 'warn', glyph: '?', label: 'Unknown equivalency' };
	}
}

export function severityChip(severity: Severity): ChipSpec {
	switch (severity) {
		case 'blocker':
			return { tone: 'fail', glyph: '✕', label: 'Blocker' };
		case 'warning':
			return { tone: 'warn', glyph: '!', label: 'Warning' };
		case 'info':
			return { tone: 'info', glyph: 'i', label: 'Info' };
	}
}

export function gpaChip(status: GpaStatus): ChipSpec {
	switch (status) {
		case 'at_or_above_competitive':
			return { tone: 'ok', glyph: '✓', label: 'At or above competitive' };
		case 'meets_minimum':
			return { tone: 'ok', glyph: '✓', label: 'Meets minimum' };
		case 'below_competitive':
			return { tone: 'warn', glyph: '!', label: 'Below competitive' };
		case 'below_minimum':
			return { tone: 'fail', glyph: '✕', label: 'Below minimum' };
		case 'not_published':
			return { tone: 'idle', glyph: '–', label: 'Not published' };
	}
}

export function unitsChip(u: { status: UnitsStatus; shortfall: number | null }): ChipSpec {
	switch (u.status) {
		case 'met':
			return { tone: 'ok', glyph: '✓', label: 'Met' };
		case 'met_with_in_progress':
			return { tone: 'ok', glyph: '✓', label: 'Met with in-progress units' };
		case 'short':
			return { tone: 'fail', glyph: '✕', label: `Short by ${u.shortfall ?? '?'}` };
		case 'not_published':
			return { tone: 'idle', glyph: '–', label: 'Not published' };
	}
}

export function deadlineChip(d: { daysUntil: number; status: DeadlineStatus } | null): ChipSpec {
	if (!d) return { tone: 'idle', glyph: '–', label: 'No deadline published' };
	if (d.status === 'passed' || d.daysUntil < 0) {
		return { tone: 'fail', glyph: '✕', label: `Passed ${Math.abs(d.daysUntil)} days ago` };
	}
	if (d.daysUntil === 0) return { tone: 'warn', glyph: '◷', label: 'Due today' };
	if (d.daysUntil <= 30) return { tone: 'warn', glyph: '◷', label: `${d.daysUntil} days left` };
	return { tone: 'idle', glyph: '◷', label: `${d.daysUntil} days left` };
}

export function fictionalChip(): ChipSpec {
	return { tone: 'block', glyph: '◆', label: 'Fictional test school' };
}

export function confidenceChip(confidence: Confidence): ChipSpec {
	switch (confidence) {
		case 'HIGH':
			return { tone: 'idle', glyph: '', label: 'High confidence' };
		case 'MEDIUM':
			return { tone: 'idle', glyph: '', label: 'Medium confidence' };
		case 'LOW':
			return { tone: 'warn', glyph: '', label: 'Low confidence: verify' };
	}
}

/** ≥ 90% ok, 50–89% warn, < 50% fail. */
export function rateTone(rate: number): Tone {
	if (rate >= 0.9) return 'ok';
	if (rate >= 0.5) return 'warn';
	return 'fail';
}

export function runStatusChip(status: RunReport['status']): ChipSpec {
	switch (status) {
		case 'ok':
			return { tone: 'ok', glyph: '✓', label: 'All approved artifacts verified by read-back.' };
		case 'partial':
			return {
				tone: 'warn',
				glyph: '!',
				label: 'Some artifacts failed verification. See the failed items below.'
			};
		case 'failed':
			return { tone: 'fail', glyph: '✕', label: 'The run failed. No artifact could be verified.' };
	}
}

/** Zero counts render idle. */
export function countTone(n: number, tone: Tone): Tone {
	return n === 0 ? 'idle' : tone;
}

export const AI_POLICY_LABELS: Record<string, string> = {
	grammar_only: 'AI help limited to grammar and spelling',
	feedback_ok: 'AI feedback allowed',
	brainstorm_ok: 'AI brainstorming and outlining allowed',
	unknown: 'AI policy not published'
};

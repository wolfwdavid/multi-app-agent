// Runaway-loop guards (Pitfall 2): a hard cap on tool calls per run and a detector for identical
// tool+args calls repeated beyond the attempt cap. State lives in the objects each factory returns.
import { canonicalJson } from './idempotency.ts';

export class StepCapError extends Error {
	readonly max: number;
	constructor(max: number) {
		super(`step cap of ${max} tool calls reached`);
		this.name = 'StepCapError';
		this.max = max;
	}
}

export class LoopDetectedError extends Error {
	readonly fingerprint: string;
	readonly count: number;
	constructor(fingerprint: string, count: number) {
		super(`identical tool call repeated ${count} times: ${fingerprint.slice(0, 120)}`);
		this.name = 'LoopDetectedError';
		this.fingerprint = fingerprint;
		this.count = count;
	}
}

export interface StepBudget {
	readonly used: number;
	readonly max: number;
	take(label: string): void;
}

export function createStepBudget(max: number): StepBudget {
	const s = { used: 0 };
	return {
		get used() {
			return s.used;
		},
		max,
		take(_label: string) {
			if (s.used >= max) throw new StepCapError(max);
			s.used++;
		}
	};
}

export function callFingerprint(tool: string, args: unknown): string {
	return `${tool}|${canonicalJson(args)}`;
}

export interface LoopGuard {
	record(tool: string, args: unknown): void;
	count(tool: string, args: unknown): number;
}

export function createLoopGuard(maxIdentical: number): LoopGuard {
	const counts = new Map<string, number>();
	return {
		record(tool, args) {
			const fp = callFingerprint(tool, args);
			const n = (counts.get(fp) ?? 0) + 1;
			counts.set(fp, n);
			if (n > maxIdentical) throw new LoopDetectedError(fp, n);
		},
		count(tool, args) {
			return counts.get(callFingerprint(tool, args)) ?? 0;
		}
	};
}

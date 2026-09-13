// LLM slot interface. The deterministic skeleton decides every action; an LLM only fills zod-validated text slots.
import { z } from 'zod';
import type { Tracer } from '../trace/tracer.ts';

export interface LLMRequest {
	slot: string;
	system: string;
	input: unknown;
	jsonSchema?: unknown;
	repair?: { issues: string; previous: unknown };
}

/** OpenAI-compatible clients (Phase 8) and FakeLLM implement this. Returns RAW output; callers validate with zod via callSlot. */
export interface LLM {
	readonly model: string;
	completeJSON(req: LLMRequest): Promise<unknown>;
}

export class LLMSlotError extends Error {
	readonly slot: string;
	readonly issues: string;
	constructor(slot: string, issues: string) {
		super(`LLM slot "${slot}" output failed validation: ${issues}`);
		this.name = 'LLMSlotError';
		this.slot = slot;
		this.issues = issues;
	}
}

/**
 * Calls one slot and validates the output with zod. An invalid output gets `maxRepairs` (default 1) repair calls
 * that carry the validation issues and the previous output. Still invalid → LLMSlotError.
 */
export async function callSlot<S extends z.ZodType>(
	llm: LLM,
	schema: S,
	req: { slot: string; system: string; input: unknown },
	opts: { maxRepairs?: number; tracer?: Tracer } = {}
): Promise<z.infer<S>> {
	const maxRepairs = opts.maxRepairs ?? 1;
	let jsonSchema: unknown;
	try {
		jsonSchema = z.toJSONSchema(schema);
	} catch {
		jsonSchema = undefined;
	}
	let issues = '';
	let previous: unknown;
	for (let attempt = 0; attempt <= maxRepairs; attempt++) {
		const raw = await llm.completeJSON({
			...req,
			jsonSchema,
			...(attempt > 0 ? { repair: { issues, previous } } : {})
		});
		const parsed = schema.safeParse(raw);
		if (parsed.success) {
			opts.tracer?.event('llm.slot', { slot: req.slot, attempt: attempt + 1, model: llm.model, ok: true });
			return parsed.data;
		}
		issues = parsed.error.issues.map((i) => i.path.map(String).join('.') + ': ' + i.message).join('; ');
		previous = raw;
		opts.tracer?.event(
			'llm.slot',
			{ slot: req.slot, attempt: attempt + 1, model: llm.model, ok: false, issues },
			'error'
		);
	}
	throw new LLMSlotError(req.slot, issues);
}

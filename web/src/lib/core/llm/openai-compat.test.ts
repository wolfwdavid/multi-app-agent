import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { createOpenAICompatLLM, mapOpenAIError, type ChatCompletionsLike } from './openai-compat.ts';
import { buildMessages, isLLMError, LLMError, toProviderSchema } from './common.ts';
import { callSlot, LLMSlotError } from './types.ts';

const BASE = { baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk_x', model: 'openai/gpt-oss-20b' };
const DraftSchema = z.object({ subject: z.string().min(1), body: z.string().min(1) });

function completion(content: string | null) {
	return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] };
}

/** Mock client: plays scripted results in order (the last one repeats); Error entries are thrown. */
function mockClient(...script: unknown[]) {
	let n = 0;
	const create = vi.fn(async (_body: Record<string, unknown>, _opts?: { timeout?: number; signal?: AbortSignal }) => {
		const r = script[Math.min(n++, script.length - 1)];
		if (r instanceof Error) throw r;
		return r;
	});
	const client: ChatCompletionsLike = { chat: { completions: { create } } };
	return { client, create };
}

function sentBody(create: ReturnType<typeof mockClient>['create'], i: number): Record<string, any> {
	return create.mock.calls[i][0];
}

async function rejection(p: Promise<unknown>): Promise<LLMError> {
	try {
		await p;
	} catch (err) {
		if (isLLMError(err)) return err;
		throw err;
	}
	throw new Error('expected rejection');
}

const httpError = (status: number, message = 'x', extra: Record<string, unknown> = {}) =>
	Object.assign(new Error(message), { status, ...extra });

describe('createOpenAICompatLLM construction', () => {
	it('does not construct a client or call anything until used', () => {
		const llm = createOpenAICompatLLM(BASE);
		expect(llm.model).toBe('openai/gpt-oss-20b');
		expect(llm.provider).toBe('hosted');
		expect(llm.baseURL).toBe('https://api.groq.com/openai/v1');
		expect(llm.structuredMode()).toBe('json_schema');
	});
});

describe('createOpenAICompatLLM request shape', () => {
	const jsonSchema = z.toJSONSchema(DraftSchema);
	const req = { slot: 'draft', system: 'S', input: { a: 1 }, jsonSchema };

	it('sends strict json_schema with deterministic settings and a timeout', async () => {
		const { client, create } = mockClient(completion('{"subject":"S","body":"B"}'));
		const llm = createOpenAICompatLLM({ ...BASE, client });
		expect(await llm.completeJSON(req)).toEqual({ subject: 'S', body: 'B' });
		expect(create).toHaveBeenCalledTimes(1);
		const b = sentBody(create, 0);
		expect(b.model).toBe('openai/gpt-oss-20b');
		expect(b.temperature).toBe(0);
		expect(b.seed).toBe(42);
		expect(b.messages).toEqual(buildMessages(req));
		expect(b.response_format).toEqual({
			type: 'json_schema',
			json_schema: { name: 'draft', schema: toProviderSchema(jsonSchema), strict: true }
		});
		expect('reasoning_effort' in b).toBe(false);
		expect(create.mock.calls[0][1]).toMatchObject({ timeout: 60000 });
	});

	it('passes reasoning_effort when configured', async () => {
		const { client, create } = mockClient(completion('{}'));
		const llm = createOpenAICompatLLM({ ...BASE, client, reasoningEffort: 'low' });
		await llm.completeJSON(req);
		expect(sentBody(create, 0).reasoning_effort).toBe('low');
	});

	it('uses json_object without a schema, or when structured is json_object', async () => {
		const { client, create } = mockClient(completion('{}'));
		await createOpenAICompatLLM({ ...BASE, client }).completeJSON({ slot: 'draft', system: 'S', input: {} });
		expect(sentBody(create, 0).response_format).toEqual({ type: 'json_object' });
		await createOpenAICompatLLM({ ...BASE, client, structured: 'json_object' }).completeJSON(req);
		expect(sentBody(create, 1).response_format).toEqual({ type: 'json_object' });
	});
});

describe('json_schema → json_object fallback', () => {
	const req = { slot: 'draft', system: 'S', input: {}, jsonSchema: z.toJSONSchema(DraftSchema) };

	it('retries once with json_object after a 400 and stays downgraded', async () => {
		const { client, create } = mockClient(
			httpError(400, 'response_format json_schema is not supported for this model'),
			completion('{"subject":"S","body":"B"}')
		);
		const llm = createOpenAICompatLLM({ ...BASE, client });
		expect(await llm.completeJSON(req)).toEqual({ subject: 'S', body: 'B' });
		expect(create).toHaveBeenCalledTimes(2);
		expect(sentBody(create, 1).response_format).toEqual({ type: 'json_object' });
		expect(llm.structuredMode()).toBe('json_object');

		await llm.completeJSON(req);
		expect(create).toHaveBeenCalledTimes(3);
		expect(sentBody(create, 2).response_format).toEqual({ type: 'json_object' });
	});

	it('a 400 while already in json_object mode throws bad_request without looping', async () => {
		const { client, create } = mockClient(httpError(400, 'nope'));
		const llm = createOpenAICompatLLM({ ...BASE, client, structured: 'json_object' });
		const e = await rejection(llm.completeJSON(req));
		expect(e.kind).toBe('bad_request');
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('a 400 on the fallback retry also throws bad_request (2 calls total)', async () => {
		const { client, create } = mockClient(httpError(400, 'nope'));
		const e = await rejection(createOpenAICompatLLM({ ...BASE, client }).completeJSON(req));
		expect(e.kind).toBe('bad_request');
		expect(create).toHaveBeenCalledTimes(2);
	});
});

describe('createOpenAICompatLLM responses', () => {
	const req = { slot: 'draft', system: 'S', input: {} };
	const run = (result: unknown) => createOpenAICompatLLM({ ...BASE, client: mockClient(result).client }).completeJSON(req);

	it('strips think blocks', async () => {
		expect(await run(completion('<think>r</think>{"subject":"S","body":"B"}'))).toEqual({ subject: 'S', body: 'B' });
	});
	it('null content resolves to an empty string', async () => {
		expect(await run(completion(null))).toBe('');
	});
	it('unparseable content resolves to the string', async () => {
		expect(await run(completion('nope'))).toBe('nope');
	});
	it('missing choices → invalid_output', async () => {
		expect((await rejection(run({ choices: [] }))).kind).toBe('invalid_output');
		expect((await rejection(run({}))).kind).toBe('invalid_output');
	});
});

describe('mapOpenAIError', () => {
	const ctx = { model: 'm', timeoutMs: 60000, apiKey: 'gsk_test_SECRET123' };

	it('maps SDK connection errors by constructor name', () => {
		expect(mapOpenAIError(new APIConnectionTimeoutError(), ctx).kind).toBe('timeout');
		expect(mapOpenAIError(new APIConnectionError({}), ctx).kind).toBe('unavailable');
		expect(mapOpenAIError(Object.assign(new Error('x'), { name: 'TimeoutError' }), ctx).kind).toBe('timeout');
	});

	it('auth errors never include the provider message or the key', () => {
		const e = mapOpenAIError(httpError(401, 'Incorrect API key provided: gsk_test_SECRET123'), ctx);
		expect(e.kind).toBe('auth');
		expect(e.status).toBe(401);
		expect(e.message).toContain('LLM_API_KEY');
		expect(e.message).not.toContain('SECRET123');
		expect(e.message).not.toContain('Incorrect API key');
		expect(mapOpenAIError(httpError(403), ctx).kind).toBe('auth');
	});

	it('429 → rate_limit with retry-after', () => {
		const e = mapOpenAIError(httpError(429, 'slow down', { headers: new Headers({ 'retry-after': '2' }) }), ctx);
		expect(e.kind).toBe('rate_limit');
		expect(e.retryAfterMs).toBe(2000);
		expect(mapOpenAIError(httpError(429, 'slow down', { headers: new Headers() }), ctx).retryAfterMs).toBeUndefined();
	});

	it('404 and 5xx → unavailable', () => {
		expect(mapOpenAIError(httpError(404), ctx).kind).toBe('unavailable');
		expect(mapOpenAIError(httpError(503), ctx).kind).toBe('unavailable');
	});

	it('400 → bad_request with the key redacted', () => {
		const e = mapOpenAIError(httpError(400, 'bad schema for gsk_test_SECRET123'), ctx);
		expect(e.kind).toBe('bad_request');
		expect(e.status).toBe(400);
		expect(e.message).toContain('***');
		expect(e.message).not.toContain('SECRET123');
	});

	it('unknown thrown values → unavailable; every error is provider hosted', () => {
		const e = mapOpenAIError('boom', ctx);
		expect(e.kind).toBe('unavailable');
		for (const err of [e, mapOpenAIError(httpError(401), ctx), mapOpenAIError(new APIConnectionTimeoutError(), ctx)]) {
			expect(err.provider).toBe('hosted');
		}
	});

	it('completeJSON surfaces mapped errors', async () => {
		const { client } = mockClient(httpError(401, 'Incorrect API key provided: gsk_test_SECRET123'));
		const llm = createOpenAICompatLLM({ ...BASE, apiKey: 'gsk_test_SECRET123', client });
		const e = await rejection(llm.completeJSON({ slot: 'draft', system: 'S', input: {} }));
		expect(e.kind).toBe('auth');
		expect(e.message).not.toContain('SECRET123');
	});
});

describe('callSlot over the hosted backend', () => {
	it('repairs once with the zod issues', async () => {
		const { client, create } = mockClient(completion('{"subject":""}'), completion('{"subject":"Q","body":"Hi"}'));
		const llm = createOpenAICompatLLM({ ...BASE, client });
		expect(await callSlot(llm, DraftSchema, { slot: 'draft', system: 'S', input: {} })).toEqual({
			subject: 'Q',
			body: 'Hi'
		});
		expect(create).toHaveBeenCalledTimes(2);
		const messages = sentBody(create, 1).messages as { content: string }[];
		expect(messages).toHaveLength(4);
		expect(messages[3].content).toContain('subject');
		expect(messages[3].content).toContain('failed validation');
	});

	it('throws LLMSlotError after exactly 2 calls when output stays invalid', async () => {
		const { client, create } = mockClient(completion('nope'));
		const llm = createOpenAICompatLLM({ ...BASE, client });
		await expect(callSlot(llm, DraftSchema, { slot: 'draft', system: 'S', input: {} })).rejects.toBeInstanceOf(
			LLMSlotError
		);
		expect(create).toHaveBeenCalledTimes(2);
	});
});

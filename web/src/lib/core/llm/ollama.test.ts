import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createOllamaLLM, listOllamaModels, normalizeOllamaBaseUrl, OLLAMA_DEFAULTS } from './ollama.ts';
import { buildMessages, isLLMError, LLMError, toProviderSchema } from './common.ts';
import { callSlot, LLMSlotError } from './types.ts';

type Scripted = Response | (() => Promise<Response>) | Error;
interface Call {
	url: string;
	init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function chat(content: unknown, extra: Record<string, unknown> = {}): Response {
	return json({ model: 'm', message: { role: 'assistant', content, ...extra }, done: true });
}

/** Offline fetch recorder: plays scripted responses in order (the last one repeats). */
function scriptedFetch(responses: Scripted[]) {
	const calls: Call[] = [];
	const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
		calls.push({ url: String(input), init });
		const r = responses[Math.min(calls.length - 1, responses.length - 1)];
		if (r instanceof Error) throw r;
		if (typeof r === 'function') return r();
		return r.clone();
	};
	return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function body(call: Call): Record<string, any> {
	return JSON.parse(String(call.init?.body));
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

const DraftSchema = z.object({ subject: z.string().min(1), body: z.string().min(1) });

describe('normalizeOllamaBaseUrl', () => {
	it('strips /v1 and /api and pins localhost to IPv4', () => {
		expect(normalizeOllamaBaseUrl('http://localhost:11434/v1/')).toBe('http://127.0.0.1:11434');
		expect(normalizeOllamaBaseUrl('http://127.0.0.1:11434/api')).toBe('http://127.0.0.1:11434');
		expect(normalizeOllamaBaseUrl('http://gpu-box:11434')).toBe('http://gpu-box:11434');
		expect(normalizeOllamaBaseUrl('  http://gpu-box:11434/  ')).toBe('http://gpu-box:11434');
	});
});

describe('createOllamaLLM request shape', () => {
	it('POSTs /api/chat with schema format, think off, deterministic options and a timeout signal', async () => {
		const { fetch, calls } = scriptedFetch([chat('{"subject":"Hi","body":"Yo"}')]);
		const llm = createOllamaLLM({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3.5:4b', fetch });
		expect(llm.model).toBe('qwen3.5:4b');
		expect(llm.provider).toBe('ollama');
		expect(llm.baseUrl).toBe('http://127.0.0.1:11434');
		expect(llm.settings).toEqual({ ...OLLAMA_DEFAULTS });

		const jsonSchema = z.toJSONSchema(DraftSchema);
		const req = { slot: 'draft', system: 'S', input: { x: 1 }, jsonSchema };
		await llm.completeJSON(req);

		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call.url).toBe('http://127.0.0.1:11434/api/chat');
		expect(call.init?.method).toBe('POST');
		expect(new Headers(call.init?.headers).get('content-type')).toBe('application/json');
		expect(call.init?.signal).toBeInstanceOf(AbortSignal);
		const b = body(call);
		expect(b.model).toBe('qwen3.5:4b');
		expect(b.stream).toBe(false);
		expect(b.think).toBe(false);
		expect(b.keep_alive).toBe('10m');
		expect(b.options).toEqual({ temperature: 0, seed: 42, num_ctx: 8192 });
		expect(b.format).toEqual(toProviderSchema(jsonSchema));
		expect('$schema' in b.format).toBe(false);
		expect(b.messages).toEqual(buildMessages(req));
	});

	it("uses format 'json' without a schema and honors custom options", async () => {
		const { fetch, calls } = scriptedFetch([chat('{}')]);
		const llm = createOllamaLLM({
			baseUrl: 'http://127.0.0.1:11434',
			model: 'qwen2.5-coder:7b',
			fetch,
			seed: 7,
			numCtx: 4096,
			keepAlive: '30m',
			timeoutMs: 5000,
			temperature: 0.2
		});
		await llm.completeJSON({ slot: 's', system: 'S', input: null });
		const b = body(calls[0]);
		expect(b.format).toBe('json');
		expect(b.options).toEqual({ temperature: 0.2, seed: 7, num_ctx: 4096 });
		expect(b.keep_alive).toBe('30m');
		expect(llm.settings.timeoutMs).toBe(5000);
	});
});

describe('createOllamaLLM response handling', () => {
	const req = { slot: 'draft', system: 'S', input: {} };

	it('returns parsed content', async () => {
		const { fetch } = scriptedFetch([chat('{"subject":"Hi","body":"Yo"}')]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		expect(await llm.completeJSON(req)).toEqual({ subject: 'Hi', body: 'Yo' });
	});

	it('strips think blocks and fences, including inside string values', async () => {
		const { fetch } = scriptedFetch([
			chat('<think>hm</think>```json\n{"subject":"A <think>z</think>B","body":"ok"}\n```')
		]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		expect(await llm.completeJSON(req)).toEqual({ subject: 'A B', body: 'ok' });
	});

	it('ignores message.thinking', async () => {
		const { fetch } = scriptedFetch([chat('{"a":1}', { thinking: '{"leak":true}' })]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		expect(await llm.completeJSON(req)).toEqual({ a: 1 });
	});

	it('returns unparseable and empty content as strings instead of throwing', async () => {
		const { fetch } = scriptedFetch([chat('garbage'), chat('')]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		expect(await llm.completeJSON(req)).toBe('garbage');
		expect(await llm.completeJSON(req)).toBe('');
	});
});

describe('createOllamaLLM errors', () => {
	const req = { slot: 'draft', system: 'S', input: {} };
	const make = (responses: Scripted[], model = 'q', timeoutMs?: number) =>
		createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model, fetch: scriptedFetch(responses).fetch, timeoutMs });

	it('connection failure → unavailable naming the host', async () => {
		const e = await rejection(make([new TypeError('fetch failed')]).completeJSON(req));
		expect(e.kind).toBe('unavailable');
		expect(e.provider).toBe('ollama');
		expect(e.message).toContain('127.0.0.1:11434');
	});

	it('TimeoutError rejection → timeout', async () => {
		const e = await rejection(make([new DOMException('timed out', 'TimeoutError')]).completeJSON(req));
		expect(e.kind).toBe('timeout');
	});

	it('real AbortSignal.timeout wiring rejects as timeout quickly', async () => {
		const hanging = (_input: unknown, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		const llm = createOllamaLLM({
			baseUrl: 'http://127.0.0.1:11434',
			model: 'q',
			timeoutMs: 20,
			fetch: hanging as unknown as typeof fetch
		});
		const started = performance.now();
		const e = await rejection(llm.completeJSON(req));
		expect(e.kind).toBe('timeout');
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it('404 → unavailable with a pull hint', async () => {
		const e = await rejection(make([json({ error: "model 'qwen9:1b' not found" }, 404)], 'qwen9:1b').completeJSON(req));
		expect(e.kind).toBe('unavailable');
		expect(e.status).toBe(404);
		expect(e.message).toContain('ollama pull qwen9:1b');
	});

	it('500 → unavailable, 400 → bad_request', async () => {
		const e500 = await rejection(make([json({ error: 'boom' }, 500)]).completeJSON(req));
		expect(e500.kind).toBe('unavailable');
		expect(e500.status).toBe(500);
		const e400 = await rejection(make([json({ error: 'invalid format' }, 400)]).completeJSON(req));
		expect(e400.kind).toBe('bad_request');
		expect(e400.status).toBe(400);
		expect(e400.message).toContain('invalid format');
	});

	it('200 without message.content → invalid_output', async () => {
		const e = await rejection(make([json({})]).completeJSON(req));
		expect(e.kind).toBe('invalid_output');
	});

	it('200 with a non-JSON body → invalid_output', async () => {
		const e = await rejection(make([new Response('oops', { status: 200 })]).completeJSON(req));
		expect(e.kind).toBe('invalid_output');
	});
});

describe('callSlot over Ollama', () => {
	it('repairs once with the zod issues and the previous output', async () => {
		const { fetch, calls } = scriptedFetch([chat('{"subject":""}'), chat('{"subject":"Q","body":"Hi"}')]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		const out = await callSlot(llm, DraftSchema, { slot: 'draft', system: 'S', input: {} });
		expect(out).toEqual({ subject: 'Q', body: 'Hi' });
		expect(calls).toHaveLength(2);
		const messages = body(calls[1]).messages as { role: string; content: string }[];
		expect(messages).toHaveLength(4);
		expect(messages[2].content).toBe('{"subject":""}');
		expect(messages[3].content).toContain('subject');
		expect(messages[3].content).toContain('failed validation');
	});

	it('throws LLMSlotError after exactly 2 calls when output stays invalid', async () => {
		const { fetch, calls } = scriptedFetch([chat('garbage')]);
		const llm = createOllamaLLM({ baseUrl: 'http://127.0.0.1:11434', model: 'q', fetch });
		await expect(callSlot(llm, DraftSchema, { slot: 'draft', system: 'S', input: {} })).rejects.toBeInstanceOf(
			LLMSlotError
		);
		expect(calls).toHaveLength(2);
	});
});

describe('listOllamaModels', () => {
	it('GETs /api/tags and returns model names', async () => {
		const { fetch, calls } = scriptedFetch([json({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'qwen3.5:4b' }] })]);
		expect(await listOllamaModels({ baseUrl: 'http://127.0.0.1:11434', fetch })).toEqual([
			'qwen2.5-coder:7b',
			'qwen3.5:4b'
		]);
		expect(calls[0].url).toBe('http://127.0.0.1:11434/api/tags');
		expect(calls[0].init?.method ?? 'GET').toBe('GET');
	});

	it('maps a rejected fetch to unavailable', async () => {
		const { fetch } = scriptedFetch([new TypeError('fetch failed')]);
		const e = await rejection(listOllamaModels({ baseUrl: 'http://127.0.0.1:11434', fetch }));
		expect(e.kind).toBe('unavailable');
	});
});

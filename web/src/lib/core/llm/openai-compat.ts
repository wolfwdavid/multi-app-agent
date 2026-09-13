// OpenAI-compatible Chat Completions backend (Groq, OpenRouter, any baseURL) implementing the LLM slot interface.
// - The openai SDK is loaded with a dynamic import, so browser/static bundles that import core never pull the SDK or
//   construct a client. There is no static import of the package in this file, not even a type import.
// - The SDK constructor throws on a missing key, so keyless OpenAI-compatible servers get a placeholder string.
// - Server-side only: the client is never created with dangerouslyAllowBrowser.
// - Prefers strict json_schema output; one HTTP 400 downgrades this instance to json_object for good.
import type { LLM, LLMRequest } from './types.ts';
import {
	LLMError,
	buildMessages,
	parseModelJson,
	redactSecret,
	safeSlotName,
	sanitizeOutput,
	toProviderSchema
} from './common.ts';

/** Minimal structural slice of the openai SDK client. Lets tests inject a mock and keeps a static SDK import out of core. */
export interface ChatCompletionsLike {
	chat: {
		completions: {
			create(body: Record<string, unknown>, options?: { timeout?: number; signal?: AbortSignal }): Promise<unknown>;
		};
	};
}

export interface OpenAICompatOptions {
	baseURL: string;
	apiKey: string;
	model: string;
	timeoutMs?: number;
	maxRetries?: number;
	temperature?: number;
	seed?: number;
	reasoningEffort?: string;
	structured?: 'json_schema' | 'json_object';
	client?: ChatCompletionsLike;
	fetch?: typeof fetch;
}

export interface OpenAICompatLLM extends LLM {
	readonly provider: 'hosted';
	readonly baseURL: string;
	structuredMode(): 'json_schema' | 'json_object';
}

type StructuredMode = 'json_schema' | 'json_object';

export function createOpenAICompatLLM(opts: OpenAICompatOptions): OpenAICompatLLM {
	const model = opts.model;
	const timeoutMs = opts.timeoutMs ?? 60_000;
	// The SDK retries 429/5xx itself; keep it low so eval runs surface rate limits instead of hiding them.
	const maxRetries = opts.maxRetries ?? 1;
	const temperature = opts.temperature ?? 0;
	const seed = opts.seed ?? 42;

	// Per-instance state: lazily created client and the structured-output mode (downgraded once on a 400).
	let clientP: Promise<ChatCompletionsLike> | undefined;
	let mode: StructuredMode = opts.structured ?? 'json_schema';

	const getClient = (): Promise<ChatCompletionsLike> =>
		opts.client
			? Promise.resolve(opts.client)
			: (clientP ??= import('openai').then(
					(m) =>
						new m.default({
							baseURL: opts.baseURL,
							apiKey: opts.apiKey || 'unused',
							timeout: timeoutMs,
							maxRetries,
							...(opts.fetch ? { fetch: opts.fetch } : {})
						}) as unknown as ChatCompletionsLike
				));

	const ctx = { model, timeoutMs, apiKey: opts.apiKey };

	async function completeJSON(req: LLMRequest): Promise<unknown> {
		const schema = toProviderSchema(req.jsonSchema);
		const messages = buildMessages(req);
		const body = (m: StructuredMode): Record<string, unknown> => ({
			model,
			messages,
			temperature,
			seed,
			response_format:
				m === 'json_schema' && schema
					? { type: 'json_schema', json_schema: { name: safeSlotName(req.slot), schema, strict: true } }
					: { type: 'json_object' },
			...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {})
		});
		const send = async (m: StructuredMode): Promise<unknown> => {
			try {
				return await (await getClient()).chat.completions.create(body(m), { timeout: timeoutMs });
			} catch (err) {
				throw mapOpenAIError(err, ctx);
			}
		};

		const effective: StructuredMode = schema && mode === 'json_schema' ? 'json_schema' : 'json_object';
		let raw: unknown;
		try {
			raw = await send(effective);
		} catch (err) {
			if (!(err instanceof LLMError) || err.kind !== 'bad_request' || effective !== 'json_schema') throw err;
			// Provider rejected the schema (e.g. optional fields missing from `required`): downgrade and retry once.
			mode = 'json_object';
			raw = await send('json_object');
		}

		const choices = (raw as { choices?: unknown } | null)?.choices;
		const message = Array.isArray(choices)
			? (choices[0] as { message?: { content?: unknown } } | undefined)?.message
			: undefined;
		if (!message) {
			throw new LLMError('invalid_output', `hosted ${model}: completion had no choices[0].message`, {
				provider: 'hosted',
				model
			});
		}
		const content = message.content;
		return sanitizeOutput(parseModelJson(typeof content === 'string' ? content : ''));
	}

	return {
		model,
		provider: 'hosted',
		baseURL: opts.baseURL,
		structuredMode: () => mode,
		completeJSON
	};
}

/**
 * Maps an openai SDK (or fetch) failure to a typed LLMError. SDK error classes all have name 'Error', so match on the
 * constructor name and numeric status. Messages are redacted; auth failures omit the provider message entirely.
 * NOTE: `cause` keeps the original error, which may carry provider text. Never serialize `cause` into traces.
 */
export function mapOpenAIError(err: unknown, ctx: { model: string; timeoutMs: number; apiKey?: string }): LLMError {
	const e = (typeof err === 'object' && err !== null ? err : {}) as {
		name?: unknown;
		message?: unknown;
		status?: unknown;
		headers?: { get?: (name: string) => string | null };
	};
	const ctor = (err as { constructor?: { name?: string } } | null | undefined)?.constructor?.name;
	const status = typeof e.status === 'number' ? e.status : undefined;
	const msg = redactSecret(String(e.message ?? err), ctx.apiKey);
	const { model } = ctx;
	const make = (kind: LLMError['kind'], message: string, retryAfterMs?: number) =>
		new LLMError(kind, message, { provider: 'hosted', model, status, retryAfterMs, cause: err });

	if (ctor === 'APIConnectionTimeoutError' || e.name === 'TimeoutError') {
		return make('timeout', `hosted ${model}: no response within ${ctx.timeoutMs}ms`);
	}
	if (ctor === 'APIUserAbortError' || e.name === 'AbortError') {
		return make('timeout', `hosted ${model}: request aborted (${msg})`);
	}
	if (ctor === 'APIConnectionError') {
		return make('unavailable', `hosted ${model}: cannot reach endpoint (${msg})`);
	}
	if (status === 401 || status === 403) {
		// No provider message: it can echo a partial key.
		return make('auth', `hosted ${model}: authentication failed (HTTP ${status}); check LLM_API_KEY`);
	}
	if (status === 429) {
		const header = e.headers?.get?.('retry-after');
		const seconds = header == null || header === '' ? NaN : Number(header);
		return make(
			'rate_limit',
			`hosted ${model}: rate limited (HTTP 429): ${msg}`,
			Number.isFinite(seconds) ? seconds * 1000 : undefined
		);
	}
	if (status === 404) return make('unavailable', `hosted ${model}: model or endpoint not found (HTTP 404): ${msg}`);
	if (status !== undefined && status >= 500) {
		return make('unavailable', `hosted ${model}: provider error (HTTP ${status}): ${msg}`);
	}
	if (status !== undefined && status >= 400) {
		return make('bad_request', `hosted ${model}: request rejected (HTTP ${status}): ${msg}`);
	}
	return make('unavailable', `hosted ${model}: ${msg}`);
}

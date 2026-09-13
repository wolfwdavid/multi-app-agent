// Native Ollama backend implementing the LLM slot interface.
// Uses /api/chat instead of the /v1 compatibility layer because think:false and format:<JSON schema> are honored
// there (measured 2026-09-13 on Ollama 0.33.1: qwen3.5:4b ~10 s warm, schema-valid output).
// Per-slot model routing lives in select.ts (plan 08-02). All config arrives as parameters; nothing is read from env.
import type { LLM, LLMRequest } from './types.ts';
import { LLMError, buildMessages, parseModelJson, sanitizeOutput, toProviderSchema, type LLMErrorKind } from './common.ts';

export interface OllamaLLMOptions {
	baseUrl: string;
	model: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	numCtx?: number;
	seed?: number;
	temperature?: number;
	keepAlive?: string;
	think?: boolean;
}

export const OLLAMA_DEFAULTS = Object.freeze({
	timeoutMs: 180_000,
	numCtx: 8192,
	seed: 42,
	temperature: 0,
	keepAlive: '10m',
	think: false
});

export interface OllamaLLM extends LLM {
	readonly provider: 'ollama';
	readonly baseUrl: string;
	readonly settings: Readonly<{
		timeoutMs: number;
		numCtx: number;
		seed: number;
		temperature: number;
		keepAlive: string;
		think: boolean;
	}>;
}

/** Trims, drops a trailing /v1 or /api, and pins localhost to 127.0.0.1 (Node may resolve localhost to ::1 on Windows). */
export function normalizeOllamaBaseUrl(url: string): string {
	return url
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/(v1|api)$/, '')
		.replace('://localhost', '://127.0.0.1');
}

function isTimeoutError(err: unknown): boolean {
	const name = (err as { name?: unknown } | null)?.name;
	return name === 'TimeoutError' || name === 'AbortError';
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function createOllamaLLM(opts: OllamaLLMOptions): OllamaLLM {
	const baseUrl = normalizeOllamaBaseUrl(opts.baseUrl);
	const model = opts.model;
	const settings = Object.freeze({
		timeoutMs: opts.timeoutMs ?? OLLAMA_DEFAULTS.timeoutMs,
		numCtx: opts.numCtx ?? OLLAMA_DEFAULTS.numCtx,
		seed: opts.seed ?? OLLAMA_DEFAULTS.seed,
		temperature: opts.temperature ?? OLLAMA_DEFAULTS.temperature,
		keepAlive: opts.keepAlive ?? OLLAMA_DEFAULTS.keepAlive,
		think: opts.think ?? OLLAMA_DEFAULTS.think
	});

	const fail = (kind: LLMErrorKind, message: string, extra: { status?: number; cause?: unknown } = {}) =>
		new LLMError(kind, message, { provider: 'ollama', model, ...extra });

	const timeoutError = (cause: unknown) =>
		fail(
			'timeout',
			`ollama ${model}: no response within ${settings.timeoutMs}ms (cold model load can take 10-60s; raise timeoutMs or warm the model)`,
			{ cause }
		);

	async function completeJSON(req: LLMRequest): Promise<unknown> {
		const f = opts.fetch ?? globalThis.fetch;
		const body = {
			model,
			messages: buildMessages(req),
			stream: false,
			think: settings.think,
			format: toProviderSchema(req.jsonSchema) ?? 'json',
			options: { temperature: settings.temperature, seed: settings.seed, num_ctx: settings.numCtx },
			keep_alive: settings.keepAlive
		};

		let res: Response;
		try {
			res = await f(`${baseUrl}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(settings.timeoutMs)
			});
		} catch (err) {
			if (isTimeoutError(err)) throw timeoutError(err);
			throw fail('unavailable', `ollama ${model}: cannot reach ${baseUrl} (${errorMessage(err)}). Is Ollama running?`, {
				cause: err
			});
		}

		if (!res.ok) {
			let detail = '';
			try {
				detail = (await res.text()).slice(0, 300);
			} catch (err) {
				if (isTimeoutError(err)) throw timeoutError(err);
			}
			const status = res.status;
			if (status === 404) {
				throw fail('unavailable', `ollama ${model}: model not found at ${baseUrl}; run: ollama pull ${model}`, { status });
			}
			if (status >= 500) throw fail('unavailable', `ollama ${model}: server error (HTTP ${status}): ${detail}`, { status });
			throw fail('bad_request', `ollama ${model}: request rejected (HTTP ${status}): ${detail}`, { status });
		}

		let data: unknown;
		try {
			data = await res.json();
		} catch (err) {
			if (isTimeoutError(err)) throw timeoutError(err);
			throw fail('invalid_output', `ollama ${model}: response body was not JSON`, { status: res.status, cause: err });
		}

		// message.thinking (if present) is deliberately ignored.
		const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
		if (typeof content !== 'string') {
			throw fail('invalid_output', `ollama ${model}: response had no message.content`, { status: res.status });
		}
		return sanitizeOutput(parseModelJson(content));
	}

	return { model, provider: 'ollama', baseUrl, settings, completeJSON };
}

/** GET /api/tags → installed model names. Used by the smoke script and provider selection. */
export async function listOllamaModels(opts: {
	baseUrl: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}): Promise<string[]> {
	const baseUrl = normalizeOllamaBaseUrl(opts.baseUrl);
	const f = opts.fetch ?? globalThis.fetch;
	const timeoutMs = opts.timeoutMs ?? 5000;
	const fail = (kind: LLMErrorKind, message: string, extra: { status?: number; cause?: unknown } = {}) =>
		new LLMError(kind, message, { provider: 'ollama', model: '', ...extra });

	let res: Response;
	try {
		res = await f(`${baseUrl}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
	} catch (err) {
		if (isTimeoutError(err)) throw fail('timeout', `ollama: no response from ${baseUrl} within ${timeoutMs}ms`, { cause: err });
		throw fail('unavailable', `ollama: cannot reach ${baseUrl} (${errorMessage(err)}). Is Ollama running?`, { cause: err });
	}
	if (!res.ok) throw fail('unavailable', `ollama: GET /api/tags failed (HTTP ${res.status})`, { status: res.status });
	let data: unknown;
	try {
		data = await res.json();
	} catch (err) {
		throw fail('invalid_output', 'ollama: /api/tags body was not JSON', { cause: err });
	}
	const models = (data as { models?: unknown } | null)?.models;
	if (!Array.isArray(models)) return [];
	return models
		.map((m) => (m as { name?: unknown } | null)?.name)
		.filter((n): n is string => typeof n === 'string');
}

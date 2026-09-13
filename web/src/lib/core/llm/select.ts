// LLM selection: the one place that turns injected env into an LLM.
//
// Core never reads process.env. Entry points (CLI scripts, SvelteKit routes, MCP server) pass their env object in.
//
// Env keys read (web/.env.example documents the first four):
//   LLM_BASE_URL          OpenAI-compatible base URL. Port 11434 (or unset) → local Ollama; anything else → hosted.
//   LLM_API_KEY           Hosted key. Never logged, never put in descriptions, probes or thrown messages.
//   LLM_MODEL             Hosted model for every slot; on Ollama, the phrasing model (default qwen3.5:4b).
//   OLLAMA_URL            Native Ollama URL (default http://127.0.0.1:11434).
//   LLM_PROVIDER          Optional fake|ollama|hosted; overrides auto-detection.
//   LLM_GROUNDING_MODEL   Ollama model for grounding-critical slots (default qwen2.5-coder:7b).
//   OLLAMA_MODEL          Ollama phrasing model when forcing ollama while LLM_* points at a hosted provider.
//   OLLAMA_NUM_CTX, LLM_SEED, LLM_TIMEOUT_MS, LLM_REASONING_EFFORT   Numeric/tuning overrides.
//
// Routing rationale (local bake-off, 2026-09-13):
//   grounding slots (critique, claims, evidence, grounding) → qwen2.5-coder:7b: grounded claims correctly, ~56 s.
//   phrasing slots (draft, gap_actions, normalize, …)      → qwen3.5:4b with think:false: ~10 s warm, but it
//                                                             grounded claims wrongly, so it only phrases.
//   hosted                                                  → LLM_MODEL for every slot (e.g. Groq openai/gpt-oss-20b).
//
// Phase 6 eval column contract:
//   const kind = parseLlmFlag(args.llm);                          // --llm fake|ollama|hosted (default fake)
//   const cfg = resolveLlmConfig(process.env, { provider: kind }); // entry point passes env
//   const llm = createLLM(cfg); const meta = llmRunMeta(cfg);     // meta goes into evals.json next to the column
// Use N=3-5 over 3-4 scenarios for ollama or hosted (a qwen2.5-coder:7b sprint takes ≈ 3 min; Groq free tier is
// ~30 RPM / 8K TPM).
//
// Phase 9 /api/health: `probeLlm(resolveLlmConfig(env))`, returned as JSON (the probe never contains the key).
import type { LLM } from './types.ts';
import { createFakeLLM } from './fake.ts';
import { LLMError, redactSecret, type LLMErrorKind } from './common.ts';
import { OLLAMA_DEFAULTS, createOllamaLLM, listOllamaModels, normalizeOllamaBaseUrl } from './ollama.ts';
import { createOpenAICompatLLM, type ChatCompletionsLike } from './openai-compat.ts';

export type LlmProviderKind = 'fake' | 'ollama' | 'hosted';
export type SlotRole = 'grounding' | 'phrasing';
export type LlmEnv = Readonly<Record<string, string | undefined>>;

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_PHRASING_MODEL = 'qwen3.5:4b';
export const DEFAULT_GROUNDING_MODEL = 'qwen2.5-coder:7b';
const FAKE_MODEL = 'fake-scripted';
const HOSTED_TIMEOUT_MS = 60_000;

export const SLOT_ROLES: Readonly<Record<string, SlotRole>> = Object.freeze({
	critique: 'grounding',
	claims: 'grounding',
	evidence: 'grounding',
	grounding: 'grounding',
	draft: 'phrasing',
	gap_actions: 'phrasing',
	normalize: 'phrasing',
	repair_args: 'phrasing'
});

export function slotRole(slot: string): SlotRole {
	return Object.hasOwn(SLOT_ROLES, slot) ? SLOT_ROLES[slot] : 'phrasing';
}

export interface OllamaConfig {
	baseUrl: string;
	phrasingModel: string;
	groundingModel: string;
	timeoutMs: number;
	numCtx: number;
	seed: number;
	temperature: number;
	keepAlive: string;
}

export interface HostedConfig {
	baseURL: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
	seed: number;
	temperature: number;
	reasoningEffort?: string;
}

export type LlmConfig =
	| { provider: 'fake' }
	| { provider: 'ollama'; ollama: OllamaConfig }
	| { provider: 'hosted'; hosted: HostedConfig };

export class LlmConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LlmConfigError';
	}
}

const PROVIDERS: readonly LlmProviderKind[] = ['fake', 'ollama', 'hosted'];

function isProvider(value: string): value is LlmProviderKind {
	return (PROVIDERS as readonly string[]).includes(value);
}

export function isOllamaUrl(url: string | undefined): boolean {
	if (!url) return false;
	try {
		return new URL(url).port === '11434';
	} catch {
		return false;
	}
}

/** `--llm` flag parser. Missing → 'fake' (deterministic default for evals and tests). */
export function parseLlmFlag(value: string | undefined): LlmProviderKind {
	if (value === undefined) return 'fake';
	const v = value.trim();
	if (!isProvider(v)) throw new LlmConfigError('--llm must be fake|ollama|hosted');
	return v;
}

export function resolveLlmConfig(env: LlmEnv, overrides: { provider?: LlmProviderKind } = {}): LlmConfig {
	const str = (k: string): string | undefined => env[k]?.trim() || undefined;
	const num = (k: string, fallback: number): number => {
		const raw = str(k);
		if (raw === undefined) return fallback;
		const n = Number(raw);
		if (!Number.isFinite(n)) throw new LlmConfigError(`${k} must be a number`);
		return n;
	};

	let provider: LlmProviderKind;
	if (overrides.provider) {
		provider = overrides.provider;
	} else {
		const explicit = str('LLM_PROVIDER');
		if (explicit !== undefined) {
			if (!isProvider(explicit)) throw new LlmConfigError('LLM_PROVIDER must be fake|ollama|hosted');
			provider = explicit;
		} else {
			const base = str('LLM_BASE_URL');
			provider = !base || isOllamaUrl(base) ? 'ollama' : 'hosted';
		}
	}

	if (provider === 'fake') return { provider: 'fake' };

	if (provider === 'ollama') {
		const llmBase = str('LLM_BASE_URL');
		const localBase = isOllamaUrl(llmBase) ? llmBase : undefined;
		// LLM_MODEL belongs to whichever provider LLM_BASE_URL points at; ignore it when that is a hosted endpoint.
		const localModel = localBase || !llmBase ? str('LLM_MODEL') : undefined;
		return {
			provider: 'ollama',
			ollama: {
				baseUrl: normalizeOllamaBaseUrl(str('OLLAMA_URL') ?? localBase ?? DEFAULT_OLLAMA_URL),
				phrasingModel: str('OLLAMA_MODEL') ?? localModel ?? DEFAULT_PHRASING_MODEL,
				groundingModel: str('LLM_GROUNDING_MODEL') ?? DEFAULT_GROUNDING_MODEL,
				timeoutMs: num('LLM_TIMEOUT_MS', OLLAMA_DEFAULTS.timeoutMs),
				numCtx: num('OLLAMA_NUM_CTX', OLLAMA_DEFAULTS.numCtx),
				seed: num('LLM_SEED', OLLAMA_DEFAULTS.seed),
				temperature: OLLAMA_DEFAULTS.temperature,
				keepAlive: OLLAMA_DEFAULTS.keepAlive
			}
		};
	}

	const baseURL = str('LLM_BASE_URL');
	if (!baseURL || isOllamaUrl(baseURL)) {
		throw new LlmConfigError(
			'hosted LLM requires LLM_BASE_URL pointing at an OpenAI-compatible endpoint (e.g. https://api.groq.com/openai/v1)'
		);
	}
	const apiKey = str('LLM_API_KEY');
	if (!apiKey) throw new LlmConfigError('hosted LLM requires LLM_API_KEY');
	const model = str('LLM_MODEL');
	if (!model) throw new LlmConfigError('hosted LLM requires LLM_MODEL');
	const reasoningEffort = str('LLM_REASONING_EFFORT') ?? (/gpt-oss/i.test(model) ? 'low' : undefined);
	return {
		provider: 'hosted',
		hosted: {
			baseURL,
			apiKey,
			model,
			timeoutMs: num('LLM_TIMEOUT_MS', HOSTED_TIMEOUT_MS),
			seed: num('LLM_SEED', 42),
			temperature: 0,
			...(reasoningEffort ? { reasoningEffort } : {})
		}
	};
}

/** An LLM whose completeJSON delegates to `route(req.slot)`. */
export function createSlotRoutedLLM(route: (slot: string) => LLM, model: string): LLM {
	return { model, completeJSON: (req) => route(req.slot).completeJSON(req) };
}

function ollamaModelLabel(o: OllamaConfig): string {
	return o.groundingModel === o.phrasingModel ? o.phrasingModel : `${o.phrasingModel}+${o.groundingModel}`;
}

export function createLLM(
	config: LlmConfig,
	deps: { fetch?: typeof fetch; openaiClient?: ChatCompletionsLike; fake?: () => LLM } = {}
): LLM {
	if (config.provider === 'fake') return deps.fake?.() ?? createFakeLLM();

	if (config.provider === 'ollama') {
		const o = config.ollama;
		const mk = (model: string) =>
			createOllamaLLM({
				baseUrl: o.baseUrl,
				model,
				...(deps.fetch ? { fetch: deps.fetch } : {}),
				timeoutMs: o.timeoutMs,
				numCtx: o.numCtx,
				seed: o.seed,
				temperature: o.temperature,
				keepAlive: o.keepAlive,
				think: false
			});
		const phrasing = mk(o.phrasingModel);
		const grounding = o.groundingModel === o.phrasingModel ? phrasing : mk(o.groundingModel);
		return createSlotRoutedLLM(
			(slot) => (slotRole(slot) === 'grounding' ? grounding : phrasing),
			`ollama/${ollamaModelLabel(o)}`
		);
	}

	const h = config.hosted;
	return createOpenAICompatLLM({
		baseURL: h.baseURL,
		apiKey: h.apiKey,
		model: h.model,
		timeoutMs: h.timeoutMs,
		seed: h.seed,
		temperature: h.temperature,
		...(h.reasoningEffort ? { reasoningEffort: h.reasoningEffort } : {}),
		...(deps.openaiClient ? { client: deps.openaiClient } : {}),
		...(deps.fetch ? { fetch: deps.fetch } : {})
	});
}

export interface LlmDescription {
	provider: LlmProviderKind;
	baseUrl: string | null;
	models: Record<string, string>;
	hasApiKey: boolean;
	seed?: number;
	temperature?: number;
	numCtx?: number;
}

function originOf(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		return 'invalid-url';
	}
}

/** Safe-to-print summary of a config. Never includes the API key; only whether one is set. */
export function describeLlmConfig(config: LlmConfig): LlmDescription {
	if (config.provider === 'fake') {
		return { provider: 'fake', baseUrl: null, models: { fake: FAKE_MODEL }, hasApiKey: false };
	}
	if (config.provider === 'ollama') {
		const o = config.ollama;
		return {
			provider: 'ollama',
			baseUrl: normalizeOllamaBaseUrl(o.baseUrl),
			models: { phrasing: o.phrasingModel, grounding: o.groundingModel },
			hasApiKey: false,
			seed: o.seed,
			temperature: o.temperature,
			numCtx: o.numCtx
		};
	}
	const h = config.hosted;
	return {
		provider: 'hosted',
		baseUrl: originOf(h.baseURL),
		models: { hosted: h.model },
		hasApiKey: h.apiKey.length > 0,
		seed: h.seed,
		temperature: h.temperature
	};
}

export interface LlmProbe {
	provider: LlmProviderKind;
	description: LlmDescription;
	reachable: boolean;
	ok: boolean;
	latencyMs: number;
	missingModels: string[];
	error?: { kind: LLMErrorKind; message: string };
}

function errorName(err: unknown): unknown {
	return (err as { name?: unknown } | null)?.name;
}

/** Health check: reachability, installed models (Ollama) or key validity (hosted), and latency. Never throws. */
export async function probeLlm(
	config: LlmConfig,
	deps: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {}
): Promise<LlmProbe> {
	const description = describeLlmConfig(config);
	const now = deps.now ?? (() => globalThis.performance.now());
	const base = { provider: config.provider, description, missingModels: [] as string[] };

	if (config.provider === 'fake') return { ...base, reachable: true, ok: true, latencyMs: 0 };

	const t0 = now();
	const elapsed = () => Math.max(0, Math.round(now() - t0));

	if (config.provider === 'ollama') {
		const o = config.ollama;
		try {
			const names = await listOllamaModels({
				baseUrl: o.baseUrl,
				...(deps.fetch ? { fetch: deps.fetch } : {}),
				timeoutMs: deps.timeoutMs ?? 5000
			});
			const wanted = [...new Set([o.phrasingModel, o.groundingModel])];
			const missingModels = wanted.filter((m) => !names.includes(m) && !names.includes(`${m}:latest`));
			return { ...base, reachable: true, ok: missingModels.length === 0, latencyMs: elapsed(), missingModels };
		} catch (err) {
			const kind: LLMErrorKind = err instanceof LLMError ? err.kind : 'unavailable';
			const message = err instanceof Error ? err.message : String(err);
			return { ...base, reachable: false, ok: false, latencyMs: elapsed(), error: { kind, message } };
		}
	}

	const h = config.hosted;
	const f = deps.fetch ?? globalThis.fetch;
	const redact = (msg: string) => redactSecret(msg, h.apiKey);
	try {
		const res = await f(`${h.baseURL.replace(/\/+$/, '')}/models`, {
			method: 'GET',
			headers: { authorization: `Bearer ${h.apiKey}` },
			signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000)
		});
		const latencyMs = elapsed();
		if (res.ok) return { ...base, reachable: true, ok: true, latencyMs };
		if (res.status === 401 || res.status === 403) {
			return {
				...base,
				reachable: true,
				ok: false,
				latencyMs,
				error: { kind: 'auth', message: redact('authentication failed; check LLM_API_KEY') }
			};
		}
		return {
			...base,
			reachable: true,
			ok: false,
			latencyMs,
			error: { kind: 'unavailable', message: redact(`HTTP ${res.status}`) }
		};
	} catch (err) {
		const kind: LLMErrorKind = errorName(err) === 'TimeoutError' ? 'timeout' : 'unavailable';
		const message = redact(err instanceof Error ? err.message : String(err));
		return { ...base, reachable: false, ok: false, latencyMs: elapsed(), error: { kind, message } };
	}
}

export interface LlmRunMeta {
	llm: LlmProviderKind;
	model: string;
	seed: number | null;
	temperature: number | null;
	numCtx: number | null;
}

/** Metadata that names the model behind an eval column (Phase 6). Key-free. */
export function llmRunMeta(config: LlmConfig): LlmRunMeta {
	if (config.provider === 'fake') {
		return { llm: 'fake', model: FAKE_MODEL, seed: null, temperature: null, numCtx: null };
	}
	if (config.provider === 'ollama') {
		const o = config.ollama;
		return { llm: 'ollama', model: ollamaModelLabel(o), seed: o.seed, temperature: o.temperature, numCtx: o.numCtx };
	}
	const h = config.hosted;
	return { llm: 'hosted', model: h.model, seed: h.seed, temperature: h.temperature, numCtx: null };
}

import { describe, it, expect } from 'vitest';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { buildPlan } from '../agent/planner.ts';
import type { ChatCompletionsLike } from './openai-compat.ts';
import type { LLM } from './types.ts';
import {
	LlmConfigError,
	createLLM,
	createSlotRoutedLLM,
	describeLlmConfig,
	isOllamaUrl,
	llmRunMeta,
	parseLlmFlag,
	probeLlm,
	resolveLlmConfig,
	slotRole
} from './select.ts';
import * as llmBarrel from './index.ts';

const groqEnv = {
	LLM_BASE_URL: 'https://api.groq.com/openai/v1',
	LLM_API_KEY: 'gsk_test_SECRET',
	LLM_MODEL: 'openai/gpt-oss-20b'
};
const exampleEnv = {
	LLM_BASE_URL: 'http://127.0.0.1:11434/v1',
	LLM_API_KEY: '',
	LLM_MODEL: 'qwen3.5:4b',
	OLLAMA_URL: 'http://127.0.0.1:11434'
};
const ollamaConfig = resolveLlmConfig({});
const groqConfig = resolveLlmConfig(groqEnv);

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const chatResponse = (content: string) => jsonResponse({ message: { role: 'assistant', content } });

type Recorded = { url: string; body: Record<string, unknown> | null; init?: RequestInit };
function mockFetch(responder: (url: string, body: Record<string, unknown> | null) => Response | Promise<Response>) {
	const calls: Recorded[] = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
		calls.push({ url, body, init });
		return responder(url, body);
	}) as typeof fetch;
	return { f, calls };
}

describe('resolveLlmConfig', () => {
	it('defaults to local Ollama with the phrasing/grounding split', () => {
		expect(resolveLlmConfig({})).toEqual({
			provider: 'ollama',
			ollama: {
				baseUrl: 'http://127.0.0.1:11434',
				phrasingModel: 'qwen3.5:4b',
				groundingModel: 'qwen2.5-coder:7b',
				timeoutMs: 180000,
				numCtx: 8192,
				seed: 42,
				temperature: 0,
				keepAlive: '10m'
			}
		});
	});

	it('selects Ollama for the .env.example values', () => {
		const cfg = resolveLlmConfig(exampleEnv);
		expect(cfg.provider).toBe('ollama');
		if (cfg.provider !== 'ollama') throw new Error('unreachable');
		expect(cfg.ollama.baseUrl).toBe('http://127.0.0.1:11434');
		expect(cfg.ollama.phrasingModel).toBe('qwen3.5:4b');
	});

	it('normalizes a localhost /v1 URL and honors LLM_MODEL locally', () => {
		const cfg = resolveLlmConfig({ LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3.2:3b' });
		expect(cfg.provider).toBe('ollama');
		if (cfg.provider !== 'ollama') throw new Error('unreachable');
		expect(cfg.ollama.baseUrl).toBe('http://127.0.0.1:11434');
		expect(cfg.ollama.phrasingModel).toBe('llama3.2:3b');
	});

	it('selects the hosted provider for a Groq env', () => {
		expect(groqConfig).toEqual({
			provider: 'hosted',
			hosted: {
				baseURL: 'https://api.groq.com/openai/v1',
				apiKey: 'gsk_test_SECRET',
				model: 'openai/gpt-oss-20b',
				timeoutMs: 60000,
				seed: 42,
				temperature: 0,
				reasoningEffort: 'low'
			}
		});
	});

	it('only defaults reasoningEffort for gpt-oss models; LLM_REASONING_EFFORT overrides', () => {
		const other = resolveLlmConfig({ ...groqEnv, LLM_MODEL: 'llama-3.3-70b-versatile' });
		if (other.provider !== 'hosted') throw new Error('unreachable');
		expect('reasoningEffort' in other.hosted).toBe(false);
		const over = resolveLlmConfig({ ...groqEnv, LLM_REASONING_EFFORT: 'medium' });
		if (over.provider !== 'hosted') throw new Error('unreachable');
		expect(over.hosted.reasoningEffort).toBe('medium');
	});

	it('rejects incomplete hosted configs without leaking values', () => {
		expect(() => resolveLlmConfig({ ...groqEnv, LLM_API_KEY: '' })).toThrow(LlmConfigError);
		expect(() => resolveLlmConfig({ ...groqEnv, LLM_API_KEY: '' })).toThrow(/LLM_API_KEY/);
		expect(() => resolveLlmConfig({ ...groqEnv, LLM_MODEL: undefined })).toThrow(/LLM_MODEL/);
		expect(() => resolveLlmConfig({ LLM_PROVIDER: 'hosted' })).toThrow(/LLM_BASE_URL/);
		expect(() => resolveLlmConfig({ LLM_PROVIDER: 'hosted', LLM_BASE_URL: 'http://127.0.0.1:11434/v1' })).toThrow(
			/LLM_BASE_URL/
		);
		try {
			resolveLlmConfig({ ...groqEnv, LLM_MODEL: '' });
		} catch (e) {
			expect(String((e as Error).message)).not.toContain('gsk_test_SECRET');
		}
	});

	it('applies provider overrides', () => {
		expect(resolveLlmConfig(groqEnv, { provider: 'fake' })).toEqual({ provider: 'fake' });
		const forced = resolveLlmConfig(groqEnv, { provider: 'ollama' });
		if (forced.provider !== 'ollama') throw new Error('unreachable');
		expect(forced.ollama.phrasingModel).toBe('qwen3.5:4b');
		expect(forced.ollama.baseUrl).toBe('http://127.0.0.1:11434');
		const withModel = resolveLlmConfig({ ...groqEnv, OLLAMA_MODEL: 'llama3.2:3b' }, { provider: 'ollama' });
		if (withModel.provider !== 'ollama') throw new Error('unreachable');
		expect(withModel.ollama.phrasingModel).toBe('llama3.2:3b');
		expect(() => resolveLlmConfig({ LLM_PROVIDER: 'bogus' })).toThrow(LlmConfigError);
	});

	it('reads numeric env and rejects non-numeric values', () => {
		const cfg = resolveLlmConfig({ OLLAMA_NUM_CTX: '4096', LLM_SEED: '7', LLM_TIMEOUT_MS: '30000' });
		if (cfg.provider !== 'ollama') throw new Error('unreachable');
		expect(cfg.ollama.numCtx).toBe(4096);
		expect(cfg.ollama.seed).toBe(7);
		expect(cfg.ollama.timeoutMs).toBe(30000);
		expect(() => resolveLlmConfig({ OLLAMA_NUM_CTX: 'big' })).toThrow(LlmConfigError);
		expect(() => resolveLlmConfig({ LLM_SEED: 'x' })).toThrow(/LLM_SEED/);
	});
});

describe('parseLlmFlag / isOllamaUrl / slotRole', () => {
	it('parses the --llm flag', () => {
		expect(parseLlmFlag(undefined)).toBe('fake');
		expect(parseLlmFlag('ollama')).toBe('ollama');
		expect(parseLlmFlag('hosted')).toBe('hosted');
		expect(() => parseLlmFlag('gpt')).toThrow(LlmConfigError);
	});

	it('detects Ollama URLs by port', () => {
		expect(isOllamaUrl('http://127.0.0.1:11434/v1')).toBe(true);
		expect(isOllamaUrl('https://api.groq.com/openai/v1')).toBe(false);
		expect(isOllamaUrl('not a url')).toBe(false);
		expect(isOllamaUrl(undefined)).toBe(false);
	});

	it('routes grounding-critical slots to the grounding role', () => {
		for (const s of ['critique', 'claims', 'evidence', 'grounding']) expect(slotRole(s)).toBe('grounding');
		for (const s of ['draft', 'gap_actions', 'whatever', 'toString']) expect(slotRole(s)).toBe('phrasing');
	});
});

describe('createLLM', () => {
	it('routes Ollama slots to the phrasing or grounding model', async () => {
		const { f, calls } = mockFetch(() => chatResponse('{"ok":true}'));
		const llm = createLLM(ollamaConfig, { fetch: f });
		expect(llm.model).toBe('ollama/qwen3.5:4b+qwen2.5-coder:7b');
		for (const slot of ['critique', 'draft', 'misc']) await llm.completeJSON({ slot, system: 's', input: {} });
		expect(calls.map((c) => c.body?.model)).toEqual(['qwen2.5-coder:7b', 'qwen3.5:4b', 'qwen3.5:4b']);
	});

	it('uses one model when grounding equals phrasing', async () => {
		const { f, calls } = mockFetch(() => chatResponse('{"ok":true}'));
		const llm = createLLM(resolveLlmConfig({ LLM_GROUNDING_MODEL: 'qwen3.5:4b' }), { fetch: f });
		expect(llm.model).toBe('ollama/qwen3.5:4b');
		for (const slot of ['critique', 'draft']) await llm.completeJSON({ slot, system: 's', input: {} });
		expect(calls.map((c) => c.body?.model)).toEqual(['qwen3.5:4b', 'qwen3.5:4b']);
	});

	it('uses LLM_MODEL for every hosted slot', async () => {
		const models: unknown[] = [];
		const client: ChatCompletionsLike = {
			chat: {
				completions: {
					create: async (body) => {
						models.push(body.model);
						return { choices: [{ message: { content: '{"ok":true}' } }] };
					}
				}
			}
		};
		const llm = createLLM(groqConfig, { openaiClient: client });
		expect(llm.model).toBe('openai/gpt-oss-20b');
		for (const slot of ['critique', 'draft']) {
			expect(await llm.completeJSON({ slot, system: 's', input: {} })).toEqual({ ok: true });
		}
		expect(models).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
	});

	it('builds the fake LLM', () => {
		expect(createLLM({ provider: 'fake' }).model).toBe('fake-scripted');
	});

	it('createSlotRoutedLLM delegates by slot', async () => {
		const mk = (name: string): LLM => ({ model: name, completeJSON: async () => name });
		const a = mk('a');
		const b = mk('b');
		const routed = createSlotRoutedLLM((slot) => (slot === 'x' ? a : b), 'label');
		expect(routed.model).toBe('label');
		expect(await routed.completeJSON({ slot: 'x', system: '', input: null })).toBe('a');
		expect(await routed.completeJSON({ slot: 'y', system: '', input: null })).toBe('b');
	});
});

describe('buildPlan over the routed Ollama backend (mocked transport)', () => {
	it('produces 23 think-free actions with critique on coder:7b and drafts on qwen3.5:4b', async () => {
		const schools = SchoolsDataset.parse(schoolsRaw);
		const demo = Profile.parse(demoRaw);
		const today = '2026-09-13';
		const { f, calls } = mockFetch((_url, body) => {
			const messages = (body?.messages ?? []) as { content: string }[];
			const system = messages[0]?.content ?? '';
			if (system.includes('essay feedback')) {
				return chatResponse(
					'<think>scratch</think>' +
						JSON.stringify({
							policyNote: 'Policy <think>x</think>ok',
							sections: [{ heading: 'Essay', comments: ['Which paragraph answers the prompt?'] }]
						})
				);
			}
			return chatResponse(JSON.stringify({ subject: 'Question <think>y</think>about transfer', body: 'Hello,\n\nThanks.' }));
		});
		const plan = await buildPlan({
			profile: demo,
			schools,
			reports: analyzeGaps(demo, schools, { today }),
			today,
			createdAt: '2026-09-13T17:00:00.000Z',
			llm: createLLM(resolveLlmConfig({}), { fetch: f })
		});
		expect(plan.actions).toHaveLength(23);
		expect(JSON.stringify(plan)).not.toMatch(/<\/?think/i);
		expect(calls.filter((c) => c.body?.model === 'qwen2.5-coder:7b')).toHaveLength(3);
		expect(calls.filter((c) => c.body?.model === 'qwen3.5:4b')).toHaveLength(4);
		for (const c of calls) {
			expect(c.body?.think).toBe(false);
			expect(typeof c.body?.format).toBe('object');
			expect(c.body?.format).not.toBeNull();
		}
	});
});

describe('describeLlmConfig / probeLlm / llmRunMeta', () => {
	it('describes hosted configs by origin, never with the key', () => {
		const d = describeLlmConfig(groqConfig);
		expect(d).toEqual({
			provider: 'hosted',
			baseUrl: 'https://api.groq.com',
			models: { hosted: 'openai/gpt-oss-20b' },
			hasApiKey: true,
			seed: 42,
			temperature: 0
		});
		expect(JSON.stringify(d)).not.toContain('gsk_test_SECRET');
	});

	it('describes ollama and fake configs', () => {
		expect(describeLlmConfig(ollamaConfig)).toEqual({
			provider: 'ollama',
			baseUrl: 'http://127.0.0.1:11434',
			models: { phrasing: 'qwen3.5:4b', grounding: 'qwen2.5-coder:7b' },
			hasApiKey: false,
			seed: 42,
			temperature: 0,
			numCtx: 8192
		});
		expect(describeLlmConfig({ provider: 'fake' })).toEqual({
			provider: 'fake',
			baseUrl: null,
			models: { fake: 'fake-scripted' },
			hasApiKey: false
		});
	});

	it('probes Ollama and reports missing models', async () => {
		let t = 100;
		const now = () => (t += 6);
		const { f, calls } = mockFetch(() => jsonResponse({ models: [{ name: 'qwen3.5:4b' }] }));
		const probe = await probeLlm(ollamaConfig, { fetch: f, now });
		expect(calls[0].url).toBe('http://127.0.0.1:11434/api/tags');
		expect(probe.provider).toBe('ollama');
		expect(probe.reachable).toBe(true);
		expect(probe.ok).toBe(false);
		expect(probe.missingModels).toEqual(['qwen2.5-coder:7b']);
		expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
		expect(probe.description).toEqual(describeLlmConfig(ollamaConfig));
	});

	it('accepts :latest-suffixed names and reports ok', async () => {
		const { f } = mockFetch(() =>
			jsonResponse({ models: [{ name: 'qwen3.5:4b' }, { name: 'qwen2.5-coder:7b' }] })
		);
		const probe = await probeLlm(ollamaConfig, { fetch: f });
		expect(probe.ok).toBe(true);
		expect(probe.missingModels).toEqual([]);
		const latest = resolveLlmConfig({ LLM_MODEL: 'llama3.2', LLM_GROUNDING_MODEL: 'llama3.2' });
		const { f: f2 } = mockFetch(() => jsonResponse({ models: [{ name: 'llama3.2:latest' }] }));
		expect((await probeLlm(latest, { fetch: f2 })).ok).toBe(true);
	});

	it('reports unreachable Ollama', async () => {
		const f = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof fetch;
		const probe = await probeLlm(ollamaConfig, { fetch: f });
		expect(probe.reachable).toBe(false);
		expect(probe.ok).toBe(false);
		expect(probe.error?.kind).toBe('unavailable');
	});

	it('probes the hosted /models endpoint with the key, never echoing it', async () => {
		const { f, calls } = mockFetch(() => jsonResponse({ data: [] }));
		const probe = await probeLlm(groqConfig, { fetch: f });
		expect(calls[0].url).toBe('https://api.groq.com/openai/v1/models');
		expect((calls[0].init?.headers as Record<string, string>).authorization).toBe('Bearer gsk_test_SECRET');
		expect(probe.reachable).toBe(true);
		expect(probe.ok).toBe(true);
		expect(JSON.stringify(probe)).not.toContain('gsk_test_SECRET');
	});

	it('maps hosted 401 to auth and rejections to unavailable, without the key', async () => {
		const { f } = mockFetch(() => jsonResponse({ error: 'bad key gsk_test_SECRET' }, 401));
		const auth = await probeLlm(groqConfig, { fetch: f });
		expect(auth.reachable).toBe(true);
		expect(auth.ok).toBe(false);
		expect(auth.error?.kind).toBe('auth');
		expect(JSON.stringify(auth)).not.toContain('gsk_test_SECRET');

		const down = (async () => {
			throw new TypeError('connect failed for gsk_test_SECRET');
		}) as typeof fetch;
		const unreachable = await probeLlm(groqConfig, { fetch: down });
		expect(unreachable.reachable).toBe(false);
		expect(unreachable.error?.kind).toBe('unavailable');
		expect(JSON.stringify(unreachable)).not.toContain('gsk_test_SECRET');

		const { f: f500 } = mockFetch(() => jsonResponse({}, 503));
		const server = await probeLlm(groqConfig, { fetch: f500 });
		expect(server.reachable).toBe(true);
		expect(server.error?.kind).toBe('unavailable');
	});

	it('probes fake immediately', async () => {
		const probe = await probeLlm({ provider: 'fake' });
		expect(probe.reachable).toBe(true);
		expect(probe.ok).toBe(true);
		expect(probe.latencyMs).toBe(0);
	});

	it('builds eval-column run metadata', () => {
		expect(llmRunMeta(ollamaConfig)).toEqual({
			llm: 'ollama',
			model: 'qwen3.5:4b+qwen2.5-coder:7b',
			seed: 42,
			temperature: 0,
			numCtx: 8192
		});
		expect(llmRunMeta(groqConfig)).toEqual({
			llm: 'hosted',
			model: 'openai/gpt-oss-20b',
			seed: 42,
			temperature: 0,
			numCtx: null
		});
		expect(llmRunMeta({ provider: 'fake' })).toEqual({
			llm: 'fake',
			model: 'fake-scripted',
			seed: null,
			temperature: null,
			numCtx: null
		});
		expect(JSON.stringify(llmRunMeta(groqConfig))).not.toContain('gsk_test_SECRET');
	});
});

describe('llm barrel', () => {
	it('re-exports the backends and selection helpers', () => {
		for (const name of [
			'callSlot',
			'createFakeLLM',
			'createOllamaLLM',
			'createOpenAICompatLLM',
			'resolveLlmConfig',
			'createLLM',
			'probeLlm',
			'LLMError',
			'LLMSlotError'
		]) {
			expect((llmBarrel as Record<string, unknown>)[name], name).toBeDefined();
		}
	});
});

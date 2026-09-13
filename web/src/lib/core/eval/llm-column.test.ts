import { describe, expect, it, vi } from 'vitest';
import { createFakeLLM } from '../llm/fake.ts';
import { describeLlmConfig, resolveLlmConfig, type LlmEnv, type LlmProbe, type LlmProviderKind } from '../llm/select.ts';
import { resolveLlmColumn } from './llm-column.ts';
import { buildLlmScript } from './llm-scripts.ts';
import { buildEvalsFile, mergeEvalsFiles, renderMarkdownTables } from './report.ts';
import { fakeColumns, runSuite } from './runner.ts';
import { getScenario } from './scenarios.ts';

const META = { generatedAt: '2026-09-13T20:00:00.000Z', commitSha: 'abc1234', seed: 1337 };
const HOSTED: LlmEnv = { LLM_BASE_URL: 'https://api.groq.com/openai/v1', LLM_MODEL: 'openai/gpt-oss-20b' };

function probeFor(env: LlmEnv, provider: LlmProviderKind, patch: Partial<LlmProbe>): LlmProbe {
	return {
		provider,
		description: describeLlmConfig(resolveLlmConfig(env, { provider })),
		reachable: true,
		ok: true,
		latencyMs: 1,
		missingModels: [],
		...patch
	};
}

describe('resolveLlmColumn errors (no network)', () => {
	it('hosted without config: config error naming LLM_BASE_URL, no probe', async () => {
		const probe = vi.fn();
		const r = await resolveLlmColumn('hosted', {}, { probe });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message.startsWith('LLM config error for --llm hosted:')).toBe(true);
		expect(r.message).toContain('LLM_BASE_URL');
		expect(probe).not.toHaveBeenCalled();
	});

	it('hosted without key names LLM_API_KEY', async () => {
		const probe = vi.fn();
		const r = await resolveLlmColumn('hosted', HOSTED, { probe });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('LLM_API_KEY');
		expect(probe).not.toHaveBeenCalled();
	});

	it('hosted probe auth failure never leaks the key', async () => {
		const env = { ...HOSTED, LLM_API_KEY: 'gsk_test_SECRET' };
		const probe = async () =>
			probeFor(env, 'hosted', { ok: false, reachable: true, error: { kind: 'auth', message: 'bad key gsk_test_SECRET' } });
		const r = await resolveLlmColumn('hosted', env, { probe });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message).toContain('Hosted LLM probe failed (auth)');
		expect(r.message).not.toContain('gsk_test_SECRET');
	});

	it('ollama unreachable', async () => {
		const probe = async () =>
			probeFor({}, 'ollama', { ok: false, reachable: false, error: { kind: 'unavailable', message: 'fetch failed' } });
		const r = await resolveLlmColumn('ollama', {}, { probe });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message).toContain('Ollama is not reachable at http://127.0.0.1:11434');
		expect(r.message).toContain('--llm fake');
	});

	it('ollama missing models names the pull command', async () => {
		const probe = async () => probeFor({}, 'ollama', { ok: false, reachable: true, missingModels: ['qwen2.5-coder:7b'] });
		const r = await resolveLlmColumn('ollama', {}, { probe });
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.message).toContain('missing model(s): qwen2.5-coder:7b');
		expect(r.message).toContain('ollama pull qwen2.5-coder:7b');
	});

	it('fake is rejected (baseline uses fakeColumns)', async () => {
		const r = await resolveLlmColumn('fake', {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('fakeColumns');
	});

	it('invalid kind', async () => {
		const r = await resolveLlmColumn('gpt', {});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('fake|ollama|hosted');
	});
});

describe('resolveLlmColumn success (injected fake backend)', () => {
	const deps = {
		probe: async () => probeFor({}, 'ollama', {}),
		createLLM: () => createFakeLLM(buildLlmScript('default'))
	};

	it('builds a verifier-on llm column with model metadata', async () => {
		const r = await resolveLlmColumn('ollama', {}, deps);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const c = r.column;
		expect(c.id).toBe('llm-ollama');
		expect(c.kind).toBe('llm');
		expect(c.config.id).toBe('verifier-on');
		expect(c.model).toBe('qwen3.5:4b+qwen2.5-coder:7b');
		expect(c.label).toBe('qwen3.5:4b+qwen2.5-coder:7b (ollama)');
		expect(c.llmMeta).toEqual({ provider: 'ollama', seed: 42, temperature: 0, numCtx: 8192 });
	});

	it('runs through runSuite and merges beside the fake baseline', async () => {
		const r = await resolveLlmColumn('ollama', {}, deps);
		if (!r.ok) throw new Error(r.message);
		const s = await runSuite({ scenarios: [getScenario('happy-path')], columns: [r.column], n: 1, seed: 1337 });
		expect(s.records).toHaveLength(1);
		expect(s.records[0].passed).toBe(true);

		const baseSuite = await runSuite({
			scenarios: [getScenario('happy-path'), getScenario('lying-success')],
			columns: fakeColumns(),
			n: 1,
			seed: 1337
		});
		const base = buildEvalsFile(baseSuite, META);
		const merged = mergeEvalsFiles(base, buildEvalsFile(s, META));
		expect(merged.scenarios.map((x) => x.results.fake)).toEqual(base.scenarios.map((x) => x.results.fake));
		const m = merged.models.find((x) => x.id === 'llm-ollama');
		expect(m?.llm?.provider).toBe('ollama');
		const hp = renderMarkdownTables(merged)
			.split('\n')
			.find((l) => l.startsWith('| happy-path |'))!
			.split('|')
			.slice(1, -1)
			.map((x) => x.trim());
		expect(hp[4]).not.toBe('not run');
	}, 15000);
});

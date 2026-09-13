// LLM-backed eval column (Phase 6 x Phase 8). Core: env and I/O-bearing deps are injected; the eval CLI passes the environment.
//
// Chain: parseLlmFlag -> resolveLlmConfig(env, { provider }) -> probeLlm (before any run) -> createLLM + llmRunMeta.
// Every unavailable backend becomes { ok: false, message } with the API key redacted, so the CLI can exit 2 cleanly.
import type { LLM } from '../llm/types.ts';
import { redactSecret } from '../llm/common.ts';
import {
	LlmConfigError,
	createLLM,
	llmRunMeta,
	parseLlmFlag,
	probeLlm,
	resolveLlmConfig,
	type LlmConfig,
	type LlmEnv,
	type LlmProbe,
	type LlmProviderKind
} from '../llm/select.ts';
import type { ModelColumn } from './runner.ts';
import { AGENT_CONFIGS } from './types.ts';

export interface LlmColumnDeps {
	createLLM?: (config: LlmConfig) => LLM;
	probe?: (config: LlmConfig) => Promise<LlmProbe>;
}

export type LlmColumnResult = { ok: true; column: ModelColumn; probe: LlmProbe } | { ok: false; message: string };

export async function resolveLlmColumn(kind: string, env: LlmEnv, deps: LlmColumnDeps = {}): Promise<LlmColumnResult> {
	const fail = (msg: string): LlmColumnResult => ({ ok: false, message: redactSecret(msg, env.LLM_API_KEY?.trim()) });

	let provider: LlmProviderKind;
	try {
		provider = parseLlmFlag(kind);
	} catch (e) {
		return fail(`${(e as Error).message}`);
	}
	if (provider === 'fake') return fail('resolveLlmColumn is for --llm ollama|hosted; the scripted baseline uses fakeColumns()');

	let cfg: LlmConfig;
	try {
		cfg = resolveLlmConfig(env, { provider });
	} catch (e) {
		if (!(e instanceof LlmConfigError)) throw e;
		return fail(`LLM config error for --llm ${provider}: ${e.message}`);
	}

	const probe = await (deps.probe ?? ((c: LlmConfig) => probeLlm(c)))(cfg);
	if (!probe.ok) {
		if (provider === 'ollama' && !probe.reachable) {
			return fail(
				`Ollama is not reachable at ${probe.description.baseUrl}: ${probe.error?.message ?? 'unknown error'}. Start Ollama (ollama serve) or run with --llm fake.`
			);
		}
		if (provider === 'ollama') {
			if (probe.missingModels.length) {
				return fail(
					`Ollama is missing model(s): ${probe.missingModels.join(', ')}. Install with: ${probe.missingModels.map((m) => 'ollama pull ' + m).join(' && ')}`
				);
			}
			return fail(`Ollama probe failed (${probe.error?.kind ?? 'unavailable'}): ${probe.error?.message ?? 'unknown error'}`);
		}
		return fail(`Hosted LLM probe failed (${probe.error?.kind ?? 'unavailable'}): ${probe.error?.message ?? 'unknown error'}`);
	}

	const llm = (deps.createLLM ?? ((c: LlmConfig) => createLLM(c)))(cfg);
	const meta = llmRunMeta(cfg);
	const column: ModelColumn = {
		id: `llm-${provider}`,
		label: `${meta.model} (${provider})`,
		kind: 'llm',
		config: AGENT_CONFIGS['verifier-on'],
		model: meta.model,
		llm: () => llm,
		llmMeta: { provider: meta.llm, seed: meta.seed, temperature: meta.temperature, numCtx: meta.numCtx }
	};
	return { ok: true, column, probe };
}

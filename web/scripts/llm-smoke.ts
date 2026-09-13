/**
 * Live LLM smoke: which backends are configured and reachable, how fast they answer, and whether the output passes zod.
 *
 * Run: cd web && npx tsx scripts/llm-smoke.ts [--sprint] [--llm ollama|hosted] [--local-only] [--hosted-only] [--warm]
 *
 * - Pings local Ollama (default http://127.0.0.1:11434, or OLLAMA_URL) and runs one schema-constrained call per routed
 *   model: phrasing slot 'normalize' (qwen3.5:4b) and grounding slot 'critique' (qwen2.5-coder:7b). The first call per
 *   model includes the cold model load. `--warm` adds a second phrasing call, printed as (warm).
 * - Pings the hosted OpenAI-compatible endpoint only if LLM_API_KEY is set.
 * - Unreachable or unconfigured backends print SKIP and don't fail. Schema misses are findings, not crashes: the base
 *   smoke always exits 0.
 * - `--sprint` runs the hero sprint on mock apps with the real LLM (slow locally: ~3-4 min with coder:7b critiques)
 *   and exits 1 only if think tags reach artifacts or the sprint throws.
 * - Never prints key values: only describeLlmConfig output (origin, models, hasApiKey).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// Type-only (erased at runtime): the base smoke must still run if the sprint module is absent.
import type * as SprintModule from '../src/lib/core/agent/sprint.ts';
import {
	LLMSlotError,
	LlmConfigError,
	callSlot,
	createLLM,
	describeLlmConfig,
	isLLMError,
	probeLlm,
	resolveLlmConfig,
	type LLM,
	type LlmConfig,
	type LlmProviderKind
} from '../src/lib/core/llm/index.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const envPath = join(WEB, '.env');
if (existsSync(envPath)) {
	try {
		process.loadEnvFile(envPath); // does not override variables already set in the shell
	} catch {
		// unreadable .env: continue with the shell env
	}
}

/** Single output channel. Only pre-sanitized strings reach it. */
const say = (line: string) => console.log(line);

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const llmIdx = argv.indexOf('--llm');
const args = {
	sprint: flag('--sprint'),
	localOnly: flag('--local-only'),
	hostedOnly: flag('--hosted-only'),
	warm: flag('--warm'),
	llm: llmIdx >= 0 ? argv[llmIdx + 1] : undefined
};

const Normalized = z.object({ officialName: z.string().min(3).max(120), isTransferQuestion: z.boolean() });
const smokeReq = {
	system:
		'Normalize the school name to its official full name and say whether the text is about transferring. Use only the input.',
	input: { text: 'UC Berkeley transfer deadline?' }
};

type Status = 'ok' | 'invalid' | 'error' | 'skip';
const rank: Record<Status, number> = { skip: 0, ok: 1, invalid: 2, error: 3 };
const worse = (a: Status, b: Status): Status => (rank[b] > rank[a] ? b : a);

function errText(e: unknown): string {
	if (isLLMError(e)) return `${e.kind}: ${e.message}`;
	return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function runOne(label: string, llm: LLM, slot: string): Promise<Status> {
	const t0 = performance.now();
	const ms = () => Math.round(performance.now() - t0);
	let status: Status;
	let schemaValid = false;
	let grounded: boolean | undefined;
	let tail: string;
	try {
		const out = await callSlot(llm, Normalized, { slot, ...smokeReq });
		status = 'ok';
		schemaValid = true;
		grounded = /University of California,? Berkeley/i.test(out.officialName);
		tail = JSON.stringify(out).slice(0, 120);
	} catch (e) {
		if (e instanceof LLMSlotError) {
			status = 'invalid';
			tail = e.issues.slice(0, 160);
		} else {
			status = 'error';
			tail = errText(e).slice(0, 240);
		}
	}
	const normalized = grounded !== undefined ? ` normalized=${grounded ? 'yes' : 'no'}` : '';
	say(
		`${label.padEnd(34)} slot=${slot.padEnd(9)} latency=${ms()}ms schemaValid=${schemaValid ? 'yes' : 'no'}${normalized} ${tail}`
	);
	return status;
}

async function localSection(): Promise<Status> {
	let cfg: LlmConfig;
	try {
		cfg = resolveLlmConfig(process.env, { provider: 'ollama' });
	} catch (e) {
		say(`SKIP ollama: ${e instanceof LlmConfigError ? e.message : errText(e)}`);
		return 'skip';
	}
	if (cfg.provider !== 'ollama') return 'skip';
	say(`ollama: ${JSON.stringify(describeLlmConfig(cfg))}`);
	const probe = await probeLlm(cfg);
	if (!probe.reachable) {
		say(`SKIP ollama: ${probe.error?.message ?? 'unreachable'}`);
		return 'skip';
	}
	say(`ollama reachable in ${probe.latencyMs}ms; missing models: ${probe.missingModels.join(', ') || 'none'}`);

	const { phrasingModel, groundingModel } = cfg.ollama;
	const llm = createLLM(cfg);
	let status: Status = 'skip';
	if (probe.missingModels.includes(phrasingModel)) {
		say(`SKIP ${phrasingModel}: not pulled (ollama pull ${phrasingModel})`);
	} else {
		status = worse(status, await runOne(`ollama/${phrasingModel} (cold)`, llm, 'normalize'));
		if (args.warm) status = worse(status, await runOne(`ollama/${phrasingModel} (warm)`, llm, 'normalize'));
	}
	if (groundingModel !== phrasingModel) {
		if (probe.missingModels.includes(groundingModel)) {
			say(`SKIP ${groundingModel}: not pulled (ollama pull ${groundingModel})`);
		} else {
			status = worse(status, await runOne(`ollama/${groundingModel} (cold)`, llm, 'critique'));
		}
	}
	return status;
}

async function hostedSection(): Promise<Status> {
	if (!process.env.LLM_API_KEY?.trim()) {
		say('SKIP hosted: LLM_API_KEY not set');
		return 'skip';
	}
	let cfg: LlmConfig;
	try {
		cfg = resolveLlmConfig(process.env, { provider: 'hosted' });
	} catch (e) {
		// LlmConfigError messages name env keys, never values.
		say(`SKIP hosted: ${e instanceof LlmConfigError ? e.message : 'invalid hosted configuration'}`);
		return 'skip';
	}
	const description = describeLlmConfig(cfg);
	say(`hosted: ${JSON.stringify(description)}`);
	const probe = await probeLlm(cfg);
	say(
		`hosted probe: reachable=${probe.reachable} ok=${probe.ok} latency=${probe.latencyMs}ms` +
			(probe.error ? ` ${probe.error.kind}: ${probe.error.message}` : '')
	);
	if (!probe.reachable) return 'error';
	return runOne(`hosted/${description.models.hosted ?? 'model'}`, createLLM(cfg), 'normalize');
}

async function sprintSection(): Promise<void> {
	let kind: LlmProviderKind;
	let cfg: LlmConfig;
	try {
		kind = args.llm === undefined ? 'ollama' : (args.llm as LlmProviderKind);
		cfg = resolveLlmConfig(process.env, { provider: kind });
	} catch (e) {
		say(`SKIP sprint: ${e instanceof LlmConfigError ? e.message : errText(e)}`);
		return;
	}

	let sprintMod: typeof SprintModule;
	try {
		sprintMod = await import('../src/lib/core/agent/sprint.ts');
	} catch {
		say('SKIP sprint: agent/sprint.ts not available yet');
		return;
	}
	const connectorsMod = await import('../src/lib/core/connectors/index.ts');
	const tracerMod = await import('../src/lib/core/trace/tracer.ts');
	const schemas = await import('../src/lib/core/schemas.ts');

	const schools = schemas.SchoolsDataset.parse(
		JSON.parse(readFileSync(join(WEB, 'src/lib/core/data/schools.json'), 'utf8'))
	);
	const profile = schemas.Profile.parse(
		JSON.parse(readFileSync(join(WEB, 'src/lib/core/data/profiles/demo.json'), 'utf8'))
	);
	const mem = new tracerMod.MemorySink();
	const tracer = tracerMod.createTracer({ sinks: [mem], traceId: 'llm-smoke-sprint' });
	const bundle = connectorsMod.createConnectors({ mode: 'mock' });
	const llm = createLLM(cfg);
	const envSecret = process.env.PLAN_SIGNING_SECRET;
	const rt = {
		connectors: bundle,
		mode: 'mock' as const,
		llm,
		tracer,
		planSecret: envSecret && envSecret.length >= 16 ? envSecret : 'llm-smoke-local-secret',
		today: connectorsMod.DEFAULT_CLOCK.slice(0, 10),
		sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
	};

	say(`sprint: ${JSON.stringify(describeLlmConfig(cfg))} today=${rt.today}`);
	const t0 = performance.now();
	try {
		const { plan, planToken } = await sprintMod.planSprint(rt, {
			profile,
			schools,
			createdAt: `${rt.today}T17:00:00.000Z`
		});
		const planSec = ((performance.now() - t0) / 1000).toFixed(1);
		say(`plan: ${plan.actions.length} actions; blockers: ${plan.blockers.map((b) => b.code).join(', ') || 'none'} (${planSec}s)`);
		const slotEvents = mem.events.filter((e) => e.name === 'llm.slot');
		const failed = slotEvents.filter((e) => (e.attrs as { ok?: unknown } | undefined)?.ok === false).length;
		say(`llm.slot events: ${slotEvents.length} (${failed} failed attempts → repairs)`);
		say(`LLM_SLOT_FAILED: ${(JSON.stringify(plan).match(/LLM_SLOT_FAILED/g) ?? []).length}`);

		const report = await sprintMod.executeSprint(rt, {
			plan,
			planToken,
			approvedIds: sprintMod.allActionIds(plan),
			profile
		});
		say(`report: ${report.status} ${JSON.stringify(report.counts)}`);

		const state = bundle.world.state as unknown as {
			docs: { docs: Record<string, unknown>[] };
			gmail: { drafts: Record<string, unknown>[] };
		};
		const leaks = (items: Record<string, unknown>[], fields: string[]) =>
			items.filter((it) => fields.some((f) => /<\/?think/i.test(String(it[f] ?? '')))).length;
		const k = leaks(state.docs.docs, ['title', 'body']) + leaks(state.gmail.drafts, ['subject', 'body']);
		say(`thinkTagsInArtifacts: ${k}`);
		say(`model: ${llm.model}`);
		say(`total: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
		if (k > 0) process.exitCode = 1;
	} catch (e) {
		say(isLLMError(e) ? `SPRINT ERROR ${e.kind}: ${e.message}` : `SPRINT ERROR ${errText(e)}`);
		say(`total: ${((performance.now() - t0) / 1000).toFixed(1)}s`);
		process.exitCode = 1;
	}
}

async function main() {
	if (args.sprint) {
		await sprintSection();
		return;
	}
	const ollama = args.hostedOnly ? 'skip' : await localSection();
	const hosted = args.localOnly ? 'skip' : await hostedSection();
	say(`SMOKE ollama=${ollama} hosted=${hosted}`);
}

await main();

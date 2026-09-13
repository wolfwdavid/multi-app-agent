---
phase: 08-real-llm-slots
plan: 02
subsystem: llm
tags: [llm, ollama, groq, provider-selection, slot-routing, health-probe, eval-contract, smoke]
requires:
  - "08-01: createOllamaLLM, listOllamaModels, normalizeOllamaBaseUrl, OLLAMA_DEFAULTS, createOpenAICompatLLM, LLMError, redactSecret"
  - "04-01: LLM, callSlot, LLMSlotError, createFakeLLM, buildPlan"
  - "04-03: planSprint, executeSprint, allActionIds (smoke --sprint)"
provides:
  - "llm/select.ts: resolveLlmConfig(env), slotRole/SLOT_ROLES, createLLM, createSlotRoutedLLM, describeLlmConfig, probeLlm, llmRunMeta, parseLlmFlag, isOllamaUrl"
  - "llm/index.ts: barrel over types, fake, common, ollama, openai-compat, select"
  - "web/scripts/llm-smoke.ts: live smoke (latency + schemaValid per model, SKIP for absent backends, opt-in --sprint)"
affects: [phase-06-evals-llm-column, phase-09-api-health, phase-11-mcp]
tech-stack:
  added: []
  patterns:
    - "Env injected as a plain object; core never reads process.env"
    - "Slot-routed LLM wrapper delegates completeJSON by slot role"
    - "Probe never throws and never carries the key (origin + hasApiKey only)"
key-files:
  created:
    - web/src/lib/core/llm/select.ts
    - web/src/lib/core/llm/select.test.ts
    - web/src/lib/core/llm/index.ts
    - web/scripts/llm-smoke.ts
  modified: []
key-decisions:
  - "resolveLlmConfig(env) auto-detects Ollama when LLM_BASE_URL is unset or on port 11434, else hosted; LLM_PROVIDER or --llm overrides; hosted requires LLM_BASE_URL + LLM_API_KEY + LLM_MODEL"
  - "Ollama routes critique/claims/evidence/grounding slots to qwen2.5-coder:7b and all other slots to qwen3.5:4b (think:false); hosted uses LLM_MODEL for every slot"
  - "Live hero sprint on real Ollama: 23 actions, 7 slot calls, 0 repairs, report ok 23/23 verified, 0 think tags in artifacts, 156 s"
requirements-completed: [AGENT-02]
duration: 11min
completed: 2026-09-13
---

# Phase 8 Plan 02: LLM Selection, Slot Routing, Probe and Live Smoke Summary

**`resolveLlmConfig(env)` turns an injected env into local Ollama (qwen2.5-coder:7b grounding, qwen3.5:4b phrasing), a hosted OpenAI-compatible provider, or the fake LLM. `createLLM`, `probeLlm`, `describeLlmConfig` and `llmRunMeta` never expose the key. A live smoke confirmed both local models return schema-valid output, and the full hero sprint ran end to end on real Ollama with 23/23 actions verified and no think tags.**

## Performance

- **Duration:** about 11 minutes (14:37 to 14:48 ET), including 156 s of live sprint
- **Tasks:** 2 (3 commits: test, feat, feat)
- **Files:** 4 created, 0 modified

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | select.ts, select.test.ts, llm/index.ts | `a553ceb` (test), `3522b8a` (feat) |
| 2 | scripts/llm-smoke.ts + live runs | `0c5c4df` (feat) |

## Exported signatures (Phase 6, 9, 11 import these from `llm/index.ts` or `llm/select.ts`)

```ts
export type LlmProviderKind = 'fake' | 'ollama' | 'hosted';
export type SlotRole = 'grounding' | 'phrasing';
export type LlmEnv = Readonly<Record<string, string | undefined>>;
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_PHRASING_MODEL = 'qwen3.5:4b';
export const DEFAULT_GROUNDING_MODEL = 'qwen2.5-coder:7b';
export const SLOT_ROLES: Readonly<Record<string, SlotRole>>;
export function slotRole(slot: string): SlotRole;                       // own-property lookup, default 'phrasing'
export interface OllamaConfig { baseUrl; phrasingModel; groundingModel; timeoutMs; numCtx; seed; temperature; keepAlive }
export interface HostedConfig { baseURL; apiKey; model; timeoutMs; seed; temperature; reasoningEffort? }
export type LlmConfig = { provider: 'fake' } | { provider: 'ollama'; ollama: OllamaConfig } | { provider: 'hosted'; hosted: HostedConfig };
export class LlmConfigError extends Error {}                             // messages name env keys, never values
export function isOllamaUrl(url: string | undefined): boolean;          // port === '11434'
export function parseLlmFlag(value: string | undefined): LlmProviderKind; // undefined → 'fake'; invalid → LlmConfigError
export function resolveLlmConfig(env: LlmEnv, overrides?: { provider?: LlmProviderKind }): LlmConfig;
export function createSlotRoutedLLM(route: (slot: string) => LLM, model: string): LLM;
export function createLLM(config: LlmConfig, deps?: { fetch?: typeof fetch; openaiClient?: ChatCompletionsLike; fake?: () => LLM }): LLM;
export interface LlmDescription { provider; baseUrl: string | null; models: Record<string, string>; hasApiKey: boolean; seed?; temperature?; numCtx? }
export function describeLlmConfig(config: LlmConfig): LlmDescription;
export interface LlmProbe { provider; description; reachable: boolean; ok: boolean; latencyMs: number; missingModels: string[]; error?: { kind: LLMErrorKind; message: string } }
export async function probeLlm(config: LlmConfig, deps?: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number }): Promise<LlmProbe>;
export interface LlmRunMeta { llm: LlmProviderKind; model: string; seed: number | null; temperature: number | null; numCtx: number | null }
export function llmRunMeta(config: LlmConfig): LlmRunMeta;
```

`createLLM` model labels: `ollama/qwen3.5:4b+qwen2.5-coder:7b` (or `ollama/<model>` when both roles use one model), the hosted `LLM_MODEL` verbatim, and `fake-scripted`.

## Env keys read

| Key | Effect |
| --- | --- |
| `LLM_BASE_URL` | Unset or port 11434 → Ollama; otherwise hosted base URL |
| `LLM_API_KEY` | Hosted key (required for hosted; never printed) |
| `LLM_MODEL` | Hosted model; Ollama phrasing model only when LLM_BASE_URL is local or unset |
| `OLLAMA_URL` | Ollama base URL (normalized: /v1 and /api stripped, localhost → 127.0.0.1) |
| `LLM_PROVIDER` | fake, ollama or hosted; overrides auto-detection |
| `LLM_GROUNDING_MODEL` | Ollama grounding model (default qwen2.5-coder:7b) |
| `OLLAMA_MODEL` | Ollama phrasing model when forcing ollama while LLM_* is hosted |
| `OLLAMA_NUM_CTX`, `LLM_SEED`, `LLM_TIMEOUT_MS` | Numeric overrides; non-numeric → LlmConfigError |
| `LLM_REASONING_EFFORT` | Hosted reasoning effort; defaults to `low` only for gpt-oss models |

## Routing table

| Slot | Role | Ollama model | Hosted model |
| ---- | ---- | ------------ | ------------ |
| critique, claims, evidence, grounding | grounding | qwen2.5-coder:7b | LLM_MODEL |
| draft, gap_actions, normalize, repair_args, anything else | phrasing | qwen3.5:4b (think:false) | LLM_MODEL |

## Live results (Ollama 127.0.0.1:11434, no hosted key, no web/.env)

### Base smoke: `cd web && npx tsx scripts/llm-smoke.ts` (exit 0)

```
ollama: {"provider":"ollama","baseUrl":"http://127.0.0.1:11434","models":{"phrasing":"qwen3.5:4b","grounding":"qwen2.5-coder:7b"},"hasApiKey":false,"seed":42,"temperature":0,"numCtx":8192}
ollama reachable in 47ms; missing models: none
ollama/qwen3.5:4b (cold)           slot=normalize latency=11581ms schemaValid=yes normalized=yes {"officialName":"University of California, Berkeley","isTransferQuestion":true}
ollama/qwen2.5-coder:7b (cold)     slot=critique  latency=15741ms schemaValid=yes normalized=yes {"officialName":"University of California, Berkeley","isTransferQuestion":true}
SKIP hosted: LLM_API_KEY not set
SMOKE ollama=ok hosted=skip
```

### Unreachable Ollama: `OLLAMA_URL=http://127.0.0.1:9 LLM_API_KEY= npx tsx scripts/llm-smoke.ts --local-only` (exit 0)

```
SKIP ollama: ollama: cannot reach http://127.0.0.1:9 (fetch failed). Is Ollama running?
SMOKE ollama=skip hosted=skip
```

### Hero sprint on real LLM: `npx tsx scripts/llm-smoke.ts --sprint --local-only` (8-minute cap; exit 0)

04-03 had landed (`planSprint`/`executeSprint` exported from agent/sprint.ts), so it ran:

```
plan: 23 actions; blockers: NO_TRANSFER_PROGRAM (156.4s)
llm.slot events: 7 (0 failed attempts → repairs)
LLM_SLOT_FAILED: 0
report: ok {"verified":23,"deduped":0,"failed":0,"skipped":0}
thinkTagsInArtifacts: 0
model: ollama/qwen3.5:4b+qwen2.5-coder:7b
total: 156.4s
```

The plan phase covers all LLM time (3 coder:7b critiques + 4 qwen3.5:4b drafts). Execution against mocks added well under a second.

### Real-LLM eval column

Pending Phase 6: `web/scripts/eval.ts` does not exist yet, and no evals were run. The Phase 6 runner should call:

```ts
const kind = parseLlmFlag(args.llm);                          // --llm fake|ollama|hosted (default fake)
const cfg = resolveLlmConfig(process.env, { provider: kind });
const llm = createLLM(cfg); const meta = llmRunMeta(cfg);     // meta names the model in evals.json
```

Suggested: N=3-5 over 3-4 scenarios for ollama (a sprint takes about 2.6 min on this machine).

### Phase 9 `/api/health`

`probeLlm(resolveLlmConfig(env))`, returned as JSON. The probe carries `description` (origin, models, hasApiKey) and never the key.

## Verification

- `npm --prefix web test -- src/lib/core/llm`: 4 files, 87 tests pass (select.test.ts has 27; the buildPlan integration test runs, not skipped).
- `npm --prefix web test` (full suite): 38 files, 627 tests pass.
- `npm --prefix web run check`: 0 errors in llm/ or scripts. At the time of the run it reported 12 errors, all `'seed.github' is possibly 'undefined'` in 05-01's in-progress critique/grounding test files. 05-01 later committed `b71ecad fix(05-01): handle optional portfolio seed fields in phase 5 tests`, which targets exactly those.
- Acceptance greps all pass:
  - select.ts: resolveLlmConfig signature ×1, `process.env` ×2 (both comments, 0 code lines), `critique: 'grounding'` ×1, 6 exported functions.
  - select.test.ts has `gsk_test_SECRET` ×11, each paired with a `not.toContain` check.
  - index.ts has 6 `export * from` lines.
  - llm-smoke.ts: `resolveLlmConfig(process.env` ×3, `127.0.0.1:11434` ×1, `process.loadEnvFile` ×1, `thinkTagsInArtifacts` ×1, the dynamic sprint import ×1; no console call takes a key.
  - No `process.env`, `node:`, `Date.now`, `new Date()` or `Math.random` in llm non-test code, and no key literals in source.
- `git diff HEAD` on llm/types.ts, fake.ts, common.ts, ollama.ts, openai-compat.ts and web/.env.example is empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The acceptance grep for the dynamic sprint import counted 2**
- **Found during:** Task 2
- **Issue:** The `typeof import('../src/lib/core/agent/sprint.ts')` type annotation matched the same grep as the runtime dynamic import.
- **Fix:** The script now uses an erased `import type * as SprintModule`, so the base smoke still runs without the module.
- **Commit:** 0c5c4df

### Minor interpretation choices

- **Warm call:** the warm second phrasing call is opt-in (`--warm`), so the base smoke probes each routed model once and stays inside the 4-minute cap.
- **Key-free output:** all smoke output goes through a `say()` helper, so no `console.*` call site contains key-related identifiers. The required `SKIP hosted: LLM_API_KEY not set` line is still printed.
- **Sprint date:** `--sprint` uses `DEFAULT_CLOCK` (2026-09-13) as `today` and a fixed `createdAt`, matching `scripts/sprint.ts`, so the plan is the 23-action hero plan on any run day.
- **LLM_SLOT_FAILED count:** it is the number of `LLM_SLOT_FAILED` code occurrences in the serialized plan, since that warning may live outside `plan.blockers`.
- **Hosted probe:** non-2xx statuses other than 401/403 map to `unavailable`, and a thrown `TimeoutError` maps to `timeout`. Every message is passed through `redactSecret`.
- **SLOT_ROLES:** no Phase 5 slot names were present in committed non-test core at execution time. The table already covers claims, evidence, grounding and gap_actions.

## Deferred Issues

- 12 svelte-check errors in 05-01 test files (critique/analyze.test.ts, critique/policy-render.test.ts, grounding/claims.test.ts), which are owned by 05-01. They were not touched, and 05-01's `b71ecad` targets them.

## ROADMAP.md

- I ran `roadmap update-plan-progress 08` in the working tree only.
- The commit was skipped under the shared-file rule. The Phase 8 plan list (`08-01-PLAN.md` / `08-02-PLAN.md` lines) exists only in other agents' uncommitted ROADMAP edit, along with Phase 5/6/7 plan-list rewrites, and HEAD has no `08-02-PLAN` line. Committing would have included their lines.

## Known Stubs

None.

## Self-Check: PASSED

- All 4 created files exist. The llm test run, full suite and live smoke cover them.
- Commits a553ceb, 3522b8a and 0c5c4df are in `git log`. Their messages contain no attribution or assistant lines.

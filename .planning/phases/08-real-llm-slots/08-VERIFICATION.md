---
phase: 08-real-llm-slots
verified: 2026-09-13T15:05:00Z
status: passed
score: 4/4 truths verified (1 of 4 ROADMAP success criteria is scoped to Phase 6 and is tracked as deferred, not a gap)
---

# Phase 8: Real LLM Slots Verification Report

**Phase Goal:** The same pipeline runs on a real OpenAI-compatible LLM: local Ollama (qwen3.5:4b, think off) or a hosted fallback chosen by env. Every output is schema-validated, and LLM variance is measured separately from harness reliability.
**Verified:** 2026-09-13T15:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Setting `LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY` switches between local Ollama and hosted with no code change; hero sprint completes locally on qwen3.5:4b, think off | VERIFIED | `resolveLlmConfig` (select.ts:116-185) auto-detects provider from `LLM_BASE_URL` port 11434 vs. other, or `LLM_PROVIDER`/`--llm` override; `createLLM` builds the matching backend. 08-02-SUMMARY.md records a live hero-sprint run (`npx tsx scripts/llm-smoke.ts --sprint --local-only`, 2026-09-13): 23 actions, 7 `llm.slot` events, 0 repairs, report `ok {"verified":23,...}`, `thinkTagsInArtifacts: 0`, 156.4s total, model `ollama/qwen3.5:4b+qwen2.5-coder:7b`. Not re-run in this verification per instructions; cited from 08-02-SUMMARY.md. |
| 2 | Every LLM slot output passes zod or goes through one visible repair; invalid output fails with a classification and never reaches a connector; think tags never appear in artifacts | VERIFIED | `callSlot` (unchanged Phase 4 `llm/types.ts`) does the zod validate + single repair; both backends (`ollama.ts`, `openai-compat.ts`) only ever throw `LLMError` for transport/protocol failures and otherwise return raw values for `callSlot` to validate/repair. `sanitizeOutput`/`stripThink` in `common.ts` strip `<think>` blocks from every string value before a backend returns. Hero sprint's `thinkTagsInArtifacts: 0` and `LLM_SLOT_FAILED: 0` (08-02-SUMMARY.md) confirm this held live. |
| 3 | `evals.json` and the dashboard show an LLM-backed column (N=3-5, model named) alongside the scripted baseline | DEFERRED to Phase 6 | `web/scripts/eval.ts` does not exist yet (08-02-SUMMARY.md, "Real-LLM eval column" section). Phase 8 delivers the contract only: `parseLlmFlag` + `resolveLlmConfig(env, {provider})` + `createLLM` + `llmRunMeta`, documented in select.ts's header and exercised end-to-end via `createLLM`/`llmRunMeta` unit tests. Per task instructions, this is a Phase 6 gap, not a Phase 8 gap. |
| 4 | The health check (CLI or `/api/health`) reports which LLM is configured and whether it is reachable | VERIFIED | `probeLlm`/`describeLlmConfig` (select.ts:238-362) never include the API key value (only `hasApiKey`). `web/scripts/llm-smoke.ts` is the CLI health check today; live run in this verification (see below) printed `ollama: {"provider":"ollama",...,"hasApiKey":false,...}`, `ollama reachable in 36ms`, and `SKIP hosted: LLM_API_KEY not set`, exit 0. Phase 9 `/api/health` is documented to call `probeLlm(resolveLlmConfig(env))` (deferred to Phase 9 per ROADMAP dependency graph). |

**Score:** 3/4 directly verified this session, 1/4 explicitly out of Phase 8's scope (Phase 6 dependency) per task instructions — no gaps within Phase 8's own deliverables.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `web/src/lib/core/llm/common.ts` | LLMError taxonomy, message builder, think/fence stripping, redaction | VERIFIED | All 9 exports present (`LLMError`, `isLLMError`, `ChatMessage`, `JSON_ONLY_INSTRUCTION`, `buildMessages`, `toProviderSchema`, `stripThink`, `parseModelJson`, `sanitizeOutput`, `safeSlotName`, `redactSecret`) and match plan behavior exactly on read. |
| `web/src/lib/core/llm/ollama.ts` | Native `/api/chat` backend | VERIFIED | `createOllamaLLM`, `OLLAMA_DEFAULTS`, `normalizeOllamaBaseUrl`, `listOllamaModels` all present; body includes `think:false`, `keep_alive`, `num_ctx`, `format`, `AbortSignal.timeout`; error mapping to `unavailable/timeout/bad_request/invalid_output` matches spec. |
| `web/src/lib/core/llm/openai-compat.ts` | OpenAI-compatible backend, lazy SDK | VERIFIED | Single `import('openai')`, zero static `from 'openai'`; `strict: true` json_schema with one-shot downgrade to `json_object`; `mapOpenAIError` covers timeout/unavailable/auth/rate_limit/bad_request with key redaction. |
| `web/src/lib/core/llm/select.ts` | env→config, per-slot routing, createLLM, probe, eval contract | VERIFIED | `resolveLlmConfig`, `SLOT_ROLES`/`slotRole`, `createLLM`, `createSlotRoutedLLM`, `describeLlmConfig`, `probeLlm`, `llmRunMeta`, `parseLlmFlag`, `isOllamaUrl`, `DEFAULT_*` all present and match plan algorithm on read. |
| `web/src/lib/core/llm/index.ts` | Barrel | VERIFIED | 6 `export * from` lines covering types, fake, common, ollama, openai-compat, select. |
| `web/scripts/llm-smoke.ts` | Live smoke CLI | VERIFIED | Ran live in this session: prints per-model latency/schemaValid, hosted SKIP when key absent, exits 0. `--sprint` result cited from 08-02-SUMMARY.md (not re-run, per instructions). |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `ollama.ts` | `http://127.0.0.1:11434/api/chat` | injected fetch + `AbortSignal.timeout` | WIRED | Confirmed by live smoke run: `ollama reachable in 36ms`, two live `/api/chat` calls both returned `schemaValid=yes`. |
| `openai-compat.ts` | `openai` package | `import('openai')` dynamic | WIRED | Grep: exactly one `import('openai')`, zero static imports; construction is lazy inside `getClient()`. |
| `ollama.ts`/`openai-compat.ts` | `llm/types.ts` | `completeJSON` implements `LLM` | WIRED | Both export a `completeJSON` matching the unchanged `LLMRequest`/`LLM` interface; `callSlot` integration tests (in `.test.ts` files) pass 87/87. |
| `select.ts` | `ollama.ts` / `openai-compat.ts` | `createLLM` builds backends, routes by `slotRole` | WIRED | Live smoke's two distinct model calls (`qwen3.5:4b` for `normalize`, `qwen2.5-coder:7b` for `critique`) confirm routing works end to end. |
| `llm-smoke.ts` | `llm/index.ts` | `resolveLlmConfig(process.env, ...)` → `probeLlm` → `createLLM` → `callSlot` | WIRED | Live run exercised the full chain successfully. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| AGENT-02 | 08-01, 08-02 | Agent works with an OpenAI-compatible LLM: local Ollama (qwen3.5:4b, think off) and a hosted fallback configured by env | SATISFIED | Live Ollama backend confirmed reachable and schema-valid this session (`schemaValid=yes` for both routed models, think:false in every request body). Hosted backend implemented and unit-tested (mock client); no hosted key available in this environment so hosted path could not be exercised live, correctly SKIPs. `REQUIREMENTS.md` line 46 checkbox is still unchecked in the file — this appears to be a bookkeeping item (the roadmap-wide requirements sync), not a functional gap; recommend ticking it given the evidence above. |

No orphaned requirements found for Phase 8 in REQUIREMENTS.md beyond AGENT-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `web/src/lib/core/llm/openai-compat.ts` | 4 (comment) | "placeholder string" | Info | Refers to the documented `apiKey || 'unused'` fallback for keyless OpenAI-compatible servers — intentional design, not a stub. |
| `web/src/lib/core/llm/fake.ts` | 55 | "This is a placeholder critique" | Info | Pre-existing Phase 4 file, untouched by Phase 8 (confirmed unchanged: empty `git diff --stat`). Out of scope. |

No blockers found. No `process.env`, `node:` imports, `Date.now()`, argument-less `new Date()`, or `Math.random()` in non-test `web/src/lib/core/llm` files (the two `process.env` hits are inside a documentation comment in `select.ts`, not code). No API key literals (`gsk_`, `sk-`) anywhere in `llm/**` or `llm-smoke.ts` source.

### Human Verification Required

None. All Phase 8 success criteria within scope were verified by direct code inspection and live command execution (Ollama running locally, no hosted key configured, matching the stated environment).

### Gaps Summary

No gaps within Phase 8's own deliverables. Automated evidence:
- `npm --prefix web test -- src/lib/core/llm` → 4 test files, 87/87 tests passed.
- `npm --prefix web run check` → 834 files, 0 errors, 0 warnings.
- `cd web && npx tsx scripts/llm-smoke.ts` (live, Ollama running, no hosted key) → both routed models (`qwen3.5:4b`, `qwen2.5-coder:7b`) returned `schemaValid=yes`, hosted section correctly printed `SKIP hosted: LLM_API_KEY not set`, exited 0.
- Boundary greps for `process.env`/`node:`/`Date.now`/`new Date()`/`Math.random` in non-test `llm/**` files return nothing outside comments; no API key literals in source.
- `llm/types.ts` and `llm/fake.ts` are unchanged by Phase 8 (`git diff --stat` empty against both).

The one ROADMAP success criterion not met (#3, the `evals.json` LLM-backed column) is explicitly a Phase 6 dependency per the task's own instructions and per 08-02-SUMMARY.md's "Real-LLM eval column: Pending Phase 6" note — `web/scripts/eval.ts` does not exist yet. This is tracked as deferred, not a Phase 8 gap.

Plan 05-02 (agent/**, critique/**) is executing concurrently in this working tree; nothing in this verification touched or depended on those files.

---

_Verified: 2026-09-13T15:05:00Z_
_Verifier: Claude (gsd-verifier)_

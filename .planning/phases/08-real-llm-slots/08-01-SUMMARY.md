---
phase: 08-real-llm-slots
plan: 01
subsystem: llm
tags: [llm, ollama, openai, json-schema, zod, repair, error-taxonomy, redaction]
requires:
  - "04-01: llm/types.ts (LLM, LLMRequest, LLMSlotError, callSlot with one zod repair)"
provides:
  - "llm/common.ts: LLMError taxonomy, buildMessages (repair turn), stripThink, parseModelJson, sanitizeOutput, toProviderSchema, safeSlotName, redactSecret"
  - "llm/ollama.ts: createOllamaLLM (native /api/chat), listOllamaModels, normalizeOllamaBaseUrl, OLLAMA_DEFAULTS"
  - "llm/openai-compat.ts: createOpenAICompatLLM (lazy openai SDK), mapOpenAIError, ChatCompletionsLike"
affects: [08-02-select-smoke, phase-06-evals-llm-column, phase-09-api]
tech-stack:
  added: []
  patterns:
    - "Backends return malformed model output; only transport/protocol failures throw typed LLMError"
    - "Injected fetch / structural client for fully offline tests"
    - "Dynamic import('openai') so importing core never constructs an SDK client"
    - "Per-instance closure state for the json_schema to json_object downgrade"
key-files:
  created:
    - web/src/lib/core/llm/common.ts
    - web/src/lib/core/llm/common.test.ts
    - web/src/lib/core/llm/ollama.ts
    - web/src/lib/core/llm/ollama.test.ts
    - web/src/lib/core/llm/openai-compat.ts
    - web/src/lib/core/llm/openai-compat.test.ts
  modified: []
key-decisions:
  - "Backends return malformed model output (string or wrong-shape value) and throw LLMError only on transport/protocol failure, so zod validation and the single repair stay solely in callSlot"
  - "Ollama uses native /api/chat with format = zod JSON schema minus $schema, think:false, temperature 0, seed 42, num_ctx 8192, keep_alive 10m and a 180 s AbortSignal.timeout; localhost is pinned to 127.0.0.1"
  - "The hosted backend lazy-imports openai. Strict json_schema downgrades per instance to json_object after one HTTP 400. 401/403 errors omit provider text; all other messages are key-redacted"
requirements-completed: []
duration: 6min
completed: 2026-09-13
---

# Phase 8 Plan 01: Real LLM Backends (Ollama + OpenAI-compatible) Summary

**This plan adds a native Ollama `/api/chat` backend and a hosted backend on the lazily loaded openai SDK. Both implement the unchanged Phase 4 `LLM` interface. Model output is constrained by JSON schema, stripped of `<think>` tags and code fences, and returned raw so `callSlot` validates and repairs it once. Transport failures throw a typed, key-redacted `LLMError`. The tests make no network calls.**

## Performance

- **Duration:** about 6 minutes (14:27 to 14:33 ET)
- **Tasks:** 2 (TDD, 4 commits)
- **Files:** 6 created, 0 modified

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | common.ts and the Ollama backend | `f154f1b` (test), `9e3ba27` (feat) |
| 2 | OpenAI-compatible hosted backend | `d2efed4` (test), `e6db12b` (feat) |

## Exported signatures (08-02 imports these)

### llm/common.ts
```ts
export type LLMErrorKind = 'timeout' | 'unavailable' | 'invalid_output' | 'auth' | 'rate_limit' | 'bad_request';
export type LLMProviderName = 'ollama' | 'hosted';
export class LLMError extends Error {
  readonly kind: LLMErrorKind; readonly provider: LLMProviderName; readonly model: string; readonly status?: number; readonly retryAfterMs?: number;
  constructor(kind: LLMErrorKind, message: string, opts: { provider: LLMProviderName; model: string; status?: number; retryAfterMs?: number; cause?: unknown });
}
export function isLLMError(e: unknown): e is LLMError;
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export const JSON_ONLY_INSTRUCTION: string;
export function toProviderSchema(jsonSchema: unknown): Record<string, unknown> | undefined;  // shallow copy minus top-level $schema; undefined unless plain object
export function buildMessages(req: LLMRequest): ChatMessage[];   // [system, user] (+ [assistant previous, user "failed validation: ..."] when repair)
export function stripThink(text: string): string;
export function parseModelJson(text: string): unknown;           // never throws; unparseable → cleaned string
export function sanitizeOutput(value: unknown): unknown;          // deep stripThink on string values
export function safeSlotName(slot: string): string;              // [a-zA-Z0-9_-], max 64, '' → 'output'
export function redactSecret(message: string, secret: string | undefined): string;  // secrets shorter than 4 chars are not redacted
```

### llm/ollama.ts
```ts
export interface OllamaLLMOptions { baseUrl: string; model: string; fetch?: typeof fetch; timeoutMs?: number; numCtx?: number; seed?: number; temperature?: number; keepAlive?: string; think?: boolean }
export const OLLAMA_DEFAULTS: Readonly<{ timeoutMs: 180000; numCtx: 8192; seed: 42; temperature: 0; keepAlive: '10m'; think: false }>;
export interface OllamaLLM extends LLM { readonly provider: 'ollama'; readonly baseUrl: string; readonly settings: Readonly<{ timeoutMs: number; numCtx: number; seed: number; temperature: number; keepAlive: string; think: boolean }> }
export function normalizeOllamaBaseUrl(url: string): string;     // trim, strip trailing '/', '/v1' or '/api', localhost → 127.0.0.1
export function createOllamaLLM(opts: OllamaLLMOptions): OllamaLLM;
export async function listOllamaModels(opts: { baseUrl: string; fetch?: typeof fetch; timeoutMs?: number }): Promise<string[]>;  // GET /api/tags, default 5000 ms
```
How Ollama failures map to errors:
- A rejected fetch with TimeoutError or AbortError becomes `timeout`. Any other rejection becomes `unavailable`, and the message names the base URL.
- HTTP 404 becomes `unavailable`, with the hint `ollama pull <model>`.
- HTTP 5xx becomes `unavailable`. Other 4xx statuses become `bad_request`, with up to 300 characters of detail.
- A body that isn't JSON, or has no `message.content`, becomes `invalid_output`.
- `message.thinking` is ignored.

### llm/openai-compat.ts
```ts
export interface ChatCompletionsLike { chat: { completions: { create(body: Record<string, unknown>, options?: { timeout?: number; signal?: AbortSignal }): Promise<unknown> } } }
export interface OpenAICompatOptions { baseURL: string; apiKey: string; model: string; timeoutMs?: number; maxRetries?: number; temperature?: number; seed?: number; reasoningEffort?: string; structured?: 'json_schema' | 'json_object'; client?: ChatCompletionsLike; fetch?: typeof fetch }
export interface OpenAICompatLLM extends LLM { readonly provider: 'hosted'; readonly baseURL: string; structuredMode(): 'json_schema' | 'json_object' }
export function createOpenAICompatLLM(opts: OpenAICompatOptions): OpenAICompatLLM;
export function mapOpenAIError(err: unknown, ctx: { model: string; timeoutMs: number; apiKey?: string }): LLMError;
```
The hosted backend's defaults are timeoutMs 60000, maxRetries 1, temperature 0, seed 42 and structured `json_schema`. `reasoning_effort` is only sent when `reasoningEffort` is set. An empty apiKey is passed to the SDK as the placeholder `'unused'`, for keyless servers.

`mapOpenAIError` checks conditions in this order:
1. `APIConnectionTimeoutError`, or name TimeoutError → `timeout`
2. `APIUserAbortError`, or name AbortError → `timeout`
3. `APIConnectionError` → `unavailable`
4. HTTP 401/403 → `auth` ("check LLM_API_KEY", with no provider text)
5. HTTP 429 → `rate_limit`, with `retryAfterMs` from the retry-after header
6. HTTP 404 → `unavailable`
7. HTTP 5xx → `unavailable`
8. Other 4xx → `bad_request`
9. Anything else → `unavailable`

`cause` holds the original error, which can include provider text, so never serialize it into traces.

## Verification

- **llm folder tests:** `npm --prefix web test -- src/lib/core/llm` passes all 60 tests in 3 files: common 21, ollama 19, openai-compat 20.
- **svelte-check:** `npm --prefix web run check` reports 801 files, 0 errors, 0 warnings.
- **Full suite:** `npm --prefix web test` passes 533 of 534 tests. The one failure is `trace/redact.test.ts`, covered under Deferred Issues.
- **Acceptance greps:** all pass.
  - ollama.ts contains `think: `, `keep_alive`, `num_ctx`, `AbortSignal.timeout(`, `/api/chat`, `ollama pull` and `127.0.0.1`.
  - openai-compat.ts has `import('openai')` exactly once and no `from 'openai'`. `strict: true` and `check LLM_API_KEY` each appear exactly once, and `redactSecret(` appears at least once.
  - openai-compat.test.ts contains `SECRET123` 8 times.
  - No `process.env`, `node:`, `Date.now`, argument-less `new Date()` or `Math.random` appears in llm non-test files.
- **Protected files:** `git diff --stat` on llm/types.ts and llm/fake.ts is empty.
- **Offline tests:** every test injects `fetch` or `client`. `11434` appears only in URL strings asserted against mocks.

## Deviations from Plan

### Auto-fixed Issues

None.

### Minor interpretation choices

- **listOllamaModels errors:** the plan only specified that a rejected fetch becomes `unavailable`. It also maps a timeout to `timeout`, non-ok HTTP to `unavailable` and a non-JSON body to `invalid_output`. A missing `models` array returns `[]`.
- **Missing retry-after header:** it leaves `retryAfterMs` undefined. The literal `Number(null) * 1000` would have produced 0, which would signal "retry immediately".
- **Fallback retry:** `buildMessages(req)` is computed once per `completeJSON`, so the json_object retry sends exactly the same messages.
- **Ollama messages:** every Ollama error message is kept free of provider secrets (Ollama has no key). 5xx responses use the message "server error (HTTP n): detail".
- **Extra tests:** the plan's behavior list didn't ask for these:
  - an unclosed `<think>` with no following JSON
  - a bare array wrapped in prose
  - LLMError status and cause
  - a 400 on the fallback retry (2 calls total)
  - a missing retry-after header
  - auth redaction through completeJSON

### Phase 4 interface differences

None. The actual `LLM`, `LLMRequest`, `LLMSlotError` and `callSlot` in llm/types.ts match the plan's `<interfaces>` exactly. types.ts and fake.ts were not modified.

## Deferred Issues

- `web/src/lib/core/trace/redact.test.ts` fails one test: "redactText > is case-insensitive and word-bounded for name parts". The file is untracked, in-progress work from plan 04-03, which owns trace/**. This plan didn't cause it and doesn't own it, so it was left alone.

## Requirements

- AGENT-02 is only partly delivered. The backends exist, but provider selection from env, per-slot routing and the live smoke test belong to 08-02, so AGENT-02 is not marked complete here.

## ROADMAP.md

- I ran `roadmap update-plan-progress 08` (2 plans, 1 summary, In Progress). It checked the `08-01-PLAN.md` box in the working tree.
- The commit was skipped under the shared-file rule. The Phase 8 plan list (`08-01-PLAN.md` / `08-02-PLAN.md` lines) exists only as another agent's uncommitted ROADMAP edit and is absent from HEAD. Committing the checkbox would also have committed their lines.
- The `[x]` stays in the working tree and will land whenever that section is committed.

## Known Stubs

None.

## Next Phase Readiness

- 08-02 can import `createOllamaLLM`, `listOllamaModels`, `createOpenAICompatLLM` and `isLLMError` directly.
  - Map env to `OllamaLLMOptions` or `OpenAICompatOptions` in select.ts. Core never reads env.
  - Warm-model timing (qwen3.5:4b about 10 s warm, 29 s cold) supports the 180 s Ollama default.

## Self-Check: PASSED

- All 6 created files exist. The llm test run and svelte-check both cover them.
- Commits f154f1b, 9e3ba27, d2efed4 and e6db12b appear in `git log`. `git log -10 --format=%B` contains no attribution or assistant lines.

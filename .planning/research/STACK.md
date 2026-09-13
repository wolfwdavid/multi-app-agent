# Technology Stack

**Project:** TransferPilot (Multi-App AI Agent Hackathon)
**Researched:** 2026-09-13 (versions verified with `npm view` on this date)
**Time box:** ~6 hours total build. Every choice below is picked to cut setup time and failure surface.

## TL;DR (prescriptive)

- **One SvelteKit app (`web/`), no monorepo.** The agent core goes in `web/src/lib/core/**` as plain TypeScript with **no SvelteKit imports** (`$app`, `$env`, `$lib`). SvelteKit routes, the MCP server, and the eval CLI all import that same folder. The CLIs run with `tsx`. You get a shared core without the setup cost of workspaces, Vercel root-dir settings or symlinks on Windows.
- **Build for both targets from one config.** Pick the adapter from `process.env.VERCEL`: `adapter-vercel` on Vercel, `adapter-static` otherwise (GitHub Pages / HF Space).
- **LLM:** use the `openai` SDK's **Chat Completions** API (not the Responses API) with a configurable `baseURL`. Locally that's Ollama at `http://127.0.0.1:11434/v1`. When deployed it's Groq. Write the agent loop yourself; don't use an agent framework.
- **Schemas:** `zod` v4 is the single source of truth. `z.toJSONSchema()` gives the LLM tool schemas, `safeParse` validates every tool call, and the same schema is passed to MCP `registerTool`.
- **Connectors:** per-API `@googleapis/*` packages plus `google-auth-library` (not the 180-major `googleapis` monolith). Use `@notionhq/client` v5 with the **data sources** API. GitHub and Hugging Face are read-only via plain `fetch`. Obsidian uses `node:fs` plus `gray-matter`.
- **MCP:** MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`). Use `StdioServerTransport` for local clients and the built-in `createMcpHandler()` in a SvelteKit `+server.ts` for Streamable HTTP on Vercel. You don't need `mcp-handler`.
- **Evals:** a **custom `tsx` script** runs N × scenarios, computes pass rates and failure taxonomy, and writes JSON for the dashboard. Keep **vitest** for deterministic unit tests (mocks, validators, idempotency).

## Recommended Stack

### Core Framework (already scaffolded, keep versions)

| Technology | Scaffold | Latest | Purpose | Why | Confidence |
|---|---|---|---|---|---|
| @sveltejs/kit | ^2.63.0 | 2.70.3 | UI + API routes | You chose it. `+server.ts` routes give REST, NDJSON streaming and the MCP HTTP endpoint in one deploy. | HIGH |
| svelte | ^5.56.1 | 5.57.0 | UI (runes) | Already set up with forced runes mode. | HIGH |
| vite | ^8.0.16 | 8.3.0 | Build | Required by vite-plugin-svelte 7.x (peer `vite ^8`). | HIGH |
| tailwindcss + @tailwindcss/vite | ^4.3.0 | 4.3.3 | Styling | Already wired. Don't add a component library; Tailwind plus a few hand-rolled components is faster. | HIGH |
| typescript | ^6.0.3 | — | Types | Already present. TS 6 removed some legacy options (old `moduleResolution` modes), so keep the SvelteKit-generated tsconfig as it is. | MEDIUM |
| @sveltejs/adapter-vercel | not installed | **6.3.4** | Live backend | Server routes that hold secrets. Peer `@sveltejs/kit ^2.4.0`. | HIGH |
| @sveltejs/adapter-static | ^3.0.10 | 3.0.10 | Pages / HF showcase | Already configured with `fallback: '404.html'` (SPA mode). | HIGH |

### LLM / Agent

| Technology | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| openai | **7.15.0** | OpenAI-compatible client for Ollama and Groq/OpenRouter | Same code path for every provider; only `baseURL`, `apiKey` and `model` come from env. Built-in retries and timeouts. **Needs Node >= 22** (`engines`), so set Vercel's Node version to 22.x or 24.x. Its peer deps (`ws`, `undici`, AWS/smithy, `zod`) are all optional. | HIGH (version/engines), MEDIUM (v7 API surface: use `client.chat.completions.create` only) |
| zod | **4.6.4** | Tool I/O schemas, config validation, LLM output validation | Native `z.toJSONSchema()` (no `zod-to-json-schema` needed). MCP SDK v2 needs zod ^4.2 (Standard Schema). One schema serves the LLM, the runtime validator and MCP. | HIGH |
| Ollama (local) | 0.33.1 installed | Local inference | Models `qwen3.5:4b` (primary, better tool calling) and `llama3.2:3b` (fallback) are both installed. | HIGH |
| Groq (hosted fallback) | API | Deployed inference (Ollama can't be reached from Vercel) | OpenAI-compatible at `https://api.groq.com/openai/v1`. The free tier needs no card. Use `openai/gpt-oss-20b` (tool calling) or `llama-3.3-70b-versatile`. Free limits are about 30 RPM and 8K TPM for gpt-oss, so eval runs of N×scenarios should go to **Ollama locally**, not Groq. | MEDIUM (limits from third-party pages) |
| OpenRouter | API | Second fallback only | `:free` models have tight daily caps and uneven tool-calling support. Keep it as an env-swappable option, not the default. | LOW |

**Verified Ollama OpenAI-compat constraints** (docs.ollama.com/api/openai-compatibility):
- `tools` is supported. **`tool_choice` is NOT supported**, so never rely on forcing a tool. Validate, and re-prompt if the model skips it.
- `reasoning_effort: "none"` turns thinking off. Send it for qwen3.5 to cut latency and stray `<think>` output. Only send it to providers that accept it.
- `response_format` is supported (JSON mode). Support for strict `json_schema` isn't documented, so still validate with zod.

### Google (Gmail drafts, Calendar, Docs, Drive)

| Library | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| google-auth-library | **11.0.2** | `OAuth2Client` + refresh token | Single user: run the consent flow once, store `GOOGLE_REFRESH_TOKEN` in `.env` and in Vercel env, then call `client.setCredentials({ refresh_token })`. The library refreshes access tokens automatically. | HIGH |
| @googleapis/gmail | **21.0.0** | `users.drafts.create` | Per-API package: small install, fast on Windows, bundles cleanly for Vercel. | HIGH |
| @googleapis/calendar | **19.0.0** | `events.insert` / `events.list` (dedupe) | Same reason. | HIGH |
| @googleapis/docs | **13.0.0** | Read the essay doc, write the critique doc (`documents.create` + `batchUpdate`) | Same reason. | HIGH |
| @googleapis/drive | **25.0.0** | Find the essay by name, `files.list` for idempotent lookup | Same reason. | HIGH |

**Scopes (request once):** `gmail.compose`, `calendar.events`, `documents`, `drive.readonly`. **Pitfall:** `drive.file` only sees files the app created, so it can't read the user's existing essay draft. For the Docs/Drive read path, use `drive.readonly` (or `documents.readonly`).
**Consent screen in "Testing" mode:** add yourself as a test user. Refresh tokens expire after 7 days, which is fine for a hackathon. Get the token with a 30-line local script (`scripts/google-auth.ts`, loopback redirect `http://127.0.0.1:<port>`) or the OAuth Playground with your own client ID. Don't build an OAuth UI in the app.

### Notion, GitHub, Hugging Face, Obsidian

| Library | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| @notionhq/client | **5.26.0** | Tracker rows | Official SDK. **v5 targets Notion API `2025-09-03` (data sources).** Use `notion.dataSources.query({ data_source_id, filter })` for the idempotent "does this school row exist" check, and `pages.create({ parent: { type: 'data_source_id', data_source_id } })`. `databases.query` examples from training data and older blog posts **fail** with the new version header. | HIGH (SDK/version), MEDIUM (exact parent shape; check against the SDK typings when coding) |
| GitHub REST via `fetch` | — | Read-only portfolio (user repos, README, languages) | 2–3 GET endpoints. A `fetch` wrapper matches the mock/real connector interface with no dependency. Send `GITHUB_TOKEN` if set (5000/hr, vs 60/hr unauthenticated). Skip `octokit` (5.0.5) and `@octokit/rest` (22.0.1); they're more than read-only calls need. | HIGH |
| Hugging Face Hub via `fetch` | — | Read-only models/Spaces by author | `GET https://huggingface.co/api/models?author=WolfDavid` and `/api/spaces?author=...` are public, no auth. `@huggingface/hub` (2.17.1) works but adds surface area for two GETs. Use it only if you need the typed iterators. | MEDIUM |
| gray-matter | **4.0.3** | Parse Obsidian frontmatter | Old but stable and the de facto standard. Put `node:fs/promises` + `fast-glob`-free recursion (just `readdir({ recursive: true })`, Node 20+) around it. **Local only:** Vercel has no vault, so the deployed build uses a seeded fixture vault in the repo. | HIGH |

### MCP Server

| Library | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| @modelcontextprotocol/server | **2.0.0** (released 2026-07-27) | Custom MCP server exposing the agent tools | v2 is the current line. It exports `McpServer` and `createMcpHandler` from the main entry (verified in `dist/index.d.mts`), and `StdioServerTransport` from `@modelcontextprotocol/server/stdio`. `registerTool(name, { description, inputSchema: z.object(...) }, handler)` reuses the core's zod schemas directly. `createMcpHandler(factory)` returns an `McpHttpHandler` with a web-standard `fetch(request)` that serves both the 2026-07-28 stateless spec and 2025-era stateless Streamable HTTP. That's exactly what a Vercel function needs (no sessions, no Redis). | HIGH (exports verified), MEDIUM (v2 is 7 weeks old and most online examples are v1) |
| @modelcontextprotocol/inspector | 2.6.0 (`npx`) | Manual MCP testing | Run `npx @modelcontextprotocol/inspector` against stdio or `/mcp`. Don't install it as a dependency. | HIGH |

**Wiring:**
- `web/scripts/mcp-stdio.ts`: `new McpServer(...)` → `registerTools(server, core)` → `server.connect(new StdioServerTransport())`. Run it with `npx tsx scripts/mcp-stdio.ts`.
- `web/src/routes/mcp/+server.ts`: `const handler = createMcpHandler(() => buildServer())` and `export const POST = ({ request }) => handler.fetch(request)` (also GET/DELETE, which return 405 in stateless mode). Add `export const prerender = false`.
- Both call the same `buildServer()` from `src/lib/core/mcp.ts`.

**Fallback if v2 breaks:** `@modelcontextprotocol/sdk@1.30.0` (the v1 line, still maintained) with `server.registerTool` + `WebStandardStreamableHTTPServerTransport`. It pulls in express/hono transitively, which is heavier but well documented.

### Evals, Testing, Scripts

| Tool | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| Custom eval runner (`web/scripts/eval.ts`) | — | N runs × seeded scenarios → final-state read-back checks → pass rates + Lemma failure taxonomy → `web/static/evals/latest.json` + trace files | LLM runs are nondeterministic. You need repetitions, aggregate pass rates, per-failure classification and a JSON artifact the static dashboard renders. vitest's single pass/fail per test fights all of that. A 150-line script is faster to build and easier to show judges. | HIGH |
| vitest | keep **^4.1.8** (5.0.0 released 2026-09-03) | Deterministic unit tests: mock app state, zod validators, idempotency keys, retry/backoff, injection sanitizer | Already configured. **Don't upgrade to 5.0 mid-hackathon**; it's 10 days old and gains you nothing today. | HIGH |
| tsx | **4.23.13** | Run TS scripts (eval, MCP stdio, google-auth) | Zero config, runs ESM TypeScript on Node 24. `tsx --env-file=.env scripts/eval.ts` loads env without `dotenv`. | HIGH |

## Key Architecture-Stack Decisions (answers to the posed questions)

### Can one SvelteKit app serve both adapter-vercel and adapter-static? YES (HIGH)

```ts
// web/vite.config.ts (inside sveltekit({...}))
import adapterStatic from '@sveltejs/adapter-static';
import adapterVercel from '@sveltejs/adapter-vercel';
const isVercel = !!process.env.VERCEL; // Vercel sets VERCEL=1 during builds
adapter: isVercel
  ? adapterVercel({ runtime: 'nodejs22.x' })   // or match the Vercel dashboard setting
  : adapterStatic({ fallback: '404.html' }),
paths: { base: isVercel ? '' : (process.env.BASE_PATH ?? '') as '' | `/${string}` },
```

Rules that make the dual build work:
1. **Pages use `+page.ts` (universal) or client-side `fetch`, never `+page.server.ts`.** adapter-static can't run server loads. In SPA/fallback mode the strict check passes, but those pages would break at runtime on Pages.
2. **API routes (`src/routes/api/**/+server.ts`, `src/routes/mcp/+server.ts`) set `export const prerender = false`.** adapter-static leaves server endpoints out of the output (verified in the docs), so they simply don't exist on Pages.
3. **Showcase data is static JSON.** The eval dashboard and replayable traces read `${base}/evals/latest.json` from `static/`. The same page works on Vercel and on Pages. Optionally set `PUBLIC_API_BASE` so the static site can call the Vercel API "live" (add CORS headers on `/api/*`).
4. **Core code reads secrets from an injected config object**, built in `+server.ts` from `$env/dynamic/private`, or from `process.env` in scripts. **Don't use `$env/static/private`.** It inlines values at build time and fails the static build when vars are missing (and core must stay free of `$env` so tsx scripts can import it).
5. `adapterVercel` accepts per-route `export const config = { maxDuration: 60 }`. With Fluid compute (the default), functions default to **300s even on Hobby**, so an agent run of several steps fits. The SvelteKit adapter docs still say 10s; that's the legacy non-Fluid figure. Stream NDJSON so the UI shows live steps.

### Should the agent core be a shared TS package? Shared CODE yes, separate PACKAGE no (MEDIUM-HIGH)

```
web/
  src/lib/core/            # framework-free: NO $app/$env/$lib imports, relative imports only
    llm.ts                 # openai client factory (ollama|groq|openrouter from config)
    tools/                 # zod schemas + handlers; registry
    agent/                 # loop: plan → act → verify, approval gate, trace events
    connectors/real/       # google, notion, github, hf, obsidian
    connectors/mock/       # stateful in-memory twins with identical interfaces
    evals/                 # scenarios, checkers, taxonomy
    mcp.ts                 # buildServer(core) → McpServer
  src/routes/api/…         # REST + NDJSON stream (adapter-vercel only)
  src/routes/mcp/+server.ts
  scripts/eval.ts  scripts/mcp-stdio.ts  scripts/google-auth.ts   # run via tsx
```

Why not npm workspaces (`packages/core`) today: on Vercel you'd need the root-directory setting plus the "include files outside root" option, workspace symlinks on Windows, `exports` pointing at `.ts` sources, and a second tsconfig. That's roughly 30–60 minutes of yak-shaving for no benefit to the judges. The "no SvelteKit imports in core" rule keeps extraction to a package trivial after the hackathon.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| Agent loop | Hand-written loop on `openai` chat.completions | LangChain / LangGraph / Mastra / CrewAI | Heavy abstractions hide the exact prompts, tool calls and retries you need to trace and classify for the 25% reliability score. Slow to learn and debug in 6 hours, and small-model quirks (no `tool_choice`) leak through anyway. |
| Agent loop | Hand-written | Vercel AI SDK (`ai`) `generateText` with tools | A reasonable option, but it adds a provider layer (Ollama needs a community provider) and its own multi-step loop semantics. You'd end up fighting it to insert the approval gate and verify steps. Don't use it. |
| LLM API | Chat Completions | OpenAI Responses API | Ollama and Groq support for Responses is partial. Chat Completions with `tools` is the lowest common denominator that works everywhere. |
| Google | `@googleapis/*` per-API + google-auth-library | `googleapis` 180.0.0 | Huge install (every Google API), slow `npm i` on Windows, larger function bundle. Same code otherwise. |
| Google | Per-API packages | Raw REST `fetch` | Gmail needs base64url RFC 822 building, and Docs batchUpdate payloads are verbose. Typed clients save debugging time. Token refresh would also have to be hand-rolled. |
| GitHub | `fetch` | `octokit` 5.0.5 / `@octokit/rest` 22.0.1 | Read-only, a few GETs. A dependency adds nothing. |
| MCP HTTP | SDK v2 `createMcpHandler` | `mcp-handler` 2.1.1 (Vercel) | Now a thin wrapper over the same SDK v2 handler (peer `@modelcontextprotocol/server ^2`, optional `next`). One less dependency. |
| MCP HTTP | Stateless | Stateful sessions / SSE | Vercel functions are ephemeral. SSE transport was removed in mcp-handler 2.x and deprecated in the spec. |
| MCP SDK | v2 `@modelcontextprotocol/server` | v1 `@modelcontextprotocol/sdk` 1.30.0 | v1 is on maintenance only and drags express/hono/cors deps. Keep it as a fallback only. |
| Evals | Custom tsx runner + JSON | vitest for evals / promptfoo / Braintrust | Need N-run pass rates, final-state read-back against mocks, and taxonomy labels rendered in your own dashboard. External eval tools add accounts and config. |
| Schema → JSON Schema | `z.toJSONSchema()` (zod 4) | `zod-to-json-schema` 3.25.2 | Built into zod v4. The extra package is only for zod v3. |
| Env loading in scripts | `tsx --env-file=.env` | dotenv | Built into Node/tsx. |
| Monorepo | Single `web/` app | npm/pnpm workspaces, Turborepo | Setup and deploy friction with no demo value (see above). |
| Hosted LLM | Groq | OpenAI / Anthropic paid keys | No keys are set, and the project calls for free/OpenAI-compatible. Adding a paid key is fine as an env swap if Groq rate limits bite during the demo. |

## Installation

```bash
cd web

# Runtime deps
npm i openai@^7.15.0 zod@^4.6.4 \
  @modelcontextprotocol/server@^2.0.0 \
  google-auth-library@^11.0.2 @googleapis/gmail@^21.0.0 @googleapis/calendar@^19.0.0 \
  @googleapis/docs@^13.0.0 @googleapis/drive@^25.0.0 \
  @notionhq/client@^5.26.0 gray-matter@^4.0.3

# Dev deps
npm i -D @sveltejs/adapter-vercel@^6.3.4 tsx@^4.23.13
```

Suggested scripts (`web/package.json`):
```json
"eval": "tsx --env-file-if-exists=.env scripts/eval.ts",
"mcp:stdio": "tsx --env-file-if-exists=.env scripts/mcp-stdio.ts",
"google:auth": "tsx --env-file=.env scripts/google-auth.ts"
```
(If `--env-file-if-exists` is rejected by the tsx/Node combination, use `--env-file=.env` and make sure `.env` exists; Node 24 supports both flags.)

Env contract (`.env.example`, committed; `.env` never committed):
```
MODE=mock|real
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3.5:4b
GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= GOOGLE_REFRESH_TOKEN=
NOTION_TOKEN= NOTION_TRACKER_DATA_SOURCE_ID=
GITHUB_TOKEN= GITHUB_USER=wolfwdavid  HF_USER=WolfDavid
OBSIDIAN_VAULT_PATH=
```
Vercel: `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=openai/gpt-oss-20b`, `MODE=mock` by default. Real mode is flipped on only after credentials exist.

## Small-Model Tool-Calling Rules (stack-level, apply from Phase 1)

1. **Code drives the workflow; the LLM fills in content.** Sequence the sprint steps (gap analysis → critique → tracker → calendar → draft) in TypeScript, and give the model only the **2–4 tools relevant to the current step**. A 4B model with 12 tools picks badly.
2. Keep tool schemas flat and short: few params, enums over free text, no nested objects where you can avoid them, short descriptions.
3. `temperature: 0`, `reasoning_effort: "none"` (Ollama/qwen3.5), a fixed `seed` when the provider supports it (helps make eval runs comparable).
4. Run every tool call through `schema.safeParse`. On failure, send the zod error back as the tool result and retry at most 2 times, then classify it (`instruction violation` / `retry loop`).
5. Wrap untrusted content (email bodies, doc text) in delimiters and never let it add tools or change approval state. This is the prompt-injection scenario.

## Windows 11 Dev Gotchas

| Gotcha | Fix | Confidence |
|---|---|---|
| Node 17+ may resolve `localhost` to `::1`, while Ollama listens on IPv4 → `ECONNREFUSED` | Use `http://127.0.0.1:11434/v1`, not `localhost` | MEDIUM |
| Setting env vars inline in npm scripts (`BASE_PATH=/x vite build`) fails in PowerShell/cmd | Use `process.env.VERCEL` / `--mode` / `.env` files, or set vars in GitHub Actions YAML (Linux). Don't write POSIX env prefixes in `package.json` scripts. | HIGH |
| Project path contains spaces (`Multi App AI Agent Hackathon`) | Quote paths in MCP client configs and scripts. In VS Code / Claude Desktop MCP config use `"command": "npx"` (or `"cmd"` with `["/c","npx","tsx","<abs path>"]` if `npx` isn't resolved) with the absolute script path as a separate arg, and set `cwd` to `web`. | MEDIUM |
| MCP stdio corrupted by `console.log` | In stdio mode, log to `console.error` (stderr) only. A single stray stdout line breaks the JSON-RPC stream. | HIGH |
| CRLF line endings in fixtures / Obsidian markdown / snapshot JSON | Add `.gitattributes` with `* text=auto eol=lf`. gray-matter handles CRLF, but string-equality checks in evals don't. | MEDIUM |
| `readdir({ recursive: true })` returns `\`-separated paths | Normalize with `path.posix`/`replaceAll('\\','/')` before using paths as IDs (idempotency keys must be stable across OSes). | HIGH |
| First Ollama call is slow (model load, ~5–20s) and times out | Warm up with one trivial request at the start of eval runs. Set an `openai` client `timeout` of 120s locally. | MEDIUM |
| The Vercel build runs on Linux, so casing differences in import paths pass locally and fail there | Match file-name casing exactly in imports | HIGH |

## Confidence Summary

| Area | Level | Notes |
|---|---|---|
| Versions | HIGH | All from `npm view` on 2026-09-13 |
| SvelteKit dual adapter | HIGH | adapter-static docs: endpoints omitted, fallback satisfies strict. `VERCEL` env is a standard Vercel build variable. |
| openai v7 + Ollama/Groq compat | MEDIUM | Ollama compat verified in official docs (tools yes, tool_choice no, reasoning_effort none). Groq free limits come from third-party summaries. v7 API surface not inspected; if chat.completions differs, a 40-line `fetch` client is the fallback. |
| MCP SDK v2 | MEDIUM-HIGH | Exports verified from the published tarball typings. The package is new and most tutorials are v1. |
| Notion v5 data sources | MEDIUM-HIGH | Official docs confirm `dataSources.query` and the 2025-09-03 break. Check exact create-parent typing in the SDK. |
| Google per-API packages / scopes | HIGH | Stable, long-standing APIs. The `drive.file` limitation is a well-known constraint. |
| Eval approach | HIGH | Design judgment aligned with the judging criteria in PROJECT.md |

## Sources

- npm registry (`npm view <pkg> version/peerDependencies/engines`), queried 2026-09-13. HIGH.
- MCP TypeScript SDK repo (v2 imports, registerTool, v1 maintenance): https://github.com/modelcontextprotocol/typescript-sdk. HIGH.
- `@modelcontextprotocol/server@2.0.0` tarball `dist/index.d.mts` (exports `McpServer`, `createMcpHandler`, `WebStandardStreamableHTTPServerTransport`, `PerRequestHTTPServerTransport`, `/stdio` subpath). HIGH.
- vercel/mcp-handler README (v2 built on SDK v2, stateless, SSE/Redis removed): https://github.com/vercel/mcp-handler. HIGH.
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility. HIGH.
- SvelteKit adapter-static: https://svelte.dev/docs/kit/adapter-static. HIGH.
- SvelteKit adapter-vercel: https://svelte.dev/docs/kit/adapter-vercel. HIGH (its duration numbers are legacy).
- Vercel function duration with Fluid compute (300s default, Hobby included): https://vercel.com/docs/functions/configuring-functions/duration, https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute. MEDIUM-HIGH.
- Notion query a data source / SDK: https://developers.notion.com/reference/query-a-data-source, https://github.com/makenotion/notion-sdk-js. HIGH.
- Groq free tier limits (third-party summaries): https://tokenmix.ai/blog/groq-free-tier-limits-2026, https://pricepertoken.com/endpoints/groq/free, https://www.eesel.ai/blog/groq-pricing. MEDIUM/LOW; check at https://console.groq.com/settings/limits once a key exists.

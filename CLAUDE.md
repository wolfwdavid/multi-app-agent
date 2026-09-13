<!-- GSD:project-start source:PROJECT.md -->
## Project

**TransferPilot (working name)**

An AI agent that helps college transfer applicants — anyone, including the builder — plan a transfer and stand out from other applicants. Given a student profile and target schools, it runs a multi-step "application sprint": finds gaps against each school's transfer requirements, critiques essay drafts, builds a deadline tracker, schedules reminders, and drafts outreach to admissions/advisors — acting across Google Docs/Drive, Notion, Google Calendar, and Gmail, with human approval before any write. Built for the Multi-App AI Agent Hackathon (Sun 2026-09-13).

**Core Value:** One end-to-end application sprint (profile + target school → gap analysis → essay critique Doc → Notion tracker + Calendar deadlines → Gmail draft) runs reliably across real apps, and we can *prove* it works with measured evals — not just a happy-path demo.

### Constraints

- **Timeline:** Everything must be built, deployed, documented, and demo-ready by 7:00 PM ET — cut scope before cutting evals.
- **Tech stack:** SvelteKit + TypeScript (user choice); agent, connectors, MCP server in TypeScript.
- **Hosting:** GitHub Pages + HF static Space (free HF can't host Gradio/Docker) for showcase; Vercel for secret-holding backend.
- **LLM:** OpenAI-compatible interface; Ollama locally (small models → keep tool schemas tight, validate every call); hosted fallback via env for deploy.
- **Credentials:** Real Google (Gmail/Calendar/Docs/Drive) and Notion connectors require OAuth/integration tokens from the user — mock mode must fully work without them so evals and deploy never block on credentials.
- **Security:** No secrets committed; `.env` local only; Vercel env vars for deploy.
- **Commit hygiene:** No mentions of AI assistants in commit messages or code.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
- `web/scripts/mcp-stdio.ts`: `new McpServer(...)` → `registerTools(server, core)` → `server.connect(new StdioServerTransport())`. Run it with `npx tsx scripts/mcp-stdio.ts`.
- `web/src/routes/mcp/+server.ts`: `const handler = createMcpHandler(() => buildServer())` and `export const POST = ({ request }) => handler.fetch(request)` (also GET/DELETE, which return 405 in stateless mode). Add `export const prerender = false`.
- Both call the same `buildServer()` from `src/lib/core/mcp.ts`.
### Evals, Testing, Scripts
| Tool | Version | Purpose | Why | Confidence |
|---|---|---|---|---|
| Custom eval runner (`web/scripts/eval.ts`) | — | N runs × seeded scenarios → final-state read-back checks → pass rates + Lemma failure taxonomy → `web/static/evals/latest.json` + trace files | LLM runs are nondeterministic. You need repetitions, aggregate pass rates, per-failure classification and a JSON artifact the static dashboard renders. vitest's single pass/fail per test fights all of that. A 150-line script is faster to build and easier to show judges. | HIGH |
| vitest | keep **^4.1.8** (5.0.0 released 2026-09-03) | Deterministic unit tests: mock app state, zod validators, idempotency keys, retry/backoff, injection sanitizer | Already configured. **Don't upgrade to 5.0 mid-hackathon**; it's 10 days old and gains you nothing today. | HIGH |
| tsx | **4.23.13** | Run TS scripts (eval, MCP stdio, google-auth) | Zero config, runs ESM TypeScript on Node 24. `tsx --env-file=.env scripts/eval.ts` loads env without `dotenv`. | HIGH |
## Key Architecture-Stack Decisions (answers to the posed questions)
### Can one SvelteKit app serve both adapter-vercel and adapter-static? YES (HIGH)
### Should the agent core be a shared TS package? Shared CODE yes, separate PACKAGE no (MEDIUM-HIGH)
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
# Runtime deps
# Dev deps
## Small-Model Tool-Calling Rules (stack-level, apply from Phase 1)
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

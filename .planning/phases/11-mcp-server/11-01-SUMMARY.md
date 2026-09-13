---
phase: 11-mcp-server
plan: 01
subsystem: mcp
tags: [mcp, stdio, json-rpc, zod, approval-gate, vscode]
requires:
  - "04-03: planSprint, executeSprint, SprintRuntime, preflightPlan"
  - "04-01: sprintRegistry, WRITE_TOOLS, CritiqueSlotOutput, callSlot, createFakeLLM, PolicyError"
  - "03-01: analyzeGaps"
  - "02-02: createConnectors, isEmptyDiff, DEFAULT_CLOCK"
provides:
  - "core/mcp/tools.ts: MCP_TOOL_NAMES, McpToolName, McpSession, McpDeps, AgentToolDef, createMcpDeps, createAgentTools"
  - "core/mcp/server.ts: MCP_SERVER_INFO, buildMcpServer"
  - "web/scripts/mcp.ts stdio entry (serveStdio, mock default, stderr-only logs)"
  - ".vscode/mcp.json VS Code MCP client config"
affects: [phase-12-brief-readme-demo]
tech-stack:
  added: []
  patterns:
    - "Agent tool zod input passed straight to registerTool: listed JSON Schema is the runtime contract"
    - "defineAgentTool<I> identity helper for per-tool args inference in a heterogeneous list"
    - "Deps (mock world + plan session) created once outside the serveStdio factory so reruns dedupe"
key-files:
  created:
    - web/src/lib/core/mcp/tools.ts
    - web/src/lib/core/mcp/server.ts
    - web/src/lib/core/mcp/index.ts
    - web/src/lib/core/mcp/server.test.ts
    - web/src/lib/core/mcp/stdio.test.ts
    - web/src/lib/core/mcp/README.md
    - web/scripts/mcp.ts
    - .vscode/mcp.json
  modified: []
key-decisions:
  - "MCP exposes 4 agent-level tools only; the 4 app write tools are never standalone MCP tools, and writes go solely through executeSprint -> authorizeExecution"
  - "run_sprint looks plans up in a per-process session (planId from plan_sprint); PolicyError surfaces as isError text 'REJECTED <code>: <message>'"
  - "critique_essay uses the FakeLLM critique slot (PHASE5-SWAP marker, source 'placeholder') until Phase 5's critique entry point lands"
requirements-completed: [MCP-01]
duration: 5min
completed: 2026-09-13
---

# Phase 11 Plan 01: MCP stdio Server Summary

**A stdio MCP server (`@modelcontextprotocol/server` v2) exposes gap_analysis, critique_essay, plan_sprint and run_sprint. Their JSON input schemas are generated from the same zod objects the handlers run. run_sprint writes only with the HMAC plan token from plan_sprint plus explicit approvedIds, and it runs on mocks unless `TRANSFERPILOT_MCP_MODE=real` is set. Tests cover it over in-memory JSON-RPC and over a spawned stdio process.**

## Performance

- **Duration:** about 5 minutes (297 s)
- **Tasks:** 2 (3 commits)
- **Files:** 8 created, 0 modified

## Task Commits

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | Core MCP adapter + in-memory JSON-RPC test | `7a32e04` (test), `3eaa9ac` (feat) |
| 2 | stdio entry, spawned handshake test, VS Code config, README | `1983a45` (feat) |

## Tool table

| Tool | Input fields | Effect | Calls |
| --- | --- | --- | --- |
| `gap_analysis` | `profileId` (enum of loaded profiles), `programId?`, `today?` (YYYY-MM-DD) | read | `analyzeGaps(profile, schools, { today })`, optionally filtered to one program |
| `critique_essay` | `profileId`, `programId` | read | `docs.readDoc(profile.essay_doc_id)` (used only for the word count), then `callSlot(llm, CritiqueSlotOutput, { slot: 'critique' })`. `// PHASE5-SWAP` |
| `plan_sprint` | `profileId` | read (dry run) | `planSprint` + `preflightPlan`. The plan is stored in the session, and the result returns planId, planToken and 23 annotated actions |
| `run_sprint` | `planId`, `planToken`, `approvedIds` (1..100) | write | `executeSprint` (authorizeExecution → executor → read-back verify). Also returns world counts in mock mode |

All inputs are `.strict()`. Annotations: `readOnlyHint` for read tools, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint` only in real mode.

## VS Code setup

`.vscode/mcp.json` (repo root):
```json
{
  "servers": {
    "transferpilot": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "scripts/mcp.ts"],
      "cwd": "${workspaceFolder}/web",
      "env": { "TRANSFERPILOT_MCP_MODE": "mock" }
    }
  }
}
```
If VS Code cannot resolve `npx` on Windows, use `"command": "cmd", "args": ["/c", "npx", "tsx", "scripts/mcp.ts"]`. Documented in `web/src/lib/core/mcp/README.md`.

## Critique entry point

**Placeholder.** PRE-FLIGHT step 2's grep matched `buildCritiqueSlotInput` in `critique/analyze.ts`. That is a slot-input builder, not a critique entry point, and plan 05-01 is still in progress. Per orchestrator instruction, critique_essay uses the FakeLLM `critique` slot with `source: 'placeholder'`, and the `// PHASE5-SWAP:` marker is kept. No `critique/**` file is imported.

## Phase 4 signature differences (PRE-FLIGHT)

None. Every Phase 4 file and export was on disk and matched the plan's `<interfaces>` and the 04-0x SUMMARYs. `planSprint` returns `PlanResult` (`{ plan, planToken, reports }`).

## Verification

- `npm --prefix web test -- src/lib/core/mcp`: 2 files, 10 tests pass. server.test.ts has 9: initialize, tools/list parity, gap_analysis equality, gap filter and errors, critique_essay, plan_sprint dry run, run_sprint refusals, happy path + 23 deduped rerun, partial approval. stdio.test.ts has 1.
- `npm --prefix web test -- src/lib/core/mcp/server.test.ts src/lib/core/boundary.test.ts`: 11 pass.
- **Full suite** (`npm --prefix web test`): 40 files, 637 tests pass.
- **svelte-check:** 834 files, 0 errors, 0 warnings. The foreign in-progress errors noted at start had cleared by the time of this run.
- **Scripted stdio handshake (plan verify):** `STDIO_HANDSHAKE_OK 4 tools`. Config check: `VSCODE_CFG_OK`.
- **Acceptance greps:**
  - server.ts: `inputSchema: t.input` 1
  - tools.ts: tool-name literals 5; `executeSprint(` 1; `planSprint(` 1; `sprintRegistry` 3; `PHASE5-SWAP` 1
  - forbidden env/node/console/stdio in core mcp (non-test): 0
  - server.test.ts: refusal/dedupe literals 3; `WRITE_TOOLS` 2
  - scripts/mcp.ts: `serveStdio(` 1; `console.log = ` 1; `console.log(` 0; `TRANSFERPILOT_MCP_MODE` 3; `'mock'` 3; `PLAN_SIGNING_SECRET` 3
  - stdio.test.ts: banner 1; `jsonrpc` 3
  - .vscode/mcp.json: cwd line 1
  - README: plan_sprint/run_sprint/cmd matches 6
- `git diff --name-only -- web/package.json README.md` is empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `satisfies AgentToolDef` inferred `args` as unknown**
- **Found during:** Task 1 (svelte-check after GREEN; vitest passed)
- **Issue:** `satisfies AgentToolDef` checks against the default `z.ZodObject`, so the `run(d, args)` parameters were untyped. That produced 10 TS errors in tools.ts.
- **Fix:** I added a local identity helper, `defineAgentTool<I extends z.ZodObject>(def: AgentToolDef<I>)`, so each tool infers `args` from its own input. The list is still typed `AgentToolDef<any>[]` behind the planned eslint-disable comment.
- **Files modified:** web/src/lib/core/mcp/tools.ts
- **Commit:** 3eaa9ac

### Minor interpretation choices
- The rerun test also asserts that every action's `preflight` is `exists` on the second plan_sprint.
- stdio.test.ts asserts at least 3 stdout lines before the purity loop, so an empty stdout cannot pass vacuously. It also strips a trailing `\r`.
- Profiles are loaded in sorted filename order, so the enum order is stable.

## Known Stubs

- `web/src/lib/core/mcp/tools.ts`, critique_essay (`// PHASE5-SWAP`): the critique comes from the FakeLLM default responder and is labeled `source: 'placeholder'`. This is intentional until Phase 5 exports a critique entry point.

## Self-Check: PASSED

- All 8 created files exist.
- Commits 7a32e04, 3eaa9ac and 1983a45 are in `git log`.
- `git log -10 --format=%B` has no attribution trailers.

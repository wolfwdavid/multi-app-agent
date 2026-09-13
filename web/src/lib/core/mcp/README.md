# TransferPilot MCP server

A stdio MCP server that exposes the agent through the same core entry points (and zod contracts) the CLI, evals and REST API use.

| Tool | Effect | Purpose |
| --- | --- | --- |
| `gap_analysis` | read | Per-school transfer gap report (GPA, units, prerequisites, essays, recs, deadlines, warnings) with source links |
| `critique_essay` | read | Question-style critique of the profile essay against a program prompt and AI policy; writes nothing |
| `plan_sprint` | read (dry run) | Builds the sprint plan (critique Doc, Notion rows, Calendar events, Gmail drafts) with idempotency keys, preflight `new`/`exists`, and a signed `planToken` |
| `run_sprint` | write | Executes ONLY the approved actions of a plan; requires `planId`, `planToken` and `approvedIds` |

## Approval flow

1. `plan_sprint { profileId }` returns `planId`, `planToken` and the action list. Nothing is written.
2. Review the actions and choose the ids you accept.
3. `run_sprint { planId, planToken, approvedIds }`. A bad or missing token, empty `approvedIds`, an unknown `planId` or an unknown action id is rejected before any write.

Gmail is drafts-only (there is no send tool anywhere). The 4 app write tools are never exposed as standalone MCP tools. The server runs on mock apps by default; reruns dedupe by idempotency key.

## VS Code

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

`cwd` must be `web/` so `npx` resolves the local `tsx`. Then run Command Palette → "MCP: List Servers" → transferpilot → Start.

Windows fallback if VS Code cannot resolve `npx`:

```json
"command": "cmd", "args": ["/c", "npx", "tsx", "scripts/mcp.ts"]
```

## Manual run

```bash
cd web && npx tsx scripts/mcp.ts
# Inspector (from web/):
npx @modelcontextprotocol/inspector npx tsx scripts/mcp.ts
```

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `TRANSFERPILOT_MCP_MODE` | `mock` | `real` makes `run_sprint` write to configured apps (still token + approval gated) |
| `PLAN_SIGNING_SECRET` | per-process random | HMAC secret for plan tokens (>= 16 chars) |
| `TRANSFERPILOT_TODAY` | `2026-09-13` | Pins "today" for reproducible deadlines |

Logs and the ready banner go to stderr only; stdout carries nothing but JSON-RPC.

/**
 * TransferPilot MCP stdio server.
 *
 * Usage (from web/):  npx tsx scripts/mcp.ts
 *
 * Env:
 *   TRANSFERPILOT_MCP_MODE=mock|real  default mock. real => run_sprint writes to configured apps
 *                                     (still requires planToken + approvedIds).
 *   PLAN_SIGNING_SECRET               >= 16 chars; otherwise a per-process secret is generated.
 *   TRANSFERPILOT_TODAY=YYYY-MM-DD    pins "today" (default 2026-09-13, same as the sprint CLI).
 *
 * stdout rule: stdout carries ONLY JSON-RPC messages. Every log, warning and the ready banner go
 * to stderr.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

// stdout is the MCP JSON-RPC channel; any stray write corrupts the stream
const toStderr = (...a: unknown[]) => console.error(...a);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

const { buildMcpServer, createMcpDeps } = await import('../src/lib/core/mcp/index.ts');
const { Profile, SchoolsDataset } = await import('../src/lib/core/schemas.ts');
const { DEFAULT_CLOCK } = await import('../src/lib/core/connectors/index.ts');
type Env = import('../src/lib/core/connectors/index.ts').Env;

const WEB = fileURLToPath(new URL('..', import.meta.url));
const profilesDir = join(WEB, 'src/lib/core/data/profiles');
const profiles = readdirSync(profilesDir)
	.filter((f) => f.endsWith('.json'))
	.sort()
	.map((f) => Profile.parse(JSON.parse(readFileSync(join(profilesDir, f), 'utf8'))));
const schools = SchoolsDataset.parse(
	JSON.parse(readFileSync(join(WEB, 'src/lib/core/data/schools.json'), 'utf8'))
);

const raw = (process.env.TRANSFERPILOT_MCP_MODE ?? '').trim().toLowerCase();
let mode: 'mock' | 'real';
if (raw === '' || raw === 'mock') {
	mode = 'mock';
} else if (raw === 'real') {
	mode = 'real';
	console.error('WARNING: real mode — run_sprint writes to configured external apps (still requires planToken + approvedIds)');
} else {
	console.error(`invalid TRANSFERPILOT_MCP_MODE "${raw}" (expected mock|real)`);
	process.exit(64);
}

const envSecret = process.env.PLAN_SIGNING_SECRET ?? '';
let planSecret: string;
if (envSecret.length >= 16) {
	planSecret = envSecret;
} else {
	planSecret = globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID();
	console.error('PLAN_SIGNING_SECRET not set: using a per-process secret (plan tokens valid for this server session only)');
}

const todayEnv = process.env.TRANSFERPILOT_TODAY ?? '';
const today = /^\d{4}-\d{2}-\d{2}$/.test(todayEnv) ? todayEnv : DEFAULT_CLOCK.slice(0, 10);

// Created ONCE outside the factory: the mock world and the plan session live for the whole process.
const env = process.env as Env;
const deps = createMcpDeps({
	profiles,
	schools,
	planSecret,
	today,
	clock: () => new Date().toISOString(),
	mode,
	...(mode === 'real' ? { env } : {})
});

const handle = serveStdio(() => buildMcpServer(deps), {
	onerror: (e) => console.error('mcp error:', e.message)
});

console.error(
	`transferpilot MCP server ready (mode=${mode}, today=${today}, profiles=${Object.keys(deps.profiles).join(',')}, tools=gap_analysis,critique_essay,plan_sprint,run_sprint)`
);

const shutdown = () => {
	void handle.close().finally(() => process.exit(0));
};
process.stdin.on('end', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

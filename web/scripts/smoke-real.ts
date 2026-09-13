/**
 * Live smoke check for every real connector. Public GitHub/HF checks need no credentials;
 * credential-gated apps print [skip]. No tokens are ever printed.
 * Run from web/: npx tsx scripts/smoke-real.ts [--save <path>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	createRealConnectors,
	probeRealConnectors,
	type ProbeResult
} from '../src/lib/core/connectors/real/index.ts';

try {
	process.loadEnvFile('.env');
} catch {
	/* no .env: public checks only */
}

const env = process.env;
const saveIdx = process.argv.indexOf('--save');
const savePath = saveIdx >= 0 ? process.argv[saveIdx + 1] : undefined;

const tag = (r: ProbeResult) => (r.ok === true ? '[ok]  ' : r.ok === null ? '[skip]' : '[FAIL]');
const line = (r: ProbeResult) =>
	`${tag(r)} ${r.app.padEnd(9)} ${r.detail}${r.latencyMs === undefined ? '' : ` (${r.latencyMs}ms)`}`;

const results = await probeRealConnectors(env, { timeoutMs: 10000 });
for (const r of results) console.log(line(r));

const byApp = (app: string) => results.find((r) => r.app === app);
const github = byApp('github');
const hf = byApp('hf');
const ghUser = env.GITHUB_USERNAME?.trim() || 'wolfwdavid';
const hfUser = env.HF_USERNAME?.trim() || 'WolfDavid';
const bundle = createRealConnectors(env, { timeoutMs: 10000 });

const repos = github?.ok ? await bundle.github.listRepos(ghUser).catch(() => []) : [];
const items = hf?.ok ? await bundle.hf.listModelsAndSpaces(hfUser).catch(() => []) : [];
if (repos.length) console.log(`       github top: ${repos.slice(0, 3).map((r) => r.name).join(', ')}`);
if (items.length) console.log(`       hf top:     ${items.slice(0, 3).map((i) => i.id).join(', ')}`);

const isOffline = (r?: ProbeResult) =>
	r?.ok === false && (r.kind === 'timeout' || (r.kind === 'server' && /network/.test(r.detail)));

if (savePath && github?.ok && hf?.ok) {
	mkdirSync(dirname(savePath), { recursive: true });
	writeFileSync(
		savePath,
		JSON.stringify(
			{
				source: 'live',
				retrieved_at: new Date().toISOString(),
				github: { username: ghUser, repos },
				hf: { username: hfUser, items }
			},
			null,
			2
		) + '\n'
	);
	console.log(`saved public evidence -> ${savePath}`);
}

if (isOffline(github) && isOffline(hf)) {
	console.log('offline: live GitHub/HF checks skipped');
	process.exit(0);
}
process.exit(results.some((r) => r.ok === false) ? 1 : 0);

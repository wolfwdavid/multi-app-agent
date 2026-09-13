/**
 * Notion tracker setup and live contract smoke. Never prints the token or any request header.
 * Run from web/: npx tsx scripts/notion-setup.ts [--apply] [--roundtrip] [--keep]
 *
 *   (no flags)   validate the data source schema and print missing / mistyped properties
 *   --apply      add missing properties (never changes the type of an existing property)
 *   --roundtrip  create a smoke row, re-run the upsert, and prove exactly 1 row exists for the key
 *   --keep       keep the smoke row instead of moving it to trash
 */
import { createHash } from 'node:crypto';
import {
	NOTION_ENV,
	createNotionClient,
	createRealNotion,
	mapNotionError
} from '../src/lib/core/connectors/real/notion.ts';
import {
	TRACKER_PROPERTIES,
	missingPropertiesUpdate,
	normalizeNotionId,
	validateTrackerSchema,
	type SchemaIssue
} from '../src/lib/core/connectors/real/notion-schema.ts';
import { missingEnv, redactSecrets } from '../src/lib/core/connectors/real/shared.ts';

try {
	process.loadEnvFile('.env');
} catch {
	/* no .env: fall through to the skip message */
}

const env = process.env;
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const roundtrip = args.has('--roundtrip');
const keep = args.has('--keep');

const safe = (text: string) => redactSecrets(text, env);
const errText = (e: unknown, ctx: string) => safe(mapNotionError(e, ctx, env).message);

// Env var NAMES only; their values are never printed.
const [TOKEN_VAR] = NOTION_ENV;
const missing = missingEnv(env, NOTION_ENV);
if (missing.length) {
	console.log(`[skip] notion  missing env: ${missing.join(', ')}`);
	console.log('Setup:');
	console.log(`  1. https://www.notion.so/profile/integrations -> New internal integration -> copy the secret into ${TOKEN_VAR} in web/.env`);
	console.log('  2. Open the tracker database -> ... menu -> Connections -> add the integration');
	console.log('  3. Put the database URL or id in NOTION_DATA_SOURCE_ID and re-run this script (it prints the data source id to use)');
	process.exit(0);
}

const id = normalizeNotionId(env.NOTION_DATA_SOURCE_ID ?? '');
if (!id) {
	console.log('[FAIL] notion  NOTION_DATA_SOURCE_ID is not a Notion id or URL (expected 32 hex chars, a UUID, or a notion.so link)');
	process.exit(1);
}

const client = createNotionClient(env);
type Props = Record<string, { type: string }>;

async function retrieveProps(): Promise<Props> {
	const resp = (await client.dataSources.retrieve({ data_source_id: id! })) as { properties?: Props };
	return resp.properties ?? {};
}

let props: Props;
try {
	props = await retrieveProps();
} catch (e) {
	const kind = mapNotionError(e, 'notion.dataSources.retrieve', env).kind;
	if (kind === 'not_found' || kind === 'validation') {
		try {
			const db = (await client.databases.retrieve({ database_id: id })) as {
				data_sources?: { id: string; name?: string }[];
			};
			const sources = db.data_sources ?? [];
			console.log('NOTION_DATA_SOURCE_ID looks like a DATABASE id. Use one of these data source ids:');
			for (const ds of sources) console.log(`  ${ds.id}  ${ds.name ?? ''}`);
			if (!sources.length) console.log('  (the database returned no data sources)');
			process.exit(1);
		} catch {
			/* not a database either: report the original error below */
		}
	}
	console.log(`[FAIL] notion  ${errText(e, 'notion.dataSources.retrieve')}`);
	if (kind !== 'not_found') {
		console.log(`       Check ${TOKEN_VAR} and share the database with the integration (... > Connections).`);
	}
	process.exit(1);
}

function report(p: Props): SchemaIssue[] {
	const issues = validateTrackerSchema(p);
	for (const [name, expected] of Object.entries(TRACKER_PROPERTIES)) {
		const issue = issues.find((i) => i.property === name);
		if (!issue) console.log(`[ok]      ${name} (${expected})`);
		else if (issue.problem === 'missing') {
			console.log(`[missing] ${name} (${expected})${issue.actual ? ` (title property is currently named "${issue.actual.slice('title:'.length)}")` : ''}`);
		} else console.log(`[type]    ${name} expected ${issue.expected}, found ${issue.actual}`);
	}
	return issues;
}

console.log(`Tracker schema for data source ${id}:`);
let issues = report(props);

if (apply && issues.some((i) => i.problem === 'missing')) {
	const body = missingPropertiesUpdate(issues, props);
	try {
		await client.dataSources.update({ data_source_id: id, properties: body as never });
		props = await retrieveProps();
		console.log('Applied missing properties. Re-validated schema:');
		issues = report(props);
	} catch (e) {
		console.log(`[FAIL] notion  --apply: ${errText(e, 'notion.dataSources.update')}`);
		process.exit(1);
	}
}

const wrongType = issues.filter((i) => i.problem === 'wrong_type');
if (wrongType.length) {
	console.log(
		`Manual fix needed: ${wrongType.map((i) => `"${i.property}"`).join(', ')} exist with the wrong type. Rename (or delete) the conflicting property in Notion, then re-run with --apply.`
	);
}
if (issues.length && !apply && issues.some((i) => i.problem === 'missing')) {
	console.log('Run again with --apply to add the missing properties.');
}

if (!roundtrip) {
	process.exit(issues.length ? 1 : 0);
}

if (issues.length) {
	console.log('[FAIL] roundtrip  schema must be clean first (fix the issues above)');
	process.exit(1);
}

// Live contract smoke: create -> re-run -> exactly one row for the key.
const key = 'tp1-' + createHash('sha256').update('transferpilot-smoke|notion').digest('hex').slice(0, 16);
const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const row = {
	schoolId: 'smoke-school',
	programId: 'smoke-program',
	title: 'TransferPilot smoke test (safe to delete)',
	deadline,
	requiredDocs: ['transcript'],
	recsRequired: 1,
	essayStatus: 'draft' as const,
	gapCount: 0,
	status: 'planning' as const,
	key
};

try {
	const port = createRealNotion(env);
	const before = await port.findByKey(key);
	const a = await port.upsertTrackerRow(row);
	const b = await port.upsertTrackerRow({ ...row, gapCount: 1 });
	const rows = (await port.listTrackerRows()).filter((r) => r.key === key);
	const after = await port.findByKey(key);
	const pass = rows.length === 1 && a.id === b.id && after?.gapCount === 1;
	const verb = before ? 'updated' : 'created';
	if (pass) {
		console.log(`[ok] roundtrip: ${verb} page ${a.url ?? a.id}, re-run deduped, 1 row for key`);
	} else {
		console.log(
			`[FAIL] roundtrip: rows for key=${rows.length} (want 1), same page on re-run=${a.id === b.id}, read-back gapCount=${after?.gapCount} (want 1)`
		);
	}
	if (!keep) {
		for (const r of rows.length ? rows : [a]) {
			await client.pages.update({ page_id: r.id, in_trash: true });
		}
		console.log('trashed');
	}
	process.exit(pass ? 0 : 1);
} catch (e) {
	console.log(`[FAIL] roundtrip: ${errText(e, 'notion.roundtrip')}`);
	process.exit(1);
}

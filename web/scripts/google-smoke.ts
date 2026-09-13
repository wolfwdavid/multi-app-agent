// Live Google smoke: create → read-back → re-run dedupe → cleanup for each implemented Google app.
//
// Run from web/: npx tsx scripts/google-smoke.ts [--keep]
//
// Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN (see scripts/google-auth.ts).
// Without them it prints [skip] and exits 0. Prints ids and links only, never credentials.
// --keep leaves the smoke objects in place (a later run then exercises the dedupe/restore paths).
import { createHash } from 'node:crypto';
import { addDaysIso } from '../src/lib/core/connectors/mock/validate.ts';
import { GOOGLE_ENV, GOOGLE_IMPLEMENTED } from '../src/lib/core/connectors/real/google/flags.ts';
import { missingEnv } from '../src/lib/core/connectors/real/shared.ts';
import { ConnectorError } from '../src/lib/core/connectors/types.ts';

try {
	process.loadEnvFile('.env');
} catch {
	// no .env: rely on the process environment
}

const env = process.env;
const keep = process.argv.includes('--keep');
const smokeKey = (app: string) => 'tp1-' + createHash('sha256').update(`transferpilot-smoke|${app}`).digest('hex').slice(0, 16);
const describe = (e: unknown) => (e instanceof ConnectorError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e));

const missing = missingEnv(env, GOOGLE_ENV);
if (missing.length) {
	console.log(`[skip] google  missing env: ${missing.join(', ')}`);
	process.exit(0);
}

// Loaded only after the env check: the Google SDKs are heavy.
const { createGoogleApis, createRealGoogle } = await import('../src/lib/core/connectors/real/google/index.ts');
const apis = createGoogleApis(env);
const ports = createRealGoogle(env, { apis });
let failed = false;
const fail = (app: string, msg: string) => {
	failed = true;
	console.log(`[FAIL] ${app}  ${msg}`);
};

if (GOOGLE_IMPLEMENTED.calendar) {
	const calendarId = env.GOOGLE_CALENDAR_ID?.trim() || 'primary';
	const key = smokeKey('calendar');
	const date = addDaysIso(new Date().toISOString().slice(0, 10), 30);
	try {
		const existing = await ports.calendar.findByKey(key);
		const created =
			existing ?? (await ports.calendar.createEvent({ title: 'TransferPilot smoke test (safe to delete)', date, key }));
		const again = await ports.calendar.findByKey(key);
		if (!again || again.id !== created.id) {
			fail('calendar', `read-back mismatch (created ${created.id}, read ${again?.id ?? 'null'})`);
		} else {
			let deduped = false;
			try {
				await ports.calendar.createEvent({ title: 'TransferPilot smoke test (safe to delete)', date: created.date, key });
			} catch (e) {
				deduped = e instanceof ConnectorError && e.kind === 'validation' && e.status === 409;
				if (!deduped) throw e;
			}
			const listed = (await ports.calendar.listEvents({ from: created.date, to: addDaysIso(created.date, 1) })).filter(
				(e) => e.key === key
			);
			if (!deduped) fail('calendar', 're-run createEvent did not return 409 (possible duplicate)');
			else if (listed.length !== 1) fail('calendar', `expected 1 smoke event, listed ${listed.length}`);
			else console.log(`[ok] calendar create → read-back → re-run 409 deduped → 1 event (${created.url ?? created.id})`);
		}
		if (!keep) {
			const cal = apis.calendar as { events: { delete(p: object): Promise<unknown> } };
			await cal.events.delete({ calendarId, eventId: created.id });
		}
	} catch (e) {
		fail('calendar', describe(e));
	}
}

if (failed) process.exitCode = 1;

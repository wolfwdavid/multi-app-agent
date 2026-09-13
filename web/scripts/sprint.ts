/**
 * Terminal hero sprint on mock apps + recorder for the static showcase.
 *
 * Usage:
 *   npx tsx scripts/sprint.ts --profile demo [--auto-approve | --approve id1,id2] [--faults rate-limit|ghost-write|lying-success|exhaust] [--rerun] [--today YYYY-MM-DD] [--out trace.jsonl] [--json run.json] [--expect-status ok|partial|failed]
 *
 * `npm run record` = `--profile demo --auto-approve --rerun`, which rewrites
 * static/traces/demo-sprint.jsonl and static/data/hero-run.json (07-UI-SPEC hero-run shape).
 * Everything printed and written is PII-redacted: the terminal may be screen-recorded.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profile, SchoolsDataset } from '../src/lib/core/schemas.ts';
import type { Plan, RunReport, TraceEvent } from '../src/lib/core/schemas.ts';
import {
	createConnectors,
	DEFAULT_CLOCK,
	isEmptyDiff,
	type MockConnectorOptions,
	type MockConnectors
} from '../src/lib/core/connectors/index.ts';
import { createFakeLLM } from '../src/lib/core/llm/fake.ts';
import { CallbackSink, createTracer, MemorySink } from '../src/lib/core/trace/tracer.ts';
import { piiFromProfile, redactText, redactTraceEvent, type PiiSpec } from '../src/lib/core/trace/redact.ts';
import { toJsonl } from '../src/lib/core/trace/jsonl.ts';
import {
	allActionIds,
	buildHeroRunFile,
	executeSprint,
	planSprint,
	PolicyError,
	preflightPlan,
	type SprintRuntime
} from '../src/lib/core/agent/index.ts';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const PROFILES_DIR = join(WEB, 'src/lib/core/data/profiles');
const SCHOOLS_PATH = join(WEB, 'src/lib/core/data/schools.json');
const USAGE =
	'usage: npx tsx scripts/sprint.ts --profile demo [--auto-approve | --approve id1,id2] ' +
	'[--faults rate-limit|ghost-write|lying-success|exhaust] [--rerun] [--today YYYY-MM-DD] ' +
	'[--out trace.jsonl] [--json run.json] [--expect-status ok|partial|failed] [--verbose]';

type FaultRules = NonNullable<MockConnectorOptions['faults']>['rules'];
const FAULT_PRESETS = {
	'rate-limit': {
		notion: [{ method: 'upsertTrackerRow', calls: [1, 2], fault: { type: 'rate_limit', retryAfterMs: 50 } }],
		calendar: [{ method: 'createEvent', calls: [1], fault: { type: 'rate_limit', retryAfterMs: 50 } }]
	},
	'ghost-write': {
		gmail: [{ method: 'createDraft', calls: [1], fault: { type: 'ghost_write' } }],
		calendar: [{ method: 'createEvent', calls: [2], fault: { type: 'ghost_write' } }]
	},
	'lying-success': {
		calendar: [{ method: 'createEvent', calls: [1], fault: { type: 'lying_success' } }]
	},
	exhaust: {
		notion: [{ method: 'upsertTrackerRow', fault: { type: 'server_error' } }]
	}
} satisfies Record<string, FaultRules>;
type FaultPreset = keyof typeof FAULT_PRESETS;
const STATUSES = ['ok', 'partial', 'failed'] as const;
type RunStatus = (typeof STATUSES)[number];

interface Args {
	profile: string;
	autoApprove: boolean;
	approve: string[] | null;
	faults: FaultPreset | null;
	rerun: boolean;
	today: string;
	out: string | null;
	json: string | null;
	expectStatus: RunStatus | null;
	verbose: boolean;
}

function usageExit(msg: string): never {
	console.error(`${msg}\n${USAGE}`);
	process.exit(64);
}

function parseArgs(argv: string[]): Args {
	const a: Args = {
		profile: 'demo',
		autoApprove: false,
		approve: null,
		faults: null,
		rerun: false,
		today: DEFAULT_CLOCK.slice(0, 10),
		out: null,
		json: null,
		expectStatus: null,
		verbose: false
	};
	const value = (i: number, flag: string): string => {
		const v = argv[i + 1];
		if (v === undefined || v.startsWith('--')) usageExit(`missing value for ${flag}`);
		return v;
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		switch (flag) {
			case '--profile':
				a.profile = value(i++, flag);
				break;
			case '--auto-approve':
				a.autoApprove = true;
				break;
			case '--approve':
				a.approve = value(i++, flag).split(',').map((s) => s.trim()).filter(Boolean);
				if (a.approve.length === 0) usageExit('--approve needs at least one action id');
				break;
			case '--faults': {
				const f = value(i++, flag);
				if (!(f in FAULT_PRESETS)) usageExit(`unknown fault preset "${f}"`);
				a.faults = f as FaultPreset;
				break;
			}
			case '--rerun':
				a.rerun = true;
				break;
			case '--today':
				a.today = value(i++, flag);
				if (!/^\d{4}-\d{2}-\d{2}$/.test(a.today)) usageExit('--today must be YYYY-MM-DD');
				break;
			case '--out':
				a.out = value(i++, flag);
				break;
			case '--json':
				a.json = value(i++, flag);
				break;
			case '--expect-status': {
				const s = value(i++, flag);
				if (!(STATUSES as readonly string[]).includes(s)) usageExit(`invalid --expect-status "${s}"`);
				a.expectStatus = s as RunStatus;
				break;
			}
			case '--verbose':
				a.verbose = true;
				break;
			default:
				usageExit(`unknown flag "${flag}"`);
		}
	}
	if (a.autoApprove && a.approve) usageExit('use either --auto-approve or --approve, not both');
	return a;
}

function loadProfile(name: string): Profile {
	const path = join(PROFILES_DIR, `${name}.json`);
	if (!existsSync(path)) {
		const available = readdirSync(PROFILES_DIR)
			.filter((f) => f.endsWith('.json'))
			.map((f) => f.replace(/\.json$/, ''));
		console.error(`profile "${name}" not found. Available: ${available.join(', ')}`);
		process.exit(64);
	}
	return Profile.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function gitSha(): string {
	try {
		return execSync('git rev-parse --short HEAD', { cwd: WEB, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'uncommitted';
	} catch {
		return 'uncommitted';
	}
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
const field = (o: object, k: string): unknown => (o as unknown as Record<string, unknown>)[k];
const BLOCKED_REASONS = new Set(['policy', 'allowlist', 'injection', 'not_approved']);

/** One readable, redacted line per interesting trace event (07-UI-SPEC display mapping). */
function createPrinter(pii: PiiSpec, verbose: boolean) {
	let n = 0;
	return (raw: TraceEvent) => {
		const e = redactTraceEvent(raw, pii);
		const at = e.attrs;
		if (e.name === 'action.execute' && e.kind === 'end') {
			const attempt = Number(at.attempt ?? 0);
			const display =
				e.status === 'ok'
					? attempt > 1
						? `retried x${attempt}`
						: 'ok'
					: e.status === 'deduped'
						? 'deduped'
						: e.status === 'skipped'
							? BLOCKED_REASONS.has(str(at.reason))
								? 'blocked'
								: 'skipped'
							: 'FAILED';
			const reason = at.reason ? ` (${str(at.reason)})` : '';
			console.log(
				`#${String(++n).padStart(2)} ${str(at.app).padEnd(8)} ${str(at.tool).padEnd(26)} try ${attempt}/${str(at.maxAttempts)} ${Math.round(e.durationMs ?? 0)}ms ${display}${reason}`
			);
		} else if (e.name === 'retry') {
			console.log(
				`    ↻ try ${str(at.attempt)} ${str(at['error.status'])} ${str(at['error.kind'])} waited ${str(at.retryAfterMs)}ms re-checked key: ${at.foundByKey ? 'found' : 'not found'}`
			);
		} else if (e.name === 'verify.readback' && e.kind === 'end') {
			console.log(`   readback ${str(at.actionId)} found=${str(at.found)} → ${str(at.artifactStatus)}`);
		} else if (e.name === 'tool.call') {
			if (verbose) console.log(`    tool.call ${str(at.tool)}.${str(at.method)} try ${str(at.attempt)} ${Math.round(Number(at.latencyMs ?? 0))}ms`);
		} else if (
			e.name === 'action.skipped' ||
			e.name === 'plan.built' ||
			e.name === 'run.end' ||
			e.name.startsWith('policy.') ||
			e.name.startsWith('guard.')
		) {
			const kv = Object.entries(at)
				.filter(([, v]) => v === null || typeof v !== 'object' || e.name === 'run.end')
				.map(([k, v]) => `${k}=${str(v)}`)
				.join(' ');
			console.log(`${e.name} ${kv}`.trimEnd());
		}
	};
}

function printPlan(plan: Plan, token: string, preflight: Record<string, 'new' | 'exists'>, pii: PiiSpec) {
	const r = (s: unknown) => redactText(str(s), pii);
	console.log(`\n== PLAN ${plan.planId} (dry run) ==`);
	console.log('id | app | tool | key | new/exists | summary');
	for (const a of plan.actions) {
		console.log(`${a.id} | ${a.app} | ${a.tool} | ${a.idempotencyKey} | ${preflight[a.id] ?? 'new'} | ${r(a.summary)}`);
		const p = a.payload;
		const preview =
			a.app === 'gmail'
				? `to=${r(p.to)} subject=${r(p.subject)}`
				: a.app === 'calendar'
					? `date=${r(p.date)} title=${r(p.title)}`
					: a.app === 'notion'
						? `title=${r(p.title)} deadline=${r(p.deadline)} status=${r(p.status)}`
						: `title=${r(p.title)}`;
		console.log(`    ${preview}`);
	}
	for (const b of plan.blockers) {
		console.log(`BLOCKER ${b.code} ${str(field(b, 'programId') ?? field(b, 'schoolId'))}: ${r(b.message)}`);
	}
	console.log(`planToken ${token.slice(0, 11)}…  (${plan.actions.length} actions)`);
}

function printFinal(bundle: MockConnectors, today: string, report: RunReport, pii: PiiSpec) {
	const s = bundle.world.state;
	console.log('\n== FINAL STATE ==');
	console.log(`notion rows: ${s.notion.rows.length}`);
	console.log(`calendar events: ${s.calendar.events.length}`);
	console.log(`docs created: ${s.docs.docs.filter((d) => d.key !== undefined).length}`);
	console.log(`gmail drafts: ${s.gmail.drafts.length}`);
	console.log(`gmail sent: ${s.gmail.sent.length}`);
	console.log(`past events: ${s.calendar.events.filter((e) => e.date < today).length}`);
	console.log('\n== REPORT ==');
	console.log(`status ${report.status}`);
	const c = report.counts;
	console.log(`verified ${c.verified}  deduped ${c.deduped}  failed ${c.failed}  skipped ${c.skipped}`);
	for (const a of report.artifacts) {
		if (a.status === 'verified' || a.status === 'deduped') continue;
		console.log(`${a.status} ${a.actionId} ${redactText(a.detail ?? '', pii)}`);
	}
	for (const b of report.blockers) console.log(`BLOCKER ${b.code}: ${redactText(b.message, pii)}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const profile = loadProfile(args.profile);
	const schools = SchoolsDataset.parse(JSON.parse(readFileSync(SCHOOLS_PATH, 'utf8')));
	const pii = piiFromProfile(profile);

	const envSecret = process.env.PLAN_SIGNING_SECRET;
	let planSecret = 'local-dev-plan-signing-secret';
	if (envSecret && envSecret.length >= 16) planSecret = envSecret;
	else console.error('using local dev signing secret (set PLAN_SIGNING_SECRET for deployments)');

	const mem = new MemorySink();
	const tracer = createTracer({
		sinks: [mem, new CallbackSink(createPrinter(pii, args.verbose))],
		traceId: `demo-sprint${args.faults ? '-' + args.faults : ''}`
	});
	const bundle = createConnectors({
		mode: 'mock',
		...(args.faults ? { faults: { rules: FAULT_PRESETS[args.faults] as FaultRules, seed: 1 } } : {})
	});
	const rt: SprintRuntime = {
		connectors: bundle,
		mode: 'mock',
		llm: createFakeLLM(),
		tracer,
		planSecret,
		today: args.today,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms))
	};

	const { plan, planToken } = await planSprint(rt, { profile, schools, createdAt: new Date().toISOString() });
	const preflight = await preflightPlan(bundle, plan);
	printPlan(plan, planToken, preflight, pii);

	const writeTrace = () => {
		const out = args.out
			? resolve(process.cwd(), args.out)
			: join(WEB, 'static/traces', `demo-sprint${args.faults ? '-' + args.faults : ''}.jsonl`);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, toJsonl(mem.events.map((e) => redactTraceEvent(e, pii))));
		console.log(`trace: ${relative(WEB, out)} (${mem.events.length} events, PII redacted)`);
	};

	if (!args.autoApprove && !args.approve) {
		console.log('\nDry run only. Re-run with --auto-approve or --approve <ids>.');
		writeTrace();
		return;
	}

	const approvedIds = args.autoApprove ? allActionIds(plan) : args.approve!;
	console.log(`\n== EXECUTE (${approvedIds.length} approved) ==`);
	const run1Start = mem.events.length;
	let report: RunReport;
	try {
		report = await executeSprint(rt, { plan, planToken, approvedIds, profile });
	} catch (err) {
		if (err instanceof PolicyError) {
			console.error(`REJECTED ${err.code}: ${redactText(err.message, pii)}`);
			process.exitCode = 2;
			return;
		}
		throw err;
	}
	const run1Events = mem.events.slice(run1Start);
	printFinal(bundle, args.today, report, pii);

	let report2: RunReport | null = null;
	let rerunEvents: TraceEvent[] = [];
	if (args.rerun) {
		console.log('\n== RERUN (same world, no faults) ==');
		const snap = bundle.world.snapshot();
		const bundle2 = createConnectors({ mode: 'mock', world: bundle.world });
		const rt2: SprintRuntime = { ...rt, connectors: bundle2 };
		const p2 = await planSprint(rt2, { profile, schools, createdAt: new Date().toISOString() });
		const rerunStart = mem.events.length;
		report2 = await executeSprint(rt2, {
			plan: p2.plan,
			planToken: p2.planToken,
			approvedIds: allActionIds(p2.plan),
			profile
		});
		rerunEvents = mem.events.slice(rerunStart);
		const dedupedCount = report2.artifacts.filter((a) => a.status === 'deduped').length;
		const newWrites = !isEmptyDiff(bundle.world.diff(snap));
		if (report.status === 'ok') {
			if (!newWrites && dedupedCount === report2.artifacts.length) {
				console.log(`RERUN: 0 new writes (${dedupedCount}/${report2.artifacts.length} deduped)`);
			} else {
				console.log(
					`RERUN FAILED: ${dedupedCount}/${report2.artifacts.length} deduped, world ${newWrites ? 'changed' : 'unchanged'}`
				);
				process.exitCode = 1;
			}
		} else {
			console.log(`RERUN: ${dedupedCount} deduped, ${report2.counts.verified} artifact(s) created that run 1 missed`);
		}
	}

	writeTrace();

	const defaultHero = !args.faults && args.autoApprove && args.profile === 'demo';
	const jsonPath = args.json ? resolve(process.cwd(), args.json) : defaultHero ? join(WEB, 'static/data/hero-run.json') : null;
	if (jsonPath) {
		const file = buildHeroRunFile({
			recordedAt: new Date().toISOString(),
			commitSha: gitSha(),
			profile,
			plan,
			preflight,
			events: run1Events,
			report,
			...(report2 ? { rerun: { events: rerunEvents, report: report2 } } : {})
		});
		mkdirSync(dirname(jsonPath), { recursive: true });
		writeFileSync(jsonPath, JSON.stringify(file, null, 2) + '\n');
		console.log(`run: ${relative(WEB, jsonPath)} (UI-SPEC hero-run shape, PII redacted)`);
	}

	if (args.expectStatus && report.status !== args.expectStatus) {
		console.log(`EXPECTED status ${args.expectStatus}, got ${report.status}`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

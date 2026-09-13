#!/usr/bin/env node
// Dependency-free MCP stdio client for the demo video.
//
// Usage (from the repo root):  node demo/tools/mcp-demo.mjs [--pause-ms 1600] [--profile demo]
//
// Spawns the TransferPilot MCP server (`npx tsx scripts/mcp.ts`, cwd web/, mock mode), performs the
// initialize handshake, lists tools, then calls ONLY the read-only plan_sprint tool (a dry run that
// writes nothing) and prints a readable summary. run_sprint (the write tool) is never called.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, '../../web');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const PAUSE = Number(flag('--pause-ms', '1600'));
const PROFILE = flag('--profile', 'demo');
const TIMEOUT_MS = 60_000;

// ---- tiny ANSI helpers ---------------------------------------------------------------------------
const esc = (c) => (s) => `\x1b[${c}m${s}\x1b[0m`;
const bold = esc('1');
const dim = esc('2');
const cyan = esc('36');
const green = esc('32');
const yellow = esc('33');
const magenta = esc('35');
const blue = esc('34');
const red = esc('31');
const out = (s = '') => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

async function step(n, total, title) {
	out();
	out(bold(cyan(`[${n}/${total}] ${title}`)));
	await sleep(Math.round(PAUSE / 3));
}

const APP_COLOR = { docs: blue, notion: magenta, calendar: yellow, gmail: red };
const appTag = (app) => (APP_COLOR[app] ?? ((s) => s))(pad(app, 8));

// ---- JSON-RPC over the child's stdio ------------------------------------------------------------
out(bold('TransferPilot MCP client') + dim('  (stdio transport, newline-delimited JSON-RPC 2.0, no SDK)'));
await sleep(Math.round(PAUSE / 2));

await step(1, 4, 'Spawn the MCP server');
out(`  ${dim('$')} npx tsx scripts/mcp.ts   ${dim('(cwd web/, TRANSFERPILOT_MCP_MODE=mock)')}`);

const child = spawn('npx tsx scripts/mcp.ts', {
	cwd: WEB,
	shell: true,
	windowsHide: true,
	stdio: ['pipe', 'pipe', 'pipe'],
	env: {
		...process.env,
		TRANSFERPILOT_MCP_MODE: 'mock',
		PLAN_SIGNING_SECRET: process.env.PLAN_SIGNING_SECRET ?? 'demo-video-signing-secret-0123456789',
		FORCE_COLOR: '0',
		NO_COLOR: '1'
	}
});

let ready;
const readyP = new Promise((r) => (ready = r));
let stderrBuf = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
	stderrBuf += d;
	let nl;
	while ((nl = stderrBuf.indexOf('\n')) >= 0) {
		const line = stderrBuf.slice(0, nl).replace(/\r$/, '');
		stderrBuf = stderrBuf.slice(nl + 1);
		if (!line.trim()) continue;
		out(`  ${dim('server stderr │')} ${dim(trunc(line, 100))}`);
		if (line.includes('MCP server ready')) ready();
	}
});

const pending = new Map();
let nonJsonLines = 0;
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
	buf += d;
	let nl;
	while ((nl = buf.indexOf('\n')) >= 0) {
		const line = buf.slice(0, nl).replace(/\r$/, '');
		buf = buf.slice(nl + 1);
		if (!line.trim()) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			nonJsonLines++;
			continue;
		}
		if (msg && pending.has(msg.id)) {
			pending.get(msg.id)(msg);
			pending.delete(msg.id);
		}
	}
});

let exited = false;
child.on('exit', (code) => {
	exited = true;
	for (const [, res] of pending) res({ error: { message: `server exited (${code})` } });
	pending.clear();
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
let nextId = 0;
function request(method, params) {
	const id = ++nextId;
	const wire = JSON.stringify({ jsonrpc: '2.0', id, method, params });
	out(`  ${green('→')} ${dim(trunc(wire, 108))}`);
	return new Promise((resolveMsg, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`timeout waiting for ${method}`));
		}, TIMEOUT_MS);
		pending.set(id, (m) => {
			clearTimeout(timer);
			if (m.error) reject(new Error(`${method} failed: ${m.error.message}`));
			else resolveMsg(m.result);
		});
		send({ jsonrpc: '2.0', id, method, params });
	});
}

function fail(err) {
	out();
	out(red(bold(`error: ${err.message}`)));
	try {
		child.stdin.end();
		child.kill();
	} catch {}
	process.exit(1);
}

try {
	await Promise.race([
		readyP,
		new Promise((_, rej) => setTimeout(() => rej(new Error('server did not report ready')), TIMEOUT_MS))
	]);
	if (exited) throw new Error('server exited early');
	await sleep(PAUSE);

	// ---- 2. initialize handshake ------------------------------------------------------------------
	await step(2, 4, 'Initialize handshake');
	const init = await request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'transferpilot-demo-client', version: '1.0.0' }
	});
	const si = init.serverInfo ?? {};
	out(
		`  ${cyan('←')} serverInfo ${bold(`${si.name} ${si.version}`)}   protocol ${bold(init.protocolVersion)}   capabilities ${bold(
			Object.keys(init.capabilities ?? {}).join(', ') || '(none)'
		)}`
	);
	send({ jsonrpc: '2.0', method: 'notifications/initialized' });
	out(`  ${green('→')} ${dim('{"jsonrpc":"2.0","method":"notifications/initialized"}')}   ${green('✔ session ready')}`);
	await sleep(PAUSE);

	// ---- 3. tools/list ----------------------------------------------------------------------------
	await step(3, 4, 'Discover tools');
	const list = await request('tools/list', {});
	const tools = list.tools ?? [];
	out(`  ${cyan('←')} ${bold(String(tools.length))} tools`);
	for (const t of tools) {
		const ro = t.annotations?.readOnlyHint;
		const effect = ro ? green(pad('read ', 6)) : yellow(pad('WRITE', 6));
		const req = t.inputSchema?.required ?? [];
		const firstSentence = (t.description ?? '').split(/(?<=\.)\s/)[0];
		out(`    ${bold(pad(t.name, 15))} ${effect} ${dim(pad(`(${req.join(', ')})`, 36))}`);
		out(`      ${trunc(firstSentence, 104)}`);
		await sleep(160);
	}
	await sleep(PAUSE);

	// ---- 4. tools/call plan_sprint ---------------------------------------------------------------
	await step(4, 4, 'Call plan_sprint (read-only dry run)');
	const call = await request('tools/call', { name: 'plan_sprint', arguments: { profileId: PROFILE } });
	if (call.isError) throw new Error(call.content?.[0]?.text ?? 'plan_sprint returned isError');
	const plan = call.structuredContent ?? JSON.parse(call.content?.[0]?.text ?? '{}');
	const actions = plan.actions ?? [];
	const byApp = {};
	const byPreflight = {};
	for (const a of actions) {
		byApp[a.app] = (byApp[a.app] ?? 0) + 1;
		const pf = typeof a.preflight === 'string' ? a.preflight : a.preflight?.status ?? 'n/a';
		byPreflight[pf] = (byPreflight[pf] ?? 0) + 1;
	}
	const appsLine = Object.entries(byApp)
		.map(([app, n]) => `${(APP_COLOR[app] ?? ((s) => s))(app)} ${bold(String(n))}`)
		.join('  ');
	const token = String(plan.planToken ?? '');
	out(`  ${cyan('←')} planId ${bold(plan.planId)}   profile ${bold(plan.profileId)}   mode ${bold(plan.mode)}`);
	out(`    actions   ${bold(String(actions.length))}   ${dim('│')} ${appsLine}`);
	out(
		`    preflight ${Object.entries(byPreflight)
			.map(([k, n]) => `${k} ${bold(String(n))}`)
			.join('  ')}   ${dim('│')} blockers ${bold(String((plan.blockers ?? []).length))}`
	);
	for (const b of (plan.blockers ?? []).slice(0, 2)) {
		const text = typeof b === 'string' ? b : b.message ?? b.reason ?? b.summary ?? JSON.stringify(b);
		out(`    ${yellow('blocker')}   ${trunc(String(text), 96)}`);
	}
	out(`    planToken ${yellow(token.length > 22 ? `${token.slice(0, 18)}…${token.slice(-4)}` : token)} ${dim(`(${token.length} chars, HMAC-signed)`)}`);
	await sleep(Math.round(PAUSE / 2));

	const SHOW = 8;
	for (const a of actions.slice(0, SHOW)) {
		out(`    ${appTag(a.app)} ${dim(pad(trunc(a.tool ?? '', 26), 26))} ${trunc(a.summary ?? '', 76)}`);
		await sleep(120);
	}
	if (actions.length > SHOW) out(dim(`    … and ${actions.length - SHOW} more actions`));
	await sleep(Math.round(PAUSE / 2));

	out();
	out(`  ${green('✔')} ${bold('Nothing was written.')} run_sprint needs this planToken plus the approvedIds a human accepts.`);
	if (nonJsonLines > 0) out(red(`  ! ${nonJsonLines} non-JSON line(s) on stdout`));
	else out(`  ${green('✔')} stdout carried only JSON-RPC ${dim(`(${nextId} responses parsed, logs on stderr)`)}`);
} catch (err) {
	fail(err);
}

child.stdin.end(); // server shuts down when stdin closes
await Promise.race([new Promise((r) => child.on('exit', r)), sleep(5000)]);
if (!exited) child.kill();
process.exit(0);

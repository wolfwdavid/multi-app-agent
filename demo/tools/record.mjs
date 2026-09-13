#!/usr/bin/env node
// Terminal session recorder -> asciicast v2.
//
// Usage:
//   node demo/tools/record.mjs --cast <out.cast> --cwd <dir> [--env K=V ...]
//        [--title "<title>"] [--width 120] [--height 34] [--stdin ignore|inherit|<file>]
//        -- <command...>
//
// Spawns the command through a shell (so npx/.cmd shims resolve on Windows),
// timestamps every stdout/stderr chunk with a high-resolution clock, echoes it
// live, and writes an asciicast v2 file incrementally. The final event is a
// marker line [t, "m", "exit:<code>"]. The recorder exits with the child's code.
//
// No npm dependencies: node: builtins only.

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

function usage(msg) {
	if (msg) process.stderr.write(`record.mjs: ${msg}\n`);
	process.stderr.write(
		'usage: node demo/tools/record.mjs --cast <out.cast> --cwd <dir> [--env K=V ...] ' +
			'[--title T] [--width 120] [--height 34] [--stdin ignore|inherit|<file>] -- <command...>\n'
	);
	process.exit(2);
}

function parseArgs(argv) {
	const opts = { env: {}, width: 120, height: 34, stdin: 'ignore', title: '', cast: '', cwd: process.cwd() };
	const sep = argv.indexOf('--');
	if (sep === -1) usage('missing "--" before the command');
	const flags = argv.slice(0, sep);
	const command = argv.slice(sep + 1);
	if (command.length === 0) usage('empty command');
	for (let i = 0; i < flags.length; i++) {
		const f = flags[i];
		const next = () => {
			if (i + 1 >= flags.length) usage(`${f} needs a value`);
			return flags[++i];
		};
		switch (f) {
			case '--cast': opts.cast = next(); break;
			case '--cwd': opts.cwd = next(); break;
			case '--title': opts.title = next(); break;
			case '--width': opts.width = Number(next()); break;
			case '--height': opts.height = Number(next()); break;
			case '--stdin': opts.stdin = next(); break;
			case '--env': {
				const kv = next();
				const eq = kv.indexOf('=');
				if (eq <= 0) usage(`--env expects K=V, got "${kv}"`);
				opts.env[kv.slice(0, eq)] = kv.slice(eq + 1);
				break;
			}
			case '-h':
			case '--help': usage();
			default: usage(`unknown flag ${f}`);
		}
	}
	if (!opts.cast) usage('--cast is required');
	if (!Number.isInteger(opts.width) || !Number.isInteger(opts.height)) usage('--width/--height must be integers');
	return { opts, command };
}

// Quote one argv element for the platform shell (cmd.exe on Windows, sh elsewhere).
function quoteArg(a) {
	if (a === '') return '""';
	if (process.platform === 'win32') {
		return /[\s"&|<>^()%!,;]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
	}
	return /[^\w@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a;
}

const { opts, command } = parseArgs(process.argv.slice(2));
const castPath = resolve(opts.cast);
const cwd = resolve(opts.cwd);
const commandLine = command.length === 1 ? command[0] : command.map(quoteArg).join(' ');

mkdirSync(dirname(castPath), { recursive: true });
const fd = openSync(castPath, 'w');
const writeLine = (obj) => writeSync(fd, JSON.stringify(obj) + '\n');

writeLine({
	version: 2,
	width: opts.width,
	height: opts.height,
	timestamp: Math.floor(Date.now() / 1000),
	title: opts.title || commandLine,
	command: commandLine,
	env: { SHELL: process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/sh', TERM: 'xterm-256color' }
});

const t0 = process.hrtime.bigint();
const now = () => Number(process.hrtime.bigint() - t0) / 1e9;
// asciicast timestamps: seconds with microsecond precision, monotonic non-decreasing.
let lastT = 0;
const stamp = () => {
	const t = Math.max(lastT, Math.round(now() * 1e6) / 1e6);
	lastT = t;
	return t;
};

let stdinMode = 'ignore';
let stdinFile = null;
if (opts.stdin === 'inherit') stdinMode = 'inherit';
else if (opts.stdin !== 'ignore') {
	stdinMode = 'pipe';
	stdinFile = readFileSync(resolve(opts.stdin));
}

const child = spawn(commandLine, {
	cwd,
	shell: true,
	windowsHide: true,
	stdio: [stdinMode, 'pipe', 'pipe'],
	env: {
		...process.env,
		FORCE_COLOR: '1',
		NO_UPDATE_NOTIFIER: '1',
		COLUMNS: String(opts.width),
		LINES: String(opts.height),
		TERM: process.env.TERM || 'xterm-256color',
		...opts.env
	}
});

if (stdinFile) {
	child.stdin.on('error', () => {});
	child.stdin.end(stdinFile);
}

function pump(stream, echo) {
	const decoder = new StringDecoder('utf8'); // keeps split multibyte chars intact
	stream.on('data', (buf) => {
		echo.write(buf);
		const s = decoder.write(buf);
		if (s) writeLine([stamp(), 'o', s]);
	});
	stream.on('end', () => {
		const s = decoder.end();
		if (s) writeLine([stamp(), 'o', s]);
	});
}
pump(child.stdout, process.stdout);
pump(child.stderr, process.stderr);

const forward = (sig) => () => {
	try { child.kill(sig); } catch {}
};
process.on('SIGINT', forward('SIGINT'));
process.on('SIGTERM', forward('SIGTERM'));

child.on('error', (err) => {
	const msg = `record.mjs: failed to start command: ${err.message}\r\n`;
	process.stderr.write(msg);
	writeLine([stamp(), 'o', msg]);
});

child.on('close', (code, signal) => {
	const exitCode = code ?? (signal ? 1 : 0);
	writeLine([stamp(), 'm', `exit:${exitCode}${signal ? ` signal:${signal}` : ''}`]);
	closeSync(fd);
	process.stderr.write(`\nrecord.mjs: wrote ${castPath} (exit ${exitCode}, ${lastT.toFixed(2)}s)\n`);
	process.exit(exitCode);
});

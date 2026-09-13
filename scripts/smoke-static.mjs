#!/usr/bin/env node
// Static showcase smoke test: serves web/build the way a sub-path static host (GitHub Pages)
// does, crawls every internal href/src, and validates the static JSON data files.
//
// Usage:
//   node scripts/smoke-static.mjs [--build] [--base multi-app-agent|''] [--dir web/build]
//                                 [--serve] [--port 4174] [--url https://host/base] [--wait 300]
//
//   --build   run `npm run build` in web/ with BASE_PATH set inside Node (static adapter)
//   --base    base path WITHOUT a leading slash (Git Bash rewrites /x into C:/Program Files/Git/x);
//             '' means the site is served at the root (HF static Space)
//   --dir     build directory to serve (default web/build)
//   --serve   keep the local server running after the checks (manual review)
//   --port    local port (default 0 = ephemeral)
//   --url     check a live site instead of the local build; the base comes from the URL path
//   --wait N  remote mode: retry the whole check set every 10 s for up to N seconds
//   --dir-index  host does not serve directory indexes (HF static Spaces 302 `/evals/` off-origin):
//             request `<dir>/index.html` for pages and crawled dir links; unknown page must be non-200
//
// Node >= 22 built-ins only. Exit 0 on SMOKE OK, 1 otherwise.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = join(ROOT, 'web');
const MAX_URLS = 150;

function parseArgs(argv) {
	const opts = { build: false, base: '', dir: join(WEB, 'build'), serve: false, port: 0, url: null, wait: 0, dirIndex: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => (i + 1 < argv.length ? argv[++i] : '');
		if (a === '--build') opts.build = true;
		else if (a === '--serve') opts.serve = true;
		else if (a === '--base') opts.base = next();
		else if (a.startsWith('--base=')) opts.base = a.slice(7);
		else if (a === '--dir') opts.dir = resolve(next());
		else if (a === '--port') opts.port = Number(next());
		else if (a === '--url') opts.url = next();
		else if (a === '--wait') opts.wait = Number(next());
		else if (a === '--dir-index') opts.dirIndex = true;
		else if (a === '--help' || a === '-h') {
			console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).join('\n'));
			process.exit(0);
		} else {
			console.error(`unknown argument: ${a}`);
			process.exit(2);
		}
	}
	return opts;
}

export function normBase(s) {
	let v = String(s ?? '').trim();
	const msys = v.match(/^[A-Za-z]:\/.*?\/Git(\/.*)$/);
	if (msys) v = msys[1];
	v = v.replace(/^\/+/, '').replace(/\/+$/, '');
	return v ? '/' + v : '';
}

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.txt': 'text/plain',
	'.md': 'text/markdown',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json',
	'.jsonl': 'application/x-ndjson'
};

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}
function isDir(p) {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

// Mimics GitHub Pages: only paths under base, dir -> index.html, dir without slash -> 301, else 404.html.
function startServer(dir, base, port) {
	const notFound = (res) => {
		const page = join(dir, '404.html');
		res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
		res.end(isFile(page) ? readFileSync(page) : 'Not found');
	};
	const server = http.createServer((req, res) => {
		let pathname;
		const u = new URL(req.url ?? '/', 'http://127.0.0.1');
		try {
			pathname = decodeURIComponent(u.pathname);
		} catch {
			res.writeHead(400).end('Bad request');
			return;
		}
		if (pathname.split('/').includes('..') || pathname.includes('\\')) {
			res.writeHead(400).end('Bad request');
			return;
		}
		if (base && pathname === base) {
			res.writeHead(301, { location: base + '/' + u.search }).end();
			return;
		}
		if (base && !pathname.startsWith(base + '/')) return notFound(res);
		const rel = pathname.slice(base.length) || '/';
		const target = join(dir, ...rel.split('/').filter(Boolean));
		if (!(target + sep).startsWith(resolve(dir) + sep) && target !== resolve(dir)) {
			res.writeHead(400).end('Bad request');
			return;
		}
		const file = rel.endsWith('/') ? join(target, 'index.html') : target;
		if (isFile(file)) {
			res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
			res.end(readFileSync(file));
			return;
		}
		if (!rel.endsWith('/') && !extname(rel) && isDir(target)) {
			res.writeHead(301, { location: pathname + '/' + u.search }).end();
			return;
		}
		notFound(res);
	});
	return new Promise((ok, fail) => {
		server.once('error', fail);
		server.listen(port, '127.0.0.1', () => ok(server));
	});
}

async function get(url, { follow = true } = {}) {
	let res = await fetch(url, { redirect: 'manual' });
	let finalUrl = url;
	if (follow && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
		finalUrl = new URL(res.headers.get('location'), url).href;
		res = await fetch(finalUrl, { redirect: 'manual' });
	}
	return { status: res.status, text: await res.text(), url: finalUrl };
}

async function runChecks({ origin, prefix, local, dir, dirIndex = false }) {
	const results = [];
	// Hosts without directory indexes: `/evals/` is only reachable as `/evals/index.html`.
	const pagePath = (p) => (dirIndex && p.endsWith('/') ? p + 'index.html' : p);
	if (dirIndex) console.log('WARN --dir-index: host does not serve directory indexes; checking <dir>/index.html (hard loads of /evals/ are not served)');
	const pass = (name) => {
		results.push({ name, ok: true });
		console.log(`PASS ${name}`);
	};
	const fail = (name, reason) => {
		results.push({ name, ok: false });
		console.log(`FAIL ${name}: ${reason}`);
	};
	const pages = {};
	const at = (p) => `${origin}${prefix}${p}`;

	// 1-2. pages with content markers
	for (const [path, markers] of [
		['/', ['Application sprint', 'TransferPilot']],
		['/evals/', ['Eval results']]
	]) {
		const name = `GET ${prefix}${pagePath(path)}`;
		try {
			const r = await get(at(pagePath(path)), { follow: false });
			const missing = markers.filter((m) => !r.text.includes(m));
			if (r.status !== 200) fail(name, `status ${r.status}`);
			else if (missing.length) fail(name, `missing text ${missing.map((m) => JSON.stringify(m)).join(', ')}`);
			else {
				pages[path] = r.text;
				pass(name);
			}
		} catch (e) {
			fail(name, e.message);
		}
	}

	const getJson = async (path) => {
		const r = await get(at(path), { follow: false });
		if (r.status !== 200) throw new Error(`status ${r.status}`);
		try {
			return JSON.parse(r.text);
		} catch (e) {
			throw new Error(`invalid JSON (${e.message})`);
		}
	};

	// 3. hero-run.json
	try {
		const hero = await getJson('/data/hero-run.json');
		if (
			Array.isArray(hero?.plan?.actions) &&
			hero.plan.actions.length > 0 &&
			Array.isArray(hero.events) &&
			typeof hero.report?.status === 'string'
		)
			pass(`data/hero-run.json (${hero.plan.actions.length} actions, ${hero.events.length} events, report ${hero.report.status})`);
		else fail('data/hero-run.json', 'shape mismatch (plan.actions[] / events[] / report.status)');
	} catch (e) {
		fail('data/hero-run.json', e.message);
	}

	// 4. evals.json
	let evals = null;
	try {
		evals = await getJson('/data/evals.json');
		if (!evals || typeof evals !== 'object' || Array.isArray(evals) || Object.keys(evals).length === 0)
			fail('data/evals.json', 'not a non-empty JSON object');
		else if ('scenarios' in evals && !(Array.isArray(evals.scenarios) && evals.scenarios.length >= 1))
			fail('data/evals.json', 'scenarios must be a non-empty array');
		else pass(`data/evals.json (${Array.isArray(evals.scenarios) ? evals.scenarios.length : '?'} scenarios)`);
	} catch (e) {
		fail('data/evals.json', e.message);
	}

	// 5. silent-failure replay file
	const sfRef = evals?.silentFailure?.file;
	const sf = String(sfRef ?? 'data/silent-failure-run.json').replace(/^\/+/, '');
	const sfLocal = local && isFile(join(dir, ...sf.split('/')));
	if (sfRef || sfLocal) {
		try {
			const run = await getJson('/' + sf);
			if (Array.isArray(run?.events) && run.oracle && typeof run.oracle === 'object')
				pass(`${sf} (${run.events.length} events, oracle.caught=${run.oracle.caught})`);
			else fail(sf, 'shape mismatch (events[] / oracle{})');
		} catch (e) {
			fail(sf, e.message);
		}
	} else {
		console.log('WARN silent-failure replay file not present');
	}

	// 6. .nojekyll
	if (local) {
		if (existsSync(join(dir, '.nojekyll'))) pass('.nojekyll present');
		else fail('.nojekyll present', `missing in ${dir}`);
	}

	// 7. link crawl
	const crawlPages = ['/', '/evals/'];
	if (local) {
		const r = await get(at('/404.html'), { follow: false }).catch(() => null);
		if (r && r.status === 200) pages['/404.html'] = r.text;
		crawlPages.push('/404.html');
	}
	const urls = new Map(); // url -> first referencing page
	let outside = 0;
	for (const p of crawlPages) {
		const html = pages[p];
		if (html == null) continue;
		const pageUrl = at(pagePath(p));
		const refs = [];
		for (const m of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) refs.push(m[1]);
		for (const m of html.matchAll(/["'](\.{1,2}\/_app\/[^"']+)["']/g)) refs.push(m[1]);
		for (const raw of refs) {
			const ref = raw.replaceAll('&amp;', '&');
			if (/^(https?:|mailto:|data:|\/\/)/i.test(ref)) continue;
			let u;
			try {
				u = new URL(ref, pageUrl);
			} catch {
				fail(`link ${ref} on ${p}`, 'unparseable URL');
				continue;
			}
			u.hash = '';
			if (u.origin !== origin || !u.pathname.startsWith(`${prefix}/`)) {
				outside++;
				fail(`link ${ref} on ${prefix}${p}`, `outside base path ${prefix || '/'}`);
				continue;
			}
			if (dirIndex && u.pathname.endsWith('/')) u.pathname += 'index.html';
			if (!urls.has(u.href)) urls.set(u.href, p);
		}
	}
	const list = [...urls.entries()];
	if (list.length > MAX_URLS) console.log(`WARN crawl capped at ${MAX_URLS} of ${list.length} urls`);
	const checked = list.slice(0, MAX_URLS);
	let bad = 0;
	for (let i = 0; i < checked.length; i += 8) {
		await Promise.all(
			checked.slice(i, i + 8).map(async ([u, page]) => {
				try {
					const r = await get(u);
					if (r.status !== 200) {
						bad++;
						fail(`link ${new URL(u).pathname} on ${prefix}${page}`, `status ${r.status}`);
					}
				} catch (e) {
					bad++;
					fail(`link ${u} on ${prefix}${page}`, e.message);
				}
			})
		);
	}
	if (bad === 0 && outside === 0) pass(`link crawl (${checked.length} urls from ${crawlPages.join(', ')})`);

	// 8. unknown page is a real 404
	try {
		const r = await get(at('/definitely-missing-page/'), { follow: false });
		if (r.status === 404) pass(`GET ${prefix}/definitely-missing-page/ -> 404`);
		else if (dirIndex && r.status !== 200) pass(`GET ${prefix}/definitely-missing-page/ -> ${r.status} (not served)`);
		else fail(`GET ${prefix}/definitely-missing-page/`, `expected 404, got ${r.status}`);
	} catch (e) {
		fail(`GET ${prefix}/definitely-missing-page/`, e.message);
	}

	const failures = results.filter((r) => !r.ok).length;
	return { failures, checks: results.length, urls: checked.length };
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	let base = normBase(opts.base);

	if (opts.build) {
		const env = { ...process.env, BASE_PATH: base };
		delete env.VERCEL;
		console.log(`building web/ with BASE_PATH=${JSON.stringify(base)}`);
		// Windows needs a shell to resolve npm.cmd; pass one command string (no args array) to avoid DEP0190.
		const r =
			process.platform === 'win32'
				? spawnSync('npm run build', { cwd: WEB, stdio: 'inherit', shell: true, env })
				: spawnSync('npm', ['run', 'build'], { cwd: WEB, stdio: 'inherit', env });
		if (r.status !== 0) {
			console.error(`build failed (exit ${r.status ?? r.signal ?? r.error?.message})`);
			process.exit(1);
		}
	}

	let server = null;
	let origin;
	let prefix;
	const local = !opts.url;
	if (opts.url) {
		const u = new URL(opts.url);
		origin = u.origin;
		prefix = normBase(u.pathname);
		base = prefix;
	} else {
		if (!isDir(opts.dir)) {
			console.error(`build directory not found: ${opts.dir} (run with --build)`);
			process.exit(1);
		}
		server = await startServer(opts.dir, base, opts.port);
		const port = server.address().port;
		origin = `http://127.0.0.1:${port}`;
		prefix = base;
	}

	const target = local ? `${opts.dir} at ${origin}${prefix}/` : `${origin}${prefix}/`;
	console.log(`smoke: ${target}`);
	const deadline = Date.now() + Math.max(0, opts.wait) * 1000;
	let attempt = 0;
	let outcome;
	for (;;) {
		attempt++;
		if (opts.wait > 0 && !local) console.log(`attempt ${attempt}`);
		outcome = await runChecks({ origin, prefix, local, dir: opts.dir, dirIndex: opts.dirIndex });
		if (outcome.failures === 0 || local || Date.now() + 10_000 > deadline) break;
		console.log(`${outcome.failures} failure(s); retrying in 10 s`);
		await new Promise((r) => setTimeout(r, 10_000));
	}

	if (outcome.failures === 0) console.log(`SMOKE OK (${outcome.checks} checks, ${outcome.urls} urls)`);
	else console.log(`SMOKE FAILED (${outcome.failures} failures)`);

	if (opts.serve && server) {
		console.log(`serving ${opts.dir} at ${origin}${prefix}/`);
		return;
	}
	// Let the process exit naturally: calling process.exit() while server/keep-alive handles are
	// still closing trips a libuv assertion on Windows (UV_HANDLE_CLOSING).
	process.exitCode = outcome.failures === 0 ? 0 : 1;
	if (server) {
		server.closeAllConnections();
		await new Promise((r) => server.close(r));
	}
}

main().catch((e) => {
	console.error(e?.stack ?? String(e));
	process.exit(1);
});

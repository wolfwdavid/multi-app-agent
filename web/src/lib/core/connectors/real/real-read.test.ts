// Offline tests for the real read connectors. Every test injects fetch; nothing touches the network.
import { describe, it, expect, vi } from 'vitest';
import { ConnectorError } from '../types.ts';
import { createPacer, fetchJson, parseRetryAfterMs } from './http.ts';
import { missingEnv, notConfiguredPort, redactSecrets, toConnectorError } from './shared.ts';
import { createRealGitHub } from './github.ts';
import { createRealHF } from './hf.ts';

type Route = () => Response | Promise<Response>;

const fake = (routes: Record<string, Route>) =>
	vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const u = String(input instanceof Request ? input.url : input);
		const hit = Object.keys(routes).find((k) => u.includes(k));
		if (!hit) throw new Error('unexpected fetch ' + u);
		return routes[hit]();
	});

const asFetch = (f: ReturnType<typeof fake>) => f as unknown as typeof fetch;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function caught(p: Promise<unknown>): Promise<ConnectorError> {
	try {
		await p;
	} catch (e) {
		return e as ConnectorError;
	}
	throw new Error('expected rejection');
}

const NOW = 1_800_000_000_000;
const URL_X = 'https://api.github.com/users/x/repos?per_page=100&token=supersecretvalue';

const failWith = async (res: Response | (() => never)) => {
	const f = fake({ 'api.github.com': typeof res === 'function' ? res : () => res });
	return caught(fetchJson(URL_X, { app: 'github', deps: { fetch: asFetch(f), now: () => NOW } }));
};

describe('fetchJson', () => {
	it('returns parsed JSON on 200 and sends the given headers', async () => {
		const f = fake({ 'api.github.com': () => json([{ a: 1 }]) });
		const out = await fetchJson<{ a: number }[]>(URL_X, {
			app: 'github',
			headers: { Accept: 'application/vnd.github+json' },
			deps: { fetch: asFetch(f) }
		});
		expect(out).toEqual([{ a: 1 }]);
		const init = f.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('maps 404 to not_found with status 404, path only in the message', async () => {
		const e = await failWith(json({ message: 'Not Found' }, 404));
		expect(e).toBeInstanceOf(ConnectorError);
		expect(e.kind).toBe('not_found');
		expect(e.status).toBe(404);
		expect(e.message).toContain('/users/x/repos');
		expect(e.message).not.toContain('supersecretvalue');
	});

	it('maps 401 to auth and 403 without rate-limit headers to auth', async () => {
		expect((await failWith(json({}, 401))).kind).toBe('auth');
		const e = await failWith(json({}, 403));
		expect(e.kind).toBe('auth');
		expect(e.status).toBe(403);
	});

	it('maps 403 with x-ratelimit-remaining 0 to rate_limit using the reset epoch (min 1000)', async () => {
		const reset = String(NOW / 1000 + 30);
		const e = await failWith(json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }));
		expect(e.kind).toBe('rate_limit');
		expect(e.status).toBe(403);
		expect(e.retryAfterMs).toBe(30000);
		const past = String(NOW / 1000 - 5);
		const e2 = await failWith(json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': past }));
		expect(e2.retryAfterMs).toBe(1000);
	});

	it('maps 429 to rate_limit with retry-after seconds, defaulting to 60000', async () => {
		const e = await failWith(json({}, 429, { 'retry-after': '7' }));
		expect(e.kind).toBe('rate_limit');
		expect(e.retryAfterMs).toBe(7000);
		expect((await failWith(json({}, 429))).retryAfterMs).toBe(60000);
	});

	it('maps 5xx to server and other 4xx to validation', async () => {
		for (const s of [500, 502, 503]) {
			const e = await failWith(json({}, s));
			expect(e.kind, String(s)).toBe('server');
			expect(e.status).toBe(s);
		}
		expect((await failWith(json({}, 422))).kind).toBe('validation');
	});

	it('maps TimeoutError and AbortError to timeout', async () => {
		for (const name of ['TimeoutError', 'AbortError']) {
			const e = await failWith(() => {
				throw new DOMException('aborted', name);
			});
			expect(e.kind, name).toBe('timeout');
		}
	});

	it('maps a network TypeError to server with a network message', async () => {
		const e = await failWith(() => {
			throw new TypeError('fetch failed');
		});
		expect(e.kind).toBe('server');
		expect(e.message).toMatch(/network/);
	});

	it('maps a 200 non-JSON body to server', async () => {
		const e = await failWith(new Response('<html>oops</html>', { status: 200 }));
		expect(e.kind).toBe('server');
	});
});

describe('parseRetryAfterMs', () => {
	it('handles seconds, an HTTP-date and absence', () => {
		expect(parseRetryAfterMs(new Headers({ 'retry-after': '3' }), NOW)).toBe(3000);
		const date = new Date(NOW + 20000).toUTCString();
		expect(parseRetryAfterMs(new Headers({ 'retry-after': date }), NOW)).toBe(20000);
		expect(parseRetryAfterMs(new Headers(), NOW)).toBeUndefined();
		expect(parseRetryAfterMs(new Headers({ 'x-ratelimit-remaining': '5', 'x-ratelimit-reset': '1' }), NOW)).toBeUndefined();
	});
});

describe('createPacer', () => {
	const clockDeps = () => {
		const clock = { t: 0 };
		const now = () => clock.t;
		const sleep = vi.fn(async (ms: number) => {
			clock.t += ms;
		});
		return { now, sleep };
	};

	it('spaces back-to-back calls by the minimum interval', async () => {
		const { now, sleep } = clockDeps();
		const pace = createPacer(350, { now, sleep });
		const starts: number[] = [];
		const results = await Promise.all(
			[1, 2, 3].map((i) =>
				pace(async () => {
					starts.push(now());
					return i;
				})
			)
		);
		expect(results).toEqual([1, 2, 3]);
		expect(starts[0]).toBe(0);
		expect(starts[1]).toBeGreaterThanOrEqual(350);
		expect(starts[2]).toBeGreaterThanOrEqual(700);
	});

	it('propagates a rejection without breaking later calls', async () => {
		const { now, sleep } = clockDeps();
		const pace = createPacer(350, { now, sleep });
		const a = pace(async () => {
			throw new Error('boom');
		});
		const b = pace(async () => 'ok');
		await expect(a).rejects.toThrow('boom');
		await expect(b).resolves.toBe('ok');
	});
});

describe('shared helpers', () => {
	it('redactSecrets replaces long secret-like env values only', () => {
		expect(redactSecrets('bad ntn_abcdef123 x', { NOTION_TOKEN: 'ntn_abcdef123' })).toBe('bad [redacted] x');
		expect(redactSecrets('short abc here', { NOTION_TOKEN: 'abc' })).toBe('short abc here');
		expect(redactSecrets('user wolfwdavid', { GITHUB_USERNAME: 'wolfwdavid' })).toBe('user wolfwdavid');
	});

	it('missingEnv returns unset or whitespace-only names', () => {
		expect(missingEnv({ A: 'x', B: '  ' }, ['A', 'B', 'C'])).toEqual(['B', 'C']);
	});

	it('notConfiguredPort rejects every method with not_configured', async () => {
		const port = notConfiguredPort<Record<string, () => Promise<unknown>>>(
			'notion',
			['findByKey', 'upsertTrackerRow'],
			'detail'
		);
		expect(Object.keys(port)).toEqual(['findByKey', 'upsertTrackerRow']);
		const e = await caught(port.findByKey());
		expect(e.kind).toBe('not_configured');
		expect(e.message).toContain('notion.findByKey');
		expect(e.message).toContain('detail');
	});

	it('toConnectorError passes ConnectorErrors through and redacts others', () => {
		const ce = new ConnectorError('auth', 'nope', { status: 401 });
		expect(toConnectorError(ce, 'ctx')).toBe(ce);
		const e = toConnectorError(new Error('leak ghp_abcdefgh1234'), 'github', { GITHUB_TOKEN: 'ghp_abcdefgh1234' });
		expect(e.kind).toBe('server');
		expect(e.message).toContain('github');
		expect(e.message).not.toContain('ghp_abcdefgh1234');
	});
});

// ---------- GitHub ----------

const ghRepo = (name: string, pushed: string, extra: Record<string, unknown> = {}) => ({
	name,
	description: `${name} desc`,
	stargazers_count: 1,
	language: 'TypeScript',
	pushed_at: pushed,
	html_url: `https://github.com/wolfwdavid/${name}`,
	fork: false,
	private: false,
	owner: { login: 'wolfwdavid' },
	...extra
});

describe('createRealGitHub', () => {
	it('lists public non-fork repos sorted by push time with mapped fields', async () => {
		const raw = [
			ghRepo('older', '2026-01-01T00:00:00Z', { stargazers_count: 4, language: null, description: null }),
			ghRepo('forked', '2026-09-01T00:00:00Z', { fork: true }),
			ghRepo('secret', '2026-09-02T00:00:00Z', { private: true }),
			ghRepo('b-newest', '2026-09-10T00:00:00Z', { stargazers_count: 7 }),
			ghRepo('a-newest', '2026-09-10T00:00:00Z')
		];
		const f = fake({ '/users/wolfwdavid/repos': () => json(raw) });
		const repos = await createRealGitHub({}, { fetch: asFetch(f) }).listRepos('wolfwdavid');
		const url = String(f.mock.calls[0][0]);
		expect(url).toContain('/users/wolfwdavid/repos');
		expect(url).toContain('per_page=100');
		expect(repos.map((r) => r.name)).toEqual(['a-newest', 'b-newest', 'older']);
		expect(repos[1]).toEqual({
			name: 'b-newest',
			description: 'b-newest desc',
			stars: 7,
			languages: ['TypeScript'],
			pushedAt: '2026-09-10T00:00:00Z',
			url: 'https://github.com/wolfwdavid/b-newest'
		});
		expect(repos[2].languages).toEqual([]);
		expect(repos[2].description).toBeNull();
		expect(repos[2].stars).toBe(4);
	});

	it('caps the list at 30 repos', async () => {
		const raw = Array.from({ length: 40 }, (_, i) =>
			ghRepo(`r${String(i).padStart(2, '0')}`, `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`)
		);
		const f = fake({ '/users/wolfwdavid/repos': () => json(raw) });
		expect(await createRealGitHub({}, { fetch: asFetch(f) }).listRepos('wolfwdavid')).toHaveLength(30);
	});

	it('without GITHUB_TOKEN sends no Authorization header and makes exactly 1 request', async () => {
		const f = fake({ '/users/wolfwdavid/repos': () => json([ghRepo('a', '2026-09-01T00:00:00Z')]) });
		await createRealGitHub({ GITHUB_TOKEN: '  ' }, { fetch: asFetch(f) }).listRepos('wolfwdavid');
		expect(f).toHaveBeenCalledTimes(1);
		const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
		expect(headers['User-Agent']).toBe('transferpilot');
	});

	it('with GITHUB_TOKEN sends Bearer auth and enriches languages for the top 5 only', async () => {
		const raw = Array.from({ length: 7 }, (_, i) => ghRepo(`r${i}`, `2026-09-0${9 - i}T00:00:00Z`));
		const routes: Record<string, Route> = { '/users/wolfwdavid/repos': () => json(raw) };
		for (let i = 0; i < 7; i++) {
			routes[`/repos/wolfwdavid/r${i}/languages`] =
				i === 1 ? () => json({}, 500) : () => json({ CSS: 10, Python: 900, TypeScript: 50 });
		}
		const f = fake(routes);
		const repos = await createRealGitHub({ GITHUB_TOKEN: 'ghp_test' }, { fetch: asFetch(f) }).listRepos('wolfwdavid');
		expect(((f.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
			'Bearer ghp_test'
		);
		const langCalls = f.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith('/languages'));
		expect(langCalls).toHaveLength(5);
		expect(repos[0].languages).toEqual(['Python', 'TypeScript', 'CSS']);
		expect(repos[1].languages).toEqual(['TypeScript']);
		expect(repos[6].languages).toEqual(['TypeScript']);
	});

	it('rejects invalid usernames with validation before any fetch', async () => {
		const f = fake({});
		const gh = createRealGitHub({}, { fetch: asFetch(f) });
		for (const bad of ['../evil', '', 'a b']) {
			const e = await caught(gh.listRepos(bad));
			expect(e.kind, bad).toBe('validation');
		}
		expect(f).not.toHaveBeenCalled();
	});

	it('maps an unknown user 404 to not_found', async () => {
		const f = fake({ '/users/nobody-here/repos': () => json({ message: 'Not Found' }, 404) });
		const e = await caught(createRealGitHub({}, { fetch: asFetch(f) }).listRepos('nobody-here'));
		expect(e.kind).toBe('not_found');
	});
});

// ---------- Hugging Face ----------

describe('createRealHF', () => {
	it('merges models and spaces with kinds, URLs, defaults and sorting', async () => {
		const models = [
			{ id: 'WolfDavid/old-model', likes: 2, tags: ['nlp'], lastModified: '2026-01-01T00:00:00.000Z' },
			{ id: 'WolfDavid/hidden', private: true, lastModified: '2026-09-09T00:00:00.000Z' },
			{ id: 'WolfDavid/created-only', createdAt: '2026-05-01T00:00:00.000Z' }
		];
		const spaces = [
			{ id: 'WolfDavid/demo-space', likes: 5, tags: ['gradio'], lastModified: '2026-09-01T00:00:00.000Z' },
			{ id: 'WolfDavid/bare' }
		];
		const f = fake({
			'/api/models?author=WolfDavid': () => json(models),
			'/api/spaces?author=WolfDavid': () => json(spaces)
		});
		const items = await createRealHF({}, { fetch: asFetch(f) }).listModelsAndSpaces('WolfDavid');
		expect(f).toHaveBeenCalledTimes(2);
		expect(items.map((i) => i.id)).toEqual([
			'WolfDavid/demo-space',
			'WolfDavid/created-only',
			'WolfDavid/old-model',
			'WolfDavid/bare'
		]);
		expect(items[0]).toEqual({
			id: 'WolfDavid/demo-space',
			kind: 'space',
			likes: 5,
			tags: ['gradio'],
			lastModified: '2026-09-01T00:00:00.000Z',
			url: 'https://huggingface.co/spaces/WolfDavid/demo-space'
		});
		expect(items[1]).toMatchObject({
			kind: 'model',
			likes: 0,
			tags: [],
			lastModified: '2026-05-01T00:00:00.000Z',
			url: 'https://huggingface.co/WolfDavid/created-only'
		});
		expect(items[3].lastModified).toBe('');
	});

	it('returns [] for an unknown author', async () => {
		const f = fake({ '/api/models?author=': () => json([]), '/api/spaces?author=': () => json([]) });
		expect(await createRealHF({}, { fetch: asFetch(f) }).listModelsAndSpaces('nobody')).toEqual([]);
	});

	it('rejects server when either endpoint returns 500', async () => {
		const f = fake({ '/api/models?author=': () => json([]), '/api/spaces?author=': () => json({}, 500) });
		const e = await caught(createRealHF({}, { fetch: asFetch(f) }).listModelsAndSpaces('WolfDavid'));
		expect(e.kind).toBe('server');
	});

	it('rejects invalid authors with validation before any fetch', async () => {
		const f = fake({});
		const e = await caught(createRealHF({}, { fetch: asFetch(f) }).listModelsAndSpaces('../evil'));
		expect(e.kind).toBe('validation');
		expect(f).not.toHaveBeenCalled();
	});
});

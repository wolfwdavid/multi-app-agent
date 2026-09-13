import { describe, expect, it } from 'vitest';
import { ConnectorError } from '../../types.ts';
import { GOOGLE_SCOPES, mapGoogleError, missingScopes, probeGoogleAuth, type AuthLike } from './auth.ts';
import { createRealGoogle, probeGoogle, type GoogleApis } from './index.ts';

const ENV = { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret-value', GOOGLE_REFRESH_TOKEN: '1//refresh-token-value' };
const NONE = { gmail: false, calendar: false, docs: false };
const apiErr = (status: number, reason?: string, headers?: Record<string, string>) => ({
	status,
	response: { status, headers: headers ?? {}, data: { error: { code: status, message: 'boom', errors: reason ? [{ reason }] : [] } } }
});
const okAuth = (scopes: string[]): AuthLike => ({
	getAccessToken: async () => ({ token: 't' }),
	getTokenInfo: async () => ({ scopes })
});
const throwingApis = (): GoogleApis => {
	const trap = new Proxy({}, { get: () => { throw new Error('API used'); } });
	return { auth: trap, calendar: trap, gmail: trap, docs: trap, drive: trap };
};

describe('GOOGLE_SCOPES', () => {
	it('is exactly the four least-privilege scopes', () => {
		expect([...GOOGLE_SCOPES]).toEqual([
			'https://www.googleapis.com/auth/documents',
			'https://www.googleapis.com/auth/drive.file',
			'https://www.googleapis.com/auth/calendar.events',
			'https://www.googleapis.com/auth/gmail.compose'
		]);
		expect(GOOGLE_SCOPES.join(' ')).not.toMatch(/gmail\.send|mail\.google\.com/);
	});
	it('missingScopes lists what was not granted', () => {
		expect(missingScopes(['https://www.googleapis.com/auth/calendar.events'])).toHaveLength(3);
		expect(missingScopes([...GOOGLE_SCOPES])).toEqual([]);
	});
});

describe('mapGoogleError', () => {
	const map = (e: unknown) => mapGoogleError(e, 'ctx', ENV);
	it('invalid_grant from the token endpoint → auth with re-auth hint', () => {
		const err = map({ response: { status: 400, data: { error: 'invalid_grant' } } });
		expect(err.kind).toBe('auth');
		expect(err.message).toContain('google-auth.ts');
		expect(err.message).toContain('7 days');
	});
	it('invalid_grant in a message → auth', () => {
		expect(map(new Error('invalid_grant: Token has been expired or revoked.')).kind).toBe('auth');
	});
	it('401 → auth', () => expect(map(apiErr(401)).kind).toBe('auth'));
	it('403 rateLimitExceeded → rate_limit with retry-after', () => {
		const err = map(apiErr(403, 'rateLimitExceeded', { 'retry-after': '3' }));
		expect(err.kind).toBe('rate_limit');
		expect(err.retryAfterMs).toBe(3000);
	});
	it('403 userRateLimitExceeded → rate_limit default 1000ms', () => {
		const err = map(apiErr(403, 'userRateLimitExceeded'));
		expect(err).toMatchObject({ kind: 'rate_limit', retryAfterMs: 1000 });
	});
	it('403 insufficientPermissions → auth mentioning scope', () => {
		const err = map(apiErr(403, 'insufficientPermissions'));
		expect(err.kind).toBe('auth');
		expect(err.message).toContain('scope');
	});
	it('404/410 → not_found', () => {
		expect(map(apiErr(404)).kind).toBe('not_found');
		expect(map(apiErr(410)).kind).toBe('not_found');
	});
	it('409 → validation status 409', () => expect(map(apiErr(409))).toMatchObject({ kind: 'validation', status: 409 }));
	it('429 → rate_limit', () => expect(map(apiErr(429)).kind).toBe('rate_limit'));
	it('400 → validation', () => expect(map(apiErr(400)).kind).toBe('validation'));
	it('500/503 → server', () => {
		expect(map(apiErr(500)).kind).toBe('server');
		expect(map(apiErr(503)).kind).toBe('server');
	});
	it('ETIMEDOUT / AbortError → timeout', () => {
		expect(map({ code: 'ETIMEDOUT', message: 'x' }).kind).toBe('timeout');
		expect(map({ name: 'AbortError', message: 'x' }).kind).toBe('timeout');
	});
	it('reads Headers objects for retry-after', () => {
		const e = { status: 429, response: { status: 429, headers: new Headers({ 'retry-after': '2' }), data: {} } };
		expect(map(e).retryAfterMs).toBe(2000);
	});
	it('passes an existing ConnectorError through', () => {
		const ce = new ConnectorError('not_found', 'x');
		expect(map(ce)).toBe(ce);
	});
	it('redacts the refresh token value from messages', () => {
		const err = map(new Error(`bad token ${ENV.GOOGLE_REFRESH_TOKEN}`));
		expect(err.message).toContain('[redacted]');
		expect(err.message).not.toContain(ENV.GOOGLE_REFRESH_TOKEN);
	});
});

describe('createRealGoogle (stubs)', () => {
	it('missing env → every app rejects not_configured naming the vars', async () => {
		const g = createRealGoogle({});
		for (const p of [g.calendar.listEvents({ from: '2026-01-01', to: '2026-02-01' }), g.gmail.listDrafts(), g.docs.findByKey('tp1-0123456789abcdef')]) {
			await expect(p).rejects.toMatchObject({ kind: 'not_configured', message: expect.stringContaining('GOOGLE_REFRESH_TOKEN') });
		}
	});
	it('env present but not implemented → not_configured, no API calls', async () => {
		const g = createRealGoogle(ENV, { apis: throwingApis(), implemented: NONE });
		for (const p of [g.calendar.findByKey('tp1-0123456789abcdef'), g.gmail.listDrafts(), g.docs.findByKey('tp1-0123456789abcdef')]) {
			await expect(p).rejects.toMatchObject({ kind: 'not_configured', message: expect.stringContaining('not implemented') });
		}
	});
});

describe('probeGoogleAuth', () => {
	it('all scopes granted → ok, no token in result', async () => {
		const r = await probeGoogleAuth(ENV, { auth: okAuth([...GOOGLE_SCOPES]) });
		expect(r.ok).toBe(true);
		expect(r).not.toHaveProperty('token');
	});
	it('only calendar.events → auth failure listing missing scopes', async () => {
		const r = await probeGoogleAuth(ENV, { auth: okAuth(['https://www.googleapis.com/auth/calendar.events']) });
		expect(r).toMatchObject({ ok: false, kind: 'auth' });
		expect(r.detail).toContain('gmail.compose');
		expect(r.detail).toContain('drive.file');
	});
	it('invalid_grant → auth failure', async () => {
		const auth: AuthLike = {
			getAccessToken: async () => {
				throw { response: { status: 400, data: { error: 'invalid_grant' } }, message: 'invalid_grant' };
			},
			getTokenInfo: async () => ({ scopes: [] })
		};
		const r = await probeGoogleAuth(ENV, { auth });
		expect(r).toMatchObject({ ok: false, kind: 'auth' });
		expect(r).not.toHaveProperty('token');
	});
});

describe('probeGoogle', () => {
	it('missing env → 3 skipped results', async () => {
		const r = await probeGoogle({});
		expect(r.map((x) => x.app)).toEqual(['calendar', 'gmail', 'docs']);
		expect(r.every((x) => x.ok === null && !x.configured)).toBe(true);
	});
	it('env present, nothing implemented → ok null with auth status in detail', async () => {
		const r = await probeGoogle(ENV, { auth: okAuth([...GOOGLE_SCOPES]), apis: throwingApis(), implemented: NONE });
		expect(r).toHaveLength(3);
		expect(r.every((x) => x.ok === null && x.implemented === false && x.detail.includes('auth: ok'))).toBe(true);
	});
	it('implemented app with failing auth → ok false, kind auth', async () => {
		const r = await probeGoogle(ENV, {
			auth: okAuth([]),
			apis: throwingApis(),
			implemented: { calendar: true, gmail: false, docs: false }
		});
		expect(r[0]).toMatchObject({ app: 'calendar', ok: false, kind: 'auth' });
	});
});

// Google auth for the single demo account: an OAuth2Client built from a long-lived refresh token
// (minted once by scripts/google-auth.ts). The client refreshes access tokens itself. Everything
// here fails LOUDLY: an expired/revoked token, a missing scope or a quota hit becomes a typed
// ConnectorError whose message never contains a credential value.
import { OAuth2Client } from 'google-auth-library';
import { ConnectorError } from '../../types.ts';
import type { ConnectorErrorKind } from '../../../schemas.ts';
import { redactSecrets, type Env } from '../shared.ts';

/**
 * Narrow scopes: gmail.compose (drafts; it would technically permit sending, which is blocked by the
 * GmailPort type having no send method; gmail.send and full-mailbox scopes are not requested), events
 * only, and Drive files this app created. Docs needs account-wide `documents` to read the essay the
 * user shares; the code reads only the specified doc id.
 */
export const GOOGLE_SCOPES = [
	'https://www.googleapis.com/auth/documents',
	'https://www.googleapis.com/auth/drive.file',
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/gmail.compose'
] as const;

export const REAUTH_HINT = 're-run npx tsx scripts/google-auth.ts';

export function createGoogleAuth(env: Env): OAuth2Client {
	const client = new OAuth2Client({
		clientId: env.GOOGLE_CLIENT_ID?.trim(),
		clientSecret: env.GOOGLE_CLIENT_SECRET?.trim()
	});
	client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN?.trim() });
	return client;
}

export function missingScopes(granted: readonly string[]): string[] {
	return GOOGLE_SCOPES.filter((scope) => !granted.includes(scope));
}

type Loose = {
	status?: unknown;
	code?: unknown;
	name?: unknown;
	message?: unknown;
	errors?: { reason?: string }[];
	response?: { status?: unknown; headers?: unknown; data?: { error?: unknown } };
};

const asStatus = (v: unknown): number | undefined => {
	if (typeof v === 'number' && Number.isInteger(v)) return v;
	if (typeof v === 'string' && /^\d{3}$/.test(v)) return Number(v);
	return undefined;
};

function retryAfterMs(headers: unknown): number {
	let raw: unknown;
	if (headers && typeof (headers as Headers).get === 'function') raw = (headers as Headers).get('retry-after');
	else if (headers && typeof headers === 'object') raw = (headers as Record<string, unknown>)['retry-after'];
	if (typeof raw !== 'string' && typeof raw !== 'number') return 1000;
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
	const at = Date.parse(String(raw));
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 1000;
}

/** Duck-typed Gaxios/Google API error → ConnectorError. Messages are redacted against env. */
export function mapGoogleError(e: unknown, context: string, env: Env): ConnectorError {
	if (e instanceof ConnectorError) return e;
	const x: Loose = e && typeof e === 'object' ? (e as Loose) : { message: String(e) };
	const dataError = x.response?.data?.error;
	const apiError =
		dataError && typeof dataError === 'object'
			? (dataError as { message?: string; errors?: { reason?: string }[] })
			: undefined;
	const rawMessage = typeof x.message === 'string' ? x.message : '';
	const status = asStatus(x.status) ?? asStatus(x.response?.status) ?? asStatus(x.code);
	const reason = apiError?.errors?.[0]?.reason ?? x.errors?.[0]?.reason;
	const apiMessage = apiError?.message ?? (rawMessage || String(e));
	const make = (kind: ConnectorErrorKind, message: string, opts?: { status?: number; retryAfterMs?: number }) =>
		new ConnectorError(kind, redactSecrets(message, env), { status, ...opts });

	if (dataError === 'invalid_grant' || rawMessage.includes('invalid_grant')) {
		return make(
			'auth',
			`${context}: Google refresh token expired or revoked (invalid_grant). Testing-mode tokens expire after 7 days: ${REAUTH_HINT}`
		);
	}
	if (x.code === 'ETIMEDOUT' || x.code === 'ECONNABORTED' || x.name === 'AbortError' || x.name === 'TimeoutError') {
		return make('timeout', `${context}: request timed out (${apiMessage})`);
	}
	const base = `${context}: ${status ?? ''} ${apiMessage}`;
	if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) {
		return make('rate_limit', base, { retryAfterMs: retryAfterMs(x.response?.headers) });
	}
	if (status === 401) return make('auth', `${base} (${REAUTH_HINT})`);
	if (status === 403) {
		if (reason === 'insufficientPermissions' || /scope/i.test(apiMessage)) {
			return make('auth', `${base}: the token is missing a required OAuth scope; ${REAUTH_HINT}`);
		}
		return make('auth', base);
	}
	if (status === 404 || status === 410) return make('not_found', base);
	if (status === 409) return make('validation', base, { status: 409 });
	if (status === 400) return make('validation', base);
	return make('server', base);
}

export type AuthLike = {
	getAccessToken(): Promise<{ token?: string | null }>;
	getTokenInfo(token: string): Promise<{ scopes: string[] }>;
};

export interface AuthProbe {
	ok: boolean;
	kind?: ConnectorErrorKind;
	detail: string;
	grantedScopes?: string[];
}

/** Refreshes an access token and checks its scopes. Never throws; never returns a token value. */
export async function probeGoogleAuth(env: Env, deps: { auth?: AuthLike } = {}): Promise<AuthProbe> {
	try {
		const auth = deps.auth ?? (createGoogleAuth(env) as unknown as AuthLike);
		const { token } = await auth.getAccessToken();
		if (!token) return { ok: false, kind: 'auth', detail: `google auth: no access token returned; ${REAUTH_HINT}` };
		const granted = [...((await auth.getTokenInfo(token)).scopes ?? [])];
		const missing = missingScopes(granted);
		if (missing.length) {
			return {
				ok: false,
				kind: 'auth',
				detail: `google auth: token is missing scopes ${missing.join(', ')}; ${REAUTH_HINT}`,
				grantedScopes: granted
			};
		}
		return { ok: true, detail: 'google auth: scopes ok', grantedScopes: granted };
	} catch (e) {
		const err = mapGoogleError(e, 'google auth', env);
		return { ok: false, kind: err.kind, detail: err.message };
	}
}

// One-time Google OAuth consent for the demo account → prints a refresh token line for web/.env.
//
// Run from web/: npx tsx scripts/google-auth.ts [--check]
//
// Prerequisites (Google Cloud Console):
//   1. APIs & Services -> Library: enable Google Calendar API, Gmail API, Google Docs API, Google Drive API.
//   2. Google Auth Platform -> Audience: External, Testing; add the demo account as a Test user.
//   3. APIs & Services -> Credentials -> Create OAuth client ID -> Application type: Desktop app.
//   4. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in web/.env.
//
// Flow: loopback redirect on 127.0.0.1 with PKCE + state check, offline access, forced consent (so
// Google always returns a refresh token). The ONLY credential ever printed is the single
// refresh-token line on stdout; everything else goes to stderr and never contains token values.
// --check: refreshes an access token from GOOGLE_REFRESH_TOKEN and verifies the granted scopes.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GOOGLE_SCOPES, missingScopes, probeGoogleAuth } from '../src/lib/core/connectors/real/google/auth.ts';
import { GOOGLE_ENV } from '../src/lib/core/connectors/real/google/flags.ts';
import { missingEnv } from '../src/lib/core/connectors/real/shared.ts';

try {
	process.loadEnvFile('.env');
} catch {
	// no .env: rely on the process environment
}

const SETUP = `Google OAuth setup (TransferPilot):
  1. Google Cloud Console -> APIs & Services -> Library: enable Calendar, Gmail, Docs and Drive APIs.
  2. Google Auth Platform -> Audience: External + Testing; add the demo account as a Test user.
  3. APIs & Services -> Credentials -> Create OAuth client ID -> Application type: Desktop app.
  4. Put GOOGLE_CLIENT_ID=... and GOOGLE_CLIENT_SECRET=... in web/.env.
  5. Run from web/: npx tsx scripts/google-auth.ts   (then --check once GOOGLE_REFRESH_TOKEN is set)`;

async function check(): Promise<void> {
	const missing = missingEnv(process.env, GOOGLE_ENV);
	if (missing.length) {
		console.error(`[FAIL] not_configured: missing env ${missing.join(', ')}\n${SETUP}`);
		process.exitCode = 1;
		return;
	}
	const r = await probeGoogleAuth(process.env);
	if (r.ok) console.log('[ok] google auth: scopes ok');
	else {
		console.log(`[FAIL] ${r.kind}: ${r.detail}`);
		process.exitCode = 1;
	}
}

async function consent(clientId: string, clientSecret: string): Promise<void> {
	const port = Number(process.env.GOOGLE_OAUTH_PORT || 53682);
	const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
	const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
	const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
	const state = randomBytes(16).toString('hex');
	const url = client.generateAuthUrl({
		access_type: 'offline',
		prompt: 'consent',
		scope: [...GOOGLE_SCOPES],
		state,
		code_challenge: codeChallenge,
		code_challenge_method: CodeChallengeMethod.S256
	});

	const server = createServer(async (req, res) => {
		const u = new URL(req.url ?? '/', redirectUri);
		if (u.pathname !== '/oauth2callback') {
			res.writeHead(404).end();
			return;
		}
		if (u.searchParams.get('state') !== state) {
			res.writeHead(400, { 'content-type': 'text/plain' }).end('State mismatch.');
			return;
		}
		const finish = (status: number, text: string) => {
			res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
			clearTimeout(timer);
			server.close();
		};
		const error = u.searchParams.get('error');
		if (error) {
			console.error(`Authorization failed: ${error}${error === 'access_denied' ? ' (is the account added as a Test user?)' : ''}`);
			process.exitCode = 1;
			finish(400, `TransferPilot: authorization failed (${error}).`);
			return;
		}
		try {
			const { tokens } = await client.getToken({ code: u.searchParams.get('code') ?? '', codeVerifier });
			if (!tokens.refresh_token) {
				console.error(
					'No refresh token was returned. Revoke TransferPilot at https://myaccount.google.com/permissions and re-run.'
				);
				process.exitCode = 1;
			} else {
				console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
				const granted = (tokens.scope ?? '').split(' ').filter(Boolean);
				console.error(`Granted scopes: ${granted.join(', ') || '(none reported)'}`);
				const missing = missingScopes(granted);
				if (missing.length) console.error(`WARNING: missing scopes ${missing.join(', ')}; tick every box on the consent screen.`);
				console.error('Paste the line above into web/.env (and Vercel env). Testing-mode refresh tokens expire in 7 days.');
			}
			finish(200, 'TransferPilot: authorization complete, return to the terminal.');
		} catch (e) {
			console.error(`Token exchange failed: ${e instanceof Error ? e.message.replace(/[A-Za-z0-9._\/-]{40,}/g, '[redacted]') : 'unknown error'}`);
			process.exitCode = 1;
			finish(500, 'TransferPilot: token exchange failed, see the terminal.');
		}
	});

	const timer = setTimeout(() => {
		console.error('Timed out after 5 minutes waiting for the browser redirect.');
		process.exitCode = 1;
		server.close();
	}, 5 * 60_000);

	server.listen(port, '127.0.0.1', () => {
		console.error('Open this URL in a browser signed in as the Test user:');
		console.error(url);
	});
}

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
if (process.argv.includes('--check')) {
	await check();
} else if (!clientId || !clientSecret) {
	console.error(`Missing GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET.\n${SETUP}`);
	process.exitCode = 1;
} else {
	await consent(clientId, clientSecret);
}

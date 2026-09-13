import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConnectorMode } from '$lib/core/connectors/index';
import { probeRealConnectors, realConnectorStatus } from '$lib/core/connectors/real/index';

export const prerender = false;

// Per-app real connector status makes missing or expired credentials visible here instead of
// failing silently mid-sprint. ?probe=1 additionally runs live read probes (secrets redacted).
export const GET: RequestHandler = async ({ url }) => {
	const env = process.env;
	let mode: string;
	try {
		mode = resolveConnectorMode(env);
	} catch {
		mode = 'invalid';
	}
	const body: Record<string, unknown> = {
		ok: true,
		service: 'transferpilot',
		target: env.VERCEL ? 'vercel' : 'local',
		time: new Date().toISOString(),
		connectors: { mode, real: realConnectorStatus(env) }
	};
	if (url.searchParams.get('probe') === '1') {
		body.probes = await probeRealConnectors(env, { timeoutMs: 5000 });
	}
	return json(body);
};

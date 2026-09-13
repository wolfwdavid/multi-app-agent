// Google real connector module (Gmail drafts, Calendar, Docs). CONTRACT STUB: plan 10-03 replaces
// the bodies, not the signatures. Loaded ONLY via dynamic import() from ../index.ts, because the
// real implementation pulls in Node-heavy SDKs that must stay out of status checks and bundles.
import type { CalendarPort, DocsPort, GmailPort } from '../../types.ts';
import { missingEnv, notConfiguredPort, type Env, type ProbeResult, type RealDeps } from '../shared.ts';
import { GOOGLE_ENV, GOOGLE_IMPLEMENTED, GOOGLE_METHODS } from './flags.ts';

export interface GooglePorts {
	gmail: GmailPort;
	calendar: CalendarPort;
	docs: DocsPort;
}

export function createRealGoogle(env: Env, _deps: RealDeps = {}): GooglePorts {
	const missing = missingEnv(env, GOOGLE_ENV);
	const detail = missing.length
		? `real connector not configured (missing env: ${missing.join(', ')})`
		: 'credentials present; real Google connector not implemented in this build';
	return {
		gmail: notConfiguredPort<GmailPort>('gmail', GOOGLE_METHODS.gmail, detail),
		calendar: notConfiguredPort<CalendarPort>('calendar', GOOGLE_METHODS.calendar, detail),
		docs: notConfiguredPort<DocsPort>('docs', GOOGLE_METHODS.docs, detail)
	};
}

/** Results in order calendar, gmail, docs. */
export async function probeGoogle(env: Env, _deps: RealDeps = {}): Promise<ProbeResult[]> {
	const missing = missingEnv(env, GOOGLE_ENV);
	return (['calendar', 'gmail', 'docs'] as const).map((app) => ({
		app,
		configured: missing.length === 0,
		implemented: GOOGLE_IMPLEMENTED[app],
		ok: null,
		detail: missing.length ? `missing env: ${missing.join(', ')}` : 'not implemented'
	}));
}

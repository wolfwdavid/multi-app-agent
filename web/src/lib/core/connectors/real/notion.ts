// Notion real connector module. CONTRACT STUB: plan 10-02 replaces the bodies, not the signatures.
// Until then every method rejects not_configured, naming the missing env when credentials are absent.
import type { NotionPort } from '../types.ts';
import { missingEnv, notConfiguredPort, type Env, type ProbeResult, type RealDeps } from './shared.ts';

export const NOTION_ENV = ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID'] as const;
export const NOTION_METHODS = ['findByKey', 'upsertTrackerRow', 'listTrackerRows'] as const;
export const NOTION_IMPLEMENTED: boolean = false;

export function createRealNotion(env: Env, _deps: RealDeps = {}): NotionPort {
	const missing = missingEnv(env, NOTION_ENV);
	const detail = missing.length
		? `real connector not configured (missing env: ${missing.join(', ')})`
		: 'credentials present; real Notion connector not implemented in this build';
	return notConfiguredPort<NotionPort>('notion', NOTION_METHODS, detail);
}

export async function probeNotion(env: Env, _deps: RealDeps = {}): Promise<ProbeResult> {
	const missing = missingEnv(env, NOTION_ENV);
	return {
		app: 'notion',
		configured: missing.length === 0,
		implemented: NOTION_IMPLEMENTED,
		ok: null,
		detail: missing.length ? `missing env: ${missing.join(', ')}` : 'not implemented'
	};
}

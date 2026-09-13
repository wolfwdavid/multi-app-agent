// Real connector slots. Until Phase 10 every method rejects with ConnectorError 'not_configured'.
// Failures must be loud, never a silent empty result (Pitfall 17): an agent that gets [] back from
// an unconfigured connector would report success on work it never did. The real implementations
// replace these stubs in Phase 10 behind the same ports, so callers do not change.
import type { AppName } from '../../schemas.ts';
import {
	ConnectorError,
	type CalendarPort,
	type Connectors,
	type DocsPort,
	type GitHubPort,
	type GmailPort,
	type HFPort,
	type NotionPort
} from '../types.ts';

export type Env = Record<string, string | undefined>;

const GOOGLE = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

export const REAL_ENV_REQUIREMENTS: Readonly<Record<AppName, readonly string[]>> = {
	notion: ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID'],
	gmail: GOOGLE,
	calendar: GOOGLE,
	docs: GOOGLE,
	github: [],
	hf: []
};

export interface RealConnectorStatus {
	app: AppName;
	configured: boolean;
	implemented: false;
	missing: string[];
}

function missingFor(app: AppName, env: Env): string[] {
	return REAL_ENV_REQUIREMENTS[app].filter((name) => (env[name] ?? '').trim() === '');
}

/** Surfaced by the Phase 8/9 health check. */
export function realConnectorStatus(env: Env): RealConnectorStatus[] {
	return (Object.keys(REAL_ENV_REQUIREMENTS) as AppName[]).map((app) => {
		const missing = missingFor(app, env);
		return { app, configured: missing.length === 0, implemented: false, missing };
	});
}

export function createRealConnectors(env: Env = {}): Connectors {
	const stub = (app: AppName, methods: readonly string[]): Record<string, () => Promise<never>> => {
		const missing = missingFor(app, env);
		const reason = missing.length
			? ` (missing env: ${missing.join(', ')})`
			: ' (credentials present; real implementation lands in Phase 10)';
		const out: Record<string, () => Promise<never>> = {};
		for (const method of methods) {
			out[method] = async () => {
				throw new ConnectorError('not_configured', `${app}.${method}: real connector not configured${reason}`);
			};
		}
		return out;
	};

	return {
		notion: stub('notion', ['findByKey', 'upsertTrackerRow', 'listTrackerRows']) as unknown as NotionPort,
		calendar: stub('calendar', ['findByKey', 'createEvent', 'listEvents']) as unknown as CalendarPort,
		// Drafts only: there is no send method.
		gmail: stub('gmail', ['findByKey', 'createDraft', 'listDrafts', 'searchInbox']) as unknown as GmailPort,
		docs: stub('docs', ['findByKey', 'readDoc', 'createDoc']) as unknown as DocsPort,
		github: stub('github', ['listRepos']) as unknown as GitHubPort,
		hf: stub('hf', ['listModelsAndSpaces']) as unknown as HFPort
	};
}

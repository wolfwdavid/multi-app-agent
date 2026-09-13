// Real connector bundle behind the same ports as the mock twins.
// - github / hf: live public read connectors (no credentials needed).
// - notion: ./notion.ts (plan 10-02 owns it).
// - gmail / calendar / docs: ./google/** (plan 10-03 owns it), loaded lazily.
// Unconfigured ports fail loudly (not_configured with the missing env names), never with a silent
// empty result: an agent that gets [] back would report success on work it never did.
import type { AppName } from '../../schemas.ts';
import type { CalendarPort, Connectors, DocsPort, GmailPort } from '../types.ts';
import { createRealGitHub } from './github.ts';
import { createRealHF } from './hf.ts';
import { NOTION_ENV, NOTION_IMPLEMENTED, createRealNotion, probeNotion } from './notion.ts';
import { GOOGLE_ENV, GOOGLE_IMPLEMENTED, GOOGLE_METHODS, type GoogleApp } from './google/flags.ts';
import type { GooglePorts } from './google/index.ts';
import {
	missingEnv,
	notConfiguredPort,
	redactSecrets,
	toConnectorError,
	type Env,
	type ProbeResult,
	type RealDeps
} from './shared.ts';

export type { Env, RealDeps, ProbeResult } from './shared.ts';

export const REAL_ENV_REQUIREMENTS: Readonly<Record<AppName, readonly string[]>> = {
	notion: NOTION_ENV,
	gmail: GOOGLE_ENV,
	calendar: GOOGLE_ENV,
	docs: GOOGLE_ENV,
	github: [],
	hf: []
};

export interface RealConnectorStatus {
	app: AppName;
	configured: boolean;
	implemented: boolean;
	missing: string[];
}

const GOOGLE_APPS = ['calendar', 'gmail', 'docs'] as const;

function isImplemented(app: AppName): boolean {
	if (app === 'github' || app === 'hf') return true;
	if (app === 'notion') return NOTION_IMPLEMENTED;
	return GOOGLE_IMPLEMENTED[app];
}

/** Surfaced by /api/health. Never loads any SDK. */
export function realConnectorStatus(env: Env): RealConnectorStatus[] {
	return (Object.keys(REAL_ENV_REQUIREMENTS) as AppName[]).map((app) => {
		const missing = missingEnv(env, REAL_ENV_REQUIREMENTS[app]);
		return { app, configured: missing.length === 0, implemented: isImplemented(app), missing };
	});
}

type AnyPort = Record<string, (...args: unknown[]) => Promise<unknown>>;

function createGooglePorts(env: Env, deps: RealDeps): GooglePorts {
	const missing = missingEnv(env, GOOGLE_ENV);
	if (missing.length) {
		const detail = `real connector not configured (missing env: ${missing.join(', ')})`;
		return {
			gmail: notConfiguredPort<GmailPort>('gmail', GOOGLE_METHODS.gmail, detail),
			calendar: notConfiguredPort<CalendarPort>('calendar', GOOGLE_METHODS.calendar, detail),
			docs: notConfiguredPort<DocsPort>('docs', GOOGLE_METHODS.docs, detail)
		};
	}
	// Lazy: the Google SDKs are Node-heavy and must not load in status checks, static or client
	// bundles, or mock runs. The module is imported on the first Google method call only.
	let googleP: Promise<GooglePorts> | undefined;
	const load = () => (googleP ??= import('./google/index.ts').then((m) => m.createRealGoogle(env, deps)));
	const lazy = <T>(app: GoogleApp): T => {
		const port: AnyPort = {};
		for (const method of GOOGLE_METHODS[app]) {
			port[method] = async (...args: unknown[]) => ((await load())[app] as unknown as AnyPort)[method](...args);
		}
		return port as unknown as T;
	};
	return { gmail: lazy<GmailPort>('gmail'), calendar: lazy<CalendarPort>('calendar'), docs: lazy<DocsPort>('docs') };
}

export function createRealConnectors(env: Env = {}, deps: RealDeps = {}): Connectors {
	const google = createGooglePorts(env, deps);
	return {
		notion: createRealNotion(env, deps),
		calendar: google.calendar,
		// Drafts only: there is no send method.
		gmail: google.gmail,
		docs: google.docs,
		github: createRealGitHub(env, deps),
		hf: createRealHF(env, deps)
	};
}

/**
 * Live per-app probes in order github, hf, notion, calendar, gmail, docs. Never throws.
 * ok: true = live call succeeded, false = failed (kind + redacted detail), null = skipped.
 */
export async function probeRealConnectors(env: Env, deps: RealDeps = {}): Promise<ProbeResult[]> {
	const now = deps.now ?? Date.now;
	const failed = (app: AppName, configured: boolean, implemented: boolean, e: unknown, start?: number): ProbeResult => {
		const err = toConnectorError(e, app, env);
		return {
			app,
			configured,
			implemented,
			ok: false,
			kind: err.kind,
			detail: redactSecrets(err.message, env),
			...(start === undefined ? {} : { latencyMs: now() - start })
		};
	};
	const live = async (app: 'github' | 'hf', run: () => Promise<string>): Promise<ProbeResult> => {
		const start = now();
		try {
			const detail = await run();
			return { app, configured: true, implemented: true, ok: true, detail, latencyMs: now() - start };
		} catch (e) {
			return failed(app, true, true, e, start);
		}
	};

	const ghUser = env.GITHUB_USERNAME?.trim() || 'wolfwdavid';
	const hfUser = env.HF_USERNAME?.trim() || 'WolfDavid';

	const github = live('github', async () => {
		const repos = await createRealGitHub(env, deps).listRepos(ghUser);
		return `${repos.length} most recently pushed public repos (${ghUser})`;
	});
	const hf = live('hf', async () => {
		const items = await createRealHF(env, deps).listModelsAndSpaces(hfUser);
		return `${items.length} models/spaces (${hfUser})`;
	});
	const notion = probeNotion(env, deps).catch((e: unknown) =>
		failed('notion', missingEnv(env, NOTION_ENV).length === 0, NOTION_IMPLEMENTED, e)
	);
	const google = (async (): Promise<ProbeResult[]> => {
		const missing = missingEnv(env, GOOGLE_ENV);
		if (missing.length) {
			return GOOGLE_APPS.map((app) => ({
				app,
				configured: false,
				implemented: GOOGLE_IMPLEMENTED[app],
				ok: null,
				detail: `missing env: ${missing.join(', ')}`
			}));
		}
		try {
			return await (await import('./google/index.ts')).probeGoogle(env, deps);
		} catch (e) {
			return GOOGLE_APPS.map((app) => failed(app, true, GOOGLE_IMPLEMENTED[app], e));
		}
	})();

	const [g, h, n, gs] = await Promise.all([github, hf, notion, google]);
	return [g, h, n, ...gs];
}

// Google real connector module (Gmail drafts, Calendar, Docs). Loaded ONLY via dynamic import()
// from ../index.ts: this file and ./auth.ts are the only ones that import the Node-heavy Google
// SDKs, which must stay out of status checks and static/client bundles. The per-app ports take
// structural API objects, so tests inject fakes and never touch the network.
import { calendar } from '@googleapis/calendar';
import { docs } from '@googleapis/docs';
import { drive } from '@googleapis/drive';
import { gmail } from '@googleapis/gmail';
import type { CalendarPort, DocsPort, GmailPort } from '../../types.ts';
import { missingEnv, notConfiguredPort, type Env, type ProbeResult, type RealDeps } from '../shared.ts';
import { createGoogleAuth, mapGoogleError, probeGoogleAuth, type AuthLike } from './auth.ts';
import { createRealCalendar, type CalendarApi } from './calendar.ts';
import { GOOGLE_ENV, GOOGLE_IMPLEMENTED, GOOGLE_METHODS, type GoogleApp } from './flags.ts';

export interface GooglePorts {
	gmail: GmailPort;
	calendar: CalendarPort;
	docs: DocsPort;
}

export interface GoogleApis {
	auth: unknown;
	calendar: unknown;
	gmail: unknown;
	docs: unknown;
	drive: unknown;
}

export interface GoogleDeps extends RealDeps {
	apis?: GoogleApis;
	auth?: AuthLike;
	/** Test seam: overrides GOOGLE_IMPLEMENTED per app. */
	implemented?: Partial<Record<GoogleApp, boolean>>;
}

const APPS = ['calendar', 'gmail', 'docs'] as const;

/** One refresh-token client shared by all four API clients. No network until the first call. */
export function createGoogleApis(env: Env): GoogleApis {
	// @googleapis/* may bundle a different google-auth-library major; runtime-compatible.
	const auth = createGoogleAuth(env) as never;
	return {
		auth,
		calendar: calendar({ version: 'v3', auth }),
		gmail: gmail({ version: 'v1', auth }),
		docs: docs({ version: 'v1', auth }),
		drive: drive({ version: 'v3', auth })
	};
}

type AnyPort = Record<string, (...args: unknown[]) => Promise<unknown>>;

/** Builds the real port on first method call, so constructing ports never builds clients. */
function lazyPort<T>(methods: readonly string[], build: () => T): T {
	let port: AnyPort | undefined;
	const out: AnyPort = {};
	for (const method of methods) {
		out[method] = async (...args) => (port ??= build() as unknown as AnyPort)[method](...args);
	}
	return out as unknown as T;
}

const calendarIdOf = (env: Env) => env.GOOGLE_CALENDAR_ID?.trim() || 'primary';

/** Real port builders per app; only called for implemented apps. */
function builders(env: Env, getApis: () => GoogleApis): Partial<{ [A in GoogleApp]: () => GooglePorts[A] }> {
	return {
		calendar: () => createRealCalendar(getApis().calendar as CalendarApi, { calendarId: calendarIdOf(env), env })
	};
}

export function createRealGoogle(env: Env, deps: GoogleDeps = {}): GooglePorts {
	const missing = missingEnv(env, GOOGLE_ENV);
	if (missing.length) {
		const detail = `real connector not configured (missing env: ${missing.join(', ')})`;
		return {
			gmail: notConfiguredPort<GmailPort>('gmail', GOOGLE_METHODS.gmail, detail),
			calendar: notConfiguredPort<CalendarPort>('calendar', GOOGLE_METHODS.calendar, detail),
			docs: notConfiguredPort<DocsPort>('docs', GOOGLE_METHODS.docs, detail)
		};
	}
	let apis: GoogleApis | undefined;
	const getApis = () => (apis ??= deps.apis ?? createGoogleApis(env));
	const build = builders(env, getApis);
	const port = <A extends GoogleApp>(app: A): GooglePorts[A] => {
		const implemented = deps.implemented?.[app] ?? GOOGLE_IMPLEMENTED[app];
		const real = build[app] as (() => GooglePorts[A]) | undefined;
		if (!implemented || !real) {
			return notConfiguredPort<GooglePorts[A]>(
				app,
				GOOGLE_METHODS[app],
				`credentials present; Google ${app} connector not implemented in this build`
			);
		}
		return lazyPort<GooglePorts[A]>(GOOGLE_METHODS[app], real);
	};
	return { gmail: port('gmail'), calendar: port('calendar'), docs: port('docs') };
}

/** One cheap, TransferPilot-scoped read per implemented app. Resolves to a detail string. */
function appReads(env: Env): Partial<Record<GoogleApp, (apis: GoogleApis) => Promise<string>>> {
	return {
		calendar: async (apis) => {
			await (apis.calendar as CalendarApi).events.list({
				calendarId: calendarIdOf(env),
				maxResults: 1,
				privateExtendedProperty: ['tpApp=transferpilot']
			});
			return 'calendar reachable';
		}
	};
}

/** Results in order calendar, gmail, docs. Never throws. */
export async function probeGoogle(env: Env, deps: GoogleDeps = {}): Promise<ProbeResult[]> {
	const missing = missingEnv(env, GOOGLE_ENV);
	const implementedOf = (app: GoogleApp) => deps.implemented?.[app] ?? GOOGLE_IMPLEMENTED[app];
	if (missing.length) {
		return APPS.map((app) => ({
			app,
			configured: false,
			implemented: implementedOf(app),
			ok: null,
			detail: `missing env: ${missing.join(', ')}`
		}));
	}
	const now = deps.now ?? Date.now;
	try {
		let apis: GoogleApis | undefined;
		const getApis = () => (apis ??= deps.apis ?? createGoogleApis(env));
		const authLike = (deps.auth ?? deps.apis?.auth ?? getApis().auth) as AuthLike;
		const auth = await probeGoogleAuth(env, { auth: authLike });
		const reads = appReads(env);
		return await Promise.all(
			APPS.map(async (app): Promise<ProbeResult> => {
				const implemented = implementedOf(app);
				const head = { app, configured: true, implemented };
				if (!implemented) {
					return { ...head, ok: null, detail: `not implemented (auth: ${auth.ok ? 'ok' : auth.detail})` };
				}
				if (!auth.ok) return { ...head, ok: false, kind: auth.kind, detail: auth.detail };
				const read = reads[app];
				if (!read) return { ...head, ok: true, detail: auth.detail };
				const started = now();
				try {
					const detail = await read(getApis());
					return { ...head, ok: true, detail, latencyMs: now() - started };
				} catch (e) {
					const err = mapGoogleError(e, `${app} probe`, env);
					return { ...head, ok: false, kind: err.kind, detail: err.message, latencyMs: now() - started };
				}
			})
		);
	} catch (e) {
		const err = mapGoogleError(e, 'google probe', env);
		return APPS.map((app) => ({
			app,
			configured: true,
			implemented: implementedOf(app),
			ok: false,
			kind: err.kind,
			detail: err.message
		}));
	}
}

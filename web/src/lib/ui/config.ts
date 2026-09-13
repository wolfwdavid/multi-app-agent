// UI constants shared by the sprint page and the eval dashboard. Pure: no $app/$env/svelte imports.
import type { AppName } from '../core/schemas.ts';

/** Public URL of the live (Vercel) deployment. Empty until Phase 9 wires LiveSource. */
export const LIVE_URL = '';
/** Phase 9 (09-02) flips this to true when LiveSource exists; until then the health probe never switches sources. */
export const LIVE_SOURCE_AVAILABLE = false;

export const REPO_URL = 'https://github.com/wolfwdavid/multi-app-agent';
export const BRIEF_URL = `${REPO_URL}/blob/main/BRIEF.md`;

/** Static recordings, relative to `base` (prefix with `${base}/`). */
export const DATA_PATHS = {
	hero: 'data/hero-run.json',
	evals: 'data/evals.json',
	silentFailure: 'data/silent-failure-run.json'
} as const;

export const APP_LABELS: Record<AppName, string> = {
	notion: 'Notion',
	calendar: 'Google Calendar',
	docs: 'Google Docs',
	gmail: 'Gmail',
	github: 'GitHub',
	hf: 'Hugging Face'
};

export const PLAN_APP_ORDER = ['notion', 'calendar', 'docs', 'gmail'] as const;

export const REPLAY_SPEEDS = [
	{ id: '1x', label: '1×', ms: 400 },
	{ id: '4x', label: '4×', ms: 100 }
] as const;

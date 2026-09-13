// App-wide reactive state: display mode and the replay recording (loaded once per page session).
import { detectMode, type AppMode } from './mode.ts';
import { loadStatic, fromSchema, HeroRunFile, type LoadResult } from './data.ts';
import { DATA_PATHS, LIVE_SOURCE_AVAILABLE } from './config.ts';

export const appState = $state<{ mode: AppMode; hero: LoadResult<HeroRunFile> | null }>({
	mode: 'detecting',
	hero: null
});

let heroPromise: Promise<LoadResult<HeroRunFile>> | null = null;

/** Memoized fetch of data/hero-run.json; assigns appState.hero when it resolves. */
export function loadHero(base: string): Promise<LoadResult<HeroRunFile>> {
	if (!heroPromise) {
		heroPromise = loadStatic(`${base}/${DATA_PATHS.hero}`, fromSchema(HeroRunFile)).then((result) => {
			appState.hero = result;
			return result;
		});
	}
	return heroPromise;
}

let started = false;

/** Idempotent: detect replay vs live, then load the recording in replay mode. */
export async function initApp(url: URL, base: string): Promise<void> {
	if (started) return;
	started = true;
	appState.mode = await detectMode({ url, base, liveAvailable: LIVE_SOURCE_AVAILABLE });
	if (appState.mode === 'replay') await loadHero(base);
}

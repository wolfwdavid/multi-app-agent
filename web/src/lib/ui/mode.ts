// Replay vs live detection (07-UI-SPEC "Mode detection"). Pure: base and fetch are injected.

export type AppMode = 'detecting' | 'live' | 'replay';

export interface DetectModeOptions {
	url: URL;
	base: string;
	liveAvailable: boolean;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

/**
 * 'replay' when `?replay` is set, live sources are not wired yet, or the health probe is not a JSON
 * response from a Vercel deployment (404 HTML on Pages/HF, network error, timeout).
 */
export async function detectMode({
	url,
	base,
	liveAvailable,
	fetchFn = fetch,
	timeoutMs = 1500
}: DetectModeOptions): Promise<'live' | 'replay'> {
	if (url.searchParams.has('replay') || !liveAvailable) return 'replay';
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		// Server routes do not inherit the layout trailingSlash: no trailing slash here.
		const res = await fetchFn(`${base}/api/health`, {
			signal: controller.signal,
			headers: { accept: 'application/json' }
		});
		if (!res.ok) return 'replay';
		if (!(res.headers.get('content-type') ?? '').includes('application/json')) return 'replay';
		const body = (await res.json()) as { target?: unknown } | null;
		return body && body.target === 'vercel' ? 'live' : 'replay';
	} catch {
		return 'replay';
	} finally {
		clearTimeout(timer);
	}
}

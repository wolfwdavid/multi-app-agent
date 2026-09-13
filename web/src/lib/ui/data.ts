// Static JSON loader for the showcase. Never throws, never returns partially valid data.
import { z } from 'zod';
import { Plan, RunReport, TraceEvent } from '../core/schemas.ts';

export type LoadResult<T> =
	| { state: 'ok'; data: T }
	| { state: 'error'; status: number | null; reason: 'http' | 'invalid' | 'network'; message: string };

export type Parser<T> = (raw: unknown) => { ok: true; data: T } | { ok: false; message: string };

export function fromSchema<S extends z.ZodType>(schema: S): Parser<z.infer<S>> {
	return (raw) => {
		const r = schema.safeParse(raw);
		if (r.success) return { ok: true, data: r.data };
		const message = r.error.issues
			.slice(0, 3)
			.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
			.join('; ');
		return { ok: false, message };
	};
}

export async function loadStatic<T>(
	url: string,
	parse: Parser<T>,
	fetchFn: typeof fetch = fetch
): Promise<LoadResult<T>> {
	let res: Response;
	try {
		res = await fetchFn(url, { headers: { accept: 'application/json' } });
	} catch (err) {
		return { state: 'error', status: null, reason: 'network', message: err instanceof Error ? err.message : String(err) };
	}
	if (!res.ok) return { state: 'error', status: res.status, reason: 'http', message: `HTTP ${res.status}` };
	let raw: unknown;
	try {
		raw = await res.json();
	} catch (err) {
		return {
			state: 'error',
			status: res.status,
			reason: 'invalid',
			message: err instanceof Error ? err.message : 'Response is not JSON'
		};
	}
	const parsed = parse(raw);
	if (!parsed.ok) return { state: 'error', status: res.status, reason: 'invalid', message: parsed.message };
	return { state: 'ok', data: parsed.data };
}

/**
 * Mirrors the 04-03 `HeroRunFile` (agent recording module). Rebuilt from core/schemas.ts so the client
 * bundle never pulls in executor or connector code.
 */
export const HeroRunFile = z.object({
	recordedAt: z.string().min(1),
	commitSha: z.string().min(1),
	profileId: z.string().min(1),
	plan: Plan,
	preflight: z.record(z.string(), z.enum(['new', 'exists'])).optional(),
	events: z.array(TraceEvent),
	report: RunReport,
	rerun: z.object({ events: z.array(TraceEvent), report: RunReport }).optional()
});
export type HeroRunFile = z.infer<typeof HeroRunFile>;

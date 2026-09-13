// JSONL (one TraceEvent per line) serializer. Pure: callers (CLI, routes) do the file I/O.
import { TraceEvent } from '../schemas.ts';

export function toJsonl(events: readonly TraceEvent[]): string {
	return events.map((e) => JSON.stringify(e) + '\n').join('');
}

export function parseJsonl(text: string): TraceEvent[] {
	const out: TraceEvent[] = [];
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch (err) {
			throw new Error(`parseJsonl: invalid JSON on line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
		}
		const r = TraceEvent.safeParse(raw);
		if (!r.success) {
			const issues = r.error.issues.map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`).join('; ');
			throw new Error(`parseJsonl: invalid trace event on line ${i + 1}: ${issues}`);
		}
		out.push(r.data);
	}
	return out;
}

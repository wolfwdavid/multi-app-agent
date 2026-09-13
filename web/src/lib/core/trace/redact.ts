// Student PII redaction for anything that leaves the process: exported traces and recordings
// (static/traces, static/data, eval artifacts, SSE replays) MUST pass through here.
// Only student identity (name, email) and GPA are treated as PII. Mock contacts are fictional
// fixtures and stay intact so recipients remain inspectable. Bare numbers are never changed,
// so numeric contract fields (ts, durationMs, latencyMs, counts) keep parsing.
import type { Profile, TraceEvent } from '../schemas.ts';

export const REDACTED = Object.freeze({
	name: '[redacted:name]',
	email: '[redacted:email]',
	gpa: '[redacted:gpa]'
});

export interface PiiSpec {
	names: string[];
	emails: string[];
	gpa: number | null;
}

export function piiFromProfile(p: Profile): PiiSpec {
	const full = p.student.name.trim();
	const parts = full.split(/\s+/).filter((s) => s.length >= 3);
	const names = [...new Set([full, ...parts])].filter((s) => s.length > 0);
	return { names, emails: [p.student.email], gpa: p.gpa };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactText(s: string, pii: PiiSpec): string {
	let out = s;
	for (const email of pii.emails) {
		if (email) out = out.replace(new RegExp(esc(email), 'gi'), REDACTED.email);
	}
	const names = [...pii.names].sort((a, b) => b.length - a.length);
	for (const name of names) {
		if (!name) continue;
		out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'giu'), REDACTED.name);
	}
	out = out.replace(/\bGPA\b([^0-9\n]{0,24})\d(?:\.\d{1,2})?/gi, `GPA$1${REDACTED.gpa}`);
	if (pii.gpa !== null) {
		for (const v of [...new Set([pii.gpa.toFixed(2), String(pii.gpa)])]) {
			out = out.replace(new RegExp(`(?<![\\d.])${esc(v)}(?![\\d])`, 'g'), REDACTED.gpa);
		}
	}
	return out;
}

const GPA_KEY = /^(gpa|studentGpa|student_gpa)$/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (v === null || typeof v !== 'object') return false;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

function redactAny(v: unknown, pii: PiiSpec): unknown {
	if (typeof v === 'string') return redactText(v, pii);
	if (Array.isArray(v)) return v.map((x) => redactAny(x, pii));
	if (isPlainObject(v)) {
		const out: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			out[k] = GPA_KEY.test(k) ? REDACTED.gpa : redactAny(val, pii);
		}
		return out;
	}
	return v;
}

/** Deep copy with student PII redacted. Numbers are never changed (except under gpa keys). */
export function redactValue<T>(v: T, pii: PiiSpec): T {
	return redactAny(v, pii) as T;
}

export function redactTraceEvent(e: TraceEvent, pii: PiiSpec): TraceEvent {
	return { ...e, attrs: redactValue(e.attrs, pii) };
}

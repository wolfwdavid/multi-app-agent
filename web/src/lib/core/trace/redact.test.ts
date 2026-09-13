import { describe, it, expect } from 'vitest';
import demoRaw from '../data/profiles/demo.json';
import { Profile, TraceEvent } from '../schemas.ts';
import { piiFromProfile, redactText, redactTraceEvent, redactValue, REDACTED } from './redact.ts';
import { parseJsonl, toJsonl } from './jsonl.ts';

const demo = Profile.parse(demoRaw);
const pii = piiFromProfile(demo);

const ev = (over: Partial<TraceEvent> = {}): TraceEvent => ({
	traceId: 't1',
	spanId: 's1',
	name: 'tool.call',
	kind: 'end',
	ts: 1700,
	durationMs: 3.3,
	status: 'ok',
	attrs: { args: { body: 'Best,\nAlex Rivera', to: ['lchen@example.edu'] }, latencyMs: 3.3, gpa: 3.3 },
	...over
});

describe('piiFromProfile', () => {
	it('derives full name, name parts, email and gpa', () => {
		expect(pii).toEqual({ names: ['Alex Rivera', 'Alex', 'Rivera'], emails: ['alex.rivera@example.com'], gpa: 3.3 });
	});
});

describe('redactText', () => {
	it('redacts the full name across newlines', () => {
		expect(redactText('Thank you,\nAlex Rivera', pii)).toBe(`Thank you,\n${REDACTED.name}`);
	});

	it('is case-insensitive and word-bounded for name parts', () => {
		// Full name is matched first (longest), so a case-variant full name collapses to one token.
		expect(redactText('ALEX rivera wrote', pii)).toBe('[redacted:name] wrote');
		expect(redactText('RIVERA and alex wrote', pii)).toBe('[redacted:name] and [redacted:name] wrote');
		expect(redactText('Alexander', pii)).toBe('Alexander');
	});

	it('redacts the student email case-insensitively', () => {
		const out = redactText('reach me at Alex.Rivera@Example.com', pii);
		expect(out).toContain(REDACTED.email);
		expect(out.toLowerCase()).not.toContain('example.com');
	});

	it('redacts GPA phrases and the standalone gpa value', () => {
		const out = redactText(
			'GPA_BELOW_COMPETITIVE: No minimum GPA is published; GPA 3.3 is below the competitive GPA of 3.5.',
			pii
		);
		expect(out).not.toContain('3.3');
		expect(out).toContain(REDACTED.gpa);
		expect(redactText('My GPA is 3.3.', pii)).not.toContain('3.3');
		expect(redactText('scored 3.30 overall', pii)).not.toContain('3.30');
	});

	it('does not redact digits embedded in other numbers', () => {
		expect(redactText('version 13.30 build', pii)).toBe('version 13.30 build');
	});

	it('leaves contact emails intact', () => {
		expect(redactText('cc lchen@example.edu', pii)).toBe('cc lchen@example.edu');
	});
});

describe('redactValue', () => {
	it('redacts gpa keys and strings but never bare numbers, without mutating', () => {
		const input = { gpa: 3.3, studentGpa: 3.3, nested: [{ body: 'Alex Rivera' }], latencyMs: 3.3, keep: 42 };
		const snapshot = structuredClone(input);
		const out = redactValue(input, pii);
		expect(out.gpa).toBe(REDACTED.gpa);
		expect(out.studentGpa).toBe(REDACTED.gpa);
		expect(out.nested[0].body).toBe(REDACTED.name);
		expect(out.latencyMs).toBe(3.3);
		expect(typeof out.latencyMs).toBe('number');
		expect(out.keep).toBe(42);
		expect(input).toEqual(snapshot);
	});
});

describe('redactTraceEvent', () => {
	it('redacts only attrs and still parses as a TraceEvent', () => {
		const e = ev();
		const out = redactTraceEvent(e, pii);
		expect(out.name).toBe(e.name);
		expect(out.spanId).toBe(e.spanId);
		expect(out.ts).toBe(e.ts);
		expect(out.durationMs).toBe(3.3);
		expect(TraceEvent.parse(out)).toEqual(out);
		const json = JSON.stringify(out);
		expect(json).not.toContain('Alex Rivera');
		expect(json).toContain('lchen@example.edu');
		expect(out.attrs.latencyMs).toBe(3.3);
		expect(out.attrs.gpa).toBe(REDACTED.gpa);
	});
});

describe('jsonl', () => {
	it('serializes one event per line with a trailing newline', () => {
		const e1 = ev();
		const e2 = ev({ spanId: 's2', name: 'retry', kind: 'event' });
		expect(toJsonl([e1, e2])).toBe(JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n');
		expect(toJsonl([])).toBe('');
	});

	it('round-trips and ignores blank lines (including CRLF)', () => {
		const events = [ev(), ev({ spanId: 's2' })];
		expect(parseJsonl(toJsonl(events))).toEqual(events);
		expect(parseJsonl('\n' + toJsonl(events).replace(/\n/g, '\r\n') + '\n\n')).toEqual(events);
	});

	it('throws with the line number on an invalid event', () => {
		const text = toJsonl([ev()]) + JSON.stringify({ name: 'bad' }) + '\n';
		expect(() => parseJsonl(text)).toThrow(/line 2/);
	});
});

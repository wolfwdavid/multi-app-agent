import { describe, it, expect } from 'vitest';
import {
	LLMError,
	isLLMError,
	JSON_ONLY_INSTRUCTION,
	buildMessages,
	toProviderSchema,
	stripThink,
	parseModelJson,
	sanitizeOutput,
	safeSlotName,
	redactSecret
} from './common.ts';

describe('stripThink', () => {
	it('removes closed think blocks across lines', () => {
		expect(stripThink('<think>plan\nstuff</think>\n{"a":1}')).toBe('\n{"a":1}');
	});
	it('is case-insensitive', () => {
		expect(stripThink('<THINK>x</THINK>ok')).toBe('ok');
	});
	it('drops an unclosed opener up to the first JSON bracket', () => {
		expect(stripThink('<think>unclosed {"a":1}')).toBe('{"a":1}');
		expect(stripThink('<think>unclosed [1]')).toBe('[1]');
	});
	it('drops an unclosed opener to the end when no JSON follows', () => {
		expect(stripThink('before <think>just thinking')).toBe('before ');
	});
	it('removes a stray closing tag', () => {
		expect(stripThink('</think>{"a":1}')).toBe('{"a":1}');
	});
});

describe('parseModelJson', () => {
	it('parses fenced JSON', () => {
		expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
	});
	it('extracts JSON surrounded by prose', () => {
		expect(parseModelJson('Sure! {"a":[1,2]} hope that helps')).toEqual({ a: [1, 2] });
	});
	it('extracts a bare array surrounded by prose', () => {
		expect(parseModelJson('here: [1,2] done')).toEqual([1, 2]);
	});
	it('strips think blocks before parsing', () => {
		expect(parseModelJson('<think>x</think>{"a":1}')).toEqual({ a: 1 });
	});
	it('returns the cleaned string when unparseable, never throws', () => {
		expect(parseModelJson('not json at all')).toBe('not json at all');
		expect(parseModelJson('')).toBe('');
	});
});

describe('sanitizeOutput', () => {
	it('strips think tags inside nested string values', () => {
		expect(
			sanitizeOutput({ s: 'A <think>x</think>B', arr: ['<think>y</think>C'], n: 1, nested: { t: '</think>D' } })
		).toEqual({ s: 'A B', arr: ['C'], n: 1, nested: { t: 'D' } });
	});
	it('passes non-string primitives through', () => {
		expect(sanitizeOutput(null)).toBe(null);
		expect(sanitizeOutput(true)).toBe(true);
		expect(sanitizeOutput(' keep spaces ')).toBe(' keep spaces ');
	});
});

describe('toProviderSchema', () => {
	it('drops top-level $schema without mutating input', () => {
		const input = { $schema: 'x', type: 'object', properties: {} };
		expect(toProviderSchema(input)).toEqual({ type: 'object', properties: {} });
		expect(input.$schema).toBe('x');
	});
	it('returns undefined for non-objects', () => {
		expect(toProviderSchema(undefined)).toBeUndefined();
		expect(toProviderSchema('x')).toBeUndefined();
		expect(toProviderSchema([1])).toBeUndefined();
	});
});

describe('safeSlotName', () => {
	it('sanitizes to the provider name alphabet', () => {
		expect(safeSlotName('draft')).toBe('draft');
		expect(safeSlotName('gap actions/v2')).toBe('gap_actions_v2');
		expect(safeSlotName('')).toBe('output');
		expect(safeSlotName('x'.repeat(100)).length).toBe(64);
	});
});

describe('buildMessages', () => {
	const base = { slot: 'draft', system: 'Write email.', input: { a: 1 }, jsonSchema: { $schema: 'x', type: 'object' } };

	it('builds system + user messages with the cleaned schema', () => {
		const m = buildMessages(base);
		expect(m).toHaveLength(2);
		expect(m[0].role).toBe('system');
		expect(m[0].content).toContain('Write email.');
		expect(m[0].content).toContain(JSON_ONLY_INSTRUCTION);
		expect(m[0].content).toContain('{"type":"object"}');
		expect(m[0].content).not.toContain('$schema');
		expect(m[1].role).toBe('user');
		expect(m[1].content).toContain('{"a":1}');
	});

	it('omits the schema section when there is no schema', () => {
		const m = buildMessages({ slot: 's', system: 'S', input: undefined });
		expect(m[0].content).not.toContain('JSON Schema');
		expect(m[1].content).toContain('null');
	});

	it('appends the repair turn', () => {
		const m = buildMessages({ ...base, repair: { issues: 'subject: Too small', previous: { subject: '' } } });
		expect(m).toHaveLength(4);
		expect(m[2]).toEqual({ role: 'assistant', content: '{"subject":""}' });
		expect(m[3].role).toBe('user');
		expect(m[3].content).toContain('subject: Too small');
		expect(m[3].content).toContain('failed validation');
	});

	it('uses a string previous output verbatim', () => {
		const m = buildMessages({ ...base, repair: { issues: 'i', previous: 'garbage' } });
		expect(m[2].content).toBe('garbage');
	});
});

describe('redactSecret', () => {
	it('replaces every occurrence of the secret', () => {
		expect(redactSecret('bad key sk-abc123 here', 'sk-abc123')).toBe('bad key *** here');
		expect(redactSecret('x', '')).toBe('x');
		expect(redactSecret('x', undefined)).toBe('x');
	});
});

describe('LLMError', () => {
	it('carries kind, provider and model', () => {
		const e = new LLMError('timeout', 'm', { provider: 'ollama', model: 'q' });
		expect(e).toBeInstanceOf(Error);
		expect(e.name).toBe('LLMError');
		expect(e.kind).toBe('timeout');
		expect(e.provider).toBe('ollama');
		expect(e.model).toBe('q');
		expect(e.status).toBeUndefined();
		expect(isLLMError(e)).toBe(true);
		expect(isLLMError(new Error())).toBe(false);
	});
	it('keeps status, retryAfterMs and cause when given', () => {
		const cause = new Error('c');
		const e = new LLMError('rate_limit', 'm', { provider: 'hosted', model: 'g', status: 429, retryAfterMs: 2000, cause });
		expect(e.status).toBe(429);
		expect(e.retryAfterMs).toBe(2000);
		expect(e.cause).toBe(cause);
	});
});

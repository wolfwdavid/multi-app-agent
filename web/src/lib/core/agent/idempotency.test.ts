import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, deriveIdempotencyKey, sha256Hex } from './idempotency.ts';
import { IdempotencyKey } from '../schemas.ts';

describe('canonicalJson', () => {
	it('sorts keys recursively, drops undefined, keeps array order', () => {
		expect(canonicalJson({ b: 1, a: { d: 1, c: 2 }, u: undefined, arr: [{ y: 1, x: 2 }] })).toBe(
			'{"a":{"c":2,"d":1},"arr":[{"x":2,"y":1}],"b":1}'
		);
	});

	it('is insertion-order independent', () => {
		expect(canonicalJson({ x: 1, y: [1, 'a', null, true] })).toBe(canonicalJson({ y: [1, 'a', null, true], x: 1 }));
	});

	it('throws on non-finite numbers and unsupported values', () => {
		expect(() => canonicalJson(NaN)).toThrow(/non-finite/);
		expect(() => canonicalJson({ a: Infinity })).toThrow(/non-finite/);
		expect(() => canonicalJson(() => 1)).toThrow();
		expect(() => canonicalJson(BigInt(1))).toThrow();
	});
});

describe('sha256Hex', () => {
	it('matches the known vector for abc', async () => {
		expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
});

describe('deriveIdempotencyKey', () => {
	const parts = {
		profileId: 'demo',
		schoolId: 'uc-berkeley',
		programId: 'uc-berkeley-data-science-ba',
		actionKind: 'tracker_row' as const,
		naturalKey: 'Fall 2027'
	};

	it('matches the node:crypto reference and the contract regex', async () => {
		const key = await deriveIdempotencyKey(parts);
		const ref =
			'tp1-' +
			createHash('sha256')
				.update('demo|uc-berkeley|uc-berkeley-data-science-ba|tracker_row|Fall 2027')
				.digest('hex')
				.slice(0, 16);
		expect(key).toBe('tp1-10ce46ea998e08c2');
		expect(key).toBe(ref);
		expect(IdempotencyKey.parse(key)).toBe(key);
	});

	it('is stable and sensitive to the natural key', async () => {
		const a = await deriveIdempotencyKey(parts);
		const b = await deriveIdempotencyKey(parts);
		const c = await deriveIdempotencyKey({ ...parts, naturalKey: 'Fall 2028' });
		expect(a).toBe(b);
		expect(c).not.toBe(a);
	});
});

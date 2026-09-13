// Deterministic idempotency keys and canonical JSON. Web Crypto only, so core runs on Node, Vercel and the browser.
import type { IdempotencyKey } from '../schemas.ts';
import type { ActionKind } from './types.ts';

/** Stable JSON: object keys sorted, undefined properties dropped, arrays in order, finite numbers only. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj)
			.filter((k) => obj[k] !== undefined)
			.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
		return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
	}
	throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
}

export async function sha256Hex(text: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface KeyParts {
	profileId: string;
	schoolId: string;
	programId: string;
	actionKind: ActionKind;
	naturalKey: string;
}

/**
 * 'tp1-' + first 16 hex chars of sha256(profileId|schoolId|programId|actionKind|naturalKey).
 * Matches the Phase 1 schemas.ts key contract (programId and actionKind added). naturalKey carries the
 * application cycle/term and NEVER the date, so a re-run on a later day, or after a deadline change,
 * dedupes to the same artifact.
 */
export async function deriveIdempotencyKey(p: KeyParts): Promise<IdempotencyKey> {
	const hex = await sha256Hex([p.profileId, p.schoolId, p.programId, p.actionKind, p.naturalKey].join('|'));
	return `tp1-${hex.slice(0, 16)}`;
}

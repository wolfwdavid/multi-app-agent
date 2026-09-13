// Policy gate: the ONLY path to execution. Enforced in core, not the UI, so REST (Phase 9), MCP (Phase 11),
// the CLI and evals all share it. Every rejection happens before any write, because the executor only runs
// on a returned Authorization.
import { Plan } from '../schemas.ts';
import type { Action, Profile } from '../schemas.ts';
import { getWriteTool } from '../tools/sprint-tools.ts';
import { canonicalJson } from './idempotency.ts';
import { PolicyError } from './types.ts';
import type { Authorization, BlockedAction, PolicyViolationCode } from './types.ts';

/** Unique lowercased contact emails, sorted. The student's own address is excluded: the sprint never drafts to the student. */
export function recipientAllowlistFromProfile(profile: Profile): string[] {
	return normalizeAllowlist(profile.contacts.map((c) => c.email));
}

function normalizeAllowlist(list: readonly string[]): string[] {
	return [...new Set(list.map((e) => e.toLowerCase()))].sort();
}

const MIN_SECRET = 16;

async function hmacKey(secret: string) {
	if (typeof secret !== 'string' || secret.length < MIN_SECRET) {
		throw new Error(`plan signing secret must be at least ${MIN_SECRET} characters`);
	}
	return globalThis.crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

/** The allowlist is bound into the token, so an execute request carrying a profile with swapped contacts fails verification. */
function signingPayload(plan: unknown, allowlist: readonly string[]) {
	return new TextEncoder().encode(canonicalJson({ v: 1, plan, recipientAllowlist: normalizeAllowlist(allowlist) }));
}

function toBase64Url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string) {
	if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('invalid base64url');
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export async function signPlan(plan: Plan, secret: string, recipientAllowlist: string[]): Promise<string> {
	const key = await hmacKey(secret);
	const sig = await globalThis.crypto.subtle.sign('HMAC', key, signingPayload(plan, recipientAllowlist));
	return 'v1.' + toBase64Url(new Uint8Array(sig));
}

/** Constant-time HMAC verify. Returns false for any malformed token or payload; throws only for a weak secret. */
export async function verifyPlanToken(
	plan: unknown,
	token: string,
	secret: string,
	recipientAllowlist: string[]
): Promise<boolean> {
	const key = await hmacKey(secret);
	if (typeof token !== 'string' || !token.startsWith('v1.')) return false;
	try {
		const sig = fromBase64Url(token.slice(3));
		return await globalThis.crypto.subtle.verify('HMAC', key, sig, signingPayload(plan, recipientAllowlist));
	} catch {
		return false;
	}
}

export function checkActionPolicy(
	action: Action,
	recipientAllowlist: string[]
): { code: PolicyViolationCode; reason: string } | null {
	const { tool } = action;
	if (/send/i.test(tool)) {
		return { code: 'forbidden_tool', reason: `tool ${tool} is not allowed (drafts only; sending is never permitted)` };
	}
	const def = getWriteTool(tool);
	if (!def) return { code: 'unknown_tool', reason: `tool ${tool} is not a registered write tool` };
	if (def.app !== action.app || action.effect !== 'write') {
		return {
			code: 'tool_app_mismatch',
			reason: `tool ${tool} is a ${def.app} write tool but the action declares app ${action.app} with effect ${action.effect}`
		};
	}
	if (tool === 'gmail.createDraft') {
		const { to, cc } = action.payload as { to?: unknown; cc?: unknown };
		if (!Array.isArray(to) || (cc !== undefined && !Array.isArray(cc))) {
			return { code: 'recipient_not_allowlisted', reason: 'recipients missing or malformed' };
		}
		const allow = new Set(normalizeAllowlist(recipientAllowlist));
		const recipients = [...to, ...((cc as unknown[] | undefined) ?? [])];
		for (const r of recipients) {
			const addr = typeof r === 'string' ? r.toLowerCase() : String(r);
			if (typeof r !== 'string' || !allow.has(addr)) {
				return { code: 'recipient_not_allowlisted', reason: `recipient ${addr} is not in the profile contact allowlist` };
			}
		}
	}
	return null;
}

/** Stable Kahn's algorithm: ties broken by original index. */
export function topoOrder(actions: Action[]): Action[] {
	const ids = new Set(actions.map((a) => a.id));
	const missing = actions.flatMap((a) => (a.dependsOn ?? []).filter((d) => !ids.has(d)).map((d) => `${a.id} -> ${d}`));
	if (missing.length) throw new PolicyError('invalid_plan', 'unknown dependency', missing);
	const done = new Set<string>();
	const remaining = [...actions];
	const out: Action[] = [];
	while (remaining.length) {
		const i = remaining.findIndex((a) => (a.dependsOn ?? []).every((d) => done.has(d)));
		if (i < 0) throw new PolicyError('invalid_plan', 'dependency cycle', remaining.map((a) => a.id));
		const [next] = remaining.splice(i, 1);
		out.push(next);
		done.add(next.id);
	}
	return out;
}

function duplicates(values: string[]): string[] {
	const seen = new Set<string>();
	const dup = new Set<string>();
	for (const v of values) (seen.has(v) ? dup : seen).add(v);
	return [...dup];
}

export async function authorizeExecution(input: {
	plan: unknown;
	planToken: string;
	approvedIds: string[];
	secret: string;
	recipientAllowlist: string[];
}): Promise<Authorization> {
	const parsed = Plan.safeParse(input.plan);
	if (!parsed.success) {
		throw new PolicyError(
			'invalid_plan',
			'plan failed schema validation',
			parsed.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
		);
	}
	// Verify the RAW input so schema defaults can't mask tampering.
	if (!(await verifyPlanToken(input.plan, input.planToken, input.secret, input.recipientAllowlist))) {
		throw new PolicyError('invalid_plan_token', 'plan token is invalid or the plan was modified after signing');
	}
	const plan = parsed.data;
	const dupIds = duplicates(plan.actions.map((a) => a.id));
	if (dupIds.length) throw new PolicyError('invalid_plan', 'duplicate action ids', dupIds);
	const dupKeys = duplicates(plan.actions.map((a) => a.idempotencyKey));
	if (dupKeys.length) throw new PolicyError('invalid_plan', 'duplicate idempotency keys', dupKeys);
	topoOrder(plan.actions);

	const ids = new Set(plan.actions.map((a) => a.id));
	const unknown = input.approvedIds.filter((id) => !ids.has(id));
	if (unknown.length) throw new PolicyError('unknown_action_id', 'approved ids are not in the plan', unknown);

	const recipientAllowlist = normalizeAllowlist(input.recipientAllowlist);
	const approvedSet = new Set(input.approvedIds);
	const approved: Action[] = [];
	const skipped: Action[] = [];
	const blocked: BlockedAction[] = [];
	for (const action of plan.actions) {
		if (!approvedSet.has(action.id)) {
			skipped.push(action);
			continue;
		}
		const v = checkActionPolicy(action, recipientAllowlist);
		if (v) blocked.push({ action, ...v });
		else approved.push(action);
	}
	return {
		planId: plan.planId,
		approvedIds: plan.actions.filter((a) => approvedSet.has(a.id)).map((a) => a.id),
		approved,
		skipped,
		blocked,
		recipientAllowlist
	};
}

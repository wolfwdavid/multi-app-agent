// Real Google GmailPort: DRAFTS ONLY. Sending is blocked in code: the port type has no send method.
// The OAuth scope is gmail.compose (never gmail.send or full mail access); note that gmail.compose
// would technically permit sending, so the guarantee is the type, not the scope. No SDK import:
// takes a structural GmailApi so tests inject fakes.
//
// Idempotency marker: the subject carries `[tp:<key>]` (APPS-03). Gmail drafts have no custom
// metadata, so findByKey searches drafts for the key and confirms the marker in the subject; the
// marker is stripped on read-back so callers see the subject they wrote.
import { ConnectorError, type Draft, type GmailPort } from '../../types.ts';
import {
	assertEmailList,
	assertIdempotencyKey,
	assertNoHeaderInjection
} from '../../mock/validate.ts';
import type { Env } from '../shared.ts';
import { mapGoogleError } from './auth.ts';

const SCAN_LIMIT = 50;
const MARKER_RE = /\s*\[tp:(tp1-[0-9a-f]{16})\]/;

export const draftMarker = (key: string) => `[tp:${key}]`;

/** ASCII passes through; anything else becomes an RFC 2047 UTF-8 base64 encoded-word. */
export function encodeHeader(value: string): string {
	return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function decodeHeader(value: string): string {
	return value.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

/** RFC 822 text/plain message, base64url encoded for users.drafts.create. */
export function buildRawMessage(d: { to: string[]; cc?: string[]; subject: string; body: string; key: string }): string {
	const bodyB64 = (Buffer.from(d.body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
	const headers = [
		`To: ${d.to.join(', ')}`,
		...(d.cc && d.cc.length ? [`Cc: ${d.cc.join(', ')}`] : []),
		`Subject: ${encodeHeader(`${d.subject} ${draftMarker(d.key)}`)}`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset="UTF-8"',
		'Content-Transfer-Encoding: base64'
	];
	return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${bodyB64}`, 'utf8').toString('base64url');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GmailApi {
	users: {
		drafts: {
			create(p: any): Promise<{ data: any }>;
			list(p: any): Promise<{ data: any }>;
			get(p: any): Promise<{ data: any }>;
			delete?(p: any): Promise<unknown>;
		};
	};
}

interface Part {
	mimeType?: string;
	headers?: { name?: string; value?: string }[];
	body?: { data?: string };
	parts?: Part[];
}

function findTextPlain(part: Part | undefined): string | undefined {
	if (!part) return undefined;
	if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
	for (const child of part.parts ?? []) {
		const hit = findTextPlain(child);
		if (hit !== undefined) return hit;
	}
	return undefined;
}

const splitAddresses = (value: string | undefined): string[] =>
	(value ?? '')
		.split(',')
		.map((a) => a.trim())
		.filter(Boolean)
		.map((a) => a.match(/<([^>]+)>/)?.[1] ?? a);

/** Parses a drafts.get(format 'full') response into a Draft if its subject carries a TransferPilot marker. */
function toDraft(data: any): Draft | null {
	const payload: Part | undefined = data?.message?.payload;
	const header = (name: string) =>
		payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
	const subject = decodeHeader(header('Subject') ?? '');
	const marker = subject.match(MARKER_RE);
	if (!marker) return null;
	const cc = splitAddresses(header('Cc'));
	return {
		id: data.id,
		key: marker[1],
		to: splitAddresses(header('To')),
		...(cc.length ? { cc } : {}),
		subject: subject.replace(MARKER_RE, ''),
		body: findTextPlain(payload) ?? ''
	};
}

export function createRealGmail(api: GmailApi, opts: { env?: Env } = {}): GmailPort {
	const env = opts.env ?? {};
	const call = async <T>(method: string, fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (e) {
			throw mapGoogleError(e, `gmail.${method}`, env);
		}
	};
	const getDraft = (method: string, id: string) =>
		call(method, () => api.users.drafts.get({ userId: 'me', id, format: 'full' })).then((r) => toDraft(r.data));
	const listIds = async (method: string, params: object): Promise<string[]> => {
		const { data } = await call(method, () => api.users.drafts.list({ userId: 'me', ...params }));
		return ((data?.drafts ?? []) as { id?: string }[]).map((d) => d.id).filter((id): id is string => !!id);
	};

	return {
		findByKey: async (key) => {
			assertIdempotencyKey('gmail', key);
			const tryIds = async (ids: string[]) => {
				for (const id of ids) {
					const draft = await getDraft('findByKey', id);
					if (draft?.key === key) return draft;
				}
				return null;
			};
			const hit = await tryIds(await listIds('findByKey', { q: `subject:"${draftMarker(key)}"`, maxResults: 10 }));
			if (hit) return hit;
			// Search indexing lags for brand-new drafts: fall back to scanning recent drafts.
			return tryIds(await listIds('findByKey', { maxResults: SCAN_LIMIT }));
		},

		createDraft: async ({ to, cc, subject, body, key }) => {
			assertIdempotencyKey('gmail', key);
			assertEmailList('To', to, true);
			assertEmailList('Cc', cc ?? [], false);
			assertNoHeaderInjection('Subject', subject);
			const raw = buildRawMessage({ to, cc, subject, body, key });
			const { data } = await call('createDraft', () =>
				api.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } })
			);
			return { id: data?.id ?? '', key, to, ...(cc && cc.length ? { cc } : {}), subject, body };
		},

		listDrafts: async () => {
			const out: Draft[] = [];
			for (const id of await listIds('listDrafts', { maxResults: SCAN_LIMIT })) {
				const draft = await getDraft('listDrafts', id);
				if (draft) out.push(draft);
			}
			return out;
		},

		searchInbox: async () => {
			throw new ConnectorError(
				'not_configured',
				'gmail.searchInbox: real mode requests gmail.compose only (drafts); inbox reading would need gmail.readonly, which TransferPilot deliberately does not request. Inbox content is mock-only.'
			);
		}
	};
}

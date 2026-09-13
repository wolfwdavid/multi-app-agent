// Real Google DocsPort. No SDK import: takes structural DocsApi/DriveApi so tests inject fakes.
//
// Idempotency: the doc is created through Drive files.create with appProperties { tpKey, tpApp }
// set ATOMICALLY at creation, so even a ghost write (created, response lost) is findable by
// findByKey before any retry. The body is inserted afterwards with documents.batchUpdate.
// readDoc returns UNTRUSTED text (possible prompt injection): callers must treat it as data only.
import { ConnectorError, type DocRef, type DocsPort } from '../../types.ts';
import { assertIdempotencyKey } from '../../mock/validate.ts';
import type { Env } from '../shared.ts';
import { mapGoogleError } from './auth.ts';

const DOC_MIME = 'application/vnd.google-apps.document';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DocsApi {
	documents: { get(p: any): Promise<{ data: any }>; batchUpdate(p: any): Promise<{ data: any }> };
}
export interface DriveApi {
	files: { create(p: any): Promise<{ data: any }>; list(p: any): Promise<{ data: any }>; delete?(p: any): Promise<unknown> };
}

/** Concatenates paragraph textRun content, recursing into table cells. */
export function extractDocText(doc: any): string {
	const walk = (content: any[] | undefined): string =>
		(content ?? [])
			.map((el) => {
				if (el?.paragraph) return (el.paragraph.elements ?? []).map((pe: any) => pe?.textRun?.content ?? '').join('');
				if (el?.table)
					return (el.table.tableRows ?? [])
						.flatMap((row: any) => (row?.tableCells ?? []).map((cell: any) => walk(cell?.content)))
						.join('');
				return '';
			})
			.join('');
	return walk(doc?.body?.content);
}

/** Accepts a Docs URL (/document/d/<id>/...) or a bare id. */
export function parseDocId(input: string): string {
	const id = String(input ?? '').match(/\/document\/d\/([^/?#]+)/)?.[1] ?? String(input ?? '').trim();
	if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
		throw new ConnectorError('validation', `docs.readDoc: invalid document id "${String(input).slice(0, 80)}"`, { status: 400 });
	}
	return id;
}

const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

export function createRealDocs(apis: { docs: DocsApi; drive: DriveApi }, opts: { env?: Env } = {}): DocsPort {
	const env = opts.env ?? {};
	const call = async <T>(method: string, fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (e) {
			throw mapGoogleError(e, `docs.${method}`, env);
		}
	};

	return {
		findByKey: async (key) => {
			// Validated BEFORE interpolation: the key regex (tp1-<16 hex>) cannot contain quotes.
			assertIdempotencyKey('docs', key);
			const { data } = await call('findByKey', () =>
				apis.drive.files.list({
					q: `appProperties has { key='tpKey' and value='${key}' } and trashed = false`,
					orderBy: 'createdTime',
					pageSize: 1,
					fields: 'files(id,name,webViewLink)'
				})
			);
			const file = data?.files?.[0];
			return file ? { id: file.id, title: file.name ?? '', url: file.webViewLink ?? docUrl(file.id), key } : null;
		},

		readDoc: async (docId) => {
			const id = parseDocId(docId);
			const { data } = await call('readDoc', () => apis.docs.documents.get({ documentId: id }));
			const ref: DocRef = { id, title: data?.title ?? '', url: docUrl(id) };
			return { ref, text: extractDocText(data) };
		},

		createDoc: async ({ title, body, key }) => {
			assertIdempotencyKey('docs', key);
			if (typeof title !== 'string' || title.trim() === '') {
				throw new ConnectorError('validation', 'docs.createDoc: title is required', { status: 400 });
			}
			const { data } = await call('createDoc', () =>
				apis.drive.files.create({
					requestBody: { name: title, mimeType: DOC_MIME, appProperties: { tpKey: key, tpApp: 'transferpilot' } },
					fields: 'id,name,webViewLink'
				})
			);
			const id: string = data.id;
			if (body) {
				try {
					await apis.docs.documents.batchUpdate({
						documentId: id,
						requestBody: { requests: [{ insertText: { endOfSegmentLocation: {}, text: body } }] }
					});
				} catch (e) {
					const err = mapGoogleError(e, 'docs.createDoc', env);
					throw new ConnectorError(
						err.kind,
						`${err.message} (doc ${id} was created but body insert failed; findByKey will find it)`,
						{ status: err.status, retryAfterMs: err.retryAfterMs }
					);
				}
			}
			return { id, title: data.name ?? title, url: data.webViewLink ?? docUrl(id), key };
		}
	};
}

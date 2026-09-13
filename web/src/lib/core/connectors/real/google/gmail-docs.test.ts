import { describe, expect, it, vi, type Mock } from 'vitest';
import { buildRawMessage, createRealGmail, draftMarker, type GmailApi } from './gmail.ts';
import { createRealDocs, extractDocText, type DocsApi, type DriveApi } from './docs.ts';
import { GOOGLE_SCOPES, type AuthLike } from './auth.ts';
import { createRealGoogle, probeGoogle, type GoogleApis } from './index.ts';

const KEY = 'tp1-0123456789abcdef';
const ENV = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret-value', GOOGLE_REFRESH_TOKEN: 'refresh-value' };
const err = (status: number) => ({ status, response: { status, headers: {}, data: { error: { code: status, message: 'x' } } } });
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const decodeRaw = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const fullDraft = (id: string, subject: string, body: string, extraHeaders: { name: string; value: string }[] = []) => ({
	id,
	message: {
		payload: {
			mimeType: 'multipart/alternative',
			headers: [{ name: 'to', value: 'Admissions <adm@x.edu>, b@y.edu' }, { name: 'Subject', value: subject }, ...extraHeaders],
			parts: [
				{ mimeType: 'multipart/related', parts: [{ mimeType: 'text/plain', body: { data: b64u(body) } }] },
				{ mimeType: 'text/html', body: { data: b64u('<p>html</p>') } }
			]
		}
	}
});

type DraftMocks = Record<'create' | 'list' | 'get', Mock>;
function fakeGmail(over: Partial<DraftMocks> = {}) {
	const drafts: DraftMocks = {
		create: vi.fn(async () => ({ data: { id: 'd1' } })),
		list: vi.fn(async () => ({ data: { drafts: [] } })),
		get: vi.fn(async () => ({ data: {} })),
		...over
	};
	return { api: { users: { drafts } } as unknown as GmailApi, drafts };
}

const input = { to: ['a@x.edu', 'b@y.edu'], subject: 'Transfer question', body: 'Hello,\nThanks!', key: KEY };

describe('gmail raw message', () => {
	it('draftMarker', () => expect(draftMarker(KEY)).toBe('[tp:tp1-0123456789abcdef]'));
	it('builds CRLF headers with the marker and a base64 body', () => {
		const raw = buildRawMessage(input);
		expect(raw).not.toMatch(/[+/]/);
		const mime = decodeRaw(raw);
		const [head, bodyPart] = mime.split('\r\n\r\n');
		const lines = head.split('\r\n');
		expect(lines).toContain('To: a@x.edu, b@y.edu');
		expect(lines.some((l) => l.startsWith('Cc:'))).toBe(false);
		expect(lines).toContain(`Subject: Transfer question [tp:${KEY}]`);
		expect(lines).toContain('MIME-Version: 1.0');
		expect(lines).toContain('Content-Type: text/plain; charset="UTF-8"');
		expect(lines).toContain('Content-Transfer-Encoding: base64');
		expect(Buffer.from(bodyPart.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(input.body);
	});
	it('adds Cc only when given and RFC 2047-encodes non-ASCII subjects', () => {
		const mime = decodeRaw(buildRawMessage({ ...input, cc: ['c@z.edu'], subject: 'Café question' }));
		expect(mime).toContain('\r\nCc: c@z.edu\r\n');
		expect(mime).toContain('Subject: =?UTF-8?B?');
	});
});

describe('createRealGmail', () => {
	it.each([
		[{ ...input, subject: 'x\nBcc: evil@e.com' }],
		[{ ...input, to: ['not-an-email'] }],
		[{ ...input, key: 'nope' }]
	])('createDraft rejects invalid input without API calls (%#)', async (bad) => {
		const { api, drafts } = fakeGmail();
		await expect(createRealGmail(api).createDraft(bad)).rejects.toMatchObject({ kind: 'validation' });
		expect(drafts.create).not.toHaveBeenCalled();
	});
	it('createDraft calls drafts.create with raw and returns the unmarked subject', async () => {
		const { api, drafts } = fakeGmail();
		const d = await createRealGmail(api).createDraft(input);
		expect(drafts.create).toHaveBeenCalledWith({ userId: 'me', requestBody: { message: { raw: buildRawMessage(input) } } });
		expect(d).toEqual({ id: 'd1', key: KEY, to: input.to, subject: 'Transfer question', body: input.body });
	});
	it('findByKey searches with q containing the key and strips the marker', async () => {
		const { api, drafts } = fakeGmail({
			list: vi.fn(async () => ({ data: { drafts: [{ id: 'd7' }] } })),
			get: vi.fn(async () => ({ data: fullDraft('d7', `Hi [tp:${KEY}]`, 'body text') }))
		});
		const d = await createRealGmail(api).findByKey(KEY);
		expect(drafts.list.mock.calls[0][0].q).toContain(KEY);
		expect(drafts.get.mock.calls[0][0]).toMatchObject({ id: 'd7', format: 'full' });
		expect(d).toEqual({ id: 'd7', key: KEY, to: ['adm@x.edu', 'b@y.edu'], subject: 'Hi', body: 'body text' });
	});
	it('findByKey falls back to scanning recent drafts, else null', async () => {
		const list = vi
			.fn()
			.mockResolvedValueOnce({ data: { drafts: [] } })
			.mockResolvedValueOnce({ data: { drafts: [{ id: 'a' }, { id: 'b' }] } });
		const get = vi.fn(async ({ id }: { id: string }) => ({
			data: id === 'b' ? fullDraft('b', `=?UTF-8?B?${Buffer.from(`Café [tp:${KEY}]`).toString('base64')}?=`, 'x') : fullDraft('a', 'other', 'y')
		}));
		const { api } = fakeGmail({ list, get });
		expect(await createRealGmail(api).findByKey(KEY)).toMatchObject({ id: 'b', subject: 'Café' });
		const empty = fakeGmail();
		expect(await createRealGmail(empty.api).findByKey(KEY)).toBeNull();
		expect(empty.drafts.list).toHaveBeenCalledTimes(2);
	});
	it('listDrafts returns only marked drafts with parsed keys', async () => {
		const { api } = fakeGmail({
			list: vi.fn(async () => ({ data: { drafts: [{ id: 'a' }, { id: 'b' }] } })),
			get: vi.fn(async ({ id }: { id: string }) => ({
				data: id === 'a' ? fullDraft('a', `S [tp:${KEY}]`, 'x', [{ name: 'Cc', value: 'c@z.edu' }]) : fullDraft('b', 'personal', 'y')
			}))
		});
		expect(await createRealGmail(api).listDrafts()).toEqual([
			{ id: 'a', key: KEY, to: ['adm@x.edu', 'b@y.edu'], cc: ['c@z.edu'], subject: 'S', body: 'x' }
		]);
	});
	it('searchInbox rejects not_configured (gmail.readonly not requested) and there is no send', async () => {
		const gmail = createRealGmail(fakeGmail().api);
		await expect(gmail.searchInbox('x')).rejects.toMatchObject({ kind: 'not_configured', message: expect.stringContaining('gmail.readonly') });
		expect('send' in gmail).toBe(false);
	});
	it('maps API errors', async () => {
		const { api } = fakeGmail({
			create: vi.fn(async () => {
				throw err(429);
			})
		});
		await expect(createRealGmail(api).createDraft(input)).rejects.toMatchObject({ kind: 'rate_limit' });
	});
});

type DocMocks = { get: Mock; batchUpdate: Mock; create: Mock; list: Mock };
function fakeDocs(over: Partial<DocMocks> = {}) {
	const m: DocMocks = {
		get: vi.fn(async () => ({ data: { title: 'Essay', body: { content: [] } } })),
		batchUpdate: vi.fn(async () => ({ data: {} })),
		create: vi.fn(async () => ({ data: { id: 'doc-1234567890', name: 'Critique', webViewLink: 'https://docs/1' } })),
		list: vi.fn(async () => ({ data: { files: [] } })),
		...over
	};
	const apis = {
		docs: { documents: { get: m.get, batchUpdate: m.batchUpdate } } as unknown as DocsApi,
		drive: { files: { create: m.create, list: m.list } } as unknown as DriveApi
	};
	return { apis, m };
}

describe('createRealDocs', () => {
	it('createDoc creates via Drive with appProperties then inserts the body', async () => {
		const { apis, m } = fakeDocs();
		const ref = await createRealDocs(apis).createDoc({ title: 'Critique', body: 'Notes', key: KEY });
		expect(m.create).toHaveBeenCalledWith({
			requestBody: { name: 'Critique', mimeType: 'application/vnd.google-apps.document', appProperties: { tpKey: KEY, tpApp: 'transferpilot' } },
			fields: 'id,name,webViewLink'
		});
		expect(m.batchUpdate).toHaveBeenCalledWith({
			documentId: 'doc-1234567890',
			requestBody: { requests: [{ insertText: { endOfSegmentLocation: {}, text: 'Notes' } }] }
		});
		expect(ref).toEqual({ id: 'doc-1234567890', title: 'Critique', url: 'https://docs/1', key: KEY });
	});
	it('empty body skips batchUpdate', async () => {
		const { apis, m } = fakeDocs();
		await createRealDocs(apis).createDoc({ title: 'Critique', body: '', key: KEY });
		expect(m.batchUpdate).not.toHaveBeenCalled();
	});
	it('batchUpdate failure rejects with body insert failed', async () => {
		const { apis } = fakeDocs({
			batchUpdate: vi.fn(async () => {
				throw err(500);
			})
		});
		await expect(createRealDocs(apis).createDoc({ title: 'C', body: 'x', key: KEY })).rejects.toMatchObject({
			kind: 'server',
			message: expect.stringContaining('body insert failed')
		});
	});
	it('findByKey queries appProperties exactly and returns the first or null', async () => {
		const { apis, m } = fakeDocs({ list: vi.fn(async () => ({ data: { files: [{ id: 'f1', name: 'Critique', webViewLink: 'L' }] } })) });
		expect(await createRealDocs(apis).findByKey(KEY)).toEqual({ id: 'f1', title: 'Critique', url: 'L', key: KEY });
		expect(m.list.mock.calls[0][0]).toMatchObject({
			q: "appProperties has { key='tpKey' and value='tp1-0123456789abcdef' } and trashed = false",
			orderBy: 'createdTime'
		});
		expect(await createRealDocs(fakeDocs().apis).findByKey(KEY)).toBeNull();
	});
	it('findByKey rejects a key that could break the query, without API calls', async () => {
		const { apis, m } = fakeDocs();
		await expect(createRealDocs(apis).findByKey("tp1-' or '1'='1")).rejects.toMatchObject({ kind: 'validation' });
		expect(m.list).not.toHaveBeenCalled();
	});
	it('readDoc parses a URL id and extracts paragraph + table text', async () => {
		const doc = {
			title: 'Essay',
			body: {
				content: [
					{ paragraph: { elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'world\n' } }] } },
					{ table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'cell\n' } }] } }] }] }] } },
					{ sectionBreak: {} }
				]
			}
		};
		const { apis, m } = fakeDocs({ get: vi.fn(async () => ({ data: doc })) });
		const r = await createRealDocs(apis).readDoc('https://docs.google.com/document/d/AbC_123-xyzLONGID/edit');
		expect(m.get).toHaveBeenCalledWith({ documentId: 'AbC_123-xyzLONGID' });
		expect(r.text).toBe('Hello world\ncell\n');
		expect(r.ref).toMatchObject({ id: 'AbC_123-xyzLONGID', title: 'Essay' });
		expect(extractDocText({})).toBe('');
	});
	it('readDoc maps 404/403 and rejects quoted ids without API calls', async () => {
		for (const [status, kind] of [
			[404, 'not_found'],
			[403, 'auth']
		] as const) {
			const { apis } = fakeDocs({
				get: vi.fn(async () => {
					throw err(status);
				})
			});
			await expect(createRealDocs(apis).readDoc('AbC_123-xyzLONGID')).rejects.toMatchObject({ kind });
		}
		const { apis, m } = fakeDocs();
		await expect(createRealDocs(apis).readDoc("abc'defghijkl")).rejects.toMatchObject({ kind: 'validation' });
		expect(m.get).not.toHaveBeenCalled();
	});
});

describe('createRealGoogle / probeGoogle with all apps', () => {
	const build = () => {
		const cal = { events: { get: vi.fn(async () => Promise.reject(err(404))), list: vi.fn(async () => ({ data: { items: [] } })) } };
		const g = fakeGmail();
		const d = fakeDocs();
		const apis: GoogleApis = { auth: {}, calendar: cal, gmail: g.api, docs: d.apis.docs, drive: d.apis.drive };
		return { apis, cal, g, d };
	};
	it('all three ports are real with injected fakes', async () => {
		const { apis, cal, g, d } = build();
		const ports = createRealGoogle(ENV, { apis, implemented: { calendar: true, gmail: true, docs: true } });
		expect(await ports.calendar.findByKey(KEY)).toBeNull();
		expect(await ports.gmail.findByKey(KEY)).toBeNull();
		expect(await ports.docs.findByKey(KEY)).toBeNull();
		expect(cal.events.get).toHaveBeenCalled();
		expect(g.drafts.list).toHaveBeenCalled();
		expect(d.m.list).toHaveBeenCalled();
		expect('send' in ports.gmail).toBe(false);
	});
	it('probeGoogle runs one cheap read per app', async () => {
		const { apis, cal, g, d } = build();
		const auth: AuthLike = { getAccessToken: async () => ({ token: 't' }), getTokenInfo: async () => ({ scopes: [...GOOGLE_SCOPES] }) };
		const r = await probeGoogle(ENV, { apis, auth, implemented: { calendar: true, gmail: true, docs: true } });
		expect(r.map((x) => [x.app, x.ok])).toEqual([
			['calendar', true],
			['gmail', true],
			['docs', true]
		]);
		expect(cal.events.list).toHaveBeenCalledTimes(1);
		expect(g.drafts.list).toHaveBeenCalledWith({ userId: 'me', maxResults: 1 });
		expect(d.m.list.mock.calls[0][0].q).toBe("appProperties has { key='tpApp' and value='transferpilot' }");
		expect(JSON.stringify(r)).not.toContain('refresh-value');
	});
});

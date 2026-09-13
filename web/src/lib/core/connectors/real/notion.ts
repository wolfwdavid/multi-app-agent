// Real Notion tracker connector on the 2025-09-03 data-sources API. Rows are upserted by the
// `TP Key` rich_text property, every call is serialized >= 350ms apart (Notion allows ~3 req/s),
// and SDK errors map to typed ConnectorErrors with secrets redacted.
import { Client, isFullPage } from '@notionhq/client';
import { ConnectorError } from '../types.ts';
import type { NotionPort, TrackerRow } from '../types.ts';
import { assertIdempotencyKey } from '../mock/validate.ts';
import { createPacer } from './http.ts';
import { fromNotionPage, normalizeNotionId, toNotionProperties, validateTrackerSchema } from './notion-schema.ts';
import { missingEnv, notConfiguredPort, redactSecrets, type Env, type ProbeResult, type RealDeps } from './shared.ts';

export const NOTION_ENV = ['NOTION_TOKEN', 'NOTION_DATA_SOURCE_ID'] as const;
export const NOTION_METHODS = ['findByKey', 'upsertTrackerRow', 'listTrackerRows'] as const;
export const NOTION_IMPLEMENTED: boolean = true;

export const NOTION_VERSION = '2025-09-03';
const DEFAULT_RATE_LIMIT_MS = 1000;
const MAX_LIST_PAGES = 20;

export type NotionClientLike = {
	dataSources: Pick<Client['dataSources'], 'query' | 'retrieve' | 'update'>;
	pages: Pick<Client['pages'], 'create' | 'update' | 'retrieve'>;
	databases: Pick<Client['databases'], 'retrieve'>;
};

export type NotionDeps = RealDeps & { client?: NotionClientLike };

export function createNotionClient(env: Env, deps: RealDeps = {}): Client {
	// Retries are disabled: a retried create after a ghost write would duplicate rows. The Phase 4
	// executor retries instead, with a findByKey re-check before every write attempt.
	return new Client({
		auth: env.NOTION_TOKEN,
		notionVersion: NOTION_VERSION,
		timeoutMs: deps.timeoutMs ?? 15000,
		retry: false,
		...(deps.fetch ? { fetch: deps.fetch as never } : {})
	});
}

function headerValue(headers: unknown, name: string): string | undefined {
	if (!headers) return undefined;
	if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
	const record = headers as Record<string, unknown>;
	const hit = Object.keys(record).find((k) => k.toLowerCase() === name);
	return hit === undefined ? undefined : String(record[hit]);
}

export function mapNotionError(e: unknown, context: string, env: Env): ConnectorError {
	if (e instanceof ConnectorError) return e;
	const err = (e ?? {}) as { code?: unknown; status?: unknown; headers?: unknown; message?: unknown; name?: unknown };
	const code = typeof err.code === 'string' ? err.code : undefined;
	const status = typeof err.status === 'number' ? err.status : undefined;
	const raw = typeof err.message === 'string' && err.message ? err.message : String(code ?? e);
	const msg = (text: string) => redactSecrets(text, env);
	const base = msg(`${context}: ${raw}`);

	if (code === 'rate_limited' || status === 429) {
		const seconds = Number(headerValue(err.headers, 'retry-after'));
		const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_MS;
		return new ConnectorError('rate_limit', base, { status: status ?? 429, retryAfterMs });
	}
	if (code === 'object_not_found' || status === 404) {
		return new ConnectorError(
			'not_found',
			msg(
				`${context}: Notion data source not found or not shared with the integration (open the database > ... > Connections > add your integration; NOTION_DATA_SOURCE_ID must be a data source id: run npx tsx scripts/notion-setup.ts)`
			),
			{ status: status ?? 404 }
		);
	}
	if (code === 'unauthorized' || code === 'restricted_resource' || status === 401 || status === 403) {
		return new ConnectorError('auth', base, { status: status ?? (code === 'unauthorized' ? 401 : 403) });
	}
	if (code === 'notionhq_client_request_timeout' || err.name === 'TimeoutError' || err.name === 'AbortError') {
		return new ConnectorError('timeout', base);
	}
	if (code === 'validation_error' || code === 'invalid_json' || code === 'invalid_request_url' || code === 'invalid_request') {
		return new ConnectorError('validation', base, { status: status ?? 400 });
	}
	if (status !== undefined && status >= 500) return new ConnectorError('server', base, { status });
	if (status !== undefined && status >= 400) return new ConnectorError('validation', base, { status });
	return new ConnectorError('server', base, status === undefined ? undefined : { status });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageLike = any;

export function createRealNotion(env: Env, deps: NotionDeps = {}): NotionPort {
	const missing = missingEnv(env, NOTION_ENV);
	if (missing.length) {
		return notConfiguredPort<NotionPort>(
			'notion',
			NOTION_METHODS,
			`real connector not configured (missing env: ${missing.join(', ')})`
		);
	}
	const dsId = normalizeNotionId(env.NOTION_DATA_SOURCE_ID!);
	if (!dsId) return notConfiguredPort<NotionPort>('notion', NOTION_METHODS, 'NOTION_DATA_SOURCE_ID is not a valid Notion id');

	const client: NotionClientLike = deps.client ?? createNotionClient(env, deps);
	const pace = createPacer(350, deps); // Notion allows ~3 requests/s per integration
	const call = <T>(ctx: string, fn: () => Promise<T>): Promise<T> =>
		pace(fn).catch((e: unknown) => {
			throw mapNotionError(e, ctx, env);
		});

	const toRow = async (resp: PageLike, ctx: string): Promise<TrackerRow> => {
		const full = isFullPage(resp)
			? resp
			: await call(ctx, () => client.pages.retrieve({ page_id: resp.id }));
		if (!isFullPage(full as PageLike)) {
			throw new ConnectorError('server', `${ctx}: Notion returned a partial page without properties`);
		}
		return fromNotionPage(full as PageLike);
	};

	const findByKey = async (key: string): Promise<TrackerRow | null> => {
		assertIdempotencyKey('notion', key);
		const resp = await call('notion.findByKey', () =>
			client.dataSources.query({
				data_source_id: dsId,
				filter: { property: 'TP Key', rich_text: { equals: key } },
				sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
				page_size: 10
			})
		);
		const pages = (resp.results as PageLike[]).filter((r) => isFullPage(r));
		return pages.length ? fromNotionPage(pages[0]) : null;
	};

	return {
		findByKey,

		upsertTrackerRow: async (input) => {
			// Throws 'validation' before any client call.
			const properties = toNotionProperties(input) as never;
			const existing = await findByKey(input.key);
			if (existing) {
				const resp = await call('notion.upsertTrackerRow(update)', () =>
					client.pages.update({ page_id: existing.id, properties })
				);
				return toRow(resp, 'notion.upsertTrackerRow(update)');
			}
			const resp = await call('notion.upsertTrackerRow(create)', () =>
				client.pages.create({ parent: { type: 'data_source_id', data_source_id: dsId }, properties })
			);
			return toRow(resp, 'notion.upsertTrackerRow(create)');
		},

		listTrackerRows: async () => {
			const rows: TrackerRow[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < MAX_LIST_PAGES; page++) {
				const resp = await call('notion.listTrackerRows', () =>
					client.dataSources.query({
						data_source_id: dsId,
						filter: { property: 'TP Key', rich_text: { is_not_empty: true } },
						sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
						page_size: 100,
						...(cursor ? { start_cursor: cursor } : {})
					})
				);
				for (const r of resp.results as PageLike[]) if (isFullPage(r)) rows.push(fromNotionPage(r));
				if (!resp.has_more || !resp.next_cursor) break;
				cursor = resp.next_cursor;
			}
			return rows;
		}
	};
}

export async function probeNotion(env: Env, deps: NotionDeps = {}): Promise<ProbeResult> {
	const missing = missingEnv(env, NOTION_ENV);
	const base = { app: 'notion' as const, configured: missing.length === 0, implemented: NOTION_IMPLEMENTED };
	if (missing.length) return { ...base, ok: null, detail: `missing env: ${missing.join(', ')}` };

	const now = deps.now ?? Date.now;
	const started = now();
	const dsId = normalizeNotionId(env.NOTION_DATA_SOURCE_ID!);
	if (!dsId) {
		return {
			...base,
			ok: false,
			kind: 'not_configured',
			detail: 'NOTION_DATA_SOURCE_ID is not a valid Notion id (run npx tsx scripts/notion-setup.ts)'
		};
	}
	try {
		const client: NotionClientLike = deps.client ?? createNotionClient(env, deps);
		const resp = (await client.dataSources.retrieve({ data_source_id: dsId })) as { properties?: Record<string, { type: string }> };
		const latencyMs = Math.max(0, now() - started);
		const properties = resp.properties ?? {};
		const issues = validateTrackerSchema(properties);
		if (issues.length === 0) {
			return { ...base, ok: true, detail: `schema ok (${Object.keys(properties).length} properties)`, latencyMs };
		}
		return {
			...base,
			ok: false,
			kind: 'validation',
			detail: `schema issues: ${issues.map((i) => `${i.property} ${i.problem}`).join(', ')} (fix: npx tsx scripts/notion-setup.ts --apply)`,
			latencyMs
		};
	} catch (e) {
		const mapped = mapNotionError(e, 'notion.probe', env);
		const hint = mapped.kind === 'not_found' && !mapped.message.includes('scripts/notion-setup.ts')
			? ' (run npx tsx scripts/notion-setup.ts)'
			: '';
		return {
			...base,
			ok: false,
			kind: mapped.kind,
			detail: redactSecrets(`${mapped.message}${hint}`, env),
			latencyMs: Math.max(0, now() - started)
		};
	}
}

// Real Google CalendarPort (all-day events only). No SDK import: takes a structural CalendarApi so
// tests inject fakes.
//
// Idempotency: the event id is DETERMINISTIC, base32hex(sha256(key)), and supplied by the client on
// insert. A retry after a ghost write (Google stored the event but the response was lost) gets 409
// instead of creating a duplicate. The event is also tagged with extendedProperties.private
// { tpKey, tpApp }, so findByKey is an O(1) get by id plus a tag check, not a search.
// Privacy: listEvents is scoped to tpApp=transferpilot, so the agent never reads the user's other events.
//
// The mock twin uses key.replace('-', '') as its id. Both are valid base32hex; ids are internal and
// callers always address events by key.
import { createHash } from 'node:crypto';
import { ConnectorError, type CalEvent, type CalendarPort } from '../../types.ts';
import { addDaysIso, assertAllDayDate, assertIdempotencyKey } from '../../mock/validate.ts';
import type { Env } from '../shared.ts';
import { mapGoogleError } from './auth.ts';

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';
const MAX_PAGES = 20;

/** RFC 4648 base32hex, lowercase, no padding. */
export function base32hex(bytes: Uint8Array): string {
	let out = '';
	let value = 0;
	let bits = 0;
	for (const byte of bytes) {
		value = ((value << 8) | byte) & 0xffff;
		bits += 8;
		while (bits >= 5) {
			out += BASE32HEX[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
	return out;
}

/** 52 chars of [0-9a-v]: a valid Google event id (5-1024 chars of base32hex). */
export function eventIdForKey(key: string): string {
	return base32hex(createHash('sha256').update(key, 'utf8').digest());
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CalendarApi {
	events: {
		insert(p: any): Promise<{ data: any }>;
		get(p: any): Promise<{ data: any }>;
		list(p: any): Promise<{ data: any }>;
		update(p: any): Promise<{ data: any }>;
		delete?(p: any): Promise<unknown>;
	};
}

interface GEvent {
	id?: string;
	status?: string;
	summary?: string;
	description?: string | null;
	htmlLink?: string;
	start?: { date?: string };
	extendedProperties?: { private?: Record<string, string> };
}

function toCalEvent(data: GEvent, key: string): CalEvent {
	return {
		id: data.id ?? '',
		key,
		title: data.summary ?? '',
		date: data.start?.date ?? '',
		...(data.description != null ? { description: data.description } : {}),
		...(data.htmlLink ? { url: data.htmlLink } : {})
	};
}

export function createRealCalendar(api: CalendarApi, opts: { calendarId?: string; env?: Env } = {}): CalendarPort {
	const calendarId = opts.calendarId || 'primary';
	const env = opts.env ?? {};
	const call = async <T>(method: string, fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (e) {
			throw mapGoogleError(e, `calendar.${method}`, env);
		}
	};

	return {
		findByKey: async (key) => {
			const eventId = eventIdForKey(key);
			let data: GEvent;
			try {
				data = (await api.events.get({ calendarId, eventId })).data ?? {};
			} catch (e) {
				const err = mapGoogleError(e, 'calendar.findByKey', env);
				if (err.kind === 'not_found') return null;
				throw err;
			}
			if (data.status === 'cancelled') return null;
			if (data.extendedProperties?.private?.tpKey !== key) {
				throw new ConnectorError(
					'validation',
					`calendar.findByKey: id collision: event ${eventId} exists but is not tagged with this key`
				);
			}
			return toCalEvent(data, key);
		},

		createEvent: async ({ title, date, description, key }) => {
			assertIdempotencyKey('calendar', key);
			if (typeof title !== 'string' || title.trim() === '') {
				throw new ConnectorError('validation', 'calendar.createEvent: Missing summary', { status: 400 });
			}
			assertAllDayDate('start.date', date);
			const eventId = eventIdForKey(key);
			const requestBody = {
				id: eventId,
				summary: title,
				...(description !== undefined ? { description } : {}),
				start: { date },
				// Google all-day events use an EXCLUSIVE end date.
				end: { date: addDaysIso(date, 1) },
				extendedProperties: { private: { tpKey: key, tpApp: 'transferpilot' } },
				transparency: 'transparent'
			};
			try {
				const { data } = await api.events.insert({ calendarId, requestBody });
				return toCalEvent({ ...requestBody, ...(data ?? {}) }, key);
			} catch (e) {
				const err = mapGoogleError(e, 'calendar.createEvent', env);
				if (err.status !== 409) throw err;
				// The id exists. A deleted event keeps its id as 'cancelled': restore it instead of failing.
				const existing = (await call('createEvent', () => api.events.get({ calendarId, eventId }))).data as GEvent;
				if (existing?.status === 'cancelled') {
					const { data } = await call('createEvent', () =>
						api.events.update({ calendarId, eventId, requestBody: { ...requestBody, status: 'confirmed' } })
					);
					return toCalEvent({ ...requestBody, ...(data ?? {}) }, key);
				}
				throw new ConnectorError('validation', 'calendar.createEvent: The requested identifier already exists.', {
					status: 409
				});
			}
		},

		// `from` inclusive, `to` exclusive (mock parity). All-day dates float with the calendar's
		// timezone, so the UTC query window is widened by a day each side and filtered exactly here.
		listEvents: async ({ from, to }) => {
			assertAllDayDate('start.date', from);
			assertAllDayDate('end.date', to);
			const hits: CalEvent[] = [];
			let pageToken: string | undefined;
			for (let page = 0; page < MAX_PAGES; page++) {
				const { data } = await call('listEvents', () =>
					api.events.list({
						calendarId,
						privateExtendedProperty: ['tpApp=transferpilot'],
						singleEvents: true,
						timeMin: `${addDaysIso(from, -1)}T00:00:00Z`,
						timeMax: `${addDaysIso(to, 1)}T00:00:00Z`,
						maxResults: 250,
						...(pageToken ? { pageToken } : {})
					})
				);
				for (const item of (data?.items ?? []) as GEvent[]) {
					const key = item.extendedProperties?.private?.tpKey;
					const date = item.start?.date;
					if (item.status === 'cancelled' || typeof key !== 'string' || !date) continue;
					if (from <= date && date < to) hits.push(toCalEvent(item, key));
				}
				pageToken = data?.nextPageToken || undefined;
				if (!pageToken) break;
			}
			return hits.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
		}
	};
}

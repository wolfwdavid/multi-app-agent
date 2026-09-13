// Stateful Google Calendar twin (all-day events only).
import { ConnectorError } from '../types.ts';
import type { CalendarPort } from '../types.ts';
import type { MockCalEvent, World } from './world.ts';
import { addDaysIso, assertAllDayDate, assertIdempotencyKey } from './validate.ts';

/**
 * The real connector derives the event id from the idempotency key ('tp1' + 16 hex chars is valid
 * Google base32hex [a-v0-9]), which is why a duplicate insert gets 409 from Google.
 */
function eventIdForKey(key: string): string {
	return key.replace(/-/g, '');
}

export function createMockCalendar(world: World): CalendarPort {
	return {
		findByKey: async (key) => {
			const ev = world.state.calendar.events.find((e) => e.key === key);
			return ev ? structuredClone(ev) : null;
		},

		createEvent: async ({ title, date, description, key }) => {
			assertIdempotencyKey('calendar', key);
			if (title.length === 0) {
				throw new ConnectorError('validation', 'Missing summary', { status: 400 });
			}
			assertAllDayDate('start.date', date);
			const id = eventIdForKey(key);
			const events = world.state.calendar.events;
			if (events.some((e) => e.id === id)) {
				throw new ConnectorError('validation', 'The requested identifier already exists.', { status: 409 });
			}
			const ev: MockCalEvent = {
				id,
				key,
				title,
				date,
				...(description !== undefined ? { description } : {}),
				url: `mock://calendar/${id}`,
				start: { date },
				// Google all-day events use an EXCLUSIVE end date.
				end: { date: addDaysIso(date, 1) }
			};
			events.push(ev);
			return structuredClone(ev);
		},

		// `from` is inclusive and `to` is exclusive, like Google's timeMin/timeMax.
		listEvents: async ({ from, to }) => {
			assertAllDayDate('start.date', from);
			assertAllDayDate('start.date', to);
			const hits = world.state.calendar.events
				.filter((e) => from <= e.date && e.date < to)
				.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
			return structuredClone(hits);
		}
	};
}

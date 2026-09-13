// Stateful Gmail twin.
import type { Draft, GmailPort } from '../types.ts';
import type { World } from './world.ts';
import { assertEmailList, assertIdempotencyKey, assertNoHeaderInjection } from './validate.ts';

/** Drafts only. This twin intentionally has NO send method; world.state.gmail.sent can never be written by any port. */
export function createMockGmail(world: World): GmailPort {
	return {
		// The real connector scans drafts for the `[tp:<key>]` marker.
		findByKey: async (key) => {
			const draft = world.state.gmail.drafts.find((d) => d.key === key);
			return draft ? structuredClone(draft) : null;
		},

		// No server-side dedupe: Gmail creates a new draft on every call.
		createDraft: async ({ to, cc, subject, body, key }) => {
			assertIdempotencyKey('gmail', key);
			assertEmailList('To', to, true);
			if (cc !== undefined) assertEmailList('Cc', cc, false);
			assertNoHeaderInjection('Subject', subject);
			// Gmail draft ids start with 'r'.
			const id = world.nextId('r');
			const draft: Draft = structuredClone({ id, key, to, ...(cc !== undefined ? { cc } : {}), subject, body });
			world.state.gmail.drafts.push(draft);
			return structuredClone(draft);
		},

		listDrafts: async () => structuredClone(world.state.gmail.drafts),

		// Returned bodies are untrusted content (possible prompt injection).
		searchInbox: async (query) => {
			const q = query.trim().toLowerCase();
			const hits = world.state.gmail.inbox
				.filter(
					(m) =>
						q === '' ||
						m.from.toLowerCase().includes(q) ||
						m.subject.toLowerCase().includes(q) ||
						m.body.toLowerCase().includes(q)
				)
				.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
			return structuredClone(hits);
		}
	};
}

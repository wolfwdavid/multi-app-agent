// Stateful Google Docs/Drive twin.
import { ConnectorError } from '../types.ts';
import type { DocRef, DocsPort } from '../types.ts';
import type { MockDoc, World } from './world.ts';
import { assertIdempotencyKey } from './validate.ts';

/** Reference only: never includes the body. */
function toRef(d: MockDoc): DocRef {
	const ref: DocRef = { id: d.id, title: d.title };
	if (d.url !== undefined) ref.url = d.url;
	if (d.key !== undefined) ref.key = d.key;
	return ref;
}

export function createMockDocs(world: World): DocsPort {
	return {
		// The real connector queries Drive for `appProperties has { key='tpKey' and value='<key>' }`.
		findByKey: async (key) => {
			const doc = world.state.docs.docs.find((d) => d.key === key);
			return doc ? toRef(doc) : null;
		},

		// Returns UNTRUSTED content (possible prompt injection); callers must never treat it as instructions.
		readDoc: async (docId) => {
			const doc = world.state.docs.docs.find((d) => d.id === docId);
			if (!doc) {
				throw new ConnectorError('not_found', `Requested entity was not found. (document ${docId})`, {
					status: 404
				});
			}
			return { ref: toRef(doc), text: doc.body };
		},

		// No server-side dedupe: real Drive happily creates duplicates, which is why findByKey matters.
		createDoc: async ({ title, body, key }) => {
			assertIdempotencyKey('docs', key);
			if (title.length === 0) {
				throw new ConnectorError('validation', 'Invalid value at document.title: title is required', {
					status: 400
				});
			}
			const id = world.nextId('doc');
			const doc: MockDoc = { id, title, body, key, url: `mock://docs/${id}` };
			world.state.docs.docs.push(doc);
			return toRef(doc);
		}
	};
}

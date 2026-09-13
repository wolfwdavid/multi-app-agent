// SDK-free Google constants. This file must import NOTHING: ../index.ts imports it statically for
// status checks and lazy wrappers, and Node ESM runs a module's whole top level on any static
// import. The SDK-bearing ./index.ts is only ever loaded via dynamic import(). Plan 10-03 flips
// the per-app implemented booleans below.

export type GoogleApp = 'gmail' | 'calendar' | 'docs';

export const GOOGLE_IMPLEMENTED: Readonly<Record<GoogleApp, boolean>> = {
	gmail: false,
	calendar: true,
	docs: false
};

export const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;

/** Gmail is drafts only: there is intentionally no send method. */
export const GOOGLE_METHODS = {
	gmail: ['findByKey', 'createDraft', 'listDrafts', 'searchInbox'],
	calendar: ['findByKey', 'createEvent', 'listEvents'],
	docs: ['findByKey', 'readDoc', 'createDoc']
} as const;

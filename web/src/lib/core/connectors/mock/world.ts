// Per-run seeded mock World. Every piece of mutable state lives inside the object returned by
// createWorld(); nothing is stored at module level, so parallel eval runs and concurrent
// server requests can never contaminate each other.
import type {
	CalEvent,
	Draft,
	HFItem,
	MessageSummary,
	RepoSummary,
	TrackerRow
} from '../types.ts';
import { addDaysIso, isIsoDate } from './validate.ts';

export const DEFAULT_CLOCK = '2026-09-13T17:00:00.000Z';

/** Stored calendar event. `end.date` is EXCLUSIVE (Google all-day semantics: date + 1 day). */
export type MockCalEvent = CalEvent & { start: { date: string }; end: { date: string } };

export type MockDoc = { id: string; title: string; body: string; key?: string; url?: string };

export interface WorldState {
	meta: { clock: string; counters: Record<string, number> };
	notion: { rows: TrackerRow[] };
	calendar: { events: MockCalEvent[] };
	/** `sent` has no writer: no port can send mail. The oracle asserts it stays []. */
	gmail: { drafts: Draft[]; inbox: MessageSummary[]; sent: MessageSummary[] };
	docs: { docs: MockDoc[] };
	/** Keyed by lowercase username (GitHub usernames are case-insensitive). */
	github: { repos: Record<string, RepoSummary[]> };
	/** Keyed by author as given. */
	hf: { items: Record<string, HFItem[]> };
}

export interface WorldSeed {
	clock?: string;
	notion?: { rows?: TrackerRow[] };
	calendar?: { events?: CalEvent[] };
	gmail?: { drafts?: Draft[]; inbox?: MessageSummary[] };
	docs?: { docs?: MockDoc[] };
	github?: { repos?: Record<string, RepoSummary[]> };
	hf?: { items?: Record<string, HFItem[]> };
}

export type CollectionName =
	| 'notion.rows'
	| 'calendar.events'
	| 'gmail.drafts'
	| 'gmail.inbox'
	| 'gmail.sent'
	| 'docs.docs';

export const COLLECTIONS: readonly CollectionName[] = [
	'notion.rows',
	'calendar.events',
	'gmail.drafts',
	'gmail.inbox',
	'gmail.sent',
	'docs.docs'
];

export interface CollectionDiff {
	added: string[];
	removed: string[];
	changed: string[];
}

export type WorldDiff = Record<CollectionName, CollectionDiff>;

export interface World {
	/** Live state. Mutate only through ports; tests and the oracle may read it. */
	readonly state: WorldState;
	/** Deep, JSON-serializable copy of the current state. */
	snapshot(): WorldState;
	/** Replaces each top-level key of state with a clone of the snapshot; keeps root identity. */
	restore(snapshot: WorldState): void;
	/** Restores the state built from the seed at creation (including counters). */
	reset(): void;
	/** `after` defaults to the current state. */
	diff(before: WorldState, after?: WorldState): WorldDiff;
	/** `${prefix}-${nnnn}` from a per-world counter stored in state.meta.counters. */
	nextId(prefix: string): string;
	/** Deterministic clock: state.meta.clock. */
	now(): string;
}

export function createWorld(seed: WorldSeed = {}): World {
	const s = structuredClone(seed);

	const repos: Record<string, RepoSummary[]> = {};
	for (const [user, list] of Object.entries(s.github?.repos ?? {})) {
		repos[user.toLowerCase()] = [...(repos[user.toLowerCase()] ?? []), ...list];
	}

	const events: MockCalEvent[] = (s.calendar?.events ?? []).map((e) => {
		if (!isIsoDate(e.date)) {
			throw new Error(`Invalid seed calendar event ${e.id}: date "${e.date}"`);
		}
		return { ...e, start: { date: e.date }, end: { date: addDaysIso(e.date, 1) } };
	});

	const state: WorldState = {
		meta: { clock: s.clock ?? DEFAULT_CLOCK, counters: {} },
		notion: { rows: s.notion?.rows ?? [] },
		calendar: { events },
		gmail: { drafts: s.gmail?.drafts ?? [], inbox: s.gmail?.inbox ?? [], sent: [] },
		docs: { docs: s.docs?.docs ?? [] },
		github: { repos },
		hf: { items: s.hf?.items ?? {} }
	};
	const initial = structuredClone(state);

	const restore = (snapshot: WorldState): void => {
		const copy = structuredClone(snapshot);
		const target = state as unknown as Record<string, unknown>;
		for (const key of Object.keys(target)) {
			if (!(key in copy)) delete target[key];
		}
		Object.assign(state, copy);
	};

	return {
		state,
		snapshot: () => structuredClone(state),
		restore,
		reset: () => restore(initial),
		diff: (before, after) => diffWorldStates(before, after ?? structuredClone(state)),
		nextId: (prefix) => {
			const n = (state.meta.counters[prefix] ?? 0) + 1;
			state.meta.counters[prefix] = n;
			return `${prefix}-${String(n).padStart(4, '0')}`;
		},
		now: () => state.meta.clock
	};
}

function collection(state: WorldState, name: CollectionName): Array<{ id: string }> {
	const [app, coll] = name.split('.') as [keyof WorldState, string];
	const bucket = state[app] as unknown as Record<string, Array<{ id: string }> | undefined>;
	return bucket?.[coll] ?? [];
}

export function diffWorldStates(before: WorldState, after: WorldState): WorldDiff {
	const out = {} as WorldDiff;
	for (const name of COLLECTIONS) {
		const b = new Map(collection(before, name).map((item) => [item.id, item]));
		const a = new Map(collection(after, name).map((item) => [item.id, item]));
		const added: string[] = [];
		const removed: string[] = [];
		const changed: string[] = [];
		for (const [id, item] of a) {
			if (!b.has(id)) added.push(id);
			else if (JSON.stringify(b.get(id)) !== JSON.stringify(item)) changed.push(id);
		}
		for (const id of b.keys()) if (!a.has(id)) removed.push(id);
		out[name] = { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
	}
	return out;
}

export function isEmptyDiff(d: WorldDiff): boolean {
	return COLLECTIONS.every(
		(name) => d[name].added.length === 0 && d[name].removed.length === 0 && d[name].changed.length === 0
	);
}

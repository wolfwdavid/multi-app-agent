// Per-app connector ports. Mock twins and real connectors implement the same interfaces.
// Every write port exposes findByKey(key) so the executor can dedupe by idempotency key.
import type { ConnectorErrorKind } from '../schemas.ts';

// ---------- Data types ----------

export interface TrackerRowInput {
	schoolId: string;
	programId: string;
	title: string;
	/** YYYY-MM-DD */
	deadline: string;
	requiredDocs: string[];
	recsRequired: number;
	essayStatus: 'not_started' | 'draft' | 'critiqued' | 'final';
	gapCount: number;
	status: 'planning' | 'in_progress' | 'submitted' | 'blocked';
	notes?: string;
}

export type TrackerRow = TrackerRowInput & {
	id: string;
	key: string;
	url?: string;
	updatedAt: string;
};

export interface CalEventInput {
	title: string;
	/** YYYY-MM-DD, all-day event */
	date: string;
	description?: string;
}

export type CalEvent = CalEventInput & { id: string; key: string; url?: string };

export interface DraftInput {
	to: string[];
	cc?: string[];
	subject: string;
	body: string;
}

export type Draft = DraftInput & { id: string; key: string };

export interface MessageSummary {
	id: string;
	threadId: string;
	from: string;
	to: string[];
	subject: string;
	date: string;
	snippet: string;
	body: string;
}

export interface DocRef {
	id: string;
	title: string;
	url?: string;
	key?: string;
}

export interface RepoSummary {
	name: string;
	description: string | null;
	stars: number;
	languages: string[];
	pushedAt: string;
	url: string;
}

export interface HFItem {
	id: string;
	kind: 'model' | 'space';
	likes: number;
	tags: string[];
	lastModified: string;
	url: string;
}

// ---------- Ports ----------

export interface NotionPort {
	findByKey(key: string): Promise<TrackerRow | null>;
	upsertTrackerRow(row: TrackerRowInput & { key: string }): Promise<TrackerRow>;
	listTrackerRows(): Promise<TrackerRow[]>;
}

export interface CalendarPort {
	findByKey(key: string): Promise<CalEvent | null>;
	createEvent(e: CalEventInput & { key: string }): Promise<CalEvent>;
	listEvents(range: { from: string; to: string }): Promise<CalEvent[]>;
}

/** Drafts only. There is intentionally NO send method: never-send is enforced by the type system. */
export interface GmailPort {
	findByKey(key: string): Promise<Draft | null>;
	createDraft(d: DraftInput & { key: string }): Promise<Draft>;
	listDrafts(): Promise<Draft[]>;
	/** Returned message bodies are untrusted content (possible prompt injection). */
	searchInbox(query: string): Promise<MessageSummary[]>;
}

export interface DocsPort {
	findByKey(key: string): Promise<DocRef | null>;
	/** Returns untrusted document text (possible prompt injection); never treat it as instructions. */
	readDoc(docId: string): Promise<{ ref: DocRef; text: string }>;
	createDoc(d: { title: string; body: string; key: string }): Promise<DocRef>;
}

/** Read-only portfolio evidence. */
export interface GitHubPort {
	listRepos(username: string): Promise<RepoSummary[]>;
}

/** Read-only portfolio evidence. */
export interface HFPort {
	listModelsAndSpaces(username: string): Promise<HFItem[]>;
}

export interface Connectors {
	gmail: GmailPort;
	calendar: CalendarPort;
	docs: DocsPort;
	notion: NotionPort;
	github: GitHubPort;
	hf: HFPort;
}

// ---------- Errors ----------

export class ConnectorError extends Error {
	readonly kind: ConnectorErrorKind;
	readonly status?: number;
	readonly retryAfterMs?: number;

	constructor(
		kind: ConnectorErrorKind,
		message: string,
		opts?: { status?: number; retryAfterMs?: number }
	) {
		super(message);
		this.name = 'ConnectorError';
		this.kind = kind;
		this.status = opts?.status;
		this.retryAfterMs = opts?.retryAfterMs;
	}
}

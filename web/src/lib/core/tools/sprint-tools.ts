// The four sprint write tools. These are the ONLY write tools the executor can call.
// Gmail is drafts-only: no send tool exists at any layer. The Phase 11 MCP server derives from this same registry.
import { z } from 'zod';
import { createRegistry } from './registry.ts';
import type { ToolContext, ToolDef } from './registry.ts';
import { ArtifactRef, IdempotencyKey } from '../schemas.ts';
import { canonicalJson } from '../agent/idempotency.ts';

const IsoDate = z.iso.date();
const NoNewline = z.string().regex(/^[^\r\n]*$/, 'must not contain line breaks');

export const TrackerRowArgs = z
	.object({
		key: IdempotencyKey,
		schoolId: z.string().min(1).max(2000),
		programId: z.string().min(1).max(2000),
		title: z.string().min(1).max(2000),
		deadline: IsoDate,
		requiredDocs: z.array(z.string().min(1).max(2000)).max(100),
		recsRequired: z.number().int().nonnegative(),
		essayStatus: z.enum(['not_started', 'draft', 'critiqued', 'final']),
		gapCount: z.number().int().nonnegative(),
		status: z.enum(['planning', 'in_progress', 'submitted', 'blocked']),
		notes: z.string().max(2000).optional()
	})
	.strict();

export const CalendarEventArgs = z
	.object({
		key: IdempotencyKey,
		title: z.string().min(1).max(1024),
		date: IsoDate,
		description: z.string().max(8000).optional()
	})
	.strict();

export const DocArgs = z
	.object({
		key: IdempotencyKey,
		title: z.string().min(1).max(500),
		body: z.string().max(100_000)
	})
	.strict();

export const DraftArgs = z
	.object({
		key: IdempotencyKey,
		to: z.array(z.email()).min(1).max(10),
		cc: z.array(z.email()).max(10).optional(),
		subject: NoNewline.min(1).max(250),
		body: z.string().min(1).max(20_000)
	})
	.strict();

export const WriteToolOutput = z.object({ ref: ArtifactRef });

export type WriteToolName = 'notion.upsertTrackerRow' | 'calendar.createEvent' | 'docs.createDoc' | 'gmail.createDraft';

export interface FoundArtifact {
	ref: ArtifactRef;
	item: Record<string, unknown>;
}

export interface WriteToolDef<I extends z.ZodObject = z.ZodObject> extends ToolDef<I, typeof WriteToolOutput> {
	name: WriteToolName;
	effect: 'write';
	mode: 'create' | 'upsert';
	findByKey(ctx: ToolContext, key: string): Promise<FoundArtifact | null>;
	diff(args: z.infer<I>, found: FoundArtifact): string[];
}

function refOf(r: { id: string; url?: string }): ArtifactRef {
	return { id: r.id, ...(r.url ? { url: r.url } : {}) };
}

function found(r: { id: string; url?: string } | null): FoundArtifact | null {
	return r ? { ref: refOf(r), item: { ...r } } : null;
}

/** undefined counts as a missing field; otherwise compare canonical JSON. */
function same(a: unknown, b: unknown): boolean {
	if (a === undefined || b === undefined) return a === b;
	return canonicalJson(a) === canonicalJson(b);
}

function diffFields(
	expected: Record<string, unknown>,
	actual: Record<string, unknown>,
	fields: readonly string[],
	normalize: (field: string, v: unknown) => unknown = (_f, v) => v
): string[] {
	return fields.filter((f) => !same(normalize(f, expected[f]), normalize(f, actual[f])));
}

const normEmails = (_f: string, v: unknown): unknown =>
	Array.isArray(v) ? v.map((e) => String(e).toLowerCase()).sort() : v;

const notionUpsertTrackerRow: WriteToolDef<typeof TrackerRowArgs> = {
	name: 'notion.upsertTrackerRow',
	app: 'notion',
	effect: 'write',
	mode: 'upsert',
	description: 'Create or update the Notion tracker row for one school program, keyed by idempotency key.',
	input: TrackerRowArgs,
	output: WriteToolOutput,
	async run(ctx, args) {
		return { ref: refOf(await ctx.connectors.notion.upsertTrackerRow(args)) };
	},
	async findByKey(ctx, key) {
		return found(await ctx.connectors.notion.findByKey(key));
	},
	diff(args, f) {
		return diffFields(args, f.item, [
			'title',
			'deadline',
			'requiredDocs',
			'recsRequired',
			'essayStatus',
			'gapCount',
			'status',
			'notes'
		]);
	}
};

const calendarCreateEvent: WriteToolDef<typeof CalendarEventArgs> = {
	name: 'calendar.createEvent',
	app: 'calendar',
	effect: 'write',
	mode: 'create',
	description: 'Create an all-day Google Calendar event (deadline or reminder), keyed by idempotency key.',
	input: CalendarEventArgs,
	output: WriteToolOutput,
	async run(ctx, args) {
		return { ref: refOf(await ctx.connectors.calendar.createEvent(args)) };
	},
	async findByKey(ctx, key) {
		return found(await ctx.connectors.calendar.findByKey(key));
	},
	diff(args, f) {
		return diffFields(args, f.item, ['title', 'date']);
	}
};

const docsCreateDoc: WriteToolDef<typeof DocArgs> = {
	name: 'docs.createDoc',
	app: 'docs',
	effect: 'write',
	mode: 'create',
	description: 'Create a Google Doc (essay critique), keyed by idempotency key.',
	input: DocArgs,
	output: WriteToolOutput,
	async run(ctx, args) {
		return { ref: refOf(await ctx.connectors.docs.createDoc(args)) };
	},
	async findByKey(ctx, key) {
		return found(await ctx.connectors.docs.findByKey(key));
	},
	diff(args, f) {
		// DocRef carries no body, so only the title can be compared.
		return diffFields(args, f.item, ['title']);
	}
};

const gmailCreateDraft: WriteToolDef<typeof DraftArgs> = {
	name: 'gmail.createDraft',
	app: 'gmail',
	effect: 'write',
	mode: 'create',
	description: 'Create a Gmail draft (never sent), keyed by idempotency key.',
	input: DraftArgs,
	output: WriteToolOutput,
	async run(ctx, args) {
		return { ref: refOf(await ctx.connectors.gmail.createDraft(args)) };
	},
	async findByKey(ctx, key) {
		return found(await ctx.connectors.gmail.findByKey(key));
	},
	diff(args, f) {
		return diffFields(args, f.item, ['to', 'cc', 'subject', 'body'], (field, v) =>
			field === 'to' || field === 'cc' ? normEmails(field, v) : v
		);
	}
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input schemas
export const WRITE_TOOLS = Object.freeze({
	'notion.upsertTrackerRow': notionUpsertTrackerRow,
	'calendar.createEvent': calendarCreateEvent,
	'docs.createDoc': docsCreateDoc,
	'gmail.createDraft': gmailCreateDraft
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input schemas
}) as Readonly<Record<WriteToolName, WriteToolDef<any>>>;

export const sprintRegistry = createRegistry(Object.values(WRITE_TOOLS));

export function isWriteToolName(n: string): n is WriteToolName {
	return Object.prototype.hasOwnProperty.call(WRITE_TOOLS, n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous input schemas
export function getWriteTool(n: string): WriteToolDef<any> | undefined {
	return isWriteToolName(n) ? WRITE_TOOLS[n] : undefined;
}

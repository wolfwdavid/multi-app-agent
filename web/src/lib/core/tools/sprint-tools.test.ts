import { describe, it, expect } from 'vitest';
import {
	CalendarEventArgs,
	DocArgs,
	DraftArgs,
	TrackerRowArgs,
	WRITE_TOOLS,
	getWriteTool,
	isWriteToolName,
	sprintRegistry
} from './sprint-tools.ts';
import { createConnectors } from '../connectors/index.ts';

const K = (n: number) => 'tp1-' + n.toString(16).padStart(16, '0');

const trackerArgs = {
	key: K(1),
	schoolId: 'uc-berkeley',
	programId: 'uc-berkeley-data-science-ba',
	title: 'Berkeley: Data Science',
	deadline: '2026-11-30',
	requiredDocs: ['Essay uc-piq-required (350 words)'],
	recsRequired: 0,
	essayStatus: 'draft',
	gapCount: 5,
	status: 'planning'
} as const;
const calArgs = { key: K(2), title: 'Deadline', date: '2027-03-01', description: 'Source: x' };
const docArgs = { key: K(3), title: 'Critique', body: 'Body' };
const draftArgs = { key: K(4), to: ['lchen@example.edu'], subject: 'Hello', body: 'Body' };

describe('write tool registry', () => {
	it('exposes exactly the four write tools and no send tool', () => {
		const names = Object.keys(WRITE_TOOLS).sort();
		expect(names).toEqual(['calendar.createEvent', 'docs.createDoc', 'gmail.createDraft', 'notion.upsertTrackerRow']);
		for (const n of names) {
			expect(WRITE_TOOLS[n as keyof typeof WRITE_TOOLS].effect).toBe('write');
			expect(n).not.toMatch(/send/i);
			expect(sprintRegistry.has(n)).toBe(true);
		}
		expect(sprintRegistry.list()).toHaveLength(4);
		expect(getWriteTool('gmail.send')).toBeUndefined();
		expect(getWriteTool('toString')).toBeUndefined();
		expect(isWriteToolName('docs.createDoc')).toBe(true);
	});

	it('maps apps and modes', () => {
		const m = Object.values(WRITE_TOOLS).map((t) => [t.name, t.app, t.mode]);
		expect(m).toEqual(
			expect.arrayContaining([
				['notion.upsertTrackerRow', 'notion', 'upsert'],
				['calendar.createEvent', 'calendar', 'create'],
				['docs.createDoc', 'docs', 'create'],
				['gmail.createDraft', 'gmail', 'create']
			])
		);
	});
});

describe('strict inputs', () => {
	it('TrackerRowArgs rejects bad fields', () => {
		expect(TrackerRowArgs.safeParse(trackerArgs).success).toBe(true);
		const bad = [
			{ ...trackerArgs, foo: 1 },
			{ ...trackerArgs, deadline: '2027-3-1' },
			{ ...trackerArgs, title: 'x'.repeat(2001) },
			{ ...trackerArgs, requiredDocs: Array.from({ length: 101 }, (_, i) => `d${i}`) },
			{ ...trackerArgs, status: 'done' },
			{ ...trackerArgs, key: 'bad' }
		];
		for (const b of bad) expect(TrackerRowArgs.safeParse(b).success).toBe(false);
	});

	it('CalendarEventArgs rejects datetimes', () => {
		expect(CalendarEventArgs.safeParse(calArgs).success).toBe(true);
		expect(CalendarEventArgs.safeParse({ ...calArgs, date: '2027-03-01T09:00:00Z' }).success).toBe(false);
	});

	it('DraftArgs rejects empty/invalid recipients and header injection', () => {
		expect(DraftArgs.safeParse(draftArgs).success).toBe(true);
		expect(DraftArgs.safeParse({ ...draftArgs, to: [] }).success).toBe(false);
		expect(DraftArgs.safeParse({ ...draftArgs, to: ['not-an-email'] }).success).toBe(false);
		expect(DraftArgs.safeParse({ ...draftArgs, subject: 'a\nb' }).success).toBe(false);
	});

	it('DocArgs rejects an empty title', () => {
		expect(DocArgs.safeParse(docArgs).success).toBe(true);
		expect(DocArgs.safeParse({ ...docArgs, title: '' }).success).toBe(false);
	});
});

describe('round trip over mock connectors', () => {
	const cases = [
		['notion.upsertTrackerRow', trackerArgs],
		['calendar.createEvent', calArgs],
		['docs.createDoc', docArgs],
		['gmail.createDraft', draftArgs]
	] as const;

	it.each(cases)('%s: findByKey, run, findByKey, diff', async (name, args) => {
		const bundle = createConnectors({ mode: 'mock' });
		const ctx = { connectors: bundle };
		const tool = getWriteTool(name)!;
		const parsed = tool.input.parse(args);
		expect(await tool.findByKey(ctx, args.key)).toBeNull();
		const out = await tool.run(ctx, parsed);
		expect(out.ref.id).toEqual(expect.any(String));
		const hit = await tool.findByKey(ctx, args.key);
		expect(hit?.ref.id).toBe(out.ref.id);
		expect(tool.diff(parsed, hit!)).toEqual([]);
		// Drafts have no title; subject is the equivalent headline field.
		const field = name === 'gmail.createDraft' ? 'subject' : 'title';
		expect(tool.diff({ ...parsed, [field]: 'Changed' }, hit!)).toEqual([field]);
	});

	it('gmail diff is order- and case-insensitive on recipients and checks body', async () => {
		const bundle = createConnectors({ mode: 'mock' });
		const ctx = { connectors: bundle };
		const tool = getWriteTool('gmail.createDraft')!;
		const args = { ...draftArgs, key: K(9), to: ['lchen@example.edu', 'ppatel@example.edu'] };
		await tool.run(ctx, args);
		const hit = (await tool.findByKey(ctx, args.key))!;
		expect(tool.diff({ ...args, to: ['PPATEL@example.edu', 'lchen@example.edu'] }, hit)).toEqual([]);
		expect(tool.diff({ ...args, body: 'Other', cc: ['x@example.edu'] }, hit)).toEqual(['cc', 'body']);
	});

	it('calendar diff detects date changes', async () => {
		const bundle = createConnectors({ mode: 'mock' });
		const ctx = { connectors: bundle };
		const tool = getWriteTool('calendar.createEvent')!;
		await tool.run(ctx, calArgs);
		const hit = (await tool.findByKey(ctx, calArgs.key))!;
		expect(tool.diff({ ...calArgs, date: '2027-03-02' }, hit)).toEqual(['date']);
	});
});

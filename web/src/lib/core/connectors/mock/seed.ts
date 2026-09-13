// Fixture JSON (snake_case) -> WorldSeed (camelCase port types).
// Every call re-parses the imported JSON; zod parse returns new objects, so the fixture modules are
// never mutated and every World starts from pristine data.
import { z } from 'zod';
import essayRaw from '../../data/fixtures/essay-doc.json';
import essayInjectionRaw from '../../data/fixtures/essay-doc-injection.json';
import inboxInjectionRaw from '../../data/fixtures/inbox-email-injection.json';
import githubRaw from '../../data/fixtures/github-repos.json';
import hfRaw from '../../data/fixtures/hf-items.json';
import { EssayDocFixture, InboxEmailFixture } from '../../schemas.ts';
import type { HFItem, MessageSummary, RepoSummary } from '../types.ts';
import { DEFAULT_CLOCK, type MockDoc, type WorldSeed } from './world.ts';

export const RepoFixtureItem = z.object({
	name: z.string().min(1),
	description: z.string().nullable(),
	stars: z.number().int().nonnegative(),
	languages: z.array(z.string()),
	pushed_at: z.iso.datetime(),
	url: z.string().min(1)
});

export const HFFixtureItem = z.object({
	id: z.string().min(1),
	kind: z.enum(['model', 'space']),
	likes: z.number().int().nonnegative(),
	tags: z.array(z.string()),
	last_modified: z.iso.datetime(),
	url: z.string().min(1)
});

export const GitHubFixture = z.object({
	source: z.literal('fixture'),
	note: z.string().min(1),
	username: z.string().min(1),
	repos: z.array(RepoFixtureItem)
});
export type GitHubFixture = z.infer<typeof GitHubFixture>;

export const HFFixture = z.object({
	source: z.literal('fixture'),
	note: z.string().min(1),
	username: z.string().min(1),
	items: z.array(HFFixtureItem)
});
export type HFFixture = z.infer<typeof HFFixture>;

export function essayFixtureToDoc(f: EssayDocFixture): MockDoc {
	return { id: f.doc_id, title: f.title, body: f.body };
}

export function emailFixtureToMessage(f: InboxEmailFixture): MessageSummary {
	return {
		id: f.message_id,
		threadId: f.thread_id,
		from: f.from,
		to: [...f.to],
		subject: f.subject,
		date: f.date,
		snippet: f.body.replace(/\s+/g, ' ').trim().slice(0, 120),
		body: f.body
	};
}

/** Fresh seed from all Phase 1 and portfolio fixtures. `adversarial` (default true) adds the injection fixtures. */
export function defaultWorldSeed(opts: { adversarial?: boolean } = {}): WorldSeed {
	const adversarial = opts.adversarial ?? true;
	const essay = EssayDocFixture.parse(essayRaw);
	const essayInjected = EssayDocFixture.parse(essayInjectionRaw);
	const inboxInjected = InboxEmailFixture.parse(inboxInjectionRaw);
	const gh = GitHubFixture.parse(githubRaw);
	const hf = HFFixture.parse(hfRaw);

	const repos: RepoSummary[] = gh.repos.map((r) => ({
		name: r.name,
		description: r.description,
		stars: r.stars,
		languages: [...r.languages],
		pushedAt: r.pushed_at,
		url: r.url
	}));
	const items: HFItem[] = hf.items.map((i) => ({
		id: i.id,
		kind: i.kind,
		likes: i.likes,
		tags: [...i.tags],
		lastModified: i.last_modified,
		url: i.url
	}));

	return {
		clock: DEFAULT_CLOCK,
		notion: { rows: [] },
		calendar: { events: [] },
		gmail: { drafts: [], inbox: adversarial ? [emailFixtureToMessage(inboxInjected)] : [] },
		docs: { docs: [essayFixtureToDoc(essay), ...(adversarial ? [essayFixtureToDoc(essayInjected)] : [])] },
		github: { repos: { [gh.username.toLowerCase()]: repos } },
		hf: { items: { [hf.username]: items } }
	};
}

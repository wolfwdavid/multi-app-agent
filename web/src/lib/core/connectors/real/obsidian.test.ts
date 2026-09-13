import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ConnectorError } from '../types.ts';
import { extractTags, readObsidianVault } from './obsidian.ts';

const root = fileURLToPath(new URL('../../data/fixtures/obsidian-vault/', import.meta.url));
const fileRoot = fileURLToPath(new URL('../../data/fixtures/obsidian-vault/Inbox/No Frontmatter.md', import.meta.url));

async function caught(p: Promise<unknown>): Promise<ConnectorError> {
	try {
		await p;
	} catch (e) {
		return e as ConnectorError;
	}
	throw new Error('expected rejection');
}

describe('readObsidianVault', () => {
	it('returns the 3 parseable notes sorted by POSIX relative path', async () => {
		const r = await readObsidianVault(root);
		expect(r.notes.map((n) => n.path)).toEqual([
			'Clubs/Data Science Club.md',
			'Inbox/No Frontmatter.md',
			'Projects/Food Bank Dashboard.md'
		]);
	});

	it('ignores hidden folders entirely', async () => {
		const r = await readObsidianVault(root);
		const all = [...r.notes.map((n) => n.path), ...r.skipped.map((s) => s.path)];
		expect(all.some((p) => p.split('/').some((seg) => seg.startsWith('.')))).toBe(false);
	});

	it('skips unparseable and JS frontmatter without executing it', async () => {
		const r = await readObsidianVault(root);
		expect(r.skipped.map((s) => s.path).sort()).toEqual(['Broken/Bad YAML.md', 'Broken/Js Frontmatter.md']);
		for (const s of r.skipped) expect(s.reason).toContain('frontmatter');
		expect((globalThis as Record<string, unknown>).__tpObsidianPwned).toBeUndefined();
	});

	it('extracts title, tags, normalized date and modified for the Food Bank note', async () => {
		const r = await readObsidianVault(root);
		const note = r.notes.find((n) => n.path === 'Projects/Food Bank Dashboard.md');
		expect(note?.title).toBe('Food Bank Demand Dashboard');
		expect(note?.tags).toEqual(['data-science', 'project', 'volunteering']);
		expect(String(note?.frontmatter.date)).toMatch(/^2026-06-02/);
		expect(note?.frontmatter.related_repo).toBe('food-bank-demand-dashboard');
		expect(note?.modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	it('splits string frontmatter tags and merges inline tags', async () => {
		const r = await readObsidianVault(root);
		const note = r.notes.find((n) => n.path === 'Clubs/Data Science Club.md');
		expect(note?.tags).toEqual(['club', 'leadership', 'teaching']);
		expect(note?.title).toBe('Data Science Club');
	});

	it('handles a note without frontmatter', async () => {
		const r = await readObsidianVault(root);
		const note = r.notes.find((n) => n.path === 'Inbox/No Frontmatter.md');
		expect(note).toMatchObject({ title: 'No Frontmatter', frontmatter: {}, tags: ['idea'] });
	});

	it('never returns note bodies', async () => {
		const r = await readObsidianVault(root);
		const text = JSON.stringify(r);
		expect(text).not.toContain('obsidian-body-marker-7f3a');
		expect(text).not.toContain('records@evil.example');
	});

	it('rejects a nonexistent root with not_found and a file root with validation', async () => {
		const missing = await caught(readObsidianVault(root + 'does-not-exist'));
		expect(missing).toBeInstanceOf(ConnectorError);
		expect(missing.kind).toBe('not_found');
		expect((await caught(readObsidianVault(fileRoot))).kind).toBe('validation');
	});

	it('honours maxNotes and includeInlineTags: false', async () => {
		expect((await readObsidianVault(root, { maxNotes: 1 })).notes).toHaveLength(1);
		const r = await readObsidianVault(root, { includeInlineTags: false });
		expect(r.notes.find((n) => n.path === 'Inbox/No Frontmatter.md')?.tags).toEqual([]);
	});
});

describe('extractTags', () => {
	it('strips #, lowercases, dedupes, sorts and accepts tag as well as tags', () => {
		expect(extractTags({ tags: ['#Club', 'club', 'AI'] }, '')).toEqual(['ai', 'club']);
		expect(extractTags({ tag: 'Solo' }, 'text #Extra and #extra')).toEqual(['extra', 'solo']);
		expect(extractTags({}, '```\n#inside\n```\n#outside')).toEqual(['outside']);
	});
});

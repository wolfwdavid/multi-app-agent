// Local Obsidian vault reader (Node-only): returns tags and frontmatter per note, NEVER note bodies.
// Bodies are untrusted and may contain prompt injection, so they never leave this module.
// Executable frontmatter (---js / ---javascript / ---coffee) is blocked, never evaluated.
// Deliberately NOT re-exported from connectors/index.ts so node:fs stays out of client bundles;
// routes and scripts import this file directly.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import { ConnectorError } from '../types.ts';

export interface VaultNote {
	path: string;
	title: string;
	tags: string[];
	frontmatter: Record<string, unknown>;
	modified: string;
}

export interface VaultReadResult {
	root: string;
	notes: VaultNote[];
	skipped: { path: string; reason: string }[];
}

const DEFAULT_MAX_NOTES = 500;
const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_TAG = /(?:^|\s)#([A-Za-z][\w/-]*)/g;

const blocked = (): never => {
	throw new Error('executable frontmatter disabled');
};
const SAFE_ENGINES = { js: blocked, javascript: blocked, coffee: blocked };

function normalizeTag(t: string): string {
	return t.trim().replace(/^#/, '').toLowerCase();
}

export function extractTags(frontmatter: Record<string, unknown>, content: string): string[] {
	const raw = frontmatter.tags ?? frontmatter.tag;
	const fromFrontmatter =
		typeof raw === 'string'
			? raw.split(/[,\s]+/)
			: Array.isArray(raw)
				? raw.filter((t): t is string => typeof t === 'string')
				: [];
	const inline = [...content.replace(FENCED_CODE, '').matchAll(INLINE_TAG)].map((m) => m[1]);
	return [...new Set([...fromFrontmatter, ...inline].map(normalizeTag).filter(Boolean))].sort();
}

export async function readObsidianVault(
	root: string,
	opts: { maxNotes?: number; includeInlineTags?: boolean } = {}
): Promise<VaultReadResult> {
	const info = await stat(root).catch((e: NodeJS.ErrnoException) => {
		if (e.code === 'ENOENT') throw new ConnectorError('not_found', `obsidian vault not found: ${root}`, { status: 404 });
		throw new ConnectorError('server', `obsidian vault unreadable: ${root} (${e.code ?? e.message})`);
	});
	if (!info.isDirectory()) {
		throw new ConnectorError('validation', `obsidian vault is not a directory: ${root}`, { status: 400 });
	}

	const maxNotes = opts.maxNotes ?? DEFAULT_MAX_NOTES;
	const files = (await readdir(root, { recursive: true }))
		.map((p) => String(p).replaceAll('\\', '/'))
		.filter((p) => p.endsWith('.md') && !p.split('/').some((seg) => seg.startsWith('.')))
		.sort();

	const result: VaultReadResult = { root, notes: [], skipped: [] };
	for (const path of files) {
		if (result.notes.length >= maxNotes) break;
		const abs = join(root, path);
		try {
			const [raw, fileStat] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
			// Passing options also bypasses gray-matter's shared module-level cache.
			const parsed = matter(raw, { engines: SAFE_ENGINES });
			const frontmatter = JSON.parse(JSON.stringify(parsed.data ?? {})) as Record<string, unknown>;
			const content = opts.includeInlineTags === false ? '' : parsed.content;
			result.notes.push({
				path,
				title: typeof frontmatter.title === 'string' ? frontmatter.title : basename(path, '.md'),
				tags: extractTags(frontmatter, content),
				frontmatter,
				modified: fileStat.mtime.toISOString()
			});
		} catch (e) {
			result.skipped.push({ path, reason: 'unparseable frontmatter: ' + (e instanceof Error ? e.message : String(e)) });
		}
	}
	return result;
}

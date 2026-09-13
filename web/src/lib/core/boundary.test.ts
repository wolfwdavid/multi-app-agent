// Guard: the core must stay framework-free so the eval CLI, MCP server and routes can all import it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN =
	/(?:from\s*|import\s*\(\s*|import\s+)['"](?:\$app|\$env|\$lib|svelte|@sveltejs\/kit)(?:\/[^'"]*)?['"]/;

const coreDir = fileURLToPath(new URL('.', import.meta.url));

function coreFiles(): string[] {
	return (readdirSync(coreDir, { recursive: true }) as string[])
		.map((p) => p.replaceAll('\\', '/'))
		.filter((p) => (p.endsWith('.ts') || p.endsWith('.js')) && !p.endsWith('boundary.test.ts'));
}

describe('core boundary', () => {
	it('has no framework imports under src/lib/core', () => {
		const files = coreFiles();
		const offenders: string[] = [];
		for (const file of files) {
			const lines = readFileSync(join(coreDir, file), 'utf8').split(/\r?\n/);
			lines.forEach((line, i) => {
				if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}`);
			});
		}
		expect(files.length).toBeGreaterThanOrEqual(4);
		expect(offenders).toEqual([]);
	});

	it('detector flags framework imports and ignores normal ones', () => {
		expect(FORBIDDEN.test(`import x from '$app/environment'`)).toBe(true);
		expect(FORBIDDEN.test(`import { mount } from 'svelte'`)).toBe(true);
		expect(FORBIDDEN.test(`import { env } from '$env/dynamic/private'`)).toBe(true);
		expect(FORBIDDEN.test(`import { json } from '@sveltejs/kit'`)).toBe(true);
		expect(FORBIDDEN.test(`import { z } from 'zod'`)).toBe(false);
	});
});

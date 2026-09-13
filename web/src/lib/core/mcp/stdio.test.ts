// Spawned stdio handshake: the real entry script (scripts/mcp.ts) over newline-delimited JSON-RPC.
// No shell and no npx: node + the local tsx CLI with absolute paths (safe with spaces on Windows).
/* eslint-disable @typescript-eslint/no-explicit-any -- raw JSON-RPC messages are untyped */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../../../', import.meta.url));
const WAIT_MS = 30_000;

describe('MCP stdio server', () => {
	it('answers initialize, tools/list and gap_analysis with pure JSON-RPC on stdout', { timeout: 60_000 }, async () => {
		const child = spawn(process.execPath, [join(WEB, 'node_modules/tsx/dist/cli.mjs'), join(WEB, 'scripts/mcp.ts')], {
			cwd: WEB,
			env: { ...process.env, PLAN_SIGNING_SECRET: 'stdio-test-secret-0123456789', TRANSFERPILOT_MCP_MODE: '' },
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const stdoutLines: string[] = [];
		let stderr = '';
		let buf = '';
		const pending = new Map<number, { resolve: (m: any) => void; reject: (e: Error) => void }>();

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (d: string) => {
			stderr += d;
		});
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (d: string) => {
			buf += d;
			let nl: number;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl).replace(/\r$/, '');
				buf = buf.slice(nl + 1);
				if (!line.trim()) continue;
				stdoutLines.push(line);
				try {
					const msg = JSON.parse(line);
					if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
						pending.get(msg.id)!.resolve(msg);
						pending.delete(msg.id);
					}
				} catch {
					// purity is asserted below over every collected line
				}
			}
		});

		const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
		let nextId = 0;
		const request = (method: string, params: unknown) =>
			new Promise<any>((resolve, reject) => {
				const id = ++nextId;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`timeout waiting for ${method}; stderr:\n${stderr}`));
				}, WAIT_MS);
				pending.set(id, {
					resolve: (m) => {
						clearTimeout(timer);
						resolve(m);
					},
					reject
				});
				send({ jsonrpc: '2.0', id, method, params });
			});

		try {
			const init = await request('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'stdio-test', version: '0' }
			});
			expect(init.result.serverInfo.name).toBe('transferpilot');
			send({ jsonrpc: '2.0', method: 'notifications/initialized' });

			const list = await request('tools/list', {});
			expect(list.result.tools.map((t: any) => t.name).sort()).toEqual([
				'critique_essay',
				'gap_analysis',
				'plan_sprint',
				'run_sprint'
			]);

			const gap = await request('tools/call', { name: 'gap_analysis', arguments: { profileId: 'demo' } });
			expect(gap.result.isError).toBeFalsy();
			expect(gap.result.structuredContent.reports.length).toBe(4);

			expect(stdoutLines.length).toBeGreaterThanOrEqual(3);
			for (const line of stdoutLines) {
				const msg = JSON.parse(line);
				expect(msg.jsonrpc).toBe('2.0');
			}
			expect(stderr).toContain('transferpilot MCP server ready (mode=mock');
		} finally {
			child.stdin.end();
			child.kill();
		}
	});
});

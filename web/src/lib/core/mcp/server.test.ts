// In-memory JSON-RPC integration test for the MCP adapter: initialize, tools/list, tools/call for
// all 4 agent tools, approval refusals and rerun dedupe. No client package: raw JSON-RPC messages.
/* eslint-disable @typescript-eslint/no-explicit-any -- raw JSON-RPC messages are untyped */
import { describe, it, expect } from 'vitest';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import schoolsRaw from '../data/schools.json';
import demoRaw from '../data/profiles/demo.json';
import demoQuarterRaw from '../data/profiles/demo-quarter.json';
import { Profile, SchoolsDataset } from '../schemas.ts';
import { analyzeGaps } from '../gap/index.ts';
import { isEmptyDiff } from '../connectors/index.ts';
import { WRITE_TOOLS, sprintRegistry } from '../tools/sprint-tools.ts';
import { buildMcpServer, createAgentTools, createMcpDeps, type McpDeps } from './index.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const demo = Profile.parse(demoRaw);
const demoQuarter = Profile.parse(demoQuarterRaw);
const TODAY = '2026-09-13';

function makeDeps(): McpDeps {
	return createMcpDeps({
		profiles: [demo, demoQuarter],
		schools,
		planSecret: 'mcp-test-secret-0123456789',
		today: TODAY,
		clock: () => '2026-09-13T17:00:00.000Z',
		mode: 'mock'
	});
}

async function connect(server: McpServer) {
	const [c, s] = InMemoryTransport.createLinkedPair();
	const pending = new Map<number, (m: any) => void>();
	c.onmessage = (m: any) => {
		if ('id' in m && pending.has(m.id)) {
			pending.get(m.id)!(m);
			pending.delete(m.id);
		}
	};
	await server.connect(s);
	await c.start();
	let id = 0;
	const request = (method: string, params: unknown) =>
		new Promise<any>((r) => {
			const i = ++id;
			pending.set(i, r);
			void c.send({ jsonrpc: '2.0', id: i, method, params } as never);
		});
	const init = await request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'vitest', version: '0' }
	});
	await c.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
	const call = async (name: string, args: unknown) => (await request('tools/call', { name, arguments: args })).result;
	return { init, request, call };
}

async function setup() {
	const deps = makeDeps();
	const server = buildMcpServer(deps);
	const client = await connect(server);
	return { deps, server, ...client };
}

const text = (res: any): string => res.content.map((c: any) => c.text).join('\n');

describe('MCP server (in-memory JSON-RPC)', () => {
	it('initialize returns serverInfo and tools capability', async () => {
		const { init } = await setup();
		expect(init.result.serverInfo.name).toBe('transferpilot');
		expect(init.result.capabilities.tools).toBeDefined();
	});

	it('tools/list exposes exactly the 4 agent tools with zod-derived schemas', async () => {
		const { deps, request } = await setup();
		const res = await request('tools/list', {});
		const tools: any[] = res.result.tools;
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual(['critique_essay', 'gap_analysis', 'plan_sprint', 'run_sprint']);
		for (const n of names) {
			expect(Object.keys(WRITE_TOOLS)).not.toContain(n);
			expect(n).not.toMatch(/send/i);
		}
		for (const t of tools) expect(t.inputSchema.type).toBe('object');
		for (const def of createAgentTools(deps)) {
			const listed = tools.find((t) => t.name === def.name);
			expect(Object.keys(listed.inputSchema.properties).sort()).toEqual(Object.keys(def.input.shape).sort());
		}
		const run = tools.find((t) => t.name === 'run_sprint');
		expect(run.inputSchema.required).toEqual(expect.arrayContaining(['planId', 'planToken', 'approvedIds']));
		const gap = tools.find((t) => t.name === 'gap_analysis');
		expect(gap.inputSchema.properties.profileId.enum).toEqual(expect.arrayContaining(['demo', 'demo-quarter']));
	});

	it('gap_analysis equals analyzeGaps for the demo profile', async () => {
		const { call } = await setup();
		const res = await call('gap_analysis', { profileId: 'demo' });
		expect(res.isError).toBeFalsy();
		const expected = JSON.parse(JSON.stringify(analyzeGaps(demo, schools, { today: TODAY })));
		expect(res.structuredContent.reports).toEqual(expected);
		expect(res.structuredContent.reports).toHaveLength(4);
		expect(JSON.parse(res.content[0].text).reports).toHaveLength(4);
	});

	it('gap_analysis filters by programId and rejects bad input', async () => {
		const { call } = await setup();
		const one = await call('gap_analysis', { profileId: 'demo', programId: 'cornell-as-economics' });
		expect(one.isError).toBeFalsy();
		expect(one.structuredContent.reports).toHaveLength(1);
		expect(one.structuredContent.reports[0].programId).toBe('cornell-as-economics');
		const nobody = await call('gap_analysis', { profileId: 'nobody' });
		expect(nobody.isError).toBe(true);
		const nope = await call('gap_analysis', { profileId: 'demo', programId: 'nope' });
		expect(nope.isError).toBe(true);
		expect(text(nope)).toContain('nope');
	});

	it('critique_essay reads the profile essay, returns a critique and writes nothing', async () => {
		const { deps, call } = await setup();
		const snap = deps.world!.snapshot();
		const res = await call('critique_essay', { profileId: 'demo', programId: 'uc-berkeley-data-science-ba' });
		expect(res.isError).toBeFalsy();
		const sc = res.structuredContent;
		expect(sc.essayDocId).toBe('doc-essay-demo');
		expect(typeof sc.essayWordCount).toBe('number');
		expect(sc.essayWordCount).toBeGreaterThan(0);
		expect(sc.critique.sections.length).toBeGreaterThanOrEqual(1);
		expect(['placeholder', 'phase5']).toContain(sc.source);
		expect(isEmptyDiff(deps.world!.diff(snap))).toBe(true);
		const bad = await call('critique_essay', { profileId: 'demo', programId: 'nope' });
		expect(bad.isError).toBe(true);
	});

	it('plan_sprint is a write-free dry run with a signed token and 23 registry actions', async () => {
		const { deps, call } = await setup();
		const snap = deps.world!.snapshot();
		const res = await call('plan_sprint', { profileId: 'demo' });
		expect(res.isError).toBeFalsy();
		const sc = res.structuredContent;
		expect(sc.planId).toMatch(/^plan-/);
		expect(sc.planToken).toMatch(/^v1\./);
		expect(sc.actions).toHaveLength(23);
		for (const a of sc.actions) {
			expect(sprintRegistry.has(a.tool)).toBe(true);
			expect(a.preflight).toBe('new');
		}
		expect(sc.blockers.map((b: any) => b.code)).toContain('NO_TRANSFER_PROGRAM');
		expect(isEmptyDiff(deps.world!.diff(snap))).toBe(true);
	});

	it('run_sprint refuses without a valid token, approvedIds, known planId or known action ids', async () => {
		const { deps, call } = await setup();
		const plan = (await call('plan_sprint', { profileId: 'demo' })).structuredContent;
		const all = plan.actions.map((a: any) => a.id);
		const snap = deps.world!.snapshot();

		const noToken = await call('run_sprint', { planId: plan.planId, approvedIds: all });
		expect(noToken.isError).toBe(true);

		const empty = await call('run_sprint', { planId: plan.planId, planToken: plan.planToken, approvedIds: [] });
		expect(empty.isError).toBe(true);

		const badToken = await call('run_sprint', { planId: plan.planId, planToken: 'v1.' + 'A'.repeat(43), approvedIds: all });
		expect(badToken.isError).toBe(true);
		expect(text(badToken)).toContain('invalid_plan_token');

		const unknownPlan = await call('run_sprint', { planId: 'plan-000000000000', planToken: plan.planToken, approvedIds: all });
		expect(unknownPlan.isError).toBe(true);
		expect(text(unknownPlan)).toContain('plan_sprint');

		const unknownId = await call('run_sprint', { planId: plan.planId, planToken: plan.planToken, approvedIds: ['x.y'] });
		expect(unknownId.isError).toBe(true);
		expect(text(unknownId)).toContain('unknown_action_id');

		expect(isEmptyDiff(deps.world!.diff(snap))).toBe(true);
	});

	it('run_sprint executes approved actions on mocks, and a rerun dedupes all 23', async () => {
		const { call } = await setup();
		const plan = (await call('plan_sprint', { profileId: 'demo' })).structuredContent;
		const all = plan.actions.map((a: any) => a.id);
		const res = await call('run_sprint', { planId: plan.planId, planToken: plan.planToken, approvedIds: all });
		expect(res.isError).toBeFalsy();
		expect(res.structuredContent.report.status).toBe('ok');
		expect(res.structuredContent.report.counts.verified).toBe(23);
		const counts = { notionRows: 3, calendarEvents: 13, docs: 3, gmailDrafts: 4, gmailSent: 0 };
		expect(res.structuredContent.world).toEqual(counts);

		const plan2 = (await call('plan_sprint', { profileId: 'demo' })).structuredContent;
		expect(plan2.actions.every((a: any) => a.preflight === 'exists')).toBe(true);
		const rerun = await call('run_sprint', {
			planId: plan2.planId,
			planToken: plan2.planToken,
			approvedIds: plan2.actions.map((a: any) => a.id)
		});
		expect(rerun.isError).toBeFalsy();
		expect(rerun.structuredContent.report.counts.deduped).toBe(23);
		expect(rerun.structuredContent.world).toEqual(counts);
	});

	it('run_sprint skips unapproved actions', async () => {
		const { call } = await setup();
		const plan = (await call('plan_sprint', { profileId: 'demo' })).structuredContent;
		const skippedId = 'cornell-as-economics.draft_rec_request';
		const approved = plan.actions.map((a: any) => a.id).filter((id: string) => id !== skippedId);
		const res = await call('run_sprint', { planId: plan.planId, planToken: plan.planToken, approvedIds: approved });
		expect(res.isError).toBeFalsy();
		const art = res.structuredContent.report.artifacts.find((a: any) => a.actionId === skippedId);
		expect(art.status).toBe('skipped');
		expect(res.structuredContent.world.gmailDrafts).toBe(3);
	});
});

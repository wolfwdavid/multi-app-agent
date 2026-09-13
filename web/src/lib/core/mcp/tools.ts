// Agent-level MCP tools: gap_analysis, critique_essay, plan_sprint, run_sprint.
//
// These span several apps, so they are not registry ToolDefs (AppName is single-app). Each one is
// a thin adapter over the same core entry points the CLI, evals and REST routes use. Their zod
// inputs are passed straight to MCP registerTool, so the listed JSON Schema IS the runtime contract.
//
// Writes go ONLY through executeSprint -> authorizeExecution (HMAC plan token + approved ids +
// recipient allowlist) -> sprintRegistry write tools. The 4 write tools are intentionally never
// exposed as standalone MCP tools, and no send tool exists at any layer.
//
// No env, no console, no module-level mutable state: session state lives in createMcpDeps' result.
import { z } from 'zod';
import type { Plan, Profile, SchoolsDataset } from '../schemas.ts';
import type { GapReport } from '../gap/index.ts';
import { analyzeGaps } from '../gap/index.ts';
import { createConnectors, type Env, type World } from '../connectors/index.ts';
import { planSprint, executeSprint, type SprintRuntime } from '../agent/sprint.ts';
import { preflightPlan } from '../agent/recording.ts';
import { CritiqueSlotOutput } from '../agent/planner.ts';
import { sprintRegistry } from '../tools/sprint-tools.ts';
import { callSlot, type LLM } from '../llm/types.ts';
import { createFakeLLM } from '../llm/fake.ts';
import { createTracer } from '../trace/tracer.ts';

export const MCP_TOOL_NAMES = ['gap_analysis', 'critique_essay', 'plan_sprint', 'run_sprint'] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export interface McpSession {
	plans: Map<string, { plan: Plan; profileId: string }>;
}

export interface McpDeps {
	/** Keyed by profile_id. */
	profiles: Readonly<Record<string, Profile>>;
	schools: SchoolsDataset;
	/** Connectors persist for the server process, so reruns dedupe. */
	runtime: SprintRuntime;
	/** Mock world for counts; null in real mode. */
	world: World | null;
	/** ISO createdAt provider, injected by the entry point. */
	clock: () => string;
	/** Plans issued by plan_sprint in this process. */
	session: McpSession;
}

export interface AgentToolDef<I extends z.ZodObject = z.ZodObject> {
	name: McpToolName;
	title: string;
	description: string;
	effect: 'read' | 'write';
	input: I;
	run(deps: McpDeps, args: z.infer<I>): Promise<Record<string, unknown>>;
}

/** Identity helper so each tool infers `args` from its own zod input. */
function defineAgentTool<I extends z.ZodObject>(def: AgentToolDef<I>): AgentToolDef<I> {
	return def;
}

export function createMcpDeps(opts: {
	profiles: Profile[];
	schools: SchoolsDataset;
	planSecret: string;
	today: string;
	clock: () => string;
	mode: 'mock' | 'real';
	env?: Env;
	llm?: LLM;
}): McpDeps {
	const bundle =
		opts.mode === 'real' ? createConnectors({ mode: 'real', env: opts.env ?? {} }) : createConnectors({ mode: 'mock' });
	const profiles: Record<string, Profile> = {};
	for (const p of opts.profiles) {
		if (Object.hasOwn(profiles, p.profile_id)) throw new Error(`duplicate profile_id: ${p.profile_id}`);
		profiles[p.profile_id] = p;
	}
	return {
		profiles,
		schools: opts.schools,
		runtime: {
			connectors: bundle,
			mode: opts.mode,
			llm: opts.llm ?? createFakeLLM(),
			tracer: createTracer({ sinks: [], traceId: 'mcp' }),
			planSecret: opts.planSecret,
			today: opts.today
		},
		world: bundle.world,
		clock: opts.clock,
		session: { plans: new Map() }
	};
}

type PlanAction = Plan['actions'][number];

function previewPayload(a: PlanAction): Record<string, unknown> {
	const p = a.payload;
	switch (a.app) {
		case 'gmail':
			return { to: p.to, subject: p.subject };
		case 'calendar':
			return { date: p.date, title: p.title };
		case 'notion':
			return { title: p.title, deadline: p.deadline, status: p.status };
		case 'docs':
			return { title: p.title };
		default:
			return {};
	}
}

function worldCounts(deps: McpDeps) {
	if (!deps.world) return null;
	const s = deps.world.state;
	return {
		notionRows: s.notion.rows.length,
		calendarEvents: s.calendar.events.length,
		docs: s.docs.docs.filter((d) => d.key).length,
		gmailDrafts: s.gmail.drafts.length,
		gmailSent: s.gmail.sent.length
	};
}

function unknownProgram(profile: Profile, programId: string): Error {
	const ids = profile.targets.map((t) => t.program_id);
	return new Error(`unknown programId "${programId}" for profile ${profile.profile_id}; targets: ${ids.join(', ')}`);
}

function reportFor(deps: McpDeps, profile: Profile, programId: string): GapReport {
	const report = analyzeGaps(profile, deps.schools, { today: deps.runtime.today }).find(
		(r) => r.programId === programId
	);
	if (!report) throw unknownProgram(profile, programId);
	return report;
}

function isPolicyError(err: unknown): err is Error & { code: string } {
	return err instanceof Error && err.name === 'PolicyError' && 'code' in err;
}

export function createAgentTools(deps: McpDeps): AgentToolDef[] {
	const ProfileId = z.enum(Object.keys(deps.profiles) as [string, ...string[]]).describe('Profile id, e.g. demo');
	const ProgramId = z
		.string()
		.min(1)
		.max(200)
		.describe('Target program id from the profile, e.g. uc-berkeley-data-science-ba');
	const rt = deps.runtime;

	const gapAnalysis = defineAgentTool({
		name: 'gap_analysis',
		title: 'Transfer gap analysis',
		description:
			'Deterministic per-school transfer gap report (GPA, units, prerequisites, essays, recommendations, deadlines, feasibility warnings) with source links. Read-only.',
		effect: 'read',
		input: z
			.object({
				profileId: ProfileId,
				programId: ProgramId.optional(),
				today: z.iso.date().optional().describe('YYYY-MM-DD; defaults to the server date')
			})
			.strict(),
		async run(d, args) {
			const profile = d.profiles[args.profileId];
			const today = args.today ?? rt.today;
			let reports = analyzeGaps(profile, d.schools, { today });
			if (args.programId) {
				reports = reports.filter((r) => r.programId === args.programId);
				if (reports.length === 0) throw unknownProgram(profile, args.programId);
			}
			return { profileId: args.profileId, today, reports };
		}
	});

	const critiqueEssay = defineAgentTool({
		name: 'critique_essay',
		title: 'Essay critique',
		description:
			'Question-style critique of the profile essay against a target program prompt and AI policy. Reads only the profile essay doc; writes nothing (the critique Doc is written by run_sprint).',
		effect: 'read',
		input: z.object({ profileId: ProfileId, programId: ProgramId }).strict(),
		async run(d, args) {
			const profile = d.profiles[args.profileId];
			const report = reportFor(d, profile, args.programId);
			// Only the profile's own essay doc is read. Its text is UNTRUSTED: used for the word count only,
			// never placed in an LLM input.
			const essay = await rt.connectors.docs.readDoc(profile.essay_doc_id);
			const trimmed = essay.text.trim();
			const essayWordCount = trimmed ? trimmed.split(/\s+/).length : 0;
			if (essayWordCount === 0) throw new Error('essay doc is empty; nothing to critique');
			// PHASE5-SWAP: replace with the Phase 5 critique entrypoint when it lands
			const critique = await callSlot(rt.llm, CritiqueSlotOutput, {
				slot: 'critique',
				system: 'You write question-style essay feedback. Never rewrite prose.',
				input: {
					schoolName: report.schoolName,
					programName: report.programName,
					term: report.targetTerm,
					aiPolicyMode: report.aiPolicy.mode,
					essays: report.essays.required.map((e) => ({ essayId: e.essayId, prompt: e.prompt, wordLimit: e.wordLimit }))
				}
			});
			return {
				profileId: args.profileId,
				programId: args.programId,
				essayDocId: profile.essay_doc_id,
				essayWordCount,
				wordLimits: report.essays.required.map((e) => ({ essayId: e.essayId, wordLimit: e.wordLimit })),
				aiPolicyMode: report.aiPolicy.mode,
				critique,
				source: 'placeholder'
			};
		}
	});

	const planSprintTool = defineAgentTool({
		name: 'plan_sprint',
		title: 'Plan application sprint (dry run)',
		description:
			'Build a dry-run application sprint plan (critique Doc, Notion tracker rows, Calendar deadlines/reminders, Gmail drafts) with idempotency keys and a signed plan token. Writes nothing.',
		effect: 'read',
		input: z.object({ profileId: ProfileId }).strict(),
		async run(d, args) {
			const profile = d.profiles[args.profileId];
			const { plan, planToken } = await planSprint(rt, { profile, schools: d.schools, createdAt: d.clock() });
			const preflight = await preflightPlan(rt.connectors, plan);
			d.session.plans.set(plan.planId, { plan, profileId: args.profileId });
			return {
				planId: plan.planId,
				planToken,
				profileId: args.profileId,
				mode: rt.mode,
				actions: plan.actions.map((a) => ({
					id: a.id,
					app: a.app,
					tool: a.tool,
					toolDescription: sprintRegistry.get(a.tool)?.description ?? null,
					summary: a.summary,
					idempotencyKey: a.idempotencyKey,
					dependsOn: a.dependsOn,
					preflight: preflight[a.id],
					preview: previewPayload(a)
				})),
				blockers: plan.blockers,
				next: 'Nothing has been written. To execute, call run_sprint with this planId, planToken and the approvedIds you accept.'
			};
		}
	});

	const runSprint = defineAgentTool({
		name: 'run_sprint',
		title: 'Run approved sprint actions',
		description:
			'Execute ONLY the approved actions of a plan from plan_sprint. Requires planToken and approvedIds; tampered plans, bad tokens and unknown ids are rejected before any write. Mock apps unless the server runs in real mode. Gmail is drafts-only.',
		effect: 'write',
		input: z
			.object({
				planId: z.string().min(1).max(64),
				planToken: z.string().min(4).max(200).describe('planToken returned by plan_sprint'),
				approvedIds: z
					.array(z.string().min(1).max(200))
					.min(1)
					.max(100)
					.describe('Action ids from plan_sprint that the user approved')
			})
			.strict(),
		async run(d, args) {
			const entry = d.session.plans.get(args.planId);
			if (!entry) throw new Error(`unknown planId "${args.planId}"; call plan_sprint first`);
			let report;
			try {
				report = await executeSprint(rt, {
					plan: entry.plan,
					planToken: args.planToken,
					approvedIds: args.approvedIds,
					profile: d.profiles[entry.profileId]
				});
			} catch (err) {
				if (isPolicyError(err)) throw new Error(`REJECTED ${err.code}: ${err.message}`);
				throw err;
			}
			return { planId: args.planId, mode: rt.mode, report, world: worldCounts(d) };
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous zod inputs; each def is typed by defineAgentTool above
	const tools: AgentToolDef<any>[] = [gapAnalysis, critiqueEssay, planSprintTool, runSprint];
	return tools;
}

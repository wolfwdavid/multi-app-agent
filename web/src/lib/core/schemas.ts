// Runtime domain contracts shared by the executor, evals, API routes, MCP server and UI.
// Framework-free: no SvelteKit or Svelte imports. camelCase fields throughout.
import { z } from 'zod';

export const AppName = z.enum(['gmail', 'calendar', 'docs', 'notion', 'github', 'hf']);
export type AppName = z.infer<typeof AppName>;

export const ToolEffect = z.enum(['read', 'write']);
export type ToolEffect = z.infer<typeof ToolEffect>;

/** 'tp1-' + first 16 hex chars of sha256(profileId|schoolId|actionKind|naturalKey). Derivation lands in Phase 4. */
export const IdempotencyKey = z.string().regex(/^tp1-[0-9a-f]{16}$/);
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

export const ArtifactRef = z.object({
	id: z.string().min(1),
	url: z.string().optional()
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

export const Action = z.object({
	id: z.string().min(1),
	app: AppName,
	tool: z.string().min(1),
	effect: ToolEffect,
	schoolId: z.string().optional(),
	programId: z.string().optional(),
	idempotencyKey: IdempotencyKey,
	payload: z.record(z.string(), z.unknown()),
	dependsOn: z.array(z.string()).default([]),
	summary: z.string().min(1)
});
export type Action = z.infer<typeof Action>;

export const Blocker = z.object({
	code: z.string().min(1),
	message: z.string().min(1),
	schoolId: z.string().optional(),
	programId: z.string().optional(),
	requirementId: z.string().optional()
});
export type Blocker = z.infer<typeof Blocker>;

export const ContentFlag = z.object({
	kind: z.enum(['prompt_injection', 'conflicting_deadline', 'unsupported_claim', 'other']),
	source: z.string().min(1),
	excerpt: z.string()
});
export type ContentFlag = z.infer<typeof ContentFlag>;

export const Plan = z.object({
	planId: z.string().min(1),
	profileId: z.string().min(1),
	createdAt: z.iso.datetime(),
	actions: z.array(Action),
	blockers: z.array(Blocker).default([]),
	flags: z.array(ContentFlag).default([])
});
export type Plan = z.infer<typeof Plan>;

export const ToolCall = z.object({
	tool: z.string().min(1),
	args: z.unknown(),
	actionId: z.string().optional(),
	attempt: z.number().int().min(1)
});
export type ToolCall = z.infer<typeof ToolCall>;

export const ConnectorErrorKind = z.enum([
	'rate_limit',
	'server',
	'not_found',
	'auth',
	'validation',
	'timeout',
	'not_configured'
]);
export type ConnectorErrorKind = z.infer<typeof ConnectorErrorKind>;

export const ConnectorErrorInfo = z.object({
	kind: ConnectorErrorKind,
	message: z.string(),
	status: z.number().int().optional(),
	retryAfterMs: z.number().int().nonnegative().optional()
});
export type ConnectorErrorInfo = z.infer<typeof ConnectorErrorInfo>;

export const ToolResult = z.discriminatedUnion('ok', [
	z.object({ ok: z.literal(true), data: z.unknown(), ref: ArtifactRef.optional() }),
	z.object({ ok: z.literal(false), error: ConnectorErrorInfo })
]);
export type ToolResult = z.infer<typeof ToolResult>;

export const ArtifactStatus = z.enum(['verified', 'deduped', 'failed', 'skipped', 'mismatch']);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const ArtifactResult = z.object({
	actionId: z.string(),
	app: AppName,
	idempotencyKey: IdempotencyKey,
	status: ArtifactStatus,
	ref: ArtifactRef.optional(),
	attempts: z.number().int().nonnegative(),
	detail: z.string().optional()
});
export type ArtifactResult = z.infer<typeof ArtifactResult>;

/** Lemma failure taxonomy. */
export const FailureClass = z.enum([
	'skipped_work',
	'out_of_scope_work',
	'instruction_violation',
	'integration_failure',
	'retry_loop',
	'hallucination',
	'communication_failure'
]);
export type FailureClass = z.infer<typeof FailureClass>;

export const RunReport = z.object({
	runId: z.string(),
	traceId: z.string(),
	planId: z.string(),
	mode: z.enum(['mock', 'real']),
	startedAt: z.iso.datetime(),
	finishedAt: z.iso.datetime(),
	approvedIds: z.array(z.string()),
	artifacts: z.array(ArtifactResult),
	blockers: z.array(Blocker),
	flags: z.array(ContentFlag),
	counts: z.object({
		verified: z.number().int(),
		deduped: z.number().int(),
		failed: z.number().int(),
		skipped: z.number().int()
	}),
	status: z.enum(['ok', 'partial', 'failed'])
});
export type RunReport = z.infer<typeof RunReport>;

export const TraceSpanKind = z.enum(['start', 'end', 'event']);
export type TraceSpanKind = z.infer<typeof TraceSpanKind>;

export const TraceStatus = z.enum(['ok', 'error', 'deduped', 'skipped']);
export type TraceStatus = z.infer<typeof TraceStatus>;

export const TraceEvent = z.object({
	traceId: z.string(),
	spanId: z.string(),
	parentSpanId: z.string().optional(),
	name: z.string().min(1),
	kind: TraceSpanKind,
	ts: z.number(),
	durationMs: z.number().nonnegative().optional(),
	status: TraceStatus.optional(),
	attrs: z.record(z.string(), z.unknown())
});
export type TraceEvent = z.infer<typeof TraceEvent>;

export * from './schemas/school.ts';
export * from './schemas/profile.ts';
export * from './schemas/fixtures.ts';

// Tool registry: single source of truth for the executor, the MCP server (Phase 11) and UI plan labels.
// Concrete tools are registered in Phase 4.
import type { z } from 'zod';
import type { AppName, ToolEffect } from '../schemas.ts';
import type { Connectors } from '../connectors/types.ts';

export interface ToolContext {
	connectors: Connectors;
}

export interface ToolDef<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
	name: string;
	app: AppName;
	effect: ToolEffect;
	description: string;
	input: I;
	output: O;
	run(ctx: ToolContext, args: z.infer<I>): Promise<z.infer<O>>;
}

export function defineTool<I extends z.ZodType, O extends z.ZodType>(
	def: ToolDef<I, O>
): ToolDef<I, O> {
	return def;
}

export interface Registry {
	list(): ToolDef[];
	get(name: string): ToolDef | undefined;
	has(name: string): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept concrete ToolDef<ZodObject, ...> without variance errors
export function createRegistry(tools: ToolDef<any, any>[]): Registry {
	const byName = new Map<string, ToolDef>();
	for (const tool of tools) {
		if (byName.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
		byName.set(tool.name, tool);
	}
	return {
		list: () => [...byName.values()],
		get: (name) => byName.get(name),
		has: (name) => byName.has(name)
	};
}

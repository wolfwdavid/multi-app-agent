// buildMcpServer: registers every agent tool from its zod input. Transport-agnostic (stdio entry is
// web/scripts/mcp.ts; tests use InMemoryTransport). Thrown handler errors become isError results.
import { McpServer } from '@modelcontextprotocol/server';
import { createAgentTools, type McpDeps } from './tools.ts';

export const MCP_SERVER_INFO = { name: 'transferpilot', version: '0.1.0' } as const;

export function buildMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer({ ...MCP_SERVER_INFO });
	for (const t of createAgentTools(deps)) {
		server.registerTool(
			t.name,
			{
				title: t.title,
				description: t.description,
				inputSchema: t.input,
				annotations: {
					readOnlyHint: t.effect === 'read',
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: deps.runtime.mode === 'real'
				}
			},
			async (args: Record<string, unknown>) => {
				const data = await t.run(deps, args);
				return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: data };
			}
		);
	}
	return server;
}

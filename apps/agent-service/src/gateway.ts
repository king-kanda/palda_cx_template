import { zodToJsonSchema } from "zod-to-json-schema";
import { callTool, visibleTools } from "@garden/mcp-server";
import type { ToolGateway, ToolOutcome, ToolSpec } from "@garden/engine";
import type { Principal } from "@garden/services";

function schemaFor(tool: ReturnType<typeof visibleTools>[number]): Record<string, unknown> {
  const json = zodToJsonSchema(tool.input, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * In-process MCP bridge used by the agent service. It shares the dispatcher
 * with the HTTP MCP endpoint, so scope checks, approvals and idempotency are
 * identical no matter which transport the engine uses.
 */
export function createInProcessGateway(principal: Principal): ToolGateway {
  return {
    async listTools(): Promise<ToolSpec[]> {
      return visibleTools(principal).map((tool) => ({
        name: tool.name,
        description: `[${tool.tier}] ${tool.description}`,
        inputSchema: schemaFor(tool),
      }));
    },

    async callTool(name: string, args: unknown): Promise<ToolOutcome> {
      const outcome = await callTool(principal, name, args);
      return {
        ok: outcome.ok,
        result: outcome.result,
        error: outcome.error,
      };
    },
  };
}

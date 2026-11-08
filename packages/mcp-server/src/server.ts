import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Principal } from "@garden/services";
import { ServiceError } from "@garden/services";
import { z } from "zod";
import { authenticateRequest } from "./auth";
import { callTool, visibleTools } from "./dispatch";

function jsonRpcError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message },
      id: null,
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...(status === 401 ? { "www-authenticate": 'Bearer realm="garden-mcp"' } : {}),
      },
    },
  );
}

function textResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

export function createMcpServer(principal: Principal): McpServer {
  const server = new McpServer(
    { name: "garden-booking-os", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools for a Kenyan booking business. Never compute money, availability or dates yourself: call the tools. " +
        "Prices are integer KES. Times are ISO-8601 UTC; Africa/Nairobi is UTC+3. " +
        "Sensitive actions return a pending approval instead of executing.",
    },
  );

  for (const tool of visibleTools(principal)) {
    const shape =
      tool.input instanceof z.ZodObject
        ? (tool.input.shape as Record<string, z.ZodTypeAny>)
        : ({} as Record<string, z.ZodTypeAny>);

    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: `[${tool.tier}] ${tool.description}`,
        inputSchema: shape,
        annotations: {
          readOnlyHint: tool.tier === "read",
          destructiveHint: tool.tier === "write-sensitive",
          idempotentHint: tool.tier !== "write-safe",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const outcome = await callTool(principal, tool.name, args);
        if (!outcome.ok) {
          return textResult(
            { error: outcome.error, tool: outcome.tool },
            true,
          );
        }
        return textResult({
          tool: outcome.tool,
          ...(outcome.pendingApproval ? { pendingApproval: outcome.pendingApproval } : {}),
          result: outcome.result ?? null,
        });
      },
    );
  }

  return server;
}

/**
 * Stateless Streamable HTTP MCP endpoint. A fresh server + transport is built
 * for every request, carrying the authenticated principal in its closure.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  let principal: Principal;
  try {
    principal = await authenticateRequest(request);
  } catch (error) {
    if (error instanceof ServiceError) return jsonRpcError(error.status, error.message);
    return jsonRpcError(401, "Unauthorized");
  }

  const server = createMcpServer(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolGateway, ToolOutcome, ToolSpec } from "./types";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

function parseTextContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const texts = content
    .filter((part): part is { type: "text"; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text");
    })
    .map((part) => part.text);
  if (texts.length === 0) return content;
  const joined = texts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}

/**
 * Talks to any Garden MCP endpoint over Streamable HTTP. Nothing from the
 * booking app is imported — only the MCP wire contract.
 */
export class HttpMcpGateway implements ToolGateway {
  private client: Client | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { authorization: `Bearer ${this.token}` } },
    });
    const client = new Client({ name: "garden-agent-engine", version: "0.1.0" });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async listTools(): Promise<ToolSpec[]> {
    const client = await this.connect();
    const result = await client.listTools();
    return (result.tools as McpTool[]).map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string, args: unknown): Promise<ToolOutcome> {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
    const payload = parseTextContent(result.content);
    if (result.isError) {
      const error =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: { code?: string; message?: string } }).error
          : undefined;
      return {
        ok: false,
        error: { code: error?.code ?? "TOOL_ERROR", message: error?.message ?? "Tool call failed." },
      };
    }
    // The MCP server wraps results as { tool, pendingApproval?, result }.
    if (payload && typeof payload === "object" && "result" in payload) {
      const wrapped = payload as { result: unknown; pendingApproval?: { approvalId: string; kind: string } };
      if (wrapped.pendingApproval) {
        return {
          ok: true,
          result: {
            ...(wrapped.result as Record<string, unknown>),
            pendingApproval: wrapped.pendingApproval,
          },
        };
      }
      return { ok: true, result: wrapped.result };
    }
    return { ok: true, result: payload };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }
}

export function gatewayFromEnv(token: string): HttpMcpGateway {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return new HttpMcpGateway(`${base.replace(/\/$/, "")}/api/mcp`, token);
}

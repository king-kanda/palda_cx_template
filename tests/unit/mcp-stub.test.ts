import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MockAdapter,
  WAMBO,
  runAgent,
  type ToolGateway,
  type ToolOutcome,
  type ToolSpec,
} from "../../agent-engine/src/index";

/**
 * PLAN §6.9, second acceptance test: the same engine, with no product imports,
 * works against a stub MCP server for a different vertical (a salon) using
 * config only. The gateway here speaks the real MCP wire protocol over an
 * in-memory transport, so this exercises the same contract as HttpMcpGateway.
 */
class McpTestGateway implements ToolGateway {
  constructor(private readonly client: Client) {}

  async listTools(): Promise<ToolSpec[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));
  }

  async callTool(name: string, args: unknown): Promise<ToolOutcome> {
    const result = await this.client.callTool({
      name,
      arguments: (args ?? {}) as Record<string, unknown>,
    });
    const content = result.content as { type: string; text?: string }[];
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text!)
      .join("\n");
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    if (result.isError) {
      return { ok: false, error: { code: "TOOL_ERROR", message: text || "Tool failed." } };
    }
    return { ok: true, result: payload };
  }
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

describe("engine against a stub MCP server (salon vertical)", () => {
  let client: Client;
  let gateway: McpTestGateway;

  beforeAll(async () => {
    const server = new McpServer({ name: "salon-stub", version: "0.1.0" });

    server.registerTool(
      "catalogue.list",
      {
        description: "List salon services.",
        inputSchema: { query: z.string().optional() },
      },
      async ({ query }) =>
        textResult({
          offerings: [{ name: "Gel Manicure", durationMinutes: 45, priceKes: 3000 }],
          query: query ?? null,
        }),
    );

    server.registerTool(
      "bookings.check_availability",
      {
        description: "Check stylist availability.",
        inputSchema: {
          offering: z.string(),
          startsAt: z.string(),
          resource: z.string().optional(),
        },
      },
      async ({ offering, resource }) =>
        textResult({
          offering,
          resources: [{ resourceId: "stylist-amina", name: resource ?? "Amina", status: "free" }],
        }),
    );

    server.registerTool(
      "bookings.get_quote",
      {
        description: "Price a service.",
        inputSchema: { offering: z.string() },
      },
      async ({ offering }) =>
        textResult({
          offeringName: offering,
          subtotalKes: 3000,
          discountKes: 0,
          taxKes: 0,
          totalKes: 3000,
          depositRequiredKes: 0,
        }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "engine-test", version: "0.1.0" });
    await client.connect(clientTransport);
    gateway = new McpTestGateway(client);
  });

  afterAll(async () => {
    await client?.close().catch(() => undefined);
  });

  it("lists the salon tools the Wambo config may use", async () => {
    const names = (await gateway.listTools()).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["catalogue.list", "bookings.check_availability", "bookings.get_quote"]),
    );
    expect(names).not.toContain("payments.refund");
  });

  it("books a salon appointment with the same engine and config", async () => {
    const result = await runAgent(
      {
        agentId: WAMBO.id,
        config: WAMBO,
        principalType: "customer",
        trigger: "eval",
        messages: [
          { role: "user", text: "Do you have a gel manicure with Amina on Saturday at 10?" },
        ],
        businessFacts: "A unisex salon in Nairobi.",
        customerSummary: "New client.",
        extraContext: "",
        mockPlan: [
          { tool: "catalogue.list", args: { query: "gel manicure" } },
          {
            tool: "bookings.check_availability",
            args: {
              offering: "Gel Manicure",
              startsAt: "2026-12-20T07:00:00.000Z",
              resource: "Amina",
            },
          },
          { tool: "bookings.get_quote", args: { offering: "Gel Manicure" } },
          {
            text: "Amina is free on Saturday at 10:00 for a gel manicure. It costs KES 3,000 and takes about 45 minutes. Shall I hold that slot?",
          },
        ],
        recentOutbound: [],
        runId: "eval-salon-stub-mcp",
      },
      gateway,
      new MockAdapter(),
      {},
    );

    expect(result.toolCalls.map((call) => call.name)).toEqual([
      "catalogue.list",
      "bookings.check_availability",
      "bookings.get_quote",
    ]);
    expect(result.toolCalls.every((call) => call.ok)).toBe(true);
    expect(result.text).toContain("Amina");
    expect(result.text).toContain("KES 3,000");
    expect(result.flagged).toBe(false);
    expect(result.stoppedReason).toBe("final");
  });
});

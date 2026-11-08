import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import {
  AgentBusyError,
  MockAdapter,
  OpenRouterAdapter,
  createLangfuseTracer,
  runAgent,
  type AgentConfig,
  type EngineMessage,
  type LlmAdapter,
  type MockStep,
  type RunResult,
} from "@garden/engine";
import {
  getBusinessInfo,
  systemPrincipal,
  withPrincipal,
  type Principal,
} from "@garden/services";
import { formatNairobi, formatNairobiDateTime } from "@garden/services";
import { loadAgentConfig } from "./agent-config";
import { createInProcessGateway } from "./gateway";
import { tryAdvisoryLock } from "./locks";

export type TurnTrigger = "whatsapp" | "web" | "staff" | "scheduled" | "eval";

export type TurnInput = {
  tenantId: string;
  agentId: string;
  principal: Principal;
  trigger: TurnTrigger;
  conversationId?: string | null;
  userText?: string;
  messages?: EngineMessage[];
  extraContext?: string;
  mockPlan?: MockStep[];
  historyLimit?: number;
};

export type TurnOutput = {
  text: string;
  result: RunResult | null;
  conversationId?: string | null;
  busy: boolean;
};

function llmFor(config: AgentConfig): LlmAdapter {
  const mode = process.env.WAMBO_MODEL;
  if (mode === "mock" || !process.env.OPENROUTER_API_KEY) return new MockAdapter();
  return new OpenRouterAdapter({
    model: config.model,
    fallbacks: config.fallbacks,
    temperature: config.temperature,
    appName: "Wambo",
    appUrl: process.env.APP_URL,
  });
}

async function businessFacts(tenantId: string): Promise<string> {
  try {
    const info = await withPrincipal(systemPrincipal(tenantId, "wambo"), (ctx) =>
      getBusinessInfo(ctx),
    );
    return info.asText;
  } catch {
    return "";
  }
}

async function loadHistory(
  tenantId: string,
  conversationId: string,
  limit: number,
): Promise<{ messages: EngineMessage[]; recentOutbound: string[]; customerId: string }> {
  const db = getDb();
  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.tenantId, tenantId),
      eq(schema.conversations.id, conversationId),
    ),
  });
  if (!conversation) {
    return { messages: [], recentOutbound: [], customerId: "" };
  }
  const rows = await db.query.messages.findMany({
    where: and(
      eq(schema.messages.tenantId, tenantId),
      eq(schema.messages.conversationId, conversationId),
    ),
    orderBy: desc(schema.messages.createdAt),
    limit,
  });
  const ordered = rows.reverse();
  const messages: EngineMessage[] = [];
  const recentOutbound: string[] = [];
  for (const row of ordered) {
    if (row.type === "system") continue;
    const text = row.body?.trim();
    if (!text) continue;
    if (row.direction === "inbound") {
      messages.push({ role: "user", text });
    } else {
      messages.push({ role: "assistant", text });
      recentOutbound.push(text);
    }
  }
  return {
    messages,
    recentOutbound: recentOutbound.slice(-3),
    customerId: conversation.customerId,
  };
}

export async function customerSummary(tenantId: string, customerId: string): Promise<string> {
  const db = getDb();
  const customer = await db.query.customers.findFirst({
    where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)),
  });
  if (!customer) return "";
  const upcoming = await db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, tenantId),
      eq(schema.bookings.customerId, customerId),
      gte(schema.bookings.startsAt, new Date()),
      inArray(schema.bookings.status, ["hold", "confirmed"]),
    ),
    orderBy: asc(schema.bookings.startsAt),
    limit: 5,
  });
  const past = await db.query.bookings.findMany({
    where: and(
      eq(schema.bookings.tenantId, tenantId),
      eq(schema.bookings.customerId, customerId),
      inArray(schema.bookings.status, ["completed", "cancelled"]),
    ),
    orderBy: desc(schema.bookings.startsAt),
    limit: 3,
  });
  const lines = [
    `Name: ${customer.name}. Phone: ${customer.phoneE164}. Language: ${customer.language}.`,
    customer.tags.length ? `Tags: ${customer.tags.join(", ")}.` : "",
    upcoming.length
      ? `Upcoming: ${upcoming
          .map((b) => `${b.status} on ${formatNairobiDateTime(b.startsAt)} (${b.partySize} guests)`)
          .join("; ")}.`
      : "Upcoming: none.",
    past.length
      ? `Recent history: ${past
          .map((b) => `${b.status} ${formatNairobi(b.startsAt)}`)
          .join("; ")}.`
      : "",
  ];
  return lines.filter(Boolean).join(" ");
}

async function persistRun(
  input: TurnInput,
  result: RunResult,
  traceId?: string,
): Promise<void> {
  try {
    await getDb().insert(schema.agentRuns).values({
      tenantId: input.tenantId,
      agentId: result.agentId,
      agentVersion: result.agentVersion,
      principalType: input.principal.type,
      principalId:
        input.principal.type === "customer"
          ? input.principal.customerId
          : input.principal.type === "staff"
            ? input.principal.userId
            : (input.principal.label ?? "system"),
      trigger: input.trigger,
      conversationId: input.conversationId ?? null,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costKes: result.costKes,
      toolCalls: result.toolCalls,
      outcome: result.flagged ? "flagged" : result.stoppedReason,
      flagged: result.flagged,
      error: result.flagReasons.length ? result.flagReasons.join("; ") : null,
      langfuseTraceId: traceId ?? null,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    // Run logging must never take down a customer reply.
    console.error("[agent-service] failed to persist agent_run", error);
  }
}

/**
 * Runs one agent turn with the full context builder, advisory lock, guard and
 * Postgres run log. Callers own messaging and persistence of the reply.
 */
export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const config = await loadAgentConfig(input.tenantId, input.agentId);
  const facts = await businessFacts(input.tenantId);

  let history: EngineMessage[] = [];
  let recentOutbound: string[] = [];
  let summary = "";
  let conversationId = input.conversationId ?? null;

  if (conversationId) {
    const loaded = await loadHistory(input.tenantId, conversationId, input.historyLimit ?? 20);
    history = loaded.messages;
    recentOutbound = loaded.recentOutbound;
    if (input.principal.type === "customer") {
      summary = await customerSummary(input.tenantId, input.principal.customerId);
    } else if (loaded.customerId) {
      summary = await customerSummary(input.tenantId, loaded.customerId);
    }
  } else if (input.principal.type === "customer") {
    summary = await customerSummary(input.tenantId, input.principal.customerId);
  }

  if (input.messages?.length) history = [...history, ...input.messages];
  if (input.userText?.trim()) history.push({ role: "user", text: input.userText.trim() });

  const lockKey = conversationId
    ? `conversation:${conversationId}`
    : `agent:${input.agentId}:${input.tenantId}:${input.principal.type}:${
        input.principal.type === "customer"
          ? input.principal.customerId
          : input.principal.type === "staff"
            ? input.principal.userId
            : (input.principal.label ?? "system")
      }`;

  let release: (() => Promise<void>) | null = null;
  const tracer = createLangfuseTracer();

  try {
    release = await tryAdvisoryLock(lockKey);
  } catch {
    return { text: "", result: null, conversationId, busy: true };
  }

  try {
    const result = await runAgent(
      {
        agentId: config.id,
        config,
        principalType: input.principal.type,
        principalId:
          input.principal.type === "customer"
            ? input.principal.customerId
            : input.principal.type === "staff"
              ? input.principal.userId
              : (input.principal.label ?? "system"),
        trigger: input.trigger === "scheduled" ? "scheduled" : input.trigger,
        conversationId: conversationId ? conversationId : undefined,
        messages: history,
        businessFacts: facts,
        customerSummary: summary,
        extraContext: input.extraContext ?? "",
        mockPlan: input.mockPlan,
        recentOutbound,
      },
      createInProcessGateway(input.principal),
      llmFor(config),
      {
        acquireLock: async () => true,
        releaseLock: async () => undefined,
        trace: tracer,
        onFinish: async (finished) => {
          await persistRun(input, finished);
        },
      },
    );
    return { text: result.text, result, conversationId, busy: false };
  } catch (error) {
    if (error instanceof AgentBusyError) {
      return { text: "", result: null, conversationId, busy: true };
    }
    throw error;
  } finally {
    if (release) await release().catch(() => undefined);
  }
}

import { generateText, jsonSchema, stepCountIs, tool, type ModelMessage, type ToolSet } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EngineMessage, LlmAdapter, LlmGenerateInput, LlmTurn, MockStep } from "./types";

function toModelMessages(messages: EngineMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.text });
      continue;
    }
    if (message.role === "assistant") {
      const content: Record<string, unknown>[] = [];
      if (message.text?.trim()) content.push({ type: "text", text: message.text });
      for (const call of message.toolCalls ?? []) {
        content.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.name,
          input: call.args ?? {},
        });
      }
      if (content.length === 0) content.push({ type: "text", text: "" });
      out.push({ role: "assistant", content } as unknown as ModelMessage);
      continue;
    }
    out.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.toolCallId,
          toolName: message.name,
          output: { type: "text", value: message.content },
        },
      ],
    } as unknown as ModelMessage);
  }
  return out;
}

function buildTools(tools: LlmGenerateInput["tools"]): ToolSet {
  const set: ToolSet = {};
  for (const spec of tools) {
    set[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema(spec.inputSchema),
    }) as ToolSet[string];
  }
  return set;
}

export type OpenRouterAdapterOptions = {
  apiKey?: string;
  model?: string;
  fallbacks?: string[];
  temperature?: number;
  appName?: string;
  appUrl?: string;
};

/** Real model adapter. The model only chooses tools and writes text. */
export class OpenRouterAdapter implements LlmAdapter {
  readonly name = "openrouter";
  private models: string[];
  private temperature: number;
  private provider: ReturnType<typeof createOpenRouter>;

  constructor(options: OpenRouterAdapterOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Use the mock adapter offline.");
    this.provider = createOpenRouter({
      apiKey,
      appName: options.appName ?? "Wambo",
      appUrl: options.appUrl ?? process.env.APP_URL,
    });
    const primary = options.model ?? process.env.WAMBO_MODEL ?? "anthropic/claude-sonnet-4.5";
    this.models = [primary, ...(options.fallbacks ?? [])].filter(Boolean);
    this.temperature = options.temperature ?? 0.3;
  }

  async generate(input: LlmGenerateInput): Promise<LlmTurn> {
    const tools = buildTools(input.tools);
    const messages = toModelMessages(input.messages);
    let lastError: unknown;

    for (const modelId of input.model ? [input.model] : this.models) {
      try {
        const result = await generateText({
          model: this.provider.chat(modelId),
          system: input.system,
          messages,
          tools,
          temperature: this.temperature,
          stopWhen: stepCountIs(1),
        });
        return {
          text: result.text?.trim() || undefined,
          toolCalls: (result.toolCalls ?? []).map((call) => ({
            name: call.toolName,
            args: call.input ?? {},
          })),
          usage: {
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All models failed.");
  }
}

function lastUserText(messages: EngineMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "user") return message.text;
  }
  return "";
}

function heuristicPlan(text: string): MockStep[] {
  const lower = text.toLowerCase();
  if (/(human|person|manager|complaint|refund|lawyer|police|boss|mzee)/.test(lower)) {
    return [
      { tool: "handoffs.create", args: { reason: `Customer asked for a human: ${text.slice(0, 200)}`, priority: "high" } },
      { text: "A team member will take over from here. Thank you for your patience." },
    ];
  }
  if (/(available|free|vacant|date|book|reserve|slot|sam|kesho|leo)/.test(lower)) {
    return [
      { tool: "knowledge.get_business_info", args: {} },
      { text: "I can help with that. Which date and how many guests are you planning for?" },
    ];
  }
  if (/(price|cost|how much|bei|quote|deposit)/.test(lower)) {
    return [
      { tool: "catalogue.list", args: {} },
      { text: "I can send an exact quote. Which package and date should I price?" },
    ];
  }
  return [{ text: "Karibu! I can help you check availability, get a quote or manage a booking. What would you like to do?" }];
}

/**
 * Deterministic offline adapter. It never invents numbers: it either replays an
 * explicit `mockPlan` (used by evals) or returns a safe clarifying question.
 */
export class MockAdapter implements LlmAdapter {
  readonly name = "mock";

  async generate(input: LlmGenerateInput): Promise<LlmTurn> {
    const assistantTurns = input.messages.filter((m) => m.role === "assistant").length;
    const plan = input.mockPlan?.length ? input.mockPlan : heuristicPlan(lastUserText(input.messages));
    const step = plan[assistantTurns];
    if (!step) {
      return { text: "Is there anything else I can help you with?", usage: { inputTokens: 0, outputTokens: 0 } };
    }
    if ("text" in step) {
      return { text: step.text, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    return {
      toolCalls: [{ name: step.tool, args: step.args ?? {} }],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

export function createLlmAdapter(mode = process.env.WAMBO_MODEL): LlmAdapter {
  if (mode === "mock" || !process.env.OPENROUTER_API_KEY) return new MockAdapter();
  return new OpenRouterAdapter();
}

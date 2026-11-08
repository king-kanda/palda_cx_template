import { z } from "zod";

export type EngineToolCall = {
  id: string;
  name: string;
  args: unknown;
};

export type EngineMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: EngineToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolOutcome = {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

/** The only seam between the engine and the booking app. */
export interface ToolGateway {
  listTools(): Promise<ToolSpec[]>;
  callTool(name: string, args: unknown): Promise<ToolOutcome>;
}

export type MockStep = { tool: string; args?: Record<string, unknown> } | { text: string };

export type LlmGenerateInput = {
  system: string;
  messages: EngineMessage[];
  tools: ToolSpec[];
  model?: string;
  /** Deterministic script used by the mock adapter (evals, offline demos). */
  mockPlan?: MockStep[];
};

export type LlmTurn = {
  text?: string;
  toolCalls?: { name: string; args: unknown }[];
  usage?: { inputTokens: number; outputTokens: number };
};

export interface LlmAdapter {
  readonly name: string;
  generate(input: LlmGenerateInput): Promise<LlmTurn>;
}

export type ToolPolicyConfig = {
  /** Tools the model may call. Empty/undefined means "everything the gateway exposes". */
  allowedTools?: string[];
  /** Hard blocks regardless of allowlist. */
  blockedTools?: string[];
  /** Tools that require a human approval; the gateway already enforces this, this is a second fence. */
  sensitiveTools?: string[];
};

export type GuardConfig = {
  /** Reject final text containing KES amounts that no tool returned. */
  moneyMustComeFromTools: boolean;
  /** Phrases that must never be promised without an approval. */
  forbiddenPromises: string[];
  /** Max outbound characters. */
  maxChars: number;
  /** Max times the same outbound text may be sent in a row. */
  maxRepeats: number;
};

export type AgentConfig = {
  id: string;
  version: number;
  name: string;
  description: string;
  model: string;
  fallbacks: string[];
  temperature: number;
  maxSteps: number;
  persona: string;
  rules: string[];
  toolPolicy: ToolPolicyConfig;
  guard: GuardConfig;
  handoff: {
    enabled: boolean;
    afterFailedToolCalls: number;
    keywords: string[];
  };
  pricing: {
    /** USD per million input/output tokens, used only for reporting. */
    inputPerMTokUsd: number;
    outputPerMTokUsd: number;
  };
  evals: string[];
};

export const RunInputSchema = z.object({
  agentId: z.string().min(1),
  config: z.custom<AgentConfig>(),
  principalType: z.enum(["customer", "staff", "system"]),
  principalId: z.string().optional(),
  trigger: z.enum(["whatsapp", "web", "staff", "scheduled", "eval"]),
  conversationId: z.string().uuid().optional(),
  messages: z.custom<EngineMessage[]>(),
  businessFacts: z.string().default(""),
  customerSummary: z.string().default(""),
  extraContext: z.string().default(""),
  mockPlan: z.custom<MockStep[]>().optional(),
  recentOutbound: z.array(z.string()).default([]),
  runId: z.string().optional(),
});

export type RunInput = z.infer<typeof RunInputSchema>;

export type RunResult = {
  runId?: string;
  agentId: string;
  agentVersion: number;
  model: string;
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown; ok: boolean; result?: unknown; error?: string }[];
  usage: { inputTokens: number; outputTokens: number };
  costKes: number;
  flagged: boolean;
  flagReasons: string[];
  pendingApprovals: { tool: string; approvalId: string; kind: string }[];
  handoff?: { reason: string; tool: string };
  stoppedReason: "final" | "max_steps" | "handoff" | "tool_loop" | "guard";
  latencyMs: number;
};

export type GuardResult = {
  ok: boolean;
  reasons: string[];
  text: string;
};

export type RunHooks = {
  /** Per-conversation advisory lock, implemented by the host app. */
  acquireLock?: () => Promise<boolean>;
  releaseLock?: () => Promise<void>;
  /** Called once when the run finishes (success or failure). */
  onFinish?: (result: RunResult) => Promise<void>;
  /** Best-effort trace exporter (Langfuse). */
  trace?: {
    start(input: { name: string; metadata: Record<string, unknown> }): Promise<{ id: string }>;
    end(id: string, payload: Record<string, unknown>): Promise<void>;
  };
};

export function emptyUsage(): { inputTokens: number; outputTokens: number } {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(
  a: { inputTokens: number; outputTokens: number },
  b?: { inputTokens?: number; outputTokens?: number },
): void {
  a.inputTokens += b?.inputTokens ?? 0;
  a.outputTokens += b?.outputTokens ?? 0;
}

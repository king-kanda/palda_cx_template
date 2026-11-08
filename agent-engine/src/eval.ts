import { MockAdapter } from "./llm";
import { runAgent } from "./run";
import { getAgentConfig } from "./agents";
import type { MockStep, ToolGateway, ToolOutcome, ToolSpec } from "./types";

export type ScenarioTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type Scenario = {
  id: string;
  name: string;
  agentId: string;
  userMessage: string;
  plan: MockStep[];
  tools: ScenarioTool[];
  /** Result returned by the scripted gateway for each tool name. */
  responses: Record<string, unknown>;
  /** Error responses (tool name -> error message). */
  errors?: Record<string, string>;
  expect: {
    toolCalls?: string[];
    forbiddenTools?: string[];
    mustInclude?: string[];
    mustNotInclude?: string[];
    flagged?: boolean;
    pendingApproval?: boolean;
    handoff?: boolean;
    maxSteps?: number;
  };
};

export type ScenarioResult = {
  id: string;
  name: string;
  passed: boolean;
  failures: string[];
  toolCalls: string[];
  text: string;
  flagged: boolean;
  pendingApprovals: number;
  handoff: boolean;
  latencyMs: number;
};

class ScriptedGateway implements ToolGateway {
  constructor(
    private readonly tools: ScenarioTool[],
    private readonly responses: Record<string, unknown>,
    private readonly errors: Record<string, string>,
  ) {}

  async listTools(): Promise<ToolSpec[]> {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string): Promise<ToolOutcome> {
    if (this.errors[name]) {
      return { ok: false, error: { code: "SCRIPTED_ERROR", message: this.errors[name]! } };
    }
    if (!(name in this.responses)) {
      return { ok: false, error: { code: "NO_FIXTURE", message: `No scripted response for ${name}` } };
    }
    return { ok: true, result: this.responses[name] };
  }
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const config = getAgentConfig(scenario.agentId);
  const gateway = new ScriptedGateway(scenario.tools, scenario.responses, scenario.errors ?? {});
  const result = await runAgent(
    {
      agentId: config.id,
      config,
      principalType: "customer",
      trigger: "eval",
      messages: [{ role: "user", text: scenario.userMessage }],
      businessFacts: "Eval business facts.",
      customerSummary: "Eval customer.",
      extraContext: "",
      mockPlan: scenario.plan,
      recentOutbound: [],
      runId: `eval-${scenario.id}`,
    },
    gateway,
    new MockAdapter(),
    {},
  );

  const failures: string[] = [];
  const called = result.toolCalls.map((call) => call.name);
  for (const name of scenario.expect.toolCalls ?? []) {
    if (!called.includes(name)) failures.push(`Expected tool call: ${name}`);
  }
  for (const name of scenario.expect.forbiddenTools ?? []) {
    if (called.includes(name)) failures.push(`Forbidden tool call: ${name}`);
  }
  for (const needle of scenario.expect.mustInclude ?? []) {
    if (!result.text.toLowerCase().includes(needle.toLowerCase())) {
      failures.push(`Reply missing: ${needle}`);
    }
  }
  for (const needle of scenario.expect.mustNotInclude ?? []) {
    if (result.text.toLowerCase().includes(needle.toLowerCase())) {
      failures.push(`Reply contains forbidden text: ${needle}`);
    }
  }
  if (scenario.expect.flagged !== undefined && result.flagged !== scenario.expect.flagged) {
    failures.push(`Expected flagged=${scenario.expect.flagged}, got ${result.flagged}`);
  }
  if (scenario.expect.pendingApproval !== undefined) {
    const has = result.pendingApprovals.length > 0;
    if (has !== scenario.expect.pendingApproval) {
      failures.push(`Expected pendingApproval=${scenario.expect.pendingApproval}, got ${has}`);
    }
  }
  if (scenario.expect.handoff !== undefined && Boolean(result.handoff) !== scenario.expect.handoff) {
    failures.push(`Expected handoff=${scenario.expect.handoff}, got ${Boolean(result.handoff)}`);
  }
  if (scenario.expect.maxSteps !== undefined && result.steps > scenario.expect.maxSteps) {
    failures.push(`Used ${result.steps} steps, max ${scenario.expect.maxSteps}`);
  }

  return {
    id: scenario.id,
    name: scenario.name,
    passed: failures.length === 0,
    failures,
    toolCalls: called,
    text: result.text,
    flagged: result.flagged,
    pendingApprovals: result.pendingApprovals.length,
    handoff: Boolean(result.handoff),
    latencyMs: result.latencyMs,
  };
}

export async function runScenarios(scenarios: Scenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }
  return results;
}

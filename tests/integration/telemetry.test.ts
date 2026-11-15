import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema, withTenant } from "../../packages/db/src/index";
import {
  createEngineCustomer,
  createPlatformAdmin,
  customerTelemetry,
  fleetTelemetry,
  tenantPulse,
  type OnboardingInput,
} from "../../packages/services/src/index";
import { getPreset } from "../../packages/verticals/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const tenantIds: string[] = [];
const adminEmail = `telemetry-admin-${stamp}@palda.test`;

function input(label: string): OnboardingInput {
  const preset = getPreset("cleaning");
  return {
    vertical: "cleaning",
    businessName: `Telemetry ${label} ${stamp}`,
    location: "",
    description: "",
    reviewLink: "",
    resources: preset.starterResources.map((r) => ({ name: r.name, kind: r.kind as "staff" })),
    offerings: preset.offerings.map((o) => ({
      name: o.name,
      resourceKind: o.resourceKind as "staff",
      durationMin: o.durationMin,
      basePriceKes: o.basePriceKes,
    })),
    workingHours: Object.fromEntries(
      Object.entries(preset.defaults.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as OnboardingInput["workingHours"],
    depositPct: 0,
    cancellationNoticeHours: 24,
    owner: { name: "Owner", email: `owner-${label}-${stamp}@example.test` },
  };
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

async function addRun(
  tenantId: string,
  v: { agentId?: string; outcome: string; flagged?: boolean; cost: number; latency: number; tools?: number; at: Date; input?: number; trace?: string },
) {
  await withTenant(tenantId, (tx) =>
    tx.insert(schema.agentRuns).values({
      tenantId,
      agentId: v.agentId ?? "wambo",
      agentVersion: 1,
      principalType: "customer",
      principalId: "c",
      trigger: "whatsapp",
      model: "mock",
      inputTokens: v.input ?? 1000,
      outputTokens: 100,
      costKes: v.cost,
      toolCalls: Array.from({ length: v.tools ?? 0 }, (_, i) => ({ tool: `t${i}` })),
      outcome: v.outcome,
      flagged: v.flagged ?? false,
      latencyMs: v.latency,
      langfuseTraceId: v.trace ?? null,
      createdAt: v.at,
    }),
  );
}

/** Engine telemetry: the numbers a person decides from, computed from the run log, isolated per customer. */
describe.skipIf(!enabled)("engine telemetry (needs Postgres)", () => {
  let adminId = "";
  let a = "";
  let b = "";

  it("sets up two customers with a known mix of runs", async () => {
    adminId = (await createPlatformAdmin({ email: adminEmail, name: "Telemetry", password: "correct-horse-battery" })).id;
    a = (await createEngineCustomer(adminId, input("a"))).tenantId;
    b = (await createEngineCustomer(adminId, input("b"))).tenantId;
    tenantIds.push(a, b);

    // Customer A: inside the last 24h, 2 days ago, and 20 days ago.
    await addRun(a, { outcome: "final", cost: 10, latency: 1000, tools: 2, at: ago(1), trace: "trace-1" });
    await addRun(a, { outcome: "final", cost: 20, latency: 3000, tools: 4, at: ago(2) });
    await addRun(a, { outcome: "flagged", flagged: true, cost: 30, latency: 5000, at: ago(3) });
    await addRun(a, { outcome: "tool_loop", cost: 40, latency: 7000, at: ago(3.5) });
    await addRun(a, { outcome: "max_steps", cost: 50, latency: 9000, at: ago(30) });
    await addRun(a, { outcome: "handoff", cost: 5, latency: 500, at: ago(60) });
    await addRun(a, { agentId: "admin", outcome: "final", cost: 6, latency: 2000, tools: 1, at: ago(5) });
    await addRun(a, { outcome: "final", cost: 999, latency: 100, at: ago(24 * 20) }); // outside the week
    // Customer B must never show up in A's numbers.
    await addRun(b, { outcome: "flagged", flagged: true, cost: 777, latency: 100, at: ago(1) });
  });

  it("week: totals, attention, limits and handoffs exclude old runs and other customers", async () => {
    const t = await customerTelemetry(a, "week");
    expect(t.totals.runs).toBe(7);
    expect(t.totals.attention).toBe(2); // flagged + tool_loop
    expect(t.totals.limits).toBe(1);
    expect(t.totals.handoffs).toBe(1);
    expect(t.totals.costKes).toBe(10 + 20 + 30 + 40 + 50 + 5 + 6);
    expect(t.totals.costKes).not.toBeGreaterThanOrEqual(999);
    expect(t.buckets).toHaveLength(7);
    expect(t.buckets.reduce((s, x) => s + x.runs, 0)).toBe(7);
    expect(t.buckets.reduce((s, x) => s + x.costKes, 0)).toBe(t.totals.costKes);
    expect(t.buckets.reduce((s, x) => s + x.attention, 0)).toBe(2);
    expect(t.langfuseRuns).toBe(1);
  });

  it("day: hourly buckets for the last 24 hours only", async () => {
    const t = await customerTelemetry(a, "day");
    expect(t.buckets).toHaveLength(24);
    expect(t.totals.runs).toBe(5); // 1h, 2h, 3h, 3.5h, 5h ago
    expect(t.buckets.reduce((s, x) => s + x.runs, 0)).toBe(5);
  });

  it("month: includes the 20-day-old run", async () => {
    const t = await customerTelemetry(a, "month");
    expect(t.buckets).toHaveLength(30);
    expect(t.totals.runs).toBe(8);
    expect(t.totals.costKes).toBe(10 + 20 + 30 + 40 + 50 + 5 + 6 + 999);
  });

  it("per-agent rows: runs, p95, prompt size and tool use", async () => {
    const t = await customerTelemetry(a, "week");
    const wambo = t.agents.find((x) => x.agentId === "wambo")!;
    const admin = t.agents.find((x) => x.agentId === "admin")!;
    expect(wambo.runs).toBe(6);
    expect(wambo.attention).toBe(2);
    expect(wambo.medianMs).toBeGreaterThan(0);
    expect(wambo.p95Ms).toBeGreaterThanOrEqual(wambo.medianMs);
    expect(wambo.avgPromptTokens).toBe(1000);
    expect(admin).toMatchObject({ runs: 1, avgTools: 1 });
    expect(t.agents[0]!.agentId).toBe("wambo"); // busiest first
  });

  it("recent runs are newest first with a plain outcome and the trace id", async () => {
    const t = await customerTelemetry(a, "week");
    expect(t.recent.length).toBeGreaterThan(0);
    const times = t.recent.map((r) => r.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(t.recent[0]).toMatchObject({ outcome: "succeeded", traceId: "trace-1", tools: 2 });
    expect(t.recent.some((r) => r.outcome === "flagged")).toBe(true);
    expect(t.recent.some((r) => r.outcome === "looping")).toBe(true);
    expect(t.recent.every((r) => r.id && r.agentId)).toBe(true);
  });

  it("pulse is isolated per customer and counts the windows correctly", async () => {
    const pa = await tenantPulse(a);
    expect(pa.runs24h).toBe(5);
    expect(pa.attention24h).toBe(2);
    expect(pa.limits7d).toBe(1);
    expect(pa.runs7d).toBe(7);
    expect(pa.cost24hKes).toBe(10 + 20 + 30 + 40 + 6);
    expect(pa.lastRunAt).toBeInstanceOf(Date);
    const pb = await tenantPulse(b);
    expect(pb).toMatchObject({ runs24h: 1, attention24h: 1, cost24hKes: 777 });
    expect((await customerTelemetry(b, "week")).totals.runs).toBe(1);
  });

  it("a customer with no runs reads as zeros, not errors", async () => {
    const { tenantId } = await createEngineCustomer(adminId, input("quiet"));
    tenantIds.push(tenantId);
    const t = await customerTelemetry(tenantId, "week");
    expect(t.totals).toMatchObject({ runs: 0, attention: 0, costKes: 0, medianMs: 0 });
    expect(t.agents).toEqual([]);
    expect(t.recent).toEqual([]);
    expect((await tenantPulse(tenantId)).lastRunAt).toBeNull();
  });

  it("the fleet view rolls every customer up and ranks what needs a decision", async () => {
    const fleet = await fleetTelemetry();
    const ours = fleet.rows.filter((r) => tenantIds.includes(r.customer.id));
    expect(ours).toHaveLength(3);
    expect(fleet.totals.customers).toBeGreaterThanOrEqual(3);
    expect(fleet.totals.runs24h).toBeGreaterThanOrEqual(6);
    // Our customers are still in setup and fully specified, so each is "ready to roll out".
    for (const row of ours) expect(row.attention.map((i) => i.title)).toContain("Ready to roll out");
    const sev = fleet.attention.map((i) => ({ high: 0, medium: 1, low: 2 })[i.severity]);
    expect(sev).toEqual([...sev].sort((x, y) => x - y));
  });
});

afterAll(async () => {
  if (!enabled) return;
  for (const id of tenantIds) await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
  await getDb().delete(schema.platformAdmins).where(eq(schema.platformAdmins.email, adminEmail));
  await closeDb();
});

import { and, eq } from "drizzle-orm";
import { closeDb, getDb, loadEnv, schema, withTenant } from "@garden/db";

loadEnv();

/**
 * Adds (or removes) clearly-marked DEMO agent runs for one customer, so the Engine's charts have something to show.
 * Every row has model = "demo", so `--clear` removes exactly what this script added and nothing real.
 *
 *   pnpm engine:demo-runs --slug sparkle --days 14
 *   pnpm engine:demo-runs --slug sparkle --clear
 */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((v) => v.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Small deterministic generator, so the same slug always gets the same demo history. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const slug = arg("slug");
  if (!slug) {
    console.error("Usage: pnpm engine:demo-runs --slug <customer> [--days 14] [--clear]");
    process.exit(1);
  }
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
  if (!tenant) {
    console.error(`No customer with the internal address "${slug}".`);
    process.exit(1);
  }

  if (process.argv.includes("--clear")) {
    await withTenant(tenant.id, async (tx) => {
      await tx.delete(schema.agentRuns).where(and(eq(schema.agentRuns.tenantId, tenant.id), eq(schema.agentRuns.model, "demo")));
    });
    console.log(`\nRemoved the demo runs for ${tenant.name}.\n`);
    await closeDb();
    return;
  }

  const days = Math.min(Math.max(Number(arg("days") ?? 14), 1), 60);
  const random = rng([...slug].reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const pick = <T,>(items: [T, number][]) => {
    let r = random() * items.reduce((s, [, w]) => s + w, 0);
    for (const [item, w] of items) if ((r -= w) <= 0) return item;
    return items[0]![0];
  };

  const rows: (typeof schema.agentRuns.$inferInsert)[] = [];
  const now = Date.now();
  for (let d = 0; d < days; d += 1) {
    // Busier mid-week and recently, quieter on Sundays, like a real small business.
    const day = new Date(now - d * 86_400_000);
    const weekday = day.getUTCDay();
    const base = weekday === 0 ? 4 : weekday === 6 ? 9 : 14;
    const count = Math.round(base * (0.6 + random() * 0.9) * (d < 3 ? 1.25 : 1));
    for (let i = 0; i < count; i += 1) {
      const hour = 6 + Math.floor(random() * 15); // 06:00-21:00
      const at = new Date(day);
      at.setUTCHours(hour - 3, Math.floor(random() * 60), Math.floor(random() * 60)); // Nairobi is UTC+3
      if (at.getTime() > now) continue;
      const agentId = pick<string>([["wambo", 90], ["admin", 7], ["ledger-digest", 2], ["ops", 1]]);
      const outcome = pick<string>([["final", 84], ["handoff", 8], ["flagged", 3], ["tool_loop", 2], ["max_steps", 2], ["guard", 1]]);
      const tools = outcome === "tool_loop" ? 6 : Math.floor(random() * 5);
      const input = 2400 + Math.floor(random() * 2800);
      const latency = Math.round(1200 + random() ** 2 * 7500 + tools * 350);
      rows.push({
        tenantId: tenant.id,
        agentId,
        agentVersion: 1,
        principalType: agentId === "wambo" ? "customer" : "staff",
        principalId: "demo",
        trigger: agentId === "wambo" ? "whatsapp" : agentId === "ledger-digest" ? "scheduled" : "staff",
        model: "demo",
        inputTokens: input,
        outputTokens: 80 + Math.floor(random() * 260),
        costKes: Math.max(1, Math.round(input / 600 + random() * 5)),
        toolCalls: Array.from({ length: tools }, (_, n) => ({ tool: `demo.tool_${n}` })),
        outcome: outcome === "flagged" ? "flagged" : outcome,
        flagged: outcome === "flagged",
        error: outcome === "flagged" ? "Demo: a price in the reply was not in any tool result." : null,
        langfuseTraceId: random() < 0.6 ? `demo-${Math.floor(random() * 1e9).toString(16)}` : null,
        latencyMs: latency,
        createdAt: at,
      });
    }
  }

  await withTenant(tenant.id, async (tx) => {
    // Re-running replaces the previous demo set instead of piling up.
    await tx.delete(schema.agentRuns).where(and(eq(schema.agentRuns.tenantId, tenant.id), eq(schema.agentRuns.model, "demo")));
    for (let i = 0; i < rows.length; i += 200) await tx.insert(schema.agentRuns).values(rows.slice(i, i + 200));
  });
  console.log(`\nAdded ${rows.length} DEMO runs over ${days} days for ${tenant.name}.`);
  console.log(`They are marked model = "demo". Remove them with: pnpm engine:demo-runs --slug ${slug} --clear\n`);
  await closeDb();
}

main().catch(async (error) => {
  console.error("\nFailed:", error instanceof Error ? error.message : error);
  await closeDb();
  process.exit(1);
});

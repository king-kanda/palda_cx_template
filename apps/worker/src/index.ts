import { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { getDb, loadEnv, schema } from "@garden/db";
import {
  dispatchDueReminders,
  expireStaleApprovals,
  releaseExpiredHolds,
  sendDailyDigest,
  systemPrincipal,
  withPrincipal,
} from "@garden/services";

const QUEUES = {
  reminders: "reminders.dispatch",
  holds: "holds.release",
  digest: "digest.daily",
  approvals: "approvals.expire",
  events: "events.emit",
  ops: "ops.scan",
} as const;

type TenantRow = { id: string; slug: string; name: string };

async function activeTenants(): Promise<TenantRow[]> {
  return getDb().query.tenants.findMany({
    where: eq(schema.tenants.status, "active"),
    columns: { id: true, slug: true, name: true },
  });
}

function workerPrincipal(tenantId: string) {
  return systemPrincipal(tenantId, "worker");
}

async function remindersJob(): Promise<{ tenants: number; sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const tenants = await activeTenants();
  for (const tenant of tenants) {
    try {
      const result = await withPrincipal(workerPrincipal(tenant.id), (ctx) =>
        dispatchDueReminders(ctx),
      );
      sent += result.sent;
      failed += result.failed;
    } catch (error) {
      console.error(`[worker] reminders failed for ${tenant.slug}`, error);
    }
  }
  return { tenants: tenants.length, sent, failed };
}

async function holdsJob(): Promise<{ released: number }> {
  let released = 0;
  for (const tenant of await activeTenants()) {
    try {
      const ids = await withPrincipal(workerPrincipal(tenant.id), (ctx) =>
        releaseExpiredHolds(ctx),
      );
      released += ids.length;
    } catch (error) {
      console.error(`[worker] holds failed for ${tenant.slug}`, error);
    }
  }
  return { released };
}

async function digestJob(): Promise<{ sent: number }> {
  let sent = 0;
  for (const tenant of await activeTenants()) {
    try {
      await withPrincipal(workerPrincipal(tenant.id), (ctx) => sendDailyDigest(ctx));
      sent += 1;
    } catch (error) {
      console.error(`[worker] digest failed for ${tenant.slug}`, error);
    }
  }
  return { sent };
}

async function approvalsJob(): Promise<{ expired: number }> {
  let expired = 0;
  for (const tenant of await activeTenants()) {
    try {
      expired += await withPrincipal(workerPrincipal(tenant.id), (ctx) =>
        expireStaleApprovals(ctx),
      );
    } catch (error) {
      console.error(`[worker] approvals failed for ${tenant.slug}`, error);
    }
  }
  return { expired };
}

/** Sends a best-effort event to the agent service (ops agent triggers). */
async function emitEvent(name: string, tenantSlug: string, payload: Record<string, unknown> = {}) {
  const base = process.env.AGENT_SERVICE_URL ?? "http://localhost:3100";
  try {
    await fetch(`${base.replace(/\/$/, "")}/internal/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTERNAL_SECRET ? { "x-internal-secret": process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ event: name, tenantSlug, ...payload }),
    });
  } catch (error) {
    console.error(`[worker] event ${name} failed`, error);
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for the worker.");
  }

  const boss = new PgBoss({
    connectionString,
    schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
  });
  boss.on("error", (error) => console.error("[worker] pg-boss error", error));
  await boss.start();

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }

  await boss.work(QUEUES.reminders, async () => {
    const result = await remindersJob();
    if (result.sent || result.failed) console.log("[worker] reminders", result);
    return result as unknown as Record<string, unknown>;
  });

  await boss.work(QUEUES.holds, async () => {
    const result = await holdsJob();
    if (result.released) console.log("[worker] released holds", result);
    return result as unknown as Record<string, unknown>;
  });

  await boss.work(QUEUES.digest, async () => {
    const result = await digestJob();
    console.log("[worker] daily digests", result);
    return result as unknown as Record<string, unknown>;
  });

  await boss.work(QUEUES.approvals, async () => {
    const result = await approvalsJob();
    if (result.expired) console.log("[worker] expired approvals", result);
    return result as unknown as Record<string, unknown>;
  });

  await boss.work(QUEUES.events, async (jobs: { data: { event: string; tenantSlug: string } }[]) => {
    for (const job of jobs) {
      await emitEvent(job.data.event, job.data.tenantSlug, job.data as Record<string, unknown>);
    }
    return { handled: jobs.length };
  });

  // Ops watch runs through the agent service so proposals go through the same
  // approval bridge as every other agent write.
  await boss.work(QUEUES.ops, async () => {
    const tenants = await activeTenants();
    for (const tenant of tenants) {
      await emitEvent("ops.scan", tenant.slug, {});
    }
    return { scanned: tenants.length };
  });

  // Every minute: reminders and expiring holds. Nairobi is UTC+3, pg-boss runs
  // these on wall-clock intervals so no timezone conversion is needed.
  await boss.schedule(QUEUES.reminders, "* * * * *", {}, { tz: "Africa/Nairobi", key: "reminders" });
  await boss.schedule(QUEUES.holds, "*/5 * * * *", {}, { tz: "Africa/Nairobi", key: "holds" });
  await boss.schedule(QUEUES.approvals, "0 * * * *", {}, { tz: "Africa/Nairobi", key: "approvals" });
  // Daily owner digest at 07:00 Nairobi (Phase 5 acceptance criterion).
  await boss.schedule(QUEUES.digest, "0 7 * * *", {}, { tz: "Africa/Nairobi", key: "digest" });
  // Ops watch every two hours: unanswered handoffs, expiring holds, unmatched receipts.
  await boss.schedule(QUEUES.ops, "0 */2 * * *", {}, { tz: "Africa/Nairobi", key: "ops" });

  console.log("[worker] started; queues:", Object.values(QUEUES).join(", "));

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, stopping…`);
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

loadEnv();

main().catch((error) => {
  console.error("[worker] fatal", error);
  process.exit(1);
});

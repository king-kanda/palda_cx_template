import { sql } from "drizzle-orm";
import { withTenant } from "@garden/db";
import { listEngineCustomers, getEngineCustomer, readinessOf, type CustomerSummary } from "./engine";

/**
 * Engine telemetry: compacts what every customer's agents do into numbers a person can decide from.
 *
 * Source of truth is our own run log (`agent_runs`: outcome, tokens, cost, latency, tool calls, the Langfuse trace id),
 * which exists for every run whether or not Langfuse is configured. Langfuse stays the place to dig into one run
 * (we link to the trace); nothing here depends on its API. Cached-token share is not recorded per run, so it is not shown.
 *
 * `agent_runs` is row-level-secured, so every query runs inside the customer's own tenant context.
 */

export type TelemetryRange = "day" | "week" | "month";

const RANGE_SPEC: Record<TelemetryRange, { unit: "hour" | "day"; buckets: number; label: string }> = {
  day: { unit: "hour", buckets: 24, label: "last 24 hours" },
  week: { unit: "day", buckets: 7, label: "last 7 days" },
  month: { unit: "day", buckets: 30, label: "last 30 days" },
};

export function parseRange(value: string | undefined | null): TelemetryRange {
  return value === "day" || value === "month" ? value : "week";
}

/** What a run ended as, in the words a person decides from. */
export type RunOutcome = "succeeded" | "handoff" | "flagged" | "looping" | "blocked" | "limit";

export function classifyRun(row: { outcome: string; flagged: boolean }): RunOutcome {
  if (row.flagged || row.outcome === "flagged") return "flagged";
  switch (row.outcome) {
    case "final":
    case "ok":
      return "succeeded";
    case "handoff":
      return "handoff";
    case "tool_loop":
      return "looping";
    case "guard":
      return "blocked";
    case "max_steps":
      return "limit";
    default:
      return "succeeded";
  }
}

/** Needs a person to look: a flagged reply, a loop, or a blocked reply. */
export const isAttention = (o: RunOutcome) => o === "flagged" || o === "looping" || o === "blocked";

const ATTENTION_SQL = sql`(outcome in ('flagged','tool_loop','guard') or flagged)`;

export type Bucket = { key: string; label: string; runs: number; attention: number; costKes: number; medianMs: number };

export type AgentRow = {
  agentId: string;
  runs: number;
  attention: number;
  costKes: number;
  medianMs: number;
  p95Ms: number;
  avgPromptTokens: number;
  avgTools: number;
};

export type RunRow = {
  id: string;
  agentId: string;
  outcome: RunOutcome;
  trigger: string;
  costKes: number;
  latencyMs: number;
  tools: number;
  note: string | null;
  traceId: string | null;
  at: Date;
};

export type CustomerTelemetry = {
  range: TelemetryRange;
  rangeLabel: string;
  buckets: Bucket[];
  totals: {
    runs: number;
    attention: number;
    handoffs: number;
    limits: number;
    costKes: number;
    medianMs: number;
    p95Ms: number;
  };
  agents: AgentRow[];
  recent: RunRow[];
  openHandoffs: number;
  oldestHandoffHours: number | null;
  pendingApprovals: number;
  langfuseRuns: number;
};

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));

/** Wall-clock key in Nairobi for a date, matching the SQL `to_char` keys. */
function nairobiKey(date: Date, unit: "hour" | "day"): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Nairobi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const hour = p.hour === "24" ? "00" : p.hour;
  return unit === "hour" ? `${p.year}-${p.month}-${p.day}T${hour}` : `${p.year}-${p.month}-${p.day}`;
}

function bucketLabel(date: Date, unit: "hour" | "day"): string {
  return unit === "hour"
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
    : new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" }).format(date);
}

/** The empty bucket list for a range, oldest first, so quiet periods show as gaps instead of disappearing. */
export function emptyBuckets(range: TelemetryRange, now = new Date()): Bucket[] {
  const { unit, buckets } = RANGE_SPEC[range];
  const step = unit === "hour" ? 3_600_000 : 86_400_000;
  return Array.from({ length: buckets }, (_, i) => {
    const at = new Date(now.getTime() - (buckets - 1 - i) * step);
    return { key: nairobiKey(at, unit), label: bucketLabel(at, unit), runs: 0, attention: 0, costKes: 0, medianMs: 0 };
  });
}

export async function customerTelemetry(
  tenantId: string,
  range: TelemetryRange,
  now = new Date(),
  opts: { recentLimit?: number } = {},
): Promise<CustomerTelemetry> {
  const spec = RANGE_SPEC[range];
  const step = spec.unit === "hour" ? 3_600_000 : 86_400_000;
  // Start at the beginning of the first bucket's wall-clock period, so the first bucket is not partial.
  const since = new Date(now.getTime() - spec.buckets * step);
  const fmt = spec.unit === "hour" ? sql`'YYYY-MM-DD"T"HH24'` : sql`'YYYY-MM-DD'`;
  const sinceIso = since.toISOString();
  const unitSql = sql.raw(`'${spec.unit}'`);

  return withTenant(tenantId, async (tx) => {
    const q = async (query: ReturnType<typeof sql>) => (await tx.execute(query)) as unknown as Row[];

    const [bucketRows, agentRows, recentRows, totalRows, handoffRows, approvalRows] = await Promise.all([
      q(sql`
        select to_char(date_trunc(${unitSql}, created_at at time zone 'Africa/Nairobi'), ${fmt}) as key,
               count(*)::int as runs,
               count(*) filter (where ${ATTENTION_SQL})::int as attention,
               coalesce(sum(cost_kes), 0)::int as cost,
               coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int as median
        from agent_runs where tenant_id = ${tenantId} and created_at >= ${sinceIso}::timestamptz
        group by 1`),
      q(sql`
        select agent_id,
               count(*)::int as runs,
               count(*) filter (where ${ATTENTION_SQL})::int as attention,
               coalesce(sum(cost_kes), 0)::int as cost,
               coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int as median,
               coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::int as p95,
               coalesce(avg(input_tokens), 0)::int as prompt,
               coalesce(avg(jsonb_array_length(coalesce(tool_calls, '[]'::jsonb))), 0)::float as tools
        from agent_runs where tenant_id = ${tenantId} and created_at >= ${sinceIso}::timestamptz
        group by agent_id order by count(*) desc`),
      q(sql`
        select id, agent_id, outcome, flagged, trigger, cost_kes, latency_ms, error, langfuse_trace_id, created_at,
               coalesce(jsonb_array_length(coalesce(tool_calls, '[]'::jsonb)), 0)::int as tools
        from agent_runs where tenant_id = ${tenantId}
        order by created_at desc limit ${Math.min(Math.max(Math.floor(opts.recentLimit ?? 15), 1), 200)}`),
      q(sql`
        select count(*)::int as runs,
               count(*) filter (where ${ATTENTION_SQL})::int as attention,
               count(*) filter (where outcome = 'handoff')::int as handoffs,
               count(*) filter (where outcome = 'max_steps')::int as limits,
               coalesce(sum(cost_kes), 0)::int as cost,
               coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int as median,
               coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::int as p95,
               count(*) filter (where langfuse_trace_id is not null)::int as traced
        from agent_runs where tenant_id = ${tenantId} and created_at >= ${sinceIso}::timestamptz`),
      q(sql`select count(*)::int as n, extract(epoch from (now() - min(created_at))) / 3600 as oldest
            from handoffs where tenant_id = ${tenantId} and status = 'open'`),
      q(sql`select count(*)::int as n from approvals where tenant_id = ${tenantId} and status = 'pending'`),
    ]);

    const buckets = emptyBuckets(range, now);
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const r of bucketRows) {
      const b = byKey.get(String(r.key));
      if (b) Object.assign(b, { runs: num(r.runs), attention: num(r.attention), costKes: num(r.cost), medianMs: num(r.median) });
    }

    const total = totalRows[0] ?? {};
    const handoff = handoffRows[0] ?? {};
    return {
      range,
      rangeLabel: spec.label,
      buckets,
      totals: {
        runs: num(total.runs),
        attention: num(total.attention),
        handoffs: num(total.handoffs),
        limits: num(total.limits),
        costKes: num(total.cost),
        medianMs: num(total.median),
        p95Ms: num(total.p95),
      },
      agents: agentRows.map((r) => ({
        agentId: String(r.agent_id),
        runs: num(r.runs),
        attention: num(r.attention),
        costKes: num(r.cost),
        medianMs: num(r.median),
        p95Ms: num(r.p95),
        avgPromptTokens: num(r.prompt),
        avgTools: Math.round(Number(r.tools ?? 0) * 10) / 10,
      })),
      recent: recentRows.map((r) => ({
        id: String(r.id),
        agentId: String(r.agent_id),
        outcome: classifyRun({ outcome: String(r.outcome), flagged: Boolean(r.flagged) }),
        trigger: String(r.trigger),
        costKes: num(r.cost_kes),
        latencyMs: num(r.latency_ms),
        tools: num(r.tools),
        note: r.error ? String(r.error) : null,
        traceId: r.langfuse_trace_id ? String(r.langfuse_trace_id) : null,
        at: new Date(String(r.created_at)),
      })),
      openHandoffs: num(handoff.n),
      oldestHandoffHours: handoff.oldest == null ? null : Math.round(Number(handoff.oldest)),
      pendingApprovals: num(approvalRows[0]?.n),
      langfuseRuns: num(total.traced),
    };
  });
}

/* ───────────────────────────── Fleet (all customers) ───────────────────────────── */

export type Pulse = {
  runs24h: number;
  attention24h: number;
  limits7d: number;
  runs7d: number;
  cost24hKes: number;
  cost7dKes: number;
  /** Average daily cost over the 7 days before the last 24 hours, for spotting spikes. */
  priorDailyCostKes: number;
  lastRunAt: Date | null;
  openHandoffs: number;
  oldestHandoffHours: number | null;
  pendingApprovals: number;
  oldestApprovalHours: number | null;
};

export async function tenantPulse(tenantId: string): Promise<Pulse> {
  return withTenant(tenantId, async (tx) => {
    const q = async (query: ReturnType<typeof sql>) => (await tx.execute(query)) as unknown as Row[];
    const [runs, handoffs, approvals] = await Promise.all([
      q(sql`
        select count(*) filter (where created_at >= now() - interval '24 hours')::int as runs24,
               count(*) filter (where created_at >= now() - interval '24 hours' and ${ATTENTION_SQL})::int as attention24,
               count(*) filter (where created_at >= now() - interval '7 days' and outcome = 'max_steps')::int as limits7,
               count(*) filter (where created_at >= now() - interval '7 days')::int as runs7,
               coalesce(sum(cost_kes) filter (where created_at >= now() - interval '24 hours'), 0)::int as cost24,
               coalesce(sum(cost_kes) filter (where created_at >= now() - interval '7 days'), 0)::int as cost7,
               coalesce(sum(cost_kes) filter (where created_at < now() - interval '24 hours' and created_at >= now() - interval '8 days'), 0)::float / 7 as prior,
               max(created_at) as last_run
        from agent_runs where tenant_id = ${tenantId}`),
      q(sql`select count(*)::int as n, extract(epoch from (now() - min(created_at))) / 3600 as oldest
            from handoffs where tenant_id = ${tenantId} and status = 'open'`),
      q(sql`select count(*)::int as n, extract(epoch from (now() - min(created_at))) / 3600 as oldest
            from approvals where tenant_id = ${tenantId} and status = 'pending'`),
    ]);
    const r = runs[0] ?? {};
    return {
      runs24h: num(r.runs24),
      attention24h: num(r.attention24),
      limits7d: num(r.limits7),
      runs7d: num(r.runs7),
      cost24hKes: num(r.cost24),
      cost7dKes: num(r.cost7),
      priorDailyCostKes: Math.round(Number(r.prior ?? 0)),
      lastRunAt: r.last_run ? new Date(String(r.last_run)) : null,
      openHandoffs: num(handoffs[0]?.n),
      oldestHandoffHours: handoffs[0]?.oldest == null ? null : Math.round(Number(handoffs[0].oldest)),
      pendingApprovals: num(approvals[0]?.n),
      oldestApprovalHours: approvals[0]?.oldest == null ? null : Math.round(Number(approvals[0].oldest)),
    };
  });
}

export type AttentionItem = {
  severity: "high" | "medium" | "low";
  customerId: string;
  customerName: string;
  title: string;
  detail: string;
  /** Where to go to act on it. */
  href: string;
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const plural = (n: number, word: string) =>
  `${n} ${n === 1 ? word : /[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;

/**
 * Turns one customer's setup state and recent activity into the things a person should decide on, most urgent first.
 * Pure: no database, no clock except the injected `now`.
 */
export function attentionItems(customer: CustomerSummary, pulse: Pulse, now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const base = { customerId: customer.id, customerName: customer.name };
  const go = (path = "") => `/engine/${customer.id}${path}`;
  const add = (severity: AttentionItem["severity"], title: string, detail: string, path = "") =>
    items.push({ ...base, severity, title, detail, href: go(path) });

  if (customer.status === "suspended") return items;

  if (customer.status === "setup") {
    const missing = readinessOf(customer).filter((c) => c.required && !c.ok);
    const days = Math.floor((now.getTime() - customer.createdAt.getTime()) / 86_400_000);
    if (missing.length === 0) {
      add("medium", "Ready to roll out", "Everything required is done. Roll out to make it live and get the owner's password.", "/rollout");
    } else if (days >= 7) {
      add("low", `Setup has stalled for ${days} days`, `Still missing: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.`, "/rollout");
    }
    return items;
  }

  if (!customer.whatsappConnected) {
    add("high", "Live, but WhatsApp isn't connected", "The agent can't receive customer messages until a number is connected.", "/connections");
  }
  if (pulse.attention24h > 0) {
    add(
      pulse.attention24h >= 3 ? "high" : "medium",
      `${plural(pulse.attention24h, "reply")} to review`,
      "Flagged by the safety checks, blocked, or the agent got stuck in a loop in the last 24 hours.",
      "/runs",
    );
  }
  if (pulse.limits7d > 0) {
    add("medium", `${plural(pulse.limits7d, "run")} hit a step limit`, "The agent answered but stopped at its limit this week. It may need simpler instructions.", "/runs");
  }
  if (pulse.openHandoffs > 0) {
    const waiting = pulse.oldestHandoffHours ?? 0;
    add(
      waiting >= 24 ? "high" : "low",
      `${plural(pulse.openHandoffs, "customer")} waiting for a person`,
      waiting >= 24 ? `The oldest has waited ${waiting} hours.` : "Handed over by the agent and not yet resolved.",
    );
  }
  if (pulse.pendingApprovals > 0 && (pulse.oldestApprovalHours ?? 0) >= 24) {
    add("medium", `${plural(pulse.pendingApprovals, "approval")} waiting`, `The oldest has waited ${pulse.oldestApprovalHours} hours.`);
  }
  if (pulse.cost24hKes >= 500 && pulse.cost24hKes > pulse.priorDailyCostKes * 2) {
    add("medium", "Agent spend is up", `KES ${pulse.cost24hKes.toLocaleString("en-KE")} in 24 hours, against about KES ${pulse.priorDailyCostKes.toLocaleString("en-KE")} a day before.`, "/runs");
  }
  const age = Math.floor((now.getTime() - customer.createdAt.getTime()) / 86_400_000);
  if (pulse.runs7d === 0 && age >= 3 && customer.whatsappConnected) {
    add("low", "No agent activity in 7 days", "Connected, but the agent hasn't answered anyone this week.", "/runs");
  }
  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export type FleetRow = { customer: CustomerSummary; pulse: Pulse; attention: AttentionItem[] };

export type Fleet = {
  rows: FleetRow[];
  attention: AttentionItem[];
  totals: { customers: number; live: number; setup: number; suspended: number; runs24h: number; attention24h: number; cost7dKes: number };
};

export async function fleetTelemetry(now = new Date()): Promise<Fleet> {
  const customers = await listEngineCustomers();
  const rows: FleetRow[] = [];
  const BATCH = 6;
  for (let i = 0; i < customers.length; i += BATCH) {
    rows.push(
      ...(await Promise.all(
        customers.slice(i, i + BATCH).map(async (customer) => {
          const pulse = await tenantPulse(customer.id);
          return { customer, pulse, attention: attentionItems(customer, pulse, now) };
        }),
      )),
    );
  }
  const attention = rows.flatMap((r) => r.attention).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    rows,
    attention,
    totals: {
      customers: rows.length,
      live: rows.filter((r) => r.customer.status === "active").length,
      setup: rows.filter((r) => r.customer.status === "setup").length,
      suspended: rows.filter((r) => r.customer.status === "suspended").length,
      runs24h: rows.reduce((s, r) => s + r.pulse.runs24h, 0),
      attention24h: rows.reduce((s, r) => s + r.pulse.attention24h, 0),
      cost7dKes: rows.reduce((s, r) => s + r.pulse.cost7dKes, 0),
    },
  };
}

/* ───────────────────────────── Langfuse link-through ───────────────────────────── */

export function langfuseConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_HOST && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/** Link to one run's trace in Langfuse, or null when Langfuse isn't configured. */
export function langfuseTraceUrl(traceId: string | null): string | null {
  const host = process.env.LANGFUSE_HOST?.replace(/\/$/, "");
  if (!host || !traceId) return null;
  return `${host}/trace/${encodeURIComponent(traceId)}`;
}

/** One customer's telemetry plus its setup state: what the workspace overview needs. */
export async function customerWorkspace(tenantId: string, range: TelemetryRange) {
  const [customer, telemetry, pulse] = await Promise.all([
    getEngineCustomer(tenantId),
    customerTelemetry(tenantId, range),
    tenantPulse(tenantId),
  ]);
  return { customer, telemetry, pulse, attention: attentionItems(customer, pulse) };
}


/* ───────────────────────────── Data sources ───────────────────────────── */

export type DataSources = {
  runLog: { runs: number; lastRunAt: Date | null; customersWithRuns: number };
  langfuse: { configured: boolean; host: string | null; tracedRuns: number };
};

/** What is feeding the Engine's numbers right now. Reads each customer in its own context. */
export async function dataSourcesStatus(): Promise<DataSources> {
  const customers = await listEngineCustomers();
  let runs = 0;
  let traced = 0;
  let withRuns = 0;
  let last: Date | null = null;
  const BATCH = 6;
  for (let i = 0; i < customers.length; i += BATCH) {
    const rows = await Promise.all(
      customers.slice(i, i + BATCH).map((c) =>
        withTenant(c.id, async (tx) => {
          const r = ((await tx.execute(
            sql`select count(*)::int as n, count(langfuse_trace_id)::int as traced, max(created_at) as last from agent_runs where tenant_id = ${c.id}`,
          )) as unknown as Row[])[0] ?? {};
          return { n: num(r.n), traced: num(r.traced), last: r.last ? new Date(String(r.last)) : null };
        }),
      ),
    );
    for (const r of rows) {
      runs += r.n;
      traced += r.traced;
      if (r.n > 0) withRuns += 1;
      if (r.last && (!last || r.last > last)) last = r.last;
    }
  }
  // A blank LANGFUSE_HOST (as in .env.example) means "not set", not an empty host.
  const host = process.env.LANGFUSE_HOST?.replace(/\/$/, "") || null;
  return {
    runLog: { runs, lastRunAt: last, customersWithRuns: withRuns },
    langfuse: { configured: langfuseConfigured(), host, tracedRuns: traced },
  };
}

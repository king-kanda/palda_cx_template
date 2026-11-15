import { describe, expect, it } from "vitest";
import { getPreset } from "../../packages/verticals/src/index";
import {
  attentionItems,
  classifyRun,
  emptyBuckets,
  isAttention,
  parseRange,
  type Pulse,
} from "../../packages/services/src/telemetry";
import type { CustomerSummary } from "../../packages/services/src/engine";

const NOW = new Date("2026-11-15T12:00:00+03:00");

function customer(overrides: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: "c1",
    slug: "c1",
    name: "Sparkle",
    vertical: "cleaning",
    verticalTitle: "Cleaning",
    status: "active",
    createdAt: new Date("2026-10-01T09:00:00+03:00"),
    owner: { id: "u1", name: "Owner", email: "o@x.test" },
    counts: { resources: 2, offerings: 3, bookings: 4, customers: 2 },
    agent: { name: "Zuri", tone: "", notes: "", intro: "name", avatar: null },
    whatsappConnected: true,
    business: {
      location: "",
      description: "",
      reviewLink: "",
      workingHours: getPreset("cleaning").defaults.workingHours,
      depositPct: 0,
      cancellationNoticeHours: 24,
    },
    ...overrides,
  };
}

function pulse(overrides: Partial<Pulse> = {}): Pulse {
  return {
    runs24h: 10,
    attention24h: 0,
    limits7d: 0,
    runs7d: 40,
    cost24hKes: 100,
    cost7dKes: 700,
    priorDailyCostKes: 100,
    lastRunAt: NOW,
    openHandoffs: 0,
    oldestHandoffHours: null,
    pendingApprovals: 0,
    oldestApprovalHours: null,
    ...overrides,
  };
}

describe("run classification", () => {
  it("maps stored outcomes to words a person decides from", () => {
    expect(classifyRun({ outcome: "final", flagged: false })).toBe("succeeded");
    expect(classifyRun({ outcome: "handoff", flagged: false })).toBe("handoff");
    expect(classifyRun({ outcome: "tool_loop", flagged: false })).toBe("looping");
    expect(classifyRun({ outcome: "guard", flagged: false })).toBe("blocked");
    expect(classifyRun({ outcome: "max_steps", flagged: false })).toBe("limit");
    expect(classifyRun({ outcome: "flagged", flagged: true })).toBe("flagged");
    // A flagged flag wins even if the stored outcome looks fine.
    expect(classifyRun({ outcome: "final", flagged: true })).toBe("flagged");
  });

  it("only flagged, looping and blocked runs need a person; handoffs and limits do not", () => {
    for (const o of ["flagged", "looping", "blocked"] as const) expect(isAttention(o)).toBe(true);
    for (const o of ["succeeded", "handoff", "limit"] as const) expect(isAttention(o)).toBe(false);
  });
});

describe("time ranges", () => {
  it("defaults to a week and only accepts known ranges", () => {
    expect(parseRange(undefined)).toBe("week");
    expect(parseRange("nonsense")).toBe("week");
    expect(parseRange("day")).toBe("day");
    expect(parseRange("month")).toBe("month");
  });

  it("builds a gap-free, ordered, unique list of buckets for each range", () => {
    const sizes = { day: 24, week: 7, month: 30 } as const;
    for (const range of ["day", "week", "month"] as const) {
      const buckets = emptyBuckets(range, NOW);
      expect(buckets).toHaveLength(sizes[range]);
      const keys = buckets.map((b) => b.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect([...keys].sort()).toEqual(keys);
      expect(buckets.every((b) => b.runs === 0 && b.costKes === 0)).toBe(true);
    }
    expect(emptyBuckets("week", NOW).at(-1)!.key).toBe("2026-11-15");
    expect(emptyBuckets("day", NOW).at(-1)!.key).toBe("2026-11-15T12");
  });
});

describe("what needs a decision", () => {
  it("says nothing about a healthy live customer", () => {
    expect(attentionItems(customer(), pulse(), NOW)).toEqual([]);
  });

  it("flags a customer who is ready to roll out, and one whose setup has stalled", () => {
    const ready = attentionItems(customer({ status: "setup" }), pulse(), NOW);
    expect(ready.map((i) => i.title)).toEqual(["Ready to roll out"]);
    expect(ready[0]!.href).toBe("/engine/c1/rollout");

    const stalled = attentionItems(
      customer({ status: "setup", counts: { resources: 0, offerings: 3, bookings: 0, customers: 0 }, createdAt: new Date("2026-11-01T09:00:00+03:00") }),
      pulse(),
      NOW,
    );
    expect(stalled).toHaveLength(1);
    expect(stalled[0]).toMatchObject({ severity: "low" });
    expect(stalled[0]!.title).toMatch(/stalled for 14 days/);
    expect(stalled[0]!.detail).toMatch(/team or spaces/);

    // A fresh setup that is still being worked on is not a problem yet.
    expect(
      attentionItems(customer({ status: "setup", counts: { resources: 0, offerings: 0, bookings: 0, customers: 0 }, createdAt: new Date("2026-11-14T09:00:00+03:00") }), pulse(), NOW),
    ).toEqual([]);
  });

  it("puts a live customer without WhatsApp first", () => {
    const items = attentionItems(customer({ whatsappConnected: false }), pulse({ attention24h: 1 }), NOW);
    expect(items[0]).toMatchObject({ severity: "high", title: expect.stringMatching(/WhatsApp/) });
  });

  it("escalates replies needing review from medium to high at three", () => {
    expect(attentionItems(customer(), pulse({ attention24h: 1 }), NOW)[0]).toMatchObject({ severity: "medium", title: "1 reply to review" });
    expect(attentionItems(customer(), pulse({ attention24h: 3 }), NOW)[0]).toMatchObject({ severity: "high", title: "3 replies to review" });
  });

  it("treats a customer waiting a day for a person as high, and a fresh handover as low", () => {
    expect(attentionItems(customer(), pulse({ openHandoffs: 2, oldestHandoffHours: 30 }), NOW)[0]).toMatchObject({ severity: "high" });
    expect(attentionItems(customer(), pulse({ openHandoffs: 1, oldestHandoffHours: 2 }), NOW)[0]).toMatchObject({ severity: "low" });
  });

  it("flags step limits, stale approvals and spend spikes, but not small or normal spend", () => {
    expect(attentionItems(customer(), pulse({ limits7d: 2 }), NOW).some((i) => /step limit/.test(i.title))).toBe(true);
    expect(attentionItems(customer(), pulse({ pendingApprovals: 1, oldestApprovalHours: 30 }), NOW).some((i) => /approval/.test(i.title))).toBe(true);
    expect(attentionItems(customer(), pulse({ pendingApprovals: 1, oldestApprovalHours: 3 }), NOW)).toEqual([]);
    expect(attentionItems(customer(), pulse({ cost24hKes: 1500, priorDailyCostKes: 400 }), NOW).some((i) => /spend is up/i.test(i.title))).toBe(true);
    expect(attentionItems(customer(), pulse({ cost24hKes: 300, priorDailyCostKes: 20 }), NOW)).toEqual([]); // under the floor
    expect(attentionItems(customer(), pulse({ cost24hKes: 1500, priorDailyCostKes: 1000 }), NOW)).toEqual([]); // not a spike
  });

  it("notices a connected customer whose agent has gone quiet", () => {
    expect(attentionItems(customer(), pulse({ runs7d: 0, runs24h: 0 }), NOW).some((i) => /No agent activity/.test(i.title))).toBe(true);
    // Brand new customers get a few days' grace.
    expect(attentionItems(customer({ createdAt: new Date("2026-11-14T09:00:00+03:00") }), pulse({ runs7d: 0, runs24h: 0 }), NOW)).toEqual([]);
  });

  it("sorts the most urgent first and ignores suspended customers", () => {
    const items = attentionItems(
      customer(),
      pulse({ attention24h: 1, openHandoffs: 1, oldestHandoffHours: 40, limits7d: 1 }),
      NOW,
    );
    const order = items.map((i) => i.severity);
    expect(order).toEqual([...order].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]));
    expect(order[0]).toBe("high");
    expect(attentionItems(customer({ status: "suspended" }), pulse({ attention24h: 9 }), NOW)).toEqual([]);
  });
});

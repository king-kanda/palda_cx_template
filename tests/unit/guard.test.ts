import { describe, expect, it } from "vitest";
import { getAgentConfig } from "../../agent-engine/src/agents";
import {
  checkDatesGrounded,
  checkForbiddenPromises,
  checkLinks,
  checkMoneyGrounded,
  checkPii,
  checkRepeat,
  guardOutput,
} from "../../agent-engine/src/guard";

describe("money grounding guard", () => {
  const toolResults = [
    { totalKes: 58_000, depositRequiredKes: 17_400, lines: [{ unitPriceKes: 150 }] },
  ];

  it("accepts amounts that appear in tool output", () => {
    expect(
      checkMoneyGrounded("The total is KES 58,000 and the deposit is KES 17,400.", toolResults),
    ).toEqual([]);
  });

  it("rejects an invented price", () => {
    const failures = checkMoneyGrounded("The total is KES 60,000.", toolResults);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("60,000");
  });

  it("accepts the same figure written without thousands separators", () => {
    expect(checkMoneyGrounded("That is KES 58000.", toolResults)).toEqual([]);
  });
});

describe("forbidden promises", () => {
  it("flags phrases the business does not allow", () => {
    const failures = checkForbiddenPromises("I have already sent the refund, you will get it today.", [
      "already sent the refund",
    ]);
    expect(failures).toHaveLength(1);
  });

  it("passes clean replies", () => {
    expect(checkForbiddenPromises("I can request that for you.", ["guaranteed"])).toEqual([]);
  });
});

describe("PII guard", () => {
  it("flags card-like numbers and credentials", () => {
    expect(checkPii("Card 4111 1111 1111 1111")).toHaveLength(1);
    expect(checkPii("your pin: 1234")).toHaveLength(1);
  });

  it("ignores ordinary phone numbers", () => {
    expect(checkPii("Call +254712345678")).toEqual([]);
  });
});

describe("repeat guard", () => {
  it("flags a message repeated too often", () => {
    expect(checkRepeat("Karibu!", ["Karibu!", "Karibu!"], 2)).toHaveLength(1);
  });

  it("allows a fresh message", () => {
    expect(checkRepeat("Karibu!", ["Karibu!"], 2)).toEqual([]);
  });
});

describe("date grounding guard", () => {
  const toolResults = [{ startsAt: "2026-12-20T06:00:00.000Z" }];

  it("accepts a date that a tool returned", () => {
    expect(checkDatesGrounded("Your event is on 20 December 2026.", toolResults)).toEqual([]);
    expect(checkDatesGrounded("Your event is on 2026-12-20.", toolResults)).toEqual([]);
  });

  it("rejects a date that no tool returned", () => {
    const failures = checkDatesGrounded("Your event is on 21 December 2026.", toolResults);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("21 December 2026");
  });

  it("ignores relative dates", () => {
    expect(checkDatesGrounded("See you next Saturday.", toolResults)).toEqual([]);
  });
});

describe("link allowlist guard", () => {
  it("allows links that a tool returned", () => {
    expect(
      checkLinks("Join here: https://meet.jit.si/palda-abc123", [
        { meetingUrl: "https://meet.jit.si/palda-abc123" },
      ]),
    ).toEqual([]);
  });

  it("allows the tenant's own domain", () => {
    expect(
      checkLinks("See https://book.palda.co.ke/intake/palda/abc", [], [
        "https://book.palda.co.ke",
      ]),
    ).toEqual([]);
  });

  it("rejects an invented link", () => {
    const failures = checkLinks("Pay here: https://evil.example/pay", []);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("evil.example");
  });
});

describe("guardOutput", () => {
  it("marks a long reply as failed", () => {
    const config = getAgentConfig("wambo");
    const result = guardOutput({
      text: "x".repeat(config.guard.maxChars + 1),
      config,
      toolResults: [],
      recentOutbound: [],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toContain("too long");
  });

  it("passes a short, grounded, policy-compliant reply", () => {
    const config = getAgentConfig("wambo");
    const result = guardOutput({
      text: "The total is KES 58,000. Would you like me to hold the date?",
      config,
      toolResults: [{ totalKes: 58_000 }],
      recentOutbound: [],
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

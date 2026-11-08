import { describe, expect, it } from "vitest";
import {
  customerPrincipal,
  staffPrincipal,
  systemPrincipal,
} from "../../packages/services/src/types";
import {
  isSensitiveFor,
  visibleTools,
} from "../../packages/mcp-server/src/dispatch";
import { TOOLS } from "../../packages/mcp-server/src/tools";

const TENANT = "00000000-0000-0000-0000-000000000001";

const customer = customerPrincipal({
  tenantId: TENANT,
  customerId: "00000000-0000-0000-0000-0000000000c1",
  phoneE164: "+254712345678",
});

describe("tool contract", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every tool a tier, scopes and a principal type", () => {
    for (const tool of TOOLS) {
      expect(["read", "write-safe", "write-sensitive", "escalate"]).toContain(tool.tier);
      expect(tool.scopes.length).toBeGreaterThan(0);
      expect(tool.principalTypes.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("marks every sensitive tool as approval-gated for customers", () => {
    const sensitive = TOOLS.filter((tool) => tool.tier === "write-sensitive");
    expect(sensitive.length).toBeGreaterThan(0);
    for (const tool of sensitive) {
      expect(isSensitiveFor(tool, customer)).toBe(true);
    }
  });
});

describe("principal scoping", () => {
  it("hides staff-only tools from a customer", () => {
    const names = visibleTools(customer).map((tool) => tool.name);
    expect(names).toContain("bookings.create_hold");
    expect(names).toContain("bookings.get_quote");
    expect(names).not.toContain("blocks.create");
    expect(names).not.toContain("reports.dashboard");
    // Refunds are visible so a customer can *request* one; the tier gate turns
    // the call into an approval instead of a refund.
    expect(names).toContain("payments.refund");
  });

  it("gives an owner every staff tool and hides customer-only tools", () => {
    const owner = staffPrincipal(TENANT, "00000000-0000-0000-0000-0000000000a1", "owner");
    const names = new Set(visibleTools(owner).map((tool) => tool.name));
    for (const tool of TOOLS) {
      if (tool.principalTypes.includes("staff")) {
        expect(names.has(tool.name)).toBe(true);
      } else {
        expect(names.has(tool.name)).toBe(false);
      }
    }
  });

  it("makes refunds and discounts owner-only for staff", () => {
    const staff = staffPrincipal(TENANT, "00000000-0000-0000-0000-0000000000a2", "staff");
    const owner = staffPrincipal(TENANT, "00000000-0000-0000-0000-0000000000a1", "owner");
    const refund = TOOLS.find((tool) => tool.name === "payments.refund");
    const discount = TOOLS.find((tool) => tool.name === "bookings.apply_discount");
    expect(refund && discount).toBeTruthy();

    expect(isSensitiveFor(refund!, staff)).toBe(true);
    expect(isSensitiveFor(refund!, owner)).toBe(false);
    expect(isSensitiveFor(discount!, staff)).toBe(true);
    expect(isSensitiveFor(discount!, owner)).toBe(false);
  });

  it("always treats system principals as needing approval for sensitive writes", () => {
    const system = systemPrincipal(TENANT, "worker");
    for (const tool of TOOLS.filter((entry) => entry.tier === "write-sensitive")) {
      expect(isSensitiveFor(tool, system)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROVIDER_ID,
  INTEGRATION_PROVIDERS,
  integrationDisplay,
  isKnownProvider,
} from "../../packages/services/src/integrations-catalog";

describe("the integration catalog (what a customer sees)", () => {
  it("has unique ids and short names, and the short names are valid tool prefixes", () => {
    const ids = INTEGRATION_PROVIDERS.map((p) => p.id);
    const names = INTEGRATION_PROVIDERS.map((p) => p.defaultName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9]{1,15}$/);
    expect(ids).not.toContain(CUSTOM_PROVIDER_ID);
  });

  it("includes the apps businesses ask for", () => {
    const names = INTEGRATION_PROVIDERS.map((p) => p.name);
    for (const want of ["Zoho Books", "Google Workspace", "Microsoft 365", "QuickBooks", "Xero", "Zoho CRM", "HubSpot"]) {
      expect(names).toContain(want);
    }
  });

  it("describes each app in plain language, with no technical words or connection details", () => {
    for (const p of INTEGRATION_PROVIDERS) {
      expect(p.summary.length).toBeGreaterThan(15);
      expect(p.summary.endsWith(".")).toBe(true);
      expect(`${p.name} ${p.summary}`).not.toMatch(/mcp|server|token|api|endpoint|https?:|webhook|oauth/i);
    }
  });

  it("knows its providers and refuses others", () => {
    expect(isKnownProvider("zoho_books")).toBe(true);
    expect(isKnownProvider("custom")).toBe(true);
    expect(isKnownProvider("evil")).toBe(false);
    expect(isKnownProvider("")).toBe(false);
  });

  it("displays a known app by its catalog name, and a custom one by its label", () => {
    expect(integrationDisplay("zoho_books", "ignored")).toMatchObject({ name: "Zoho Books", category: "Accounting" });
    expect(integrationDisplay("custom", "Our booking system")).toMatchObject({ name: "Our booking system", category: "Other" });
    expect(integrationDisplay("custom", "  ").name).toBe("Connected app");
    expect(integrationDisplay("custom", null).name).toBe("Connected app");
  });
});

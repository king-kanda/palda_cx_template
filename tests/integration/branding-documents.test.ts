import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import {
  DOCUMENT_MAX_BYTES,
  addBusinessDocument,
  brandCss,
  createEngineCustomer,
  createPlatformAdmin,
  deleteBusinessDocument,
  getBusinessDocument,
  getSettings,
  listBusinessDocuments,
  systemPrincipal,
  updateBrand,
  withPrincipal,
  type OnboardingInput,
} from "../../packages/services/src/index";
import { getPreset } from "../../packages/verticals/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const tenantIds: string[] = [];
const adminEmails: string[] = [];

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const text = (s: string) => new TextEncoder().encode(s);

function input(label: string): OnboardingInput {
  const preset = getPreset("cleaning");
  return {
    vertical: "cleaning",
    businessName: `Brand ${label} ${stamp}`,
    location: "Westlands, Nairobi",
    description: "",
    reviewLink: "",
    agent: { name: "Zuri", tone: "", notes: "" },
    resources: preset.starterResources.map((r) => ({ name: r.name, kind: r.kind as "staff" })),
    offerings: preset.offerings.map((o) => ({
      name: o.name,
      resourceKind: o.resourceKind as "staff",
      durationMin: o.durationMin,
      basePriceKes: o.basePriceKes,
      bufferBeforeMin: o.bufferBeforeMin ?? 0,
    })),
    workingHours: Object.fromEntries(
      Object.entries(preset.defaults.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as OnboardingInput["workingHours"],
    depositPct: 0,
    cancellationNoticeHours: 24,
    owner: { name: "Owner", email: `owner-${label}-${stamp}@example.test` },
  };
}

const settingsOf = (tenantId: string) => withPrincipal(systemPrincipal(tenantId, "test"), (ctx) => getSettings(ctx));

describe.skipIf(!enabled)("business branding and documents (needs Postgres)", () => {
  let adminId = "";
  let a = "";
  let b = "";

  it("sets up two customers; neither has a custom brand yet", async () => {
    const email = `brand-admin-${stamp}@palda.test`;
    adminEmails.push(email);
    adminId = (await createPlatformAdmin({ email, name: "Admin", password: "correct-horse-battery" })).id;
    a = (await createEngineCustomer(adminId, input("a"))).tenantId;
    b = (await createEngineCustomer(adminId, input("b"))).tenantId;
    tenantIds.push(a, b);
    for (const t of [a, b]) {
      const s = await settingsOf(t);
      expect(s.brand.custom).toBe(false);
      expect(s.brand.logo).toBeNull();
      expect(brandCss(s.brand)).toBe("");
    }
  });

  it("saves a brand and the customer's settings reflect it, for that customer only", async () => {
    await updateBrand(adminId, a, {
      primary: "#0F4C81",
      accent: "#8FD3F4",
      website: "https://www.sparkle.example",
      tagline: "A spotless home",
      instagram: "https://instagram.com/sparkle",
      email: "hello@sparkle.example",
      phone: "+254 711 333 444",
      logo: PIXEL,
    });
    const sa = await settingsOf(a);
    expect(sa.brand).toMatchObject({ custom: true, primary: "#0F4C81", accent: "#8FD3F4", website: "https://www.sparkle.example", tagline: "A spotless home", logo: PIXEL });
    expect(brandCss(sa.brand)).toContain("--color-brand-800:#0f4c81");
    expect(sa.location).toBe("Westlands, Nairobi");

    const sb = await settingsOf(b);
    expect(sb.brand.custom).toBe(false);
    expect(sb.brand.logo).toBeNull();
    expect(sb.brand.website).toBe("");
  });

  it("the agent's own settings survive a brand save, and two businesses can differ", async () => {
    expect((await settingsOf(a)).agentName).toBe("Zuri");
    await updateBrand(adminId, b, { primary: "#8A3B1E", accent: "#F7C78B", website: "https://www.palda.example" });
    expect((await settingsOf(b)).brand.primary).toBe("#8A3B1E");
    expect((await settingsOf(a)).brand.primary).toBe("#0F4C81");
  });

  it("saving without a logo leaves it; null removes it", async () => {
    await updateBrand(adminId, a, { primary: "#0F4C81", accent: "#8FD3F4", tagline: "Changed" });
    const kept = await settingsOf(a);
    expect(kept.brand.logo).toBe(PIXEL);
    expect(kept.brand.tagline).toBe("Changed");
    await updateBrand(adminId, a, { primary: "#0F4C81", accent: "#8FD3F4", logo: null });
    expect((await settingsOf(a)).brand.logo).toBeNull();
  });

  it("refuses unreadable colours and unsafe values, and saves nothing", async () => {
    await expect(updateBrand(adminId, a, { primary: "#DDDDDD", accent: "#8FD3F4" })).rejects.toThrow(/too light/);
    await expect(updateBrand(adminId, a, { primary: "#0F4C81", accent: "#0F5083" })).rejects.toThrow(/accent/i);
    await expect(updateBrand(adminId, a, { primary: "#0F4C81", accent: "#8FD3F4", website: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(updateBrand(adminId, a, { primary: "#0F4C81", accent: "#8FD3F4", logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).rejects.toThrow();
    expect((await settingsOf(a)).brand.primary).toBe("#0F4C81");
  });

  it("branding changes are audited", async () => {
    const rows = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, a) });
    expect(rows.some((r) => r.action === "engine.brand_updated")).toBe(true);
  });

  /* ───────────────────────────────── documents ───────────────────────────────── */

  let docId = "";

  it("uploads a document; the list never carries the file contents", async () => {
    const res = await addBusinessDocument(adminId, a, {
      title: "Price guide",
      kind: "price_list",
      filename: "../prices 2026.txt",
      bytes: text("Standard clean: KES 3,000"),
    });
    docId = res.id;
    const list = await listBusinessDocuments(a);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "Price guide", kind: "price_list", filename: "prices 2026.txt", mime: "text/plain" });
    expect(Object.keys(list[0]!)).not.toContain("data");
  });

  it("downloads the exact bytes back", async () => {
    const doc = await getBusinessDocument(a, docId);
    expect(Buffer.from(doc.data).toString("utf8")).toBe("Standard clean: KES 3,000");
    expect(doc.sizeBytes).toBe(25);
  });

  it("another customer cannot see, fetch or delete it", async () => {
    expect(await listBusinessDocuments(b)).toEqual([]);
    await expect(getBusinessDocument(b, docId)).rejects.toThrow();
    await expect(deleteBusinessDocument(adminId, b, docId)).rejects.toThrow();
    expect((await listBusinessDocuments(a)).length).toBe(1);
  });

  it("refuses files that are the wrong type, wrong content, empty or too big", async () => {
    const add = (filename: string, bytes: Uint8Array, title = "x doc") => addBusinessDocument(adminId, a, { title, kind: "other", filename, bytes });
    await expect(add("run.exe", new Uint8Array([0x4d, 0x5a, 0x90]))).rejects.toThrow(/isn't allowed/);
    await expect(add("page.html", text("<script>alert(1)</script>"))).rejects.toThrow(/isn't allowed/);
    await expect(add("logo.svg", text("<svg onload=alert(1)>"))).rejects.toThrow(/isn't allowed/);
    await expect(add("fake.pdf", text("<html>not a pdf</html>"))).rejects.toThrow(/real \.pdf/);
    await expect(add("empty.txt", new Uint8Array())).rejects.toThrow(/empty/);
    await expect(add("big.txt", new Uint8Array(DOCUMENT_MAX_BYTES + 1).fill(65))).rejects.toThrow(/too large/);
    await expect(add("ok.txt", text("fine"), "x")).rejects.toThrow(/title/);
    expect((await listBusinessDocuments(a)).length).toBe(1);
  });

  it("accepts a real PDF and treats an unknown type as 'other'", async () => {
    const pdf = await addBusinessDocument(adminId, a, { title: "Brochure", kind: "brochure", filename: "brochure.pdf", bytes: text("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n") });
    const doc = await getBusinessDocument(a, pdf.id);
    expect(doc.mime).toBe("application/pdf");
    const odd = await addBusinessDocument(adminId, a, { title: "Misc", kind: "not-a-kind", filename: "notes.md", bytes: text("# Notes") });
    expect((await getBusinessDocument(a, odd.id)).kind).toBe("other");
    expect((await getBusinessDocument(a, odd.id)).mime).toBe("text/plain"); // from the extension, never from the browser
  });

  it("deleting removes it and is audited; the token-free audit trail names the file", async () => {
    await deleteBusinessDocument(adminId, a, docId);
    await expect(getBusinessDocument(a, docId)).rejects.toThrow();
    const rows = await getDb().query.auditLog.findMany({ where: eq(schema.auditLog.tenantId, a) });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("engine.document_added");
    expect(actions).toContain("engine.document_removed");
  });
});

afterAll(async () => {
  if (!enabled) return;
  for (const id of tenantIds) await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
  for (const email of adminEmails) await getDb().delete(schema.platformAdmins).where(eq(schema.platformAdmins.email, email.toLowerCase()));
  await closeDb();
});

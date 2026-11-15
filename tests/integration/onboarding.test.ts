import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import { passwordVerify } from "../../packages/integrations/src/index";
import {
  addDays,
  createBookingFor,
  createBusiness,
  dateKey,
  findAccountsByEmail,
  getSettings,
  nairobiTime,
  seedDemoTenant,
  staffPrincipal,
  withPrincipal,
  type OnboardingInput,
} from "../../packages/services/src/index";
import {
  VERTICAL_IDS,
  getPreset,
  type BookingField,
  type VerticalId,
} from "../../packages/verticals/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const createdTenantIds: string[] = [];

function inputFor(vertical: VerticalId, slug: string): OnboardingInput {
  const preset = getPreset(vertical);
  return {
    vertical,
    businessName: `Onboard ${vertical} ${stamp}`,
    slug,
    location: "Nairobi",
    description: "",
    reviewLink: "",
    resources: preset.starterResources.map((r) => ({
      name: r.name,
      kind: r.kind as "space" | "staff" | "room" | "equipment",
      capacity: r.capacity ?? null,
    })),
    offerings: preset.offerings.map((o) => ({
      name: o.name,
      resourceKind: o.resourceKind as "space" | "staff" | "room" | "equipment",
      durationMin: o.durationMin,
      basePriceKes: o.basePriceKes,
      bufferBeforeMin: o.bufferBeforeMin ?? 0,
      bufferAfterMin: o.bufferAfterMin ?? 0,
      attributes: o.attributes ?? {},
    })),
    workingHours: Object.fromEntries(
      Object.entries(preset.defaults.workingHours).map(([d, h]) => [d, h ?? null]),
    ) as OnboardingInput["workingHours"],
    depositPct: preset.defaults.depositPct,
    cancellationNoticeHours: 36,
    owner: { name: "Test Owner", email: `owner-${slug}@example.test`, password: "test-password-1234" },
  };
}

function sampleAttributes(fields: BookingField[]): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "select") attributes[field.key] = field.defaultValue ?? field.options?.[0]?.value;
    else if (field.required) attributes[field.key] = "12 Test Street, Nairobi";
  }
  return attributes;
}

/**
 * Self-serve onboarding: a new business created from any vertical preset must be
 * immediately usable (settings load, owner can sign in, staff can book through the
 * same attribute fields the UI renders) and must not inherit another tenant's data.
 */
describe.skipIf(!enabled)("onboarding (needs Postgres)", () => {
  for (const vertical of VERTICAL_IDS) {
    it(`creates a usable ${vertical} business with no demo data`, async () => {
      const slug = `ob-${vertical}-${stamp}`;
      const result = await createBusiness(inputFor(vertical, slug));
      createdTenantIds.push(result.tenantId);
      const db = getDb();

      // Tenant, vertical and owner login
      const tenant = await db.query.tenants.findFirst({ where: eq(schema.tenants.id, result.tenantId) });
      expect(tenant?.slug).toBe(slug);
      expect(tenant?.vertical).toBe(vertical);
      const owner = await db.query.users.findFirst({ where: eq(schema.users.id, result.ownerId) });
      expect(owner?.role).toBe("owner");
      expect(passwordVerify("test-password-1234", owner!.passwordHash)).toBe(true);
      expect(passwordVerify("wrong-password", owner!.passwordHash)).toBe(false);

      // Preset data, but no demo bookings or customers
      const preset = getPreset(vertical);
      const resources = await db.query.resources.findMany({ where: eq(schema.resources.tenantId, result.tenantId) });
      const offerings = await db.query.offerings.findMany({ where: eq(schema.offerings.tenantId, result.tenantId) });
      const addons = await db.query.addons.findMany({ where: eq(schema.addons.tenantId, result.tenantId) });
      expect(resources).toHaveLength(preset.starterResources.length);
      expect(offerings).toHaveLength(preset.offerings.length);
      expect(addons).toHaveLength(preset.addons.length);
      expect(await db.query.bookings.findMany({ where: eq(schema.bookings.tenantId, result.tenantId) })).toHaveLength(0);
      expect(await db.query.customers.findMany({ where: eq(schema.customers.tenantId, result.tenantId) })).toHaveLength(0);
      for (const offering of offerings) {
        const source = preset.offerings.find((o) => o.name === offering.name)!;
        expect(offering.bufferBeforeMin).toBe(source.bufferBeforeMin ?? 0);
      }

      // Settings resolve through the normal path
      const principal = staffPrincipal(result.tenantId, result.ownerId, "owner");
      const settings = await withPrincipal(principal, (ctx) => getSettings(ctx));
      expect(settings.vertical).toBe(vertical);
      expect(settings.cancellationNoticeHours).toBe(36);
      expect(settings.workingHours[1]).toBeTruthy();

      // No cross-tenant leakage: the demo garden's review link must not be inherited
      expect(settings.reviewLink).toBe("");
      expect(settings.reviewLink).not.toContain("palda-gardens");
      expect(settings.businessFacts).not.toContain("Palda Gardens");
      const faqText = JSON.stringify(settings.faq);
      expect(faqText).not.toContain("Karen");
      expect(faqText).not.toContain("Ngong");
      expect(faqText).toContain("36 hours"); // generated from this business's own policy

      // Staff can book using exactly the fields the form renders
      const offering = offerings[0]!;
      const resource = resources.find((r) => r.kind === offering.resourceKind)!;
      const monday = (() => {
        let key = addDays(dateKey(new Date()), 2);
        while (new Date(`${key}T12:00:00+03:00`).getUTCDay() !== 1) key = addDays(key, 1);
        return key;
      })();
      const created = await createBookingFor(principal, {
        customer: { name: "Test Customer", phone: "+254700111222" },
        offeringId: offering.id,
        resourceIds: [resource.id],
        startsAt: nairobiTime(monday, "10:00").toISOString(),
        partySize: 1,
        status: "hold",
        source: "staff",
        attributes: sampleAttributes(preset.bookingFields),
        idempotencyKey: `onboard-${vertical}-${stamp}`,
      });
      expect(created.booking.tenantId).toBe(result.tenantId);
    });
  }

  it("rejects a cleaning booking that carries the venue-only eventType field", async () => {
    const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, `ob-cleaning-${stamp}`) });
    expect(tenant).toBeTruthy();
    const owner = await getDb().query.users.findFirst({ where: eq(schema.users.tenantId, tenant!.id) });
    const offering = await getDb().query.offerings.findFirst({ where: eq(schema.offerings.tenantId, tenant!.id) });
    const resource = await getDb().query.resources.findFirst({ where: eq(schema.resources.tenantId, tenant!.id) });
    await expect(
      createBookingFor(staffPrincipal(tenant!.id, owner!.id, "owner"), {
        customer: { name: "Bad Attr", phone: "+254700333444" },
        offeringId: offering!.id,
        resourceIds: [resource!.id],
        startsAt: nairobiTime(addDays(dateKey(new Date()), 10), "10:00").toISOString(),
        partySize: 1,
        status: "hold",
        source: "staff",
        attributes: { eventType: "wedding" },
      }),
    ).rejects.toThrow(/Invalid booking attributes/);
  });

  it("refuses a duplicate or reserved short name and bad input, creating nothing", async () => {
    const slug = `ob-dupe-${stamp}`;
    const first = await createBusiness(inputFor("salon", slug));
    createdTenantIds.push(first.tenantId);

    await expect(
      createBusiness({ ...inputFor("salon", slug), owner: { ...inputFor("salon", slug).owner, email: `dupe2-${stamp}@example.test` } }),
    ).rejects.toThrow(/taken/i);
    await expect(createBusiness(inputFor("salon", "admin"))).rejects.toThrow(/reserved/i);
    await expect(createBusiness({ ...inputFor("salon", `ob-bad-${stamp}`), slug: "bad slug!" })).rejects.toThrow();

    // A service that needs a resource kind the business doesn't have is refused before anything is written.
    const broken = inputFor("dental", `ob-broken-${stamp}`);
    broken.resources = broken.resources.filter((r) => r.kind !== "staff");
    await expect(createBusiness(broken)).rejects.toThrow(/needs at least one/i);

    const leftovers = await getDb().query.tenants.findMany({ where: eq(schema.tenants.slug, `ob-broken-${stamp}`) });
    expect(leftovers).toHaveLength(0);
  });

  it("needs no workspace name: generates a unique internal short name from the business name", async () => {
    const base = { ...inputFor("cleaning", "unused"), businessName: `Sparkle Auto ${stamp}` };
    const { slug: _omit, ...input } = base;
    const first = await createBusiness({ ...input, owner: { ...input.owner, email: `a-${stamp}@example.test` } });
    const second = await createBusiness({ ...input, owner: { ...input.owner, email: `b-${stamp}@example.test` } });
    createdTenantIds.push(first.tenantId, second.tenantId);
    expect(first.slug).toBe(`sparkle-auto-${stamp}`.slice(0, 32).replace(/-+$/g, ""));
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(first.slug.slice(0, 26))).toBe(true);
  });

  it("signs in by email alone: finds exactly the owner's business, and refuses a second business with the same email", async () => {
    const email = `solo-${stamp}@example.test`;
    const { slug: _omit, ...input } = inputFor("dental", "unused");
    const created = await createBusiness({ ...input, businessName: `Solo Dental ${stamp}`, owner: { ...input.owner, email } });
    createdTenantIds.push(created.tenantId);

    const accounts = await findAccountsByEmail(email.toUpperCase());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.tenant.id).toBe(created.tenantId);
    expect(accounts[0]!.user.id).toBe(created.ownerId);
    expect(passwordVerify("test-password-1234", accounts[0]!.user.passwordHash)).toBe(true);
    expect(await findAccountsByEmail(`nobody-${stamp}@example.test`)).toHaveLength(0);

    await expect(
      createBusiness({ ...input, businessName: `Other Dental ${stamp}`, owner: { ...input.owner, email } }),
    ).rejects.toThrow(/already registered/i);
  });

  it("seeds the cleaning demo tenant with addressed jobs, travel buffers and its own review link", async () => {
    const slug = `ob-demo-cleaning-${stamp}`;
    const seeded = await seedDemoTenant({
      slug,
      name: "Seeded Cleaners",
      vertical: "cleaning",
      ownerEmail: `owner-${slug}@example.test`,
      ownerPassword: "test-password-1234",
      staffEmail: `staff-${slug}@example.test`,
      staffPassword: "test-password-1234",
      reset: true,
    });
    createdTenantIds.push(seeded.tenantId);
    expect(seeded.counts.bookings).toBeGreaterThanOrEqual(8);
    expect(seeded.counts.skipped).toBe(0);

    const bookings = await getDb().query.bookings.findMany({ where: eq(schema.bookings.tenantId, seeded.tenantId) });
    const withAddress = bookings.filter((b) => typeof (b.attributes as Record<string, unknown>).address === "string");
    expect(withAddress.length).toBe(bookings.length);

    const principal = staffPrincipal(seeded.tenantId, (await getDb().query.users.findFirst({ where: eq(schema.users.tenantId, seeded.tenantId) }))!.id, "owner");
    const settings = await withPrincipal(principal, (ctx) => getSettings(ctx));
    expect(settings.reviewLink).toBe(`https://g.page/r/${slug}/review`);
    expect(settings.labels.booking).toBe("Job");
  });

  afterAll(async () => {
    if (!enabled) return;
    for (const id of createdTenantIds) {
      await getDb().delete(schema.tenants).where(eq(schema.tenants.id, id));
    }
    await closeDb();
  });
});

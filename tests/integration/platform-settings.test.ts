import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, loadEnv, schema } from "../../packages/db/src/index";
import { applyPlatformSettings, platformSetting, whatsappMode } from "../../packages/integrations/src/index";
import { getPlatformSettingsView, loadPlatformSettings, savePlatformSettings } from "../../packages/services/src/index";

loadEnv();

const enabled = Boolean(process.env.DATABASE_URL);

/**
 * Meta / WhatsApp settings saved from the Engine. This shares the development database, so whatever is saved there before
 * the test is put back afterwards, exactly.
 */
describe.skipIf(!enabled)("platform settings saved from the Engine (needs Postgres)", () => {
  let before: (typeof schema.platformSettings.$inferSelect)[] = [];
  const env = { ...process.env };

  beforeAll(async () => {
    before = await getDb().select().from(schema.platformSettings);
    await getDb().delete(schema.platformSettings);
    for (const k of ["WHATSAPP_MODE", "META_APP_ID", "META_APP_SECRET", "WHATSAPP_APP_SECRET", "META_ES_CONFIG_ID", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_GRAPH_VERSION"]) {
      delete process.env[k];
    }
    applyPlatformSettings({});
  });

  afterAll(async () => {
    await getDb().delete(schema.platformSettings);
    if (before.length) await getDb().insert(schema.platformSettings).values(before);
    process.env = { ...env };
    applyPlatformSettings({});
    await closeDb();
  });

  it("refuses to go live while anything live WhatsApp needs is missing", async () => {
    await expect(savePlatformSettings("engine:test", { values: { WHATSAPP_MODE: "cloud", META_APP_ID: "123456789" } })).rejects.toThrow(
      /Live WhatsApp needs: Meta app secret, Embedded Signup configuration ID, Webhook verify token/,
    );
    expect(await getDb().select().from(schema.platformSettings)).toHaveLength(0); // nothing half-saved
    expect(whatsappMode()).toBe("mock");
  });

  it("rejects malformed values", async () => {
    await expect(savePlatformSettings("engine:test", { values: { META_APP_ID: "abc" } })).rejects.toThrow(/app ID is a number/);
    await expect(savePlatformSettings("engine:test", { values: { WHATSAPP_GRAPH_VERSION: "21" } })).rejects.toThrow(/v21.0/);
    await expect(savePlatformSettings("engine:test", { values: { WHATSAPP_VERIFY_TOKEN: "short" } })).rejects.toThrow(/12 characters/);
  });

  it("saves everything, encrypted, and goes live", async () => {
    await savePlatformSettings("engine:test", {
      values: {
        WHATSAPP_MODE: "cloud",
        META_APP_ID: "123456789",
        META_APP_SECRET: "super-secret-app-secret",
        META_ES_CONFIG_ID: "987654321",
        WHATSAPP_VERIFY_TOKEN: "verify-token-abcdef",
        WHATSAPP_GRAPH_VERSION: "v23.0",
      },
    });
    expect(whatsappMode()).toBe("cloud");
    const rows = await getDb().select().from(schema.platformSettings);
    expect(rows).toHaveLength(6);
    expect(JSON.stringify(rows)).not.toContain("super-secret-app-secret");
    expect(rows.every((r) => r.updatedBy === "engine:test")).toBe(true);

    // The page never gets the secret back, only a hint.
    const secret = getPlatformSettingsView().find((s) => s.key === "META_APP_SECRET")!;
    expect(secret).toMatchObject({ value: null, hint: "…cret", source: "engine" });
  });

  it("another process picks the saved values up from the database", async () => {
    applyPlatformSettings({}); // as if this were the agent service, freshly started
    expect(whatsappMode()).toBe("mock");
    await loadPlatformSettings();
    expect(whatsappMode()).toBe("cloud");
    expect(platformSetting("META_APP_SECRET")).toBe("super-secret-app-secret");
  });

  it("a blank secret keeps the saved one; removing a key falls back to .env", async () => {
    await savePlatformSettings("engine:test", { values: { META_APP_SECRET: "" } });
    expect(platformSetting("META_APP_SECRET")).toBe("super-secret-app-secret");

    process.env.WHATSAPP_GRAPH_VERSION = "v22.0";
    await savePlatformSettings("engine:test", { values: {}, clear: ["WHATSAPP_GRAPH_VERSION"] });
    expect(platformSetting("WHATSAPP_GRAPH_VERSION")).toBe("v22.0");
  });

  it("can't strand the platform live by removing something it needs", async () => {
    await expect(savePlatformSettings("engine:test", { values: {}, clear: ["META_APP_SECRET"] })).rejects.toThrow(/Meta app secret/);
    expect(platformSetting("META_APP_SECRET")).toBe("super-secret-app-secret");
    // switching back to mock in the same save is fine
    await savePlatformSettings("engine:test", { values: { WHATSAPP_MODE: "mock" }, clear: ["META_APP_SECRET"] });
    expect(whatsappMode()).toBe("mock");
    expect(platformSetting("META_APP_SECRET")).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlatformSettings,
  graphVersion,
  metaConfig,
  platformSetting,
  platformSettingSource,
  signatureForTests,
  verifyWebhookSignature,
  webhookChallenge,
  whatsappMode,
} from "../../packages/integrations/src/index";

const saved = { ...process.env };
afterEach(() => {
  applyPlatformSettings({});
  process.env = { ...saved };
});

describe("platform settings", () => {
  it("a value saved in the Engine wins over .env; an empty one falls back to .env", () => {
    process.env.META_APP_ID = "111111";
    expect(platformSetting("META_APP_ID")).toBe("111111");
    expect(platformSettingSource("META_APP_ID")).toBe("env");

    applyPlatformSettings({ META_APP_ID: "222222" });
    expect(platformSetting("META_APP_ID")).toBe("222222");
    expect(platformSettingSource("META_APP_ID")).toBe("engine");
    expect(metaConfig().appId).toBe("222222");

    applyPlatformSettings({ META_APP_ID: "  " });
    expect(platformSetting("META_APP_ID")).toBe("111111");
  });

  it("switches WhatsApp mode and Graph version without a restart", () => {
    delete process.env.WHATSAPP_MODE;
    delete process.env.WHATSAPP_GRAPH_VERSION;
    expect(whatsappMode()).toBe("mock");
    expect(graphVersion()).toBe("v21.0");
    applyPlatformSettings({ WHATSAPP_MODE: "cloud", WHATSAPP_GRAPH_VERSION: "v23.0" });
    expect(whatsappMode()).toBe("cloud");
    expect(graphVersion()).toBe("v23.0");
    applyPlatformSettings({ WHATSAPP_MODE: "something-else" });
    expect(whatsappMode()).toBe("mock"); // anything but "cloud" is safe mock mode
  });

  it("verifies Meta's webhook signature with META_APP_SECRET (it used to read only WHATSAPP_APP_SECRET)", () => {
    process.env.WHATSAPP_MODE = "cloud";
    delete process.env.WHATSAPP_APP_SECRET;
    process.env.META_APP_SECRET = "app-secret-1";
    const body = '{"entry":[]}';
    expect(verifyWebhookSignature(body, signatureForTests(body, "app-secret-1"))).toBe(true);
    expect(verifyWebhookSignature(body, signatureForTests(body, "wrong"))).toBe(false);

    // the older name still works, and a secret saved in the Engine takes over
    delete process.env.META_APP_SECRET;
    process.env.WHATSAPP_APP_SECRET = "legacy";
    expect(verifyWebhookSignature(body, signatureForTests(body, "legacy"))).toBe(true);
    applyPlatformSettings({ META_APP_SECRET: "from-engine" });
    expect(verifyWebhookSignature(body, signatureForTests(body, "from-engine"))).toBe(true);
    expect(verifyWebhookSignature(body, signatureForTests(body, "legacy"))).toBe(false);
  });

  it("answers Meta's verification only with the configured token, never with an empty one", () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const q = (token: string) => new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    expect(webhookChallenge(q(""))).toBeNull(); // unset token must not match an empty one
    applyPlatformSettings({ WHATSAPP_VERIFY_TOKEN: "verify-token-123" });
    expect(webhookChallenge(q("verify-token-123"))).toBe("42");
    expect(webhookChallenge(q("nope"))).toBeNull();
  });
});

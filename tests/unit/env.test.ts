import { describe, expect, it } from "vitest";
import { missingRuntimeEnv } from "../../packages/db/src/env";

const base = { MPESA_MODE: "mock", WHATSAPP_MODE: "mock", MEETINGS_MODE: "mock" };

describe("runtime configuration validation", () => {
  it("accepts the default mock configuration", () => {
    expect(missingRuntimeEnv(base)).toEqual([]);
  });

  it("requires Tuma credentials and a public HTTPS callback", () => {
    const problems = missingRuntimeEnv({
      ...base,
      MPESA_MODE: "tuma",
      TUMA_EMAIL: "",
      TUMA_API_KEY: "",
      TUMA_CALLBACK_URL: "http://localhost:3000/api/mpesa/callback",
    });
    expect(problems).toContain("MPESA_MODE=tuma: TUMA_EMAIL is empty");
    expect(problems).toContain("MPESA_MODE=tuma: TUMA_API_KEY is empty");
    expect(problems).toContain(
      "MPESA_MODE=tuma: TUMA_CALLBACK_URL must be a public https:// URL",
    );
  });

  it("accepts complete Tuma configuration", () => {
    expect(
      missingRuntimeEnv({
        ...base,
        MPESA_MODE: "tuma",
        TUMA_EMAIL: "merchant@example.test",
        TUMA_API_KEY: "key",
        TUMA_CALLBACK_URL: "https://bookings.example.test/api/mpesa/callback",
      }),
    ).toEqual([]);
  });

  it("falls back to MPESA_CALLBACK_URL for Tuma", () => {
    expect(
      missingRuntimeEnv({
        ...base,
        MPESA_MODE: "tuma",
        TUMA_EMAIL: "merchant@example.test",
        TUMA_API_KEY: "key",
        MPESA_CALLBACK_URL: "https://bookings.example.test/api/mpesa/callback",
      }),
    ).toEqual([]);
  });

  it("requires Daraja credentials when that mode is selected", () => {
    const problems = missingRuntimeEnv({ ...base, MPESA_MODE: "daraja" });
    expect(problems).toEqual(
      expect.arrayContaining([
        "MPESA_MODE=daraja: MPESA_CONSUMER_KEY is empty",
        "MPESA_MODE=daraja: MPESA_CONSUMER_SECRET is empty",
        "MPESA_MODE=daraja: MPESA_PASSKEY is empty",
        "MPESA_MODE=daraja: MPESA_CALLBACK_URL is empty",
      ]),
    );
  });

  it("requires only the Meta APP values when cloud mode is selected (each customer connects their own number)", () => {
    const problems = missingRuntimeEnv({ ...base, WHATSAPP_MODE: "cloud" });
    expect(problems).toContain("WHATSAPP_MODE=cloud: META_APP_ID is empty");
    expect(problems).toContain("WHATSAPP_MODE=cloud: META_ES_CONFIG_ID is empty");
    expect(problems).toContain("WHATSAPP_MODE=cloud: WHATSAPP_VERIFY_TOKEN is empty");
    expect(problems.some((p) => /META_APP_SECRET/.test(p))).toBe(true);
    // the old global, single-number values are no longer required: they belong to each customer now
    expect(problems.join(" ")).not.toContain("WHATSAPP_PHONE_NUMBER_ID");
    expect(problems.join(" ")).not.toContain("WHATSAPP_ACCESS_TOKEN");
  });

  it("accepts a complete Meta app configuration, and the old app-secret name as an alias", () => {
    const meta = { ...base, WHATSAPP_MODE: "cloud", META_APP_ID: "1", META_ES_CONFIG_ID: "2", WHATSAPP_VERIFY_TOKEN: "v" };
    expect(missingRuntimeEnv({ ...meta, META_APP_SECRET: "s" })).toEqual([]);
    expect(missingRuntimeEnv({ ...meta, WHATSAPP_APP_SECRET: "s" })).toEqual([]);
    expect(missingRuntimeEnv(meta).some((p) => /META_APP_SECRET/.test(p))).toBe(true);
  });

  it("rejects an unknown mode instead of silently defaulting", () => {
    const problems = missingRuntimeEnv({ ...base, MPESA_MODE: "tumaa" });
    expect(problems[0]).toContain('MPESA_MODE="tumaa"');
  });

  it("rejects an unimplemented meetings provider", () => {
    const problems = missingRuntimeEnv({ ...base, MEETINGS_MODE: "google" });
    expect(problems[0]).toContain('MEETINGS_MODE="google"');
  });

  it("does not let a real model id run without its API key", () => {
    expect(
      missingRuntimeEnv({ ...base, WAMBO_MODEL: "anthropic/claude-sonnet-4.5" }),
    ).toEqual([
      'WAMBO_MODEL="anthropic/claude-sonnet-4.5" requires OPENROUTER_API_KEY (or set WAMBO_MODEL=mock for offline replies)',
    ]);
    expect(
      missingRuntimeEnv({
        ...base,
        WAMBO_MODEL: "anthropic/claude-sonnet-4.5",
        OPENROUTER_API_KEY: "sk-test",
      }),
    ).toEqual([]);
  });
});

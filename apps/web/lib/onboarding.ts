import { timingSafeEqual } from "node:crypto";

/**
 * Self-serve business setup is a public endpoint that creates tenants, so it is gated:
 *  - ONBOARDING_CODE set      -> enabled, and the wizard asks for that invite code
 *  - ONBOARDING_ENABLED=true  -> enabled without a code (demos, internal use)
 *  - otherwise                -> enabled outside production only
 */
export function onboardingStatus(): { enabled: boolean; codeRequired: boolean } {
  const code = process.env.ONBOARDING_CODE?.trim() ?? "";
  const enabled =
    code.length > 0 || process.env.ONBOARDING_ENABLED === "true" || process.env.NODE_ENV !== "production";
  return { enabled, codeRequired: code.length > 0 };
}

export function onboardingCodeMatches(input: string): boolean {
  const expected = Buffer.from(process.env.ONBOARDING_CODE?.trim() ?? "");
  const given = Buffer.from(input.trim());
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

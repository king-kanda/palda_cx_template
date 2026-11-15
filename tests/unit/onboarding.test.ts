import { describe, expect, it } from "vitest";
import { getPreset } from "../../packages/verticals/src/index";
import { onboardingSchema, slugifyBusinessName, type OnboardingInput } from "../../packages/services/src/onboarding";
import { stripReviewLink } from "../../packages/services/src/notify";

function validInput(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  const preset = getPreset("cleaning");
  return {
    vertical: "cleaning",
    businessName: "Sparkle Cleaners",
    slug: "sparkle-cleaners",
    location: "Kilimani, Nairobi",
    description: "",
    reviewLink: "",
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
    owner: { name: "Amina Hassan", email: "Amina@Sparkle.co.ke", password: "a-long-password" },
    ...overrides,
  };
}

describe("onboarding input", () => {
  it("accepts a preset-derived setup and normalises the email and slug", () => {
    const parsed = onboardingSchema.parse(validInput({ slug: "  Sparkle-Cleaners " }));
    expect(parsed.slug).toBe("sparkle-cleaners");
    expect(parsed.owner.email).toBe("amina@sparkle.co.ke");
  });

  it("does not need a short name: people never type one", () => {
    const { slug: _omit, ...withoutSlug } = validInput();
    expect(onboardingSchema.safeParse(withoutSlug).success).toBe(true);
  });

  it("derives a safe internal short name from the business name", () => {
    expect(slugifyBusinessName("Sparkle Cleaners Ltd.")).toBe("sparkle-cleaners-ltd");
    expect(slugifyBusinessName("  Café   Zéro!! ")).toBe("cafe-zero");
    expect(slugifyBusinessName("A")).toMatch(/^[a-z0-9-]{3,32}$/);
    expect(slugifyBusinessName("🙂🙂")).toMatch(/^[a-z0-9-]{3,32}$/);
    expect(slugifyBusinessName("x".repeat(80)).length).toBeLessThanOrEqual(32);
    for (const name of ["Sparkle Cleaners Ltd.", "Café Zéro", "O'Brien & Sons", "123"]) {
      expect(slugifyBusinessName(name)).toMatch(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
    }
  });

  it("still validates a short name when one is supplied", () => {
    for (const slug of ["a", "ab", "has space", "-leading", "trailing-", "UPPER_case", "x".repeat(41), "emoji-🙂"]) {
      expect(onboardingSchema.safeParse(validInput({ slug })).success, slug).toBe(false);
    }
  });

  it("rejects short passwords, bad emails and unknown verticals", () => {
    expect(
      onboardingSchema.safeParse(validInput({ owner: { name: "A B", email: "a@b.co", password: "short" } })).success,
    ).toBe(false);
    expect(
      onboardingSchema.safeParse(validInput({ owner: { name: "A B", email: "nope", password: "long-enough-1" } }))
        .success,
    ).toBe(false);
    expect(onboardingSchema.safeParse({ ...validInput(), vertical: "plumbing" }).success).toBe(false);
  });

  it("rejects hours that close before they open, and malformed times", () => {
    const hours = { ...validInput().workingHours, "1": { open: "18:00", close: "09:00" } };
    expect(onboardingSchema.safeParse(validInput({ workingHours: hours })).success).toBe(false);
    const bad = { ...validInput().workingHours, "1": { open: "9am", close: "5pm" } };
    expect(onboardingSchema.safeParse(validInput({ workingHours: bad })).success).toBe(false);
  });

  it("requires at least one resource and one service, and a valid review link when given", () => {
    expect(onboardingSchema.safeParse(validInput({ resources: [] })).success).toBe(false);
    expect(onboardingSchema.safeParse(validInput({ offerings: [] })).success).toBe(false);
    expect(onboardingSchema.safeParse(validInput({ reviewLink: "not a url" })).success).toBe(false);
    expect(onboardingSchema.safeParse(validInput({ reviewLink: "https://g.page/r/abc/review" })).success).toBe(true);
  });

  it("bounds money and policy numbers", () => {
    expect(onboardingSchema.safeParse(validInput({ depositPct: 101 })).success).toBe(false);
    expect(onboardingSchema.safeParse(validInput({ cancellationNoticeHours: -1 })).success).toBe(false);
  });
});

describe("review link hygiene", () => {
  it("removes the placeholder and its lead-in when a business has no review link", () => {
    expect(stripReviewLink("Thanks! We'd love a review: {{review_link}}")).toBe("Thanks! We'd love a review");
    expect(stripReviewLink("Rate us - {{ review_link }} thanks")).toBe("Rate us thanks");
    expect(stripReviewLink("No link here")).toBe("No link here");
  });
});

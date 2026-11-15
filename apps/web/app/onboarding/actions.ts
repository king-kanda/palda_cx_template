"use server";

import { redirect } from "next/navigation";
import { createBusiness, ServiceError } from "@garden/services";
import { createSession } from "@/lib/auth";
import { onboardingCodeMatches, onboardingStatus } from "@/lib/onboarding";

export type OnboardingState = { error?: string };

export async function createBusinessAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const status = onboardingStatus();
  if (!status.enabled) return { error: "Self-serve setup is turned off on this server." };
  if (status.codeRequired && !onboardingCodeMatches(String(formData.get("code") ?? ""))) {
    return { error: "That invite code isn't right. Ask whoever invited you for the code." };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Something went wrong reading the form. Please try again." };
  }

  let result;
  try {
    result = await createBusiness(payload as Parameters<typeof createBusiness>[0]);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[onboarding] unexpected failure", error);
    return { error: "We couldn't set up your business. Please try again." };
  }

  await createSession({
    userId: result.ownerId,
    tenantId: result.tenantId,
    tenantSlug: result.slug,
    role: "owner",
    email: result.ownerEmail,
    name: result.ownerName,
  });
  redirect("/dashboard?welcome=1");
}

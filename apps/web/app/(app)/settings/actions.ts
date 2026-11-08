"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addonInputSchema,
  createAddon,
  createOffering,
  createResource,
  offeringInputSchema,
  resourceInputSchema,
  updateConfig,
  updateResource,
  withPrincipal,
  type ServiceContext,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}

export async function savePoliciesAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const depositPct = Number(formData.get("depositPct") ?? 0);
  const taxPct = Number(formData.get("taxPct") ?? 0);
  const holdHours = Number(formData.get("holdHours") ?? 48);
  const cancellationNoticeHours = Number(formData.get("cancellationNoticeHours") ?? 72);
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      updateConfig(ctx, "policies", {
        depositPct,
        taxPct,
        holdHours,
        cancellationNoticeHours,
      }),
    );
    revalidatePath("/settings");
  } catch (error) {
    fail(error);
  }
}

export async function saveBusinessAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const slotIntervalMin = Number(formData.get("slotIntervalMin") ?? 30);
  const arrivalTime = String(formData.get("arrivalTime") ?? "10:00");
  const location = String(formData.get("location") ?? "").trim();
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      updateConfig(ctx, "business", {
        slotIntervalMin,
        arrivalTime,
        location,
      }),
    );
    revalidatePath("/settings");
  } catch (error) {
    fail(error);
  }
}

export async function createResourceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const kind = String(formData.get("kind") ?? "space") as "space" | "staff" | "room" | "equipment";
  const name = String(formData.get("name") ?? "").trim();
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const parentResourceId = String(formData.get("parentResourceId") ?? "").trim();
  try {
    const input = resourceInputSchema.parse({
      kind,
      name,
      capacity: capacityRaw ? Number(capacityRaw) : null,
      parentResourceId: parentResourceId || null,
      attributes: {},
      sortOrder: 0,
    });
    await withPrincipal(principalOf(session), (ctx) => createResource(ctx, input));
    revalidatePath("/settings");
    revalidatePath("/bookings");
    revalidatePath("/calendar");
  } catch (error) {
    fail(error);
  }
}

export async function deactivateResourceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const resourceId = String(formData.get("resourceId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => updateResource(ctx, resourceId, { active: false }));
    revalidatePath("/settings");
  } catch (error) {
    fail(error);
  }
}

export async function createOfferingAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  try {
    const input = offeringInputSchema.parse({
      name: String(formData.get("name") ?? "").trim(),
      resourceKind: String(formData.get("resourceKind") ?? "space") as never,
      durationMin: Number(formData.get("durationMin") ?? 60),
      bufferBeforeMin: Number(formData.get("bufferBeforeMin") ?? 0),
      bufferAfterMin: Number(formData.get("bufferAfterMin") ?? 0),
      basePriceKes: Number(formData.get("basePriceKes") ?? 0),
      depositPct: null,
      attributes: {},
    });
    await withPrincipal(principalOf(session), (ctx) => createOffering(ctx, input));
    revalidatePath("/settings");
    revalidatePath("/bookings");
  } catch (error) {
    fail(error);
  }
}

export async function createAddonAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  try {
    const input = addonInputSchema.parse({
      name: String(formData.get("name") ?? "").trim(),
      priceKes: Number(formData.get("priceKes") ?? 0),
      unit: String(formData.get("unit") ?? "each"),
    });
    await withPrincipal(principalOf(session), (ctx) => createAddon(ctx, input));
    revalidatePath("/settings");
  } catch (error) {
    fail(error);
  }
}

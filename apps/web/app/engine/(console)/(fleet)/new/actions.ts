"use server";

import { redirect } from "next/navigation";
import { createEngineCustomer, ServiceError } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";

export type NewCustomerState = { error?: string };

export async function createCustomerAction(_prev: NewCustomerState, formData: FormData): Promise<NewCustomerState> {
  const admin = await requireEngineAdmin();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "Something went wrong reading the form. Please try again." };
  }

  let result;
  try {
    result = await createEngineCustomer(admin.id, payload as Parameters<typeof createEngineCustomer>[1]);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    console.error("[engine] create customer failed", error);
    return { error: "We couldn't create this customer. Please try again." };
  }
  redirect(`/engine/${result.tenantId}`);
}

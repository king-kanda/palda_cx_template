"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addNote,
  upsertCustomerFor,
  updateTags,
  withPrincipal,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createCustomerAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const language = String(formData.get("language") ?? "en");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!name || !phone) fail("/customers", new Error("Name and phone are required."));

  try {
    const customer = await upsertCustomerFor(principalOf(session), {
      name,
      phone,
      email: email || null,
      language,
      tags,
    });
    revalidatePath("/customers");
    redirect(`/customers/${customer.id}`);
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    fail("/customers", error);
  }
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const customerId = String(formData.get("customerId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) fail(`/customers/${customerId}`, new Error("Note cannot be empty."));
  try {
    await withPrincipal(principalOf(session), (ctx) => addNote(ctx, customerId, note));
    revalidatePath(`/customers/${customerId}`);
  } catch (error) {
    fail(`/customers/${customerId}`, error);
  }
}

export async function updateTagsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const customerId = String(formData.get("customerId") ?? "");
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  try {
    await withPrincipal(principalOf(session), (ctx) => updateTags(ctx, customerId, tags));
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/customers");
  } catch (error) {
    fail(`/customers/${customerId}`, error);
  }
}

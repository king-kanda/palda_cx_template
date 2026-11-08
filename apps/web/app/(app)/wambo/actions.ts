"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  handBackToAgent,
  resolveHandoff,
  sendStaffMessage,
  takeOverConversation,
  withPrincipal,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function takeOverAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => takeOverConversation(ctx, conversationId));
    revalidatePath("/wambo");
    revalidatePath(`/wambo/${conversationId}`);
  } catch (error) {
    fail(`/wambo/${conversationId}`, error);
  }
}

export async function handBackAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => handBackToAgent(ctx, conversationId));
    revalidatePath("/wambo");
    revalidatePath(`/wambo/${conversationId}`);
  } catch (error) {
    fail(`/wambo/${conversationId}`, error);
  }
}

export async function resolveHandoffAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const handoffId = String(formData.get("handoffId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => resolveHandoff(ctx, handoffId));
    revalidatePath("/wambo");
    revalidatePath(`/wambo/${conversationId}`);
  } catch (error) {
    fail("/wambo", error);
  }
}

export async function staffMessageAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) fail(`/wambo/${conversationId}`, new Error("Message cannot be empty."));
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      sendStaffMessage(ctx, { conversationId, text }),
    );
    revalidatePath(`/wambo/${conversationId}`);
    revalidatePath("/wambo");
  } catch (error) {
    fail(`/wambo/${conversationId}`, error);
  }
}

/** Asks the agent service for a Wambo reply and stores it in the thread. */
export async function agentReplyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const conversationId = String(formData.get("conversationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) fail(`/wambo/${conversationId}`, new Error("Message cannot be empty."));

  const base = process.env.AGENT_SERVICE_URL ?? "http://localhost:3100";
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/internal/reply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.INTERNAL_SECRET ? { "x-internal-secret": process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({
        tenantSlug: session.tenantSlug,
        conversationId,
        text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Agent service returned ${response.status}.`);
    }
    revalidatePath(`/wambo/${conversationId}`);
    revalidatePath("/wambo");
  } catch (error) {
    fail(`/wambo/${conversationId}`, error);
  }
}

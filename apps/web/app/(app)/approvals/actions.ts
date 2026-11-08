"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  decideApproval,
  executeApproval,
  withPrincipal,
  type Principal,
} from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`/approvals?error=${encodeURIComponent(message)}`);
}

async function runApproved(
  principal: Principal,
  approvalId: string,
): Promise<{ executed: boolean; manual: boolean }> {
  const execution = await withPrincipal(principal, (ctx) => executeApproval(ctx, approvalId));
  if (!execution.executed) {
    // Tool-backed approvals are executed by the MCP dispatcher. Surface a clear
    // message rather than silently marking them done.
    return { executed: false, manual: true };
  }
  return { executed: true, manual: false };
}

export async function approveAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const approvalId = String(formData.get("approvalId") ?? "");
  const principal = principalOf(session);
  try {
    await withPrincipal(principal, (ctx) => decideApproval(ctx, approvalId, "approved"));
    await runApproved(principal, approvalId);
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
  } catch (error) {
    fail(error);
  }
}

export async function rejectAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const approvalId = String(formData.get("approvalId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      decideApproval(ctx, approvalId, "rejected"),
    );
    revalidatePath("/approvals");
    revalidatePath("/dashboard");
  } catch (error) {
    fail(error);
  }
}

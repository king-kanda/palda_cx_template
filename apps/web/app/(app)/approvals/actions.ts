"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decideApproval, withPrincipal, type Principal } from "@garden/services";
import { executeApprovedAction } from "@garden/mcp-server";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`/approvals?error=${encodeURIComponent(message)}`);
}

/** Carries out the approved action, including tool-backed ones the agent asked for (e.g. "email the customer from Gmail"). */
async function runApproved(principal: Principal, approvalId: string): Promise<void> {
  await executeApprovedAction(principal, approvalId);
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

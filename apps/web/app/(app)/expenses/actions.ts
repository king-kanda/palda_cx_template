"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createExpense, deleteExpense, withPrincipal } from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(path: string, error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createExpenseAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const category = String(formData.get("category") ?? "other");
  const amountKes = Number(formData.get("amountKes") ?? 0);
  const vendor = String(formData.get("vendor") ?? "").trim();
  const incurredOn = String(formData.get("incurredOn") ?? "");
  const receiptUrl = String(formData.get("receiptUrl") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  try {
    await withPrincipal(principalOf(session), (ctx) =>
      createExpense(ctx, {
        category: category as never,
        amountKes,
        vendor: vendor || null,
        incurredOn: incurredOn ? new Date(`${incurredOn}T12:00:00+03:00`).toISOString() : new Date().toISOString(),
        receiptUrl: receiptUrl || null,
        notes: notes || null,
      }),
    );
    revalidatePath("/expenses");
  } catch (error) {
    fail("/expenses", error);
  }
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const expenseId = String(formData.get("expenseId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => deleteExpense(ctx, expenseId));
    revalidatePath("/expenses");
  } catch (error) {
    fail("/expenses", error);
  }
}

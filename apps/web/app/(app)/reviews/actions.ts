"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordReview, requestReview, withPrincipal } from "@garden/services";
import { requireSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  redirect(`/reviews?error=${encodeURIComponent(message)}`);
}

export async function requestReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  try {
    await withPrincipal(principalOf(session), (ctx) => requestReview(ctx, bookingId));
    revalidatePath("/reviews");
  } catch (error) {
    fail(error);
  }
}

export async function recordReviewAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId") ?? "");
  const rating = Number(formData.get("rating") ?? 0);
  const comment = String(formData.get("comment") ?? "").trim();
  try {
    await withPrincipal(principalOf(session), (ctx) =>
      recordReview(ctx, { bookingId, rating, comment: comment || undefined }),
    );
    revalidatePath("/reviews");
    revalidatePath("/bookings");
  } catch (error) {
    fail(error);
  }
}

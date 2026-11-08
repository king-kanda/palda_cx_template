import { and, desc, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, getSettings, type ServiceContext } from "./context";
import { sendFreeform } from "./notify";
import { createHandoff } from "./handoffs";
import { ForbiddenError, NotFoundError, ValidationError } from "./types";

export async function requestReview(
  ctx: ServiceContext,
  bookingId: string,
): Promise<typeof schema.reviews.$inferSelect> {
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", bookingId);
  if (ctx.principal.type === "customer" && booking.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only review your own booking.");
  }
  const existing = await ctx.db.query.reviews.findFirst({
    where: and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.bookingId, bookingId)),
  });
  if (existing) return existing;
  const [review] = await ctx.db
    .insert(schema.reviews)
    .values({ tenantId: ctx.tenantId, bookingId, requestedAt: new Date() })
    .returning();

  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, booking.customerId),
  });
  const settings = await getSettings(ctx);
  if (customer) {
    const template = settings.preset.templates.thank_you_review;
    if (template) {
      await sendFreeform(
        ctx,
        customer,
        template
          .replace(/\{\{customer_name\}\}/g, customer.name)
          .replace(/\{\{review_link\}\}/g, settings.reviewLink)
          .replace(/\{\{business_name\}\}/g, settings.tenant.name),
      );
    }
  }
  await audit(ctx, "review.requested", "review", review!.id, { bookingId });
  return review!;
}

export async function recordReview(
  ctx: ServiceContext,
  input: { bookingId: string; rating: number; comment?: string },
): Promise<{ review: typeof schema.reviews.$inferSelect; handoffId?: string }> {
  if (input.rating < 1 || input.rating > 5) throw new ValidationError("Rating must be 1-5.");
  const booking = await ctx.db.query.bookings.findFirst({
    where: and(eq(schema.bookings.id, input.bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
  });
  if (!booking) throw new NotFoundError("Booking", input.bookingId);
  if (ctx.principal.type === "customer" && booking.customerId !== ctx.principal.customerId) {
    throw new ForbiddenError("You can only review your own booking.");
  }
  const settings = await getSettings(ctx);
  const existing = await ctx.db.query.reviews.findFirst({
    where: and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.bookingId, input.bookingId)),
  });
  let review: typeof schema.reviews.$inferSelect;
  if (existing) {
    const [updated] = await ctx.db
      .update(schema.reviews)
      .set({
        rating: input.rating,
        comment: input.comment ?? null,
        receivedAt: new Date(),
        publicLinkSent: input.rating >= 4 ? true : existing.publicLinkSent,
      })
      .where(eq(schema.reviews.id, existing.id))
      .returning();
    review = updated!;
  } else {
    const [created] = await ctx.db
      .insert(schema.reviews)
      .values({
        tenantId: ctx.tenantId,
        bookingId: input.bookingId,
        rating: input.rating,
        comment: input.comment ?? null,
        requestedAt: new Date(),
        receivedAt: new Date(),
        publicLinkSent: input.rating >= 4,
      })
      .returning();
    review = created!;
  }

  let handoffId: string | undefined;
  const customer = await ctx.db.query.customers.findFirst({
    where: eq(schema.customers.id, booking.customerId),
  });

  if (input.rating <= 3) {
    let conversation = await ctx.db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.tenantId, ctx.tenantId),
        eq(schema.conversations.customerId, booking.customerId),
      ),
    });
    if (!conversation) {
      const [created] = await ctx.db
        .insert(schema.conversations)
        .values({
          tenantId: ctx.tenantId,
          customerId: booking.customerId,
          channel: "whatsapp",
          state: "open",
        })
        .returning();
      conversation = created!;
    }
    const handoff = await createHandoff(ctx, {
      conversationId: conversation.id,
      reason: `Low review score (${input.rating}/5): ${input.comment ?? "no comment"}`,
      priority: "high",
      notifyCustomer: false,
    });
    handoffId = handoff.id;
  } else if (customer) {
    await sendFreeform(
      ctx,
      customer,
      `Asante sana ${customer.name}! We're glad you enjoyed it. Would you share a quick review? ${settings.reviewLink}`,
    );
  }

  await audit(ctx, "review.recorded", "review", review.id, { rating: input.rating, handoffId });
  return { review, handoffId };
}

export async function listReviews(ctx: ServiceContext) {
  return ctx.db
    .select({
      review: schema.reviews,
      booking: schema.bookings,
      customer: schema.customers,
    })
    .from(schema.reviews)
    .innerJoin(schema.bookings, eq(schema.reviews.bookingId, schema.bookings.id))
    .innerJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
    .where(eq(schema.reviews.tenantId, ctx.tenantId))
    .orderBy(desc(schema.reviews.receivedAt))
    .limit(100);
}

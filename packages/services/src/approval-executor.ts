import { and, eq } from "drizzle-orm";
import { schema } from "@garden/db";
import { audit, getSettings, type ServiceContext } from "./context";
import { cancelBookingInternal } from "./bookings";
import { recalculateInvoices } from "./invoices";
import { markApprovalExecuted } from "./approvals";
import { sendFreeform } from "./notify";
import { getQuote } from "./pricing";
import { NotFoundError, ValidationError } from "./types";

export type ApprovalExecution =
  | { executed: true; result: Record<string, unknown> }
  | { executed: false; pendingTool: { tool: string; args: Record<string, unknown> } };

/**
 * Executes an approved action exactly once. Tool-backed approvals (e.g. the
 * generic `other` kind produced by the MCP layer) are handed back to the caller,
 * which invokes the tool and then calls markApprovalExecuted.
 */
export async function executeApproval(
  ctx: ServiceContext,
  approvalId: string,
): Promise<ApprovalExecution> {
  const approval = await ctx.db.query.approvals.findFirst({
    where: and(eq(schema.approvals.id, approvalId), eq(schema.approvals.tenantId, ctx.tenantId)),
  });
  if (!approval) throw new NotFoundError("Approval", approvalId);
  if (approval.status !== "approved") {
    throw new ValidationError(`Approval must be approved before execution (is ${approval.status}).`);
  }
  const payload = approval.payload as Record<string, unknown>;

  if (typeof payload.tool === "string") {
    return {
      executed: false,
      pendingTool: { tool: payload.tool, args: (payload.args as Record<string, unknown>) ?? {} },
    };
  }

  switch (approval.kind) {
    case "cancel_outside_policy": {
      const bookingId = String(payload.bookingId ?? "");
      const reason = String(payload.reason ?? "Cancelled outside policy (approved)");
      const booking = await cancelBookingInternal(ctx, bookingId, reason);
      await markApprovalExecuted(ctx, approvalId, { bookingId: booking.id });
      return { executed: true, result: { bookingId: booking.id } };
    }
    case "discount":
    case "override_price": {
      const bookingId = String(payload.bookingId ?? "");
      const booking = await ctx.db.query.bookings.findFirst({
        where: and(eq(schema.bookings.id, bookingId), eq(schema.bookings.tenantId, ctx.tenantId)),
      });
      if (!booking) throw new NotFoundError("Booking", bookingId);
      const discountKes =
        approval.kind === "discount"
          ? Number(payload.discountKes ?? 0)
          : Math.max(0, booking.subtotalKes + booking.taxKes - Number(payload.totalKes ?? booking.totalKes));
      if (discountKes < 0 || discountKes > booking.subtotalKes) {
        throw new ValidationError("Approved discount is out of range.");
      }
      const quote = await getQuote(ctx, { offeringId: booking.offeringId, discountKes });
      await ctx.db
        .update(schema.bookings)
        .set({
          discountKes,
          taxKes: quote.taxKes,
          totalKes: quote.totalKes,
          depositRequiredKes: quote.depositRequiredKes,
          updatedAt: new Date(),
        })
        .where(eq(schema.bookings.id, bookingId));
      await recalculateInvoices(ctx, bookingId);
      await markApprovalExecuted(ctx, approvalId, { bookingId, discountKes });
      return { executed: true, result: { bookingId, discountKes } };
    }
    case "refund": {
      const bookingId = String(payload.bookingId ?? "");
      const amountKes = Number(payload.amountKes ?? 0);
      if (amountKes <= 0) throw new ValidationError("Refund amount is invalid.");
      const [payment] = await ctx.db
        .insert(schema.payments)
        .values({
          tenantId: ctx.tenantId,
          bookingId,
          method: "refund",
          amountKes,
          status: "succeeded",
          receivedAt: new Date(),
          rawPayload: { reason: payload.reason ?? "approved refund", approvalId },
        })
        .returning();
      await recalculateInvoices(ctx, bookingId);
      await markApprovalExecuted(ctx, approvalId, { paymentId: payment!.id, amountKes });
      return { executed: true, result: { paymentId: payment!.id, amountKes } };
    }
    case "bulk_send": {
      const message = String(payload.message ?? "");
      const customerIds = Array.isArray(payload.customerIds) ? (payload.customerIds as string[]) : [];
      if (!message || customerIds.length === 0) throw new ValidationError("Bulk send payload is incomplete.");
      if (customerIds.length > 200) throw new ValidationError("Bulk send is capped at 200 recipients.");
      let sent = 0;
      for (const customerId of customerIds) {
        const customer = await ctx.db.query.customers.findFirst({
          where: and(eq(schema.customers.id, customerId), eq(schema.customers.tenantId, ctx.tenantId)),
        });
        if (!customer) continue;
        await sendFreeform(ctx, customer, message);
        sent += 1;
      }
      await markApprovalExecuted(ctx, approvalId, { sent });
      return { executed: true, result: { sent } };
    }
    default: {
      const settings = await getSettings(ctx);
      await audit(ctx, `approval.${settings.vertical}.executed_manually`, "approval", approvalId);
      await markApprovalExecuted(ctx, approvalId, { manual: true });
      return { executed: true, result: { manual: true } };
    }
  }
}

export function approvalTitle(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "refund":
      return `Refund KES ${Number(payload.amountKes ?? 0).toLocaleString("en-KE")}`;
    case "discount":
      return `Discount KES ${Number(payload.discountKes ?? 0).toLocaleString("en-KE")}`;
    case "cancel_outside_policy":
      return "Cancel outside policy";
    case "bulk_send":
      return "Bulk WhatsApp send";
    case "override_price":
      return `Price override to KES ${Number(payload.totalKes ?? 0).toLocaleString("en-KE")}`;
    default:
      return typeof payload.tool === "string" ? `Tool: ${payload.tool}` : "Approval request";
  }
}

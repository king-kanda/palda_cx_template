/**
 * Audit-log actions in plain words, for the dashboard's activity feed. The raw action name (e.g. `booking.created`) is never
 * shown to a person: anything not listed here falls back to "updated <entity>".
 */
const PHRASES: Record<string, string> = {
  "addon.created": "added an add-on",
  "addon.updated": "updated an add-on",
  "approval.approved": "approved a request",
  "approval.rejected": "turned down a request",
  "approval.executed": "carried out an approved request",
  "integration.connected": "connected an app",
  "integration.disconnected": "disconnected an app",
  "integration.google_event_added": "added a booking to Google Calendar",
  "integration.google_email_sent": "emailed a customer from Gmail",
  "integration.zoho_invoice_created": "raised an invoice in Zoho Books",
  "whatsapp.connected": "connected WhatsApp",
  "whatsapp.disconnected": "disconnected WhatsApp",
  "payments.provider_enabled": "turned on a payment provider",
  "payments.provider_disabled": "turned off a payment provider",
  "approval.requested": "asked for approval",
  "block.created": "blocked off dates",
  "block.deleted": "reopened blocked dates",
  "booking.cancelled": "cancelled a booking",
  "booking.completed": "completed a booking",
  "booking.confirmed": "confirmed a booking",
  "booking.created": "created a booking",
  "booking.discount": "applied a discount",
  "booking.intake_form_sent": "sent an intake form",
  "booking.intake_submitted": "submitted an intake form",
  "booking.meeting_link_created": "created a meeting link",
  "booking.recall_scheduled": "scheduled a recall",
  "booking.rescheduled": "rescheduled a booking",
  "complaint.logged": "logged a complaint",
  "config.updated": "changed settings",
  "conversation.app_reply_takeover": "replied from the WhatsApp app",
  "conversation.staff_message": "replied in a chat",
  "conversation.takeover": "took over a chat",
  "customer.created": "added a customer",
  "customer.erased": "erased a customer's data",
  "customer.note": "added a customer note",
  "customer.sensitive.deleted": "removed private customer details",
  "customer.sensitive.updated": "updated private customer details",
  "customer.tags": "tagged a customer",
  "expense.created": "recorded an expense",
  "expense.deleted": "deleted an expense",
  "handoff.created": "asked a person to step in",
  "handoff.handed_back": "handed a chat back",
  "handoff.resolved": "resolved a handoff",
  "invoice.generated": "created an invoice",
  "invoice.sent": "sent an invoice",
  "invoice.voided": "voided an invoice",
  "memory.deleted": "deleted a memory",
  "memory.forgotten": "forgot a detail",
  "memory.remembered": "remembered a detail",
  "offering.created": "added a service",
  "offering.updated": "updated a service",
  "payment.matched": "matched a payment",
  "payment.mpesa_callback": "received an M-Pesa payment",
  "payment.mpesa_failed": "saw an M-Pesa payment fail",
  "payment.options_sent": "sent payment options",
  "payment.provider_failed": "saw a payment fail",
  "payment.provider_unverified": "flagged an unverified payment",
  "payment.recorded": "recorded a payment",
  "payment.refunded": "refunded a payment",
  "payment.stk_initiated": "sent an M-Pesa payment request",
  "payments.provider_moved": "changed payment provider order",
  "payments.provider_removed": "removed a payment provider",
  "payments.provider_saved": "set up a payment provider",
  "payments.templates_submitted": "submitted message templates",
  "resource.created": "added a space",
  "resource.updated": "updated a space",
  "review.recorded": "received a review",
  "review.requested": "asked for a review",
};

export function activityPhrase(action: string, entity: string): string {
  return PHRASES[action] ?? `updated ${entity.replace(/_/g, " ")}`;
}

/** Where an activity row should link, when the thing it touched has a page. */
export function activityHref(entity: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entity) {
    case "booking":
      return `/bookings/${entityId}`;
    case "invoice":
      return `/invoices/${entityId}`;
    case "customer":
      return `/customers/${entityId}`;
    case "conversation":
      return `/wambo/${entityId}`;
    default:
      return null;
  }
}

/** "2.45M", "177K", "950": short money for chart axes and tiles. The full figure is always one hover away. */
export function compactKes(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `${Math.round(amount / 1_000)}K`;
  return String(Math.round(amount));
}

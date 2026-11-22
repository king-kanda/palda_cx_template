import { z } from "zod";
import * as svc from "@garden/services";
import type { ServiceContext } from "@garden/services";
import {
  googleBusy,
  googleCreateEvent,
  googleSendEmail,
  odooFindPartner,
  odooInvoices,
  odooSavePartner,
  zohoBooksCreateContact,
  zohoBooksCreateInvoice,
  zohoBooksFindContact,
  zohoBooksInvoices,
  zohoCrmAddNote,
  zohoCrmFindLead,
  zohoCrmSaveLead,
} from "@garden/integrations";
import type { AnyToolDef, ToolDef } from "./tools";

/**
 * The agent's tools for the apps a business connects (Google Workspace, Zoho Books, Zoho CRM, Odoo). Our own code, reviewed and
 * tested, calling the vendor APIs with the business's stored credentials through `svc.withApp`.
 *
 * Rules every tool here follows:
 *  - It acts only for the customer being served: for a customer principal that is the person chatting; for staff it is the
 *    customer of the booking (or `customerId`). People are matched in the app by their exact email or phone, never fuzzily.
 *  - Money and dates come from the app's answer or our own booking, never from the model.
 *  - Every tool starts switched OFF for a business and is only offered while the app is connected (see agent-config).
 */

const define = <S extends z.ZodTypeAny>(def: ToolDef<S> & { integration: svc.AppId }): AnyToolDef => def as unknown as AnyToolDef;

const READ = ["apps:read", "apps:read_own"];
const WRITE = ["apps:write", "apps:write_own"];
const WHO = ["customer", "staff", "system"] as ToolDef["principalTypes"];
const iso = z.string().min(10).max(40);

async function subject(ctx: ServiceContext, customerId?: string) {
  const id = ctx.principal.type === "customer" ? ctx.principal.customerId : customerId;
  if (!id) throw new svc.ValidationError("customerId is required.");
  const c = await svc.getCustomer(ctx, id);
  return { id: c.id, name: c.name, email: c.email, phone: c.phoneE164 };
}

/** The booking, checked to belong to the customer being served (getBookingDetail enforces it for customers). */
async function ownBooking(ctx: ServiceContext, bookingId: string) {
  return svc.getBookingDetail(ctx, bookingId);
}

/** Before an approval is even requested: the booking must be the customer's own and the app connected. */
const ownBookingAndApp = (app: svc.AppId) => async (ctx: ServiceContext, args: { bookingId: string }) => {
  await ownBooking(ctx, args.bookingId);
  if (!(await svc.healthyApps(ctx.tenantId)).has(app)) throw new svc.AppNotConnectedError(app);
};

const sum = (xs: { balanceKes: number }[]) => xs.reduce((n, x) => n + x.balanceKes, 0);

/* ─────────────────────────────── Google Workspace ─────────────────────────────── */

const google: AnyToolDef[] = [
  define({
    name: "google.calendar_busy",
    group: "google_workspace",
    integration: "google_workspace",
    description:
      "Busy times on the business's Google Calendar between two times (ISO, at most 14 days apart). Use it before promising a meeting time outside the booking system.",
    tier: "read",
    principalTypes: WHO,
    scopes: READ,
    input: z.object({ from: iso, to: iso }).strict(),
    async handler(ctx, args) {
      const from = new Date(args.from);
      const to = new Date(args.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new svc.ValidationError("Give a valid from/to range.");
      if (to.getTime() - from.getTime() > 14 * 86_400_000) throw new svc.ValidationError("Ask for at most 14 days at a time.");
      const busy = await svc.withApp(ctx, "google_workspace", (a) => googleBusy(a.token, { from: from.toISOString(), to: to.toISOString() }));
      return { from: from.toISOString(), to: to.toISOString(), busy, free: busy.length === 0 };
    },
  }),
  define({
    name: "google.calendar_add_event",
    group: "google_workspace",
    integration: "google_workspace",
    description:
      "Adds a confirmed booking to the business's Google Calendar (title, time and the customer as a guest if they have an email). Only for a booking that belongs to the customer.",
    tier: "write-safe",
    principalTypes: WHO,
    scopes: WRITE,
    input: z.object({ bookingId: z.string().uuid(), idempotencyKey: z.string().min(6).max(80).optional() }).strict(),
    async handler(ctx, args) {
      const b = await ownBooking(ctx, args.bookingId);
      if (!["hold", "confirmed"].includes(b.booking.status)) throw new svc.ValidationError("Only an upcoming booking can be added to the calendar.");
      const event = await svc.withApp(ctx, "google_workspace", (a) =>
        googleCreateEvent(a.token, {
          summary: `${b.offering.name} · ${b.customer.name}`,
          description: `Booking ${b.booking.id.slice(0, 8)} · ${b.booking.partySize} guest(s) · ${b.customer.phoneE164}`,
          start: b.booking.startsAt.toISOString(),
          end: b.booking.endsAt.toISOString(),
          attendeeEmail: b.customer.email,
        }),
      );
      await svc.audit(ctx, "integration.google_event_added", "booking", b.booking.id, { eventId: event.id });
      return { added: true, start: event.start, end: event.end, link: event.link, invitedCustomer: Boolean(b.customer.email) };
    },
  }),
  define({
    name: "google.email_customer",
    group: "google_workspace",
    integration: "google_workspace",
    description:
      "Emails the customer of a booking from the business's Gmail (to the email on their profile only). Needs an owner's approval before it is sent.",
    tier: "write-sensitive",
    principalTypes: WHO,
    scopes: WRITE,
    input: z
      .object({
        bookingId: z.string().uuid(),
        subject: z.string().trim().min(3).max(150),
        body: z.string().trim().min(10).max(4000),
      })
      .strict(),
    authorize: async (ctx, args) => {
      await ownBookingAndApp("google_workspace")(ctx, args);
      const b = await ownBooking(ctx, args.bookingId);
      if (!b.customer.email) throw new svc.ValidationError("This customer has no email address on file. Ask for one first.");
    },
    async handler(ctx, args) {
      const b = await ownBooking(ctx, args.bookingId);
      if (!b.customer.email) throw new svc.ValidationError("This customer has no email address on file. Ask for one first.");
      const sent = await svc.withApp(ctx, "google_workspace", (a) =>
        googleSendEmail(a.token, { to: b.customer.email!, subject: args.subject, body: args.body }),
      );
      await svc.audit(ctx, "integration.google_email_sent", "booking", b.booking.id, { messageId: sent.id });
      return { sent: true, to: b.customer.email };
    },
  }),
];

/* ─────────────────────────────── Zoho Books ─────────────────────────────── */

const zohoBooks: AnyToolDef[] = [
  define({
    name: "zohobooks.my_invoices",
    group: "zoho_books",
    integration: "zoho_books",
    description: "The customer's own invoices in the business's Zoho Books: number, dates, total, balance and status.",
    tier: "read",
    principalTypes: WHO,
    scopes: READ,
    input: z.object({ customerId: z.string().uuid().optional() }).strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      return svc.withApp(ctx, "zoho_books", async (a) => {
        const contact = await zohoBooksFindContact(a, who);
        if (!contact) return { found: false, invoices: [], message: "No Zoho Books account matches this customer's email or phone." };
        const invoices = await zohoBooksInvoices(a, contact.id);
        return { found: true, invoices, totalBalanceKes: sum(invoices) };
      });
    },
  }),
  define({
    name: "zohobooks.my_balance",
    group: "zoho_books",
    integration: "zoho_books",
    description: "How much the customer owes in the business's Zoho Books (sum of unpaid balances) and how many invoices are open.",
    tier: "read",
    principalTypes: WHO,
    scopes: READ,
    input: z.object({ customerId: z.string().uuid().optional() }).strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      return svc.withApp(ctx, "zoho_books", async (a) => {
        const contact = await zohoBooksFindContact(a, who);
        if (!contact) return { found: false, balanceKes: 0, openInvoices: 0 };
        const invoices = await zohoBooksInvoices(a, contact.id);
        const open = invoices.filter((i) => i.balanceKes > 0);
        return { found: true, balanceKes: sum(open), openInvoices: open.length };
      });
    },
  }),
  define({
    name: "zohobooks.invoice_booking",
    group: "zoho_books",
    integration: "zoho_books",
    description:
      "Raises a draft invoice in the business's Zoho Books for a booking, for the booking's total as computed by Palda CX. Creates the customer in Zoho Books if needed. Needs an owner's approval.",
    tier: "write-sensitive",
    principalTypes: WHO,
    scopes: WRITE,
    input: z.object({ bookingId: z.string().uuid() }).strict(),
    authorize: ownBookingAndApp("zoho_books"),
    async handler(ctx, args) {
      const b = await ownBooking(ctx, args.bookingId);
      if (b.booking.totalKes <= 0) throw new svc.ValidationError("This booking has no amount to invoice.");
      const who = { name: b.customer.name, email: b.customer.email, phone: b.customer.phoneE164 };
      const invoice = await svc.withApp(ctx, "zoho_books", async (a) => {
        const contact = (await zohoBooksFindContact(a, who)) ?? (await zohoBooksCreateContact(a, who));
        return zohoBooksCreateInvoice(a, {
          contactId: contact.id,
          reference: `Palda ${b.booking.id.slice(0, 8)}`,
          itemName: b.offering.name,
          description: `Booking on ${b.booking.startsAt.toISOString().slice(0, 10)} for ${b.booking.partySize} guest(s)`,
          amountKes: b.booking.totalKes,
        });
      });
      await svc.audit(ctx, "integration.zoho_invoice_created", "booking", b.booking.id, { number: invoice.number });
      return { created: true, ...invoice };
    },
  }),
];

/* ─────────────────────────────── Zoho CRM ─────────────────────────────── */

const zohoCrm: AnyToolDef[] = [
  define({
    name: "zohocrm.save_lead",
    group: "zoho_crm",
    integration: "zoho_crm",
    description:
      "Saves the customer as a lead in the business's Zoho CRM (creates it, or updates the existing lead with the same email or phone). Add a one-line summary of what they want.",
    tier: "write-safe",
    principalTypes: WHO,
    scopes: WRITE,
    input: z.object({ summary: z.string().trim().max(500).optional(), customerId: z.string().uuid().optional() }).strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      const lead = await svc.withApp(ctx, "zoho_crm", (a) => zohoCrmSaveLead(a, who, { description: args.summary, source: "WhatsApp" }));
      return { saved: true, created: lead.created };
    },
  }),
  define({
    name: "zohocrm.add_note",
    group: "zoho_crm",
    integration: "zoho_crm",
    description: "Adds a note to the customer's lead in the business's Zoho CRM (saving the lead first if it doesn't exist).",
    tier: "write-safe",
    principalTypes: WHO,
    scopes: WRITE,
    input: z
      .object({ title: z.string().trim().min(2).max(120), note: z.string().trim().min(2).max(2000), customerId: z.string().uuid().optional() })
      .strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      await svc.withApp(ctx, "zoho_crm", async (a) => {
        const lead = (await zohoCrmFindLead(a, who)) ?? (await zohoCrmSaveLead(a, who, { source: "WhatsApp" }));
        return zohoCrmAddNote(a, lead.id, { title: args.title, content: args.note });
      });
      return { added: true };
    },
  }),
];

/* ─────────────────────────────── Odoo ─────────────────────────────── */

const odoo: AnyToolDef[] = [
  define({
    name: "odoo.my_invoices",
    group: "odoo",
    integration: "odoo",
    description: "The customer's own posted invoices in the business's Odoo: number, dates, total, amount still due and payment state.",
    tier: "read",
    principalTypes: WHO,
    scopes: READ,
    input: z.object({ customerId: z.string().uuid().optional() }).strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      return svc.withApp(ctx, "odoo", async (ref) => {
        const partner = await odooFindPartner(ref, who);
        if (!partner) return { found: false, invoices: [], message: "No Odoo contact matches this customer's email or phone." };
        const invoices = await odooInvoices(ref, partner.id);
        return { found: true, invoices, totalBalanceKes: sum(invoices) };
      });
    },
  }),
  define({
    name: "odoo.save_contact",
    group: "odoo",
    integration: "odoo",
    description: "Saves the customer as a contact in the business's Odoo (creates it, or updates the one with the same email or phone).",
    tier: "write-safe",
    principalTypes: WHO,
    scopes: WRITE,
    input: z.object({ customerId: z.string().uuid().optional() }).strict(),
    async handler(ctx, args) {
      const who = await subject(ctx, args.customerId);
      const saved = await svc.withApp(ctx, "odoo", (ref) => odooSavePartner(ref, who));
      return { saved: true, created: saved.created };
    },
  }),
];

export const integrationTools: AnyToolDef[] = [...google, ...zohoBooks, ...zohoCrm, ...odoo];

/** Tool name → the app it needs. */
export const INTEGRATION_TOOL_APPS = new Map<string, svc.AppId>(
  integrationTools.map((t) => [t.name, (t as AnyToolDef & { integration: svc.AppId }).integration]),
);

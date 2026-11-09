import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import {
  listBookings,
  listInvoices,
  listPayments,
  withPrincipal,
} from "@garden/services";

export const dynamic = "force-dynamic";

/** RFC 4180-ish escaping; also guards against spreadsheet formula injection. */
function cell(value: unknown): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  // BOM so Excel opens UTF-8 (names with accents) correctly.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function filenameFor(type: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${type}-${stamp}.csv`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "bookings";
  const principal = principalOf(session);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  let csv: string;

  if (type === "invoices") {
    const rows = await withPrincipal(principal, (ctx) => listInvoices(ctx, { limit: 1000 }));
    csv = toCsv(
      [
        "invoice_number",
        "status",
        "issued_at",
        "due_at",
        "customer",
        "phone",
        "total_kes",
        "balance_kes",
        "booking_id",
      ],
      rows.map((row) => [
        row.invoice.number,
        row.invoice.status,
        row.invoice.issuedAt?.toISOString() ?? "",
        row.invoice.dueAt?.toISOString() ?? "",
        row.customer.name,
        row.customer.phoneE164,
        row.invoice.totalKes,
        row.invoice.balanceKes,
        row.invoice.bookingId,
      ]),
    );
  } else if (type === "payments") {
    const rows = await withPrincipal(principal, (ctx) => listPayments(ctx, { limit: 1000 }));
    csv = toCsv(
      [
        "received_at",
        "method",
        "status",
        "amount_kes",
        "phone",
        "mpesa_receipt",
        "booking_id",
        "invoice_id",
      ],
      rows.map((row) => [
        row.receivedAt?.toISOString() ?? row.createdAt.toISOString(),
        row.method,
        row.status,
        row.amountKes,
        row.phone ?? "",
        row.mpesaReceipt ?? "",
        row.bookingId ?? "",
        row.invoiceId ?? "",
      ]),
    );
  } else {
    const rows = await withPrincipal(principal, (ctx) =>
      listBookings(ctx, { from, to, limit: 1000 }),
    );
    csv = toCsv(
      [
        "booking_id",
        "status",
        "source",
        "customer",
        "phone",
        "offering",
        "starts_at",
        "ends_at",
        "guests",
        "total_kes",
        "deposit_kes",
        "paid_kes",
        "balance_kes",
      ],
      rows.map((row) => [
        row.booking.id,
        row.booking.status,
        row.booking.source,
        row.customer.name,
        row.customer.phoneE164,
        row.offering.name,
        row.booking.startsAt.toISOString(),
        row.booking.endsAt.toISOString(),
        row.booking.partySize,
        row.booking.totalKes,
        row.booking.depositRequiredKes,
        row.paidKes ?? 0,
        Math.max(0, row.booking.totalKes - (row.paidKes ?? 0)),
      ]),
    );
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filenameFor(type)}"`,
      "cache-control": "no-store",
    },
  });
}

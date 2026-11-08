import { getInvoiceDetail, getSettings, invoicePdfData, withPrincipal } from "@garden/services";
import { renderInvoicePdf } from "@garden/integrations";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorised", { status: 401 });
  const { id } = await params;
  const principal = principalOf(session);

  try {
    const [detail, settings] = await Promise.all([
      withPrincipal(principal, (ctx) => getInvoiceDetail(ctx, id)),
      withPrincipal(principal, (ctx) => getSettings(ctx)),
    ]);

    const data = invoicePdfData({
      businessName: settings.tenant.name,
      invoice: detail.invoice,
      booking: detail.booking,
      customer: detail.customer,
      offering: detail.offering,
      addons: detail.items.map((item) => ({
        description: item.description,
        qty: item.qty,
        unitPriceKes: item.unitPriceKes,
      })),
      paidKes: detail.invoice.totalKes - detail.invoice.balanceKes,
    });

    const buffer = await renderInvoicePdf(data);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${detail.invoice.number}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return new Response("Invoice not found", { status: 404 });
  }
}

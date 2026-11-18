import { eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { mpesaMode } from "@garden/integrations";
import { paymentLinkForInvoice, settleMockCheckout, systemPrincipal, withPrincipal } from "@garden/services";

export const dynamic = "force-dynamic";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f5;color:#1c2b22;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 2px 12px #0001;text-align:center}
button{background:#1f6b3a;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:16px;cursor:pointer}p{color:#475}</style></head>
<body><main><h1 style="font-size:20px">${esc(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

type Params = { params: Promise<{ slug: string; ref: string }> };

/**
 * `/pay/<business>/<invoice id>`: the page a "Pay online" button opens. It makes (or reuses) a payment link with the business's
 * first working link provider and sends the customer there. `/pay/<business>/thanks` is where Pesapal sends them back afterwards.
 * `/pay/mock/<reference>` is a pretend checkout for demos, only in mock mode.
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const { slug, ref } = await params;

  if (slug === "mock") {
    if (mpesaMode() !== "mock") return page("Not available", "<p>This page is only for demos.</p>", 404);
    return page(
      "Demo checkout",
      `<p>This is a pretend payment page. Nothing is charged.</p><form method="post"><button type="submit">Pay now (demo)</button></form>`,
    );
  }
  if (ref === "thanks") {
    return page("Thank you", "<p>We're confirming your payment. You'll get a message on WhatsApp as soon as it's received.</p>");
  }

  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
  if (!tenant || !/^[0-9a-f-]{36}$/i.test(ref)) return page("Link not found", "<p>This payment link isn't valid.</p>", 404);
  try {
    const result = await withPrincipal(systemPrincipal(tenant.id, "pay-link"), (ctx) => paymentLinkForInvoice(ctx, ref));
    if (result.paid) return page("All paid", "<p>There's nothing left to pay on this invoice. Thank you!</p>");
    return Response.redirect(result.url, 302);
  } catch (error) {
    console.error("[web] pay link failed", error);
    return page("Couldn't open payment", "<p>We couldn't start the payment just now. Please try again in a moment, or message us on WhatsApp.</p>", 502);
  }
}

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { slug, ref } = await params;
  if (slug !== "mock" || mpesaMode() !== "mock") return page("Not available", "<p>This page is only for demos.</p>", 404);
  const tenant = await getDb().query.tenants.findFirst({
    where: eq(schema.tenants.slug, new URL(request.url).searchParams.get("tenant") ?? ""),
  });
  if (!tenant) return page("Not found", "<p>That payment doesn't exist.</p>", 404);
  try {
    await withPrincipal(systemPrincipal(tenant.id, "mock-checkout"), (ctx) => settleMockCheckout(ctx, ref));
  } catch {
    return page("Not found", "<p>That payment doesn't exist.</p>", 404);
  }
  return page("Payment received", "<p>Thank you! This was a demo payment.</p>");
}

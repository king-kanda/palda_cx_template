import { eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { ForbiddenError, handlePesapalIpn, systemPrincipal, withPrincipal } from "@garden/services";

export const dynamic = "force-dynamic";

/**
 * Pesapal notification (IPN) for ONE business, registered by us as `<APP_URL>/api/payments/pesapal?tenant=<slug>`.
 * Pesapal sends OrderTrackingId and OrderMerchantReference, never proof of payment, so the status is read back from Pesapal.
 */
async function handle(request: Request, params: URLSearchParams): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("tenant") ?? process.env.DEFAULT_TENANT_SLUG ?? "palda";
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
  const echo = {
    orderNotificationType: params.get("OrderNotificationType") ?? "IPNCHANGE",
    orderTrackingId: params.get("OrderTrackingId") ?? "",
    orderMerchantReference: params.get("OrderMerchantReference") ?? "",
  };
  if (!tenant) return Response.json({ ...echo, status: 200 });
  try {
    await withPrincipal(systemPrincipal(tenant.id, "pesapal-ipn"), (ctx) => handlePesapalIpn(ctx, params));
    return Response.json({ ...echo, status: 200 });
  } catch (error) {
    if (error instanceof ForbiddenError) return Response.json({ ...echo, status: 200 });
    console.error("[web] pesapal ipn failed", error);
    // A temporary failure (Pesapal's API was down) is answered with 500 so Pesapal retries the notification.
    return Response.json({ ...echo, status: 500 }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, new URL(request.url).searchParams);
}

export async function POST(request: Request): Promise<Response> {
  const merged = new URLSearchParams(new URL(request.url).searchParams);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") merged.set(k, v);
  } catch {
    /* the notification may carry everything in the query string */
  }
  return handle(request, merged);
}

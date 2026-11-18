import { eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import { ForbiddenError, handlePaystackWebhook, systemPrincipal, withPrincipal } from "@garden/services";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook for ONE business: set the webhook URL in that business's Paystack dashboard to
 * `<APP_URL>/api/payments/paystack?tenant=<slug>`. The body is signed with the business's own secret key (HMAC-SHA512) and is
 * checked before anything is believed. Anything else is acknowledged so Paystack does not retry it forever.
 */
export async function POST(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("tenant") ?? process.env.DEFAULT_TENANT_SLUG ?? "palda";
  const tenant = await getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
  if (!tenant) return new Response("ok", { status: 200 });

  const rawBody = await request.text();
  try {
    await withPrincipal(systemPrincipal(tenant.id, "paystack-webhook"), (ctx) =>
      handlePaystackWebhook(ctx, rawBody, request.headers.get("x-paystack-signature")),
    );
    return new Response("ok", { status: 200 });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("forbidden", { status: 401 });
    console.error("[web] paystack webhook failed", error);
    return new Response("ok", { status: 200 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: "paystack-webhook" });
}

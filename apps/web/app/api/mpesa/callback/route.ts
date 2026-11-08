import { eq } from "drizzle-orm";
import { getDb, schema } from "@garden/db";
import {
  handleC2BCallback,
  handleStkCallback,
  systemPrincipal,
  withPrincipal,
} from "@garden/services";

export const dynamic = "force-dynamic";

async function tenantFor(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("tenant") ?? process.env.DEFAULT_TENANT_SLUG ?? "palda";
  return getDb().query.tenants.findFirst({ where: eq(schema.tenants.slug, slug) });
}

/**
 * Daraja callback receiver. STK results and C2B confirmations both arrive here.
 * Matching is idempotent: duplicate receipts return the existing payment.
 */
export async function POST(request: Request): Promise<Response> {
  const tenant = await tenantFor(request);
  if (!tenant) return Response.json({ ResultCode: 0, ResultDesc: "Unknown tenant" }, { status: 200 });

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ResultCode: 1, ResultDesc: "Invalid JSON" }, { status: 400 });
  }

  const principal = systemPrincipal(tenant.id, "mpesa-callback");
  const isC2B = "TransID" in payload && "BillRefNumber" in payload;

  try {
    if (isC2B) {
      await withPrincipal(principal, (ctx) => handleC2BCallback(ctx, payload));
      return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    await withPrincipal(principal, (ctx) => handleStkCallback(ctx, payload));
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("[web] mpesa callback failed", error);
    // Daraja retries non-2xx responses; acknowledge so a poison payload does not
    // loop forever. Failures are visible in integrations_log/audit.
    return Response.json({ ResultCode: 0, ResultDesc: "Acknowledged" });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, service: "mpesa-callback" });
}

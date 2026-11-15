import { getEngineAdmin } from "@/lib/engine-auth";
import { documentResponse } from "@/lib/document-response";

export const dynamic = "force-dynamic";

/** A signed-in Palda admin downloads a document for the customer they are looking at. */
export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string; id: string }> }) {
  const admin = await getEngineAdmin();
  if (!admin) return new Response("Sign in to the Engine to download this file.", { status: 401 });
  const { tenantId, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return new Response("Not found", { status: 404 });
  return documentResponse(tenantId, id);
}

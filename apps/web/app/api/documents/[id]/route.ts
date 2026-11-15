import { getSession } from "@/lib/auth";
import { documentResponse } from "@/lib/document-response";

export const dynamic = "force-dynamic";

/** A signed-in customer downloads one of THEIR business documents. The tenant comes from the session, never the URL. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Sign in to download this file.", { status: 401 });
  const { id } = await params;
  return documentResponse(session.tenantId, id);
}

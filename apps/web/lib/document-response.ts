import { NotFoundError, getBusinessDocument } from "@garden/services";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves a business document as a DOWNLOAD only. The type is the one we decided at upload (from the extension, checked against
 * the contents), `nosniff` stops a browser second-guessing it, and `attachment` means it is saved, never opened in the page,
 * so a file can't run as part of our site. The caller has already decided WHICH tenant may read it.
 */
export async function documentResponse(tenantId: string, id: string): Promise<Response> {
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  try {
    const doc = await getBusinessDocument(tenantId, id);
    const ascii = doc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(doc.data), {
      status: 200,
      headers: {
        "Content-Type": doc.mime === "text/plain" || doc.mime === "text/csv" ? `${doc.mime}; charset=utf-8` : doc.mime,
        "Content-Length": String(doc.sizeBytes),
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}

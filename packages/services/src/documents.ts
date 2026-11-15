import { and, desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@garden/db";
import { DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from "./documents-meta";
import { NotFoundError, ValidationError } from "./types";

/**
 * A customer's business documents: brochures, price lists, terms, and contract or quote templates, kept by the Palda team and
 * visible to the customer (download only). Files are checked by their actual contents, not just their name, and are never
 * served in a way a browser could run.
 */

export { DOCUMENT_ACCEPT, DOCUMENT_KINDS, DOCUMENT_MAX_BYTES, DOCUMENT_TYPES, formatBytes, kindLabel, type DocumentKind } from "./documents-meta";

const startsWith = (bytes: Uint8Array, sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);

/** Does the content look like what the extension says? Cheap magic-number checks; text must contain no binary. */
export function contentMatches(ext: string, bytes: Uint8Array): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case "docx":
    case "xlsx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // a zip container
    case "txt":
    case "md":
    case "csv": {
      const head = bytes.subarray(0, 4096);
      return !head.includes(0); // no NUL bytes: it is text
    }
    default:
      return false;
  }
}

/** A filename that is safe to store and to put in a header: no path, no control characters, bounded. */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"<>|?*:;]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(-120) || "document";
}

const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export type BusinessDocumentInfo = {
  id: string;
  title: string;
  kind: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: Date;
};

export async function listBusinessDocuments(tenantId: string): Promise<BusinessDocumentInfo[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: schema.businessDocuments.id,
        title: schema.businessDocuments.title,
        kind: schema.businessDocuments.kind,
        filename: schema.businessDocuments.filename,
        mime: schema.businessDocuments.mime,
        sizeBytes: schema.businessDocuments.sizeBytes,
        createdAt: schema.businessDocuments.createdAt,
      })
      .from(schema.businessDocuments)
      .where(eq(schema.businessDocuments.tenantId, tenantId))
      .orderBy(desc(schema.businessDocuments.createdAt)),
  );
}

/** The file itself, for a download. Scoped to the tenant, so another customer's id is simply "not found". */
export async function getBusinessDocument(tenantId: string, id: string) {
  const row = await withTenant(tenantId, (tx) =>
    tx.query.businessDocuments.findFirst({
      where: and(eq(schema.businessDocuments.tenantId, tenantId), eq(schema.businessDocuments.id, id)),
    }),
  );
  if (!row) throw new NotFoundError("Document", id);
  return row;
}

export async function addBusinessDocument(
  adminId: string,
  tenantId: string,
  input: { title: string; kind: string; filename: string; bytes: Uint8Array },
): Promise<{ id: string }> {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 120) throw new ValidationError("Give the document a title (2 to 120 characters).");
  const kind = DOCUMENT_KINDS.find((k) => k.value === input.kind)?.value ?? "other";
  const filename = safeFilename(input.filename);
  const ext = extensionOf(filename);
  const mime = DOCUMENT_TYPES[ext];
  if (!mime) throw new ValidationError("That file type isn't allowed. Use PDF, Word, Excel, an image, or a text or CSV file.");
  if (input.bytes.length === 0) throw new ValidationError("That file is empty.");
  if (input.bytes.length > DOCUMENT_MAX_BYTES) throw new ValidationError("That file is too large. The limit is 5 MB.");
  if (!contentMatches(ext, input.bytes)) throw new ValidationError("That file doesn't look like a real ." + ext + " file.");

  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.businessDocuments)
      .values({
        tenantId,
        title,
        kind,
        filename,
        mime,
        sizeBytes: input.bytes.length,
        data: Buffer.from(input.bytes),
        createdBy: `engine:${adminId}`,
      })
      .returning({ id: schema.businessDocuments.id });
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: `engine:${adminId}`,
      action: "engine.document_added",
      entity: "business_document",
      entityId: row!.id,
      diff: { title, kind, filename, bytes: input.bytes.length },
    });
    return { id: row!.id };
  });
}

export async function deleteBusinessDocument(adminId: string, tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const removed = await tx
      .delete(schema.businessDocuments)
      .where(and(eq(schema.businessDocuments.tenantId, tenantId), eq(schema.businessDocuments.id, id)))
      .returning({ id: schema.businessDocuments.id, title: schema.businessDocuments.title });
    if (removed.length === 0) throw new NotFoundError("Document", id);
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: `engine:${adminId}`,
      action: "engine.document_removed",
      entity: "business_document",
      entityId: id,
      diff: { title: removed[0]!.title },
    });
  });
}

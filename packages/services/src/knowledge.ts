import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, withTenant } from "@garden/db";
import { embedText, embedTexts, vectorsFor } from "@garden/integrations";
import { audit, type ServiceContext } from "./context";
import { ForbiddenError, NotFoundError, ValidationError } from "./types";

/**
 * Agent knowledge (documents the Palda team adds per customer) and agent memory (short facts about one end customer).
 *
 * Postgres is the source of truth and holds the text under row-level security. Qdrant holds only vectors with the same ids
 * (see packages/integrations/src/vector.ts). Every search resolves its hits back through Postgres, so a vector that does not
 * belong to this tenant finds no row and is dropped.
 */

/* ───────────────────────────────── chunking ───────────────────────────────── */

export const CHUNK_MAX = 700;
export const CHUNK_OVERLAP = 80;

/** Splits text into chunks of at most CHUNK_MAX characters, on paragraph and sentence boundaries where possible. */
export function chunkText(raw: string, max = CHUNK_MAX, overlap = CHUNK_OVERLAP): string[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!text) return [];
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const p = paragraph.trim();
    if (!p) continue;
    if (p.length <= max) {
      pieces.push(p);
      continue;
    }
    // A long paragraph: split on sentences, then hard-cut any sentence that is still too long.
    let buffer = "";
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if (sentence.length > max) {
        if (buffer) pieces.push(buffer);
        buffer = "";
        for (let i = 0; i < sentence.length; i += max) pieces.push(sentence.slice(i, i + max));
        continue;
      }
      if ((buffer + " " + sentence).trim().length > max) {
        pieces.push(buffer);
        buffer = sentence;
      } else {
        buffer = (buffer + " " + sentence).trim();
      }
    }
    if (buffer) pieces.push(buffer);
  }
  // Merge small neighbours so we do not index a hundred one-line chunks, and carry a little overlap for context.
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.length + piece.length + 2 <= max) merged[merged.length - 1] = `${last}\n\n${piece}`;
    else merged.push(piece);
  }
  return merged.map((chunk, i) => {
    if (i === 0 || overlap <= 0) return chunk;
    const tail = merged[i - 1]!.slice(-overlap).replace(/^\S*\s/, "");
    return tail && chunk.length + tail.length + 1 <= max + overlap ? `${tail} ${chunk}` : chunk;
  });
}

const actorFor = (adminId: string) => `engine:${adminId}`;

async function auditAs(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  actor: string,
  tenantId: string,
  action: string,
  entityId: string | null,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({ tenantId, actor, action, entity: "knowledge", entityId, diff: diff ?? null });
}

/* ───────────────────────────────── knowledge ───────────────────────────────── */

export type KnowledgeDocumentInfo = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  chunkCount: number;
  chars: number;
  createdAt: Date;
};

export async function listKnowledgeDocuments(tenantId: string): Promise<KnowledgeDocumentInfo[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.query.knowledgeDocuments.findMany({
      where: eq(schema.knowledgeDocuments.tenantId, tenantId),
      orderBy: desc(schema.knowledgeDocuments.createdAt),
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      error: r.error,
      chunkCount: r.chunkCount,
      chars: r.body.length,
      createdAt: r.createdAt,
    }));
  });
}

export async function getKnowledgeDocument(tenantId: string, docId: string) {
  return withTenant(tenantId, async (tx) => {
    const doc = await tx.query.knowledgeDocuments.findFirst({
      where: and(eq(schema.knowledgeDocuments.tenantId, tenantId), eq(schema.knowledgeDocuments.id, docId)),
    });
    if (!doc) throw new NotFoundError("Document", docId);
    return doc;
  });
}

/** Adds a document, splits it, embeds it and stores the vectors. Embedding happens outside the database transaction. */
export async function addKnowledgeDocument(adminId: string, tenantId: string, input: { title: string; body: string }) {
  const title = input.title.trim();
  const body = input.body.replace(/\u0000/g, "").trim();
  if (title.length < 2 || title.length > 120) throw new ValidationError("Give the document a title (2 to 120 characters).");
  if (body.length < 20) throw new ValidationError("The document is too short to be useful.");
  if (body.length > 40_000) throw new ValidationError("The document is too long. Split it into parts under 40,000 characters.");
  const chunks = chunkText(body);
  if (chunks.length === 0) throw new ValidationError("The document has no readable text.");
  if (chunks.length > 120) throw new ValidationError("The document makes too many sections. Split it into smaller documents.");

  const stored = await withTenant(tenantId, async (tx) => {
    const [doc] = await tx
      .insert(schema.knowledgeDocuments)
      .values({ tenantId, title, body, status: "indexing", createdBy: actorFor(adminId) })
      .returning();
    const rows = await tx
      .insert(schema.knowledgeChunks)
      .values(chunks.map((text, position) => ({ tenantId, documentId: doc!.id, position, text })))
      .returning({ id: schema.knowledgeChunks.id, text: schema.knowledgeChunks.text, position: schema.knowledgeChunks.position });
    await auditAs(tx, actorFor(adminId), tenantId, "engine.knowledge_added", doc!.id, { title, chunks: rows.length });
    return { docId: doc!.id, rows: rows.sort((a, b) => a.position - b.position) };
  });

  try {
    const vectors = await embedTexts(stored.rows.map((r) => `${title}\n${r.text}`));
    await vectorsFor(tenantId).upsert(
      stored.rows.map((r, i) => ({
        id: r.id,
        vector: vectors[i]!,
        payload: { kind: "knowledge" as const, refId: r.id, docId: stored.docId },
      })),
    );
    await withTenant(tenantId, (tx) =>
      tx
        .update(schema.knowledgeDocuments)
        .set({ status: "ready", error: null, chunkCount: stored.rows.length })
        .where(eq(schema.knowledgeDocuments.id, stored.docId)),
    );
    return { id: stored.docId, chunks: stored.rows.length, status: "ready" as const };
  } catch (error) {
    // Keep the text (so it can be reindexed) but never leave half a document searchable.
    await vectorsFor(tenantId).deleteByDoc(stored.docId).catch(() => undefined);
    const message = error instanceof Error ? error.message.slice(0, 300) : "Indexing failed";
    await withTenant(tenantId, (tx) =>
      tx
        .update(schema.knowledgeDocuments)
        .set({ status: "failed", error: message })
        .where(eq(schema.knowledgeDocuments.id, stored.docId)),
    );
    return { id: stored.docId, chunks: 0, status: "failed" as const, error: message };
  }
}

export async function deleteKnowledgeDocument(adminId: string, tenantId: string, docId: string) {
  await getKnowledgeDocument(tenantId, docId); // 404 for a document that is not this tenant's
  await vectorsFor(tenantId).deleteByDoc(docId);
  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(schema.knowledgeDocuments)
      .where(and(eq(schema.knowledgeDocuments.tenantId, tenantId), eq(schema.knowledgeDocuments.id, docId)));
    await auditAs(tx, actorFor(adminId), tenantId, "engine.knowledge_deleted", docId);
  });
}

/** Rebuilds a tenant's vectors from Postgres (after a model change or if Qdrant was wiped). */
export async function reindexKnowledge(tenantId: string): Promise<{ documents: number; chunks: number }> {
  const docs = await withTenant(tenantId, (tx) =>
    tx.query.knowledgeDocuments.findMany({ where: eq(schema.knowledgeDocuments.tenantId, tenantId) }),
  );
  let chunks = 0;
  for (const doc of docs) {
    const rows = await withTenant(tenantId, (tx) =>
      tx.query.knowledgeChunks.findMany({
        where: and(eq(schema.knowledgeChunks.tenantId, tenantId), eq(schema.knowledgeChunks.documentId, doc.id)),
        orderBy: asc(schema.knowledgeChunks.position),
      }),
    );
    if (rows.length === 0) continue;
    try {
      await vectorsFor(tenantId).deleteByDoc(doc.id);
      const vectors = await embedTexts(rows.map((r) => `${doc.title}\n${r.text}`));
      await vectorsFor(tenantId).upsert(
        rows.map((r, i) => ({ id: r.id, vector: vectors[i]!, payload: { kind: "knowledge" as const, refId: r.id, docId: doc.id } })),
      );
      await withTenant(tenantId, (tx) =>
        tx.update(schema.knowledgeDocuments).set({ status: "ready", error: null, chunkCount: rows.length }).where(eq(schema.knowledgeDocuments.id, doc.id)),
      );
      chunks += rows.length;
    } catch (error) {
      await withTenant(tenantId, (tx) =>
        tx
          .update(schema.knowledgeDocuments)
          .set({ status: "failed", error: (error instanceof Error ? error.message : "Reindex failed").slice(0, 300) })
          .where(eq(schema.knowledgeDocuments.id, doc.id)),
      );
    }
  }
  return { documents: docs.length, chunks };
}

export type KnowledgeHit = { title: string; text: string; score: number };

function minScore(): number {
  const n = Number(process.env.KNOWLEDGE_MIN_SCORE);
  return Number.isFinite(n) && n > 0 ? n : 0.15;
}

/** Semantic search over one tenant's documents. Returns text read back from Postgres, never from Qdrant. */
export async function searchKnowledge(tenantId: string, query: string, limit = 4): Promise<KnowledgeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hits = await vectorsFor(tenantId).search(await embedText(q), { kind: "knowledge", limit });
  const wanted = hits.filter((h) => h.score >= minScore());
  if (wanted.length === 0) return [];
  const rows = await withTenant(tenantId, async (tx) => {
    const chunks = await tx.query.knowledgeChunks.findMany({
      where: and(eq(schema.knowledgeChunks.tenantId, tenantId), inArray(schema.knowledgeChunks.id, wanted.map((h) => h.id))),
    });
    const docs = await tx.query.knowledgeDocuments.findMany({
      where: and(
        eq(schema.knowledgeDocuments.tenantId, tenantId),
        eq(schema.knowledgeDocuments.status, "ready"),
        inArray(schema.knowledgeDocuments.id, [...new Set(chunks.map((c) => c.documentId))]),
      ),
    });
    return { chunks, titles: new Map(docs.map((d) => [d.id, d.title])) };
  });
  const byId = new Map(rows.chunks.map((c) => [c.id, c]));
  const out: KnowledgeHit[] = [];
  for (const hit of wanted) {
    const chunk = byId.get(hit.id);
    const title = chunk ? rows.titles.get(chunk.documentId) : undefined;
    if (chunk && title) out.push({ title, text: chunk.text, score: Math.round(hit.score * 1000) / 1000 });
  }
  return out;
}

/* ───────────────────────────────── memory ───────────────────────────────── */

export const MEMORY_MAX_PER_CUSTOMER = 30;

/**
 * A memory is a short, plain fact. Because a customer-facing agent can write them, and they are read back into later
 * prompts, anything that looks like an instruction, a link or a sensitive number is refused. Returns null when fine.
 */
export function checkMemoryFact(raw: string): { fact: string } | { error: string } {
  const fact = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (fact.length < 3) return { error: "A memory needs at least a few words." };
  if (fact.length > 200) return { error: "Keep the memory under 200 characters." };
  if (/https?:\/\/|www\.|\w+@\w+\.\w+/i.test(fact)) return { error: "Do not store links or email addresses." };
  if (/\d(?:[\s-]?\d){7,}/.test(fact)) return { error: "Do not store phone, ID or card numbers." };
  if (/(ignore|disregard|forget|override|bypass)\b.{0,30}\b(rules?|instructions?|previous|policy|policies|prompt)/i.test(fact)) {
    return { error: "That looks like an instruction, not a fact about the customer." };
  }
  if (/\b(system prompt|you must|you should always|always (approve|refund|waive|discount)|never (charge|ask|verify))\b/i.test(fact)) {
    return { error: "That looks like an instruction, not a fact about the customer." };
  }
  // Claims of entitlement ("is allowed a free upgrade", "was promised a refund") are how a poisoned memory would try to buy
  // something later. A real preference never needs to assert what the business owes the customer.
  if (
    /\b(allowed|entitled|eligible|authori[sz]ed|approved|promised|owed|granted|cleared)\b.{0,40}\b(free|discount|refund|upgrade|waiv\w*|credit|comp(ed)?|extra)\b/i.test(fact) ||
    /\b(free|complimentary)\s+(upgrade|service|booking|session|visit)\b/i.test(fact) ||
    /\b(100|50|25|10)\s?%\s*(off|discount)\b/i.test(fact)
  ) {
    return { error: "Do not record what the customer is owed or entitled to. Staff manage that." };
  }
  if (/<\/?[a-z][^>]*>|```|\bassistant\s*:|\bsystem\s*:/i.test(fact)) return { error: "Plain text only." };
  return { fact };
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type MemoryInfo = { id: string; customerId: string; fact: string; source: string; createdAt: Date };

function ownCustomer(ctx: ServiceContext, customerId: string): void {
  if (ctx.principal.type === "customer" && ctx.principal.customerId !== customerId) {
    throw new ForbiddenError("You can only use your own saved details.");
  }
}

/** Saves one fact about a customer. A customer-facing agent can only write for the customer it is talking to. */
export async function rememberFact(
  ctx: ServiceContext,
  input: { customerId: string; fact: string; source?: "agent" | "staff" },
): Promise<MemoryInfo & { duplicate: boolean }> {
  ownCustomer(ctx, input.customerId);
  const checked = checkMemoryFact(input.fact);
  if ("error" in checked) throw new ValidationError(checked.error);

  const existing = await ctx.db.query.customerMemories.findMany({
    where: and(eq(schema.customerMemories.tenantId, ctx.tenantId), eq(schema.customerMemories.customerId, input.customerId)),
  });
  const dup = existing.find((m) => normalise(m.fact) === normalise(checked.fact));
  if (dup) return { ...dup, duplicate: true };
  if (existing.length >= MEMORY_MAX_PER_CUSTOMER) {
    throw new ValidationError("This customer already has the maximum number of saved details. Ask staff to tidy them.");
  }
  const customer = await ctx.db.query.customers.findFirst({
    where: and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.customerId)),
  });
  if (!customer) throw new NotFoundError("Customer", input.customerId);

  const [row] = await ctx.db
    .insert(schema.customerMemories)
    .values({
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      fact: checked.fact,
      source: input.source ?? (ctx.principal.type === "staff" ? "staff" : "agent"),
      createdBy: ctx.principal.type === "staff" ? `staff:${ctx.principal.userId}` : `${ctx.principal.type}`,
    })
    .returning();
  await audit(ctx, "memory.remembered", "customer_memory", row!.id, { customerId: input.customerId, source: row!.source });
  try {
    await vectorsFor(ctx.tenantId).upsert([
      { id: row!.id, vector: await embedText(checked.fact), payload: { kind: "memory", refId: row!.id, customerId: input.customerId } },
    ]);
  } catch (error) {
    // The fact is saved and will still be recalled by recency; the reindex job restores semantic search.
    console.error("[memory] vector upsert failed", error);
  }
  return { ...row!, duplicate: false };
}

export async function listMemories(ctx: ServiceContext, customerId: string): Promise<MemoryInfo[]> {
  ownCustomer(ctx, customerId);
  return ctx.db.query.customerMemories.findMany({
    where: and(eq(schema.customerMemories.tenantId, ctx.tenantId), eq(schema.customerMemories.customerId, customerId)),
    orderBy: desc(schema.customerMemories.createdAt),
  });
}

/** Staff and Engine only. A customer-facing agent cannot delete memories. */
export async function deleteMemory(ctx: ServiceContext, memoryId: string): Promise<void> {
  if (ctx.principal.type === "customer") throw new ForbiddenError("Ask a member of staff to remove saved details.");
  const row = await ctx.db.query.customerMemories.findFirst({
    where: and(eq(schema.customerMemories.tenantId, ctx.tenantId), eq(schema.customerMemories.id, memoryId)),
  });
  if (!row) throw new NotFoundError("Memory", memoryId);
  await vectorsFor(ctx.tenantId).deleteByRef("memory", [memoryId]);
  await ctx.db.delete(schema.customerMemories).where(eq(schema.customerMemories.id, memoryId));
  await audit(ctx, "memory.deleted", "customer_memory", memoryId, { customerId: row.customerId });
}

/** Erases everything remembered about one customer (privacy request). */
export async function forgetCustomer(ctx: ServiceContext, customerId: string): Promise<number> {
  if (ctx.principal.type === "customer") throw new ForbiddenError("Ask a member of staff to remove saved details.");
  await vectorsFor(ctx.tenantId).deleteByCustomer(customerId);
  const removed = await ctx.db
    .delete(schema.customerMemories)
    .where(and(eq(schema.customerMemories.tenantId, ctx.tenantId), eq(schema.customerMemories.customerId, customerId)))
    .returning({ id: schema.customerMemories.id });
  await audit(ctx, "memory.forgotten", "customer_memory", null, { customerId, count: removed.length });
  return removed.length;
}

/**
 * The facts to show the agent for this message: the ones closest in meaning to what the customer just said, plus the
 * latest few, deduplicated. Text always comes from Postgres, and only for this tenant and this customer.
 */
export async function recallMemories(tenantId: string, customerId: string, query: string, limit = 6): Promise<string[]> {
  let semanticIds: string[] = [];
  if (query.trim().length >= 3) {
    try {
      const hits = await vectorsFor(tenantId).search(await embedText(query), { kind: "memory", customerId, limit: 4 });
      semanticIds = hits.map((h) => h.id);
    } catch (error) {
      console.error("[memory] semantic recall failed, using recency only", error);
    }
  }
  const rows = await withTenant(tenantId, (tx) =>
    tx.query.customerMemories.findMany({
      where: and(eq(schema.customerMemories.tenantId, tenantId), eq(schema.customerMemories.customerId, customerId)),
      orderBy: desc(schema.customerMemories.createdAt),
      limit: 40,
    }),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [...semanticIds.map((id) => byId.get(id)).filter(Boolean), ...rows.slice(0, 3)] as typeof rows;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of ordered) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row.fact);
    if (out.length >= limit) break;
  }
  return out;
}

/** Engine view: the latest facts across a customer's end-customers, with names, so staff can review and delete. */
export async function listRecentMemories(tenantId: string, limit = 100) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.query.customerMemories.findMany({
      where: eq(schema.customerMemories.tenantId, tenantId),
      orderBy: desc(schema.customerMemories.createdAt),
      limit,
    });
    const customers = await tx.query.customers.findMany({
      where: and(eq(schema.customers.tenantId, tenantId), inArray(schema.customers.id, [...new Set(rows.map((r) => r.customerId))].length ? [...new Set(rows.map((r) => r.customerId))] : ["00000000-0000-0000-0000-000000000000"])),
      columns: { id: true, name: true },
    });
    const names = new Map(customers.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ id: r.id, customerId: r.customerId, customerName: names.get(r.customerId) ?? "Customer", fact: r.fact, source: r.source, createdAt: r.createdAt }));
  });
}

/** Engine delete for one memory, audited as the admin. */
export async function deleteMemoryAsAdmin(adminId: string, tenantId: string, memoryId: string): Promise<void> {
  await vectorsFor(tenantId).deleteByRef("memory", [memoryId]);
  await withTenant(tenantId, async (tx) => {
    const removed = await tx
      .delete(schema.customerMemories)
      .where(and(eq(schema.customerMemories.tenantId, tenantId), eq(schema.customerMemories.id, memoryId)))
      .returning({ id: schema.customerMemories.id });
    if (removed.length === 0) throw new NotFoundError("Memory", memoryId);
    await tx.insert(schema.auditLog).values({
      tenantId,
      actor: actorFor(adminId),
      action: "engine.memory_deleted",
      entity: "customer_memory",
      entityId: memoryId,
    });
  });
}

/** Rebuilds a tenant's memory vectors from Postgres. */
export async function reindexMemories(tenantId: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.query.customerMemories.findMany({ where: eq(schema.customerMemories.tenantId, tenantId) }),
  );
  if (rows.length === 0) return 0;
  const vectors = await embedTexts(rows.map((r) => r.fact));
  const v = vectorsFor(tenantId);
  await v.deleteByRef("memory", rows.map((r) => r.id));
  await v.upsert(rows.map((r, i) => ({ id: r.id, vector: vectors[i]!, payload: { kind: "memory" as const, refId: r.id, customerId: r.customerId } })));
  return rows.length;
}

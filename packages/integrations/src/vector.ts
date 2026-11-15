/**
 * Vector storage (Qdrant) with tenant isolation built in.
 *
 * Qdrant has no row-level security, so isolation is enforced here, in depth:
 *  1. The ONLY way to reach the store is `vectorsFor(tenantId)`. Callers never see the raw client and cannot pass a filter.
 *  2. Every write stamps `tenant_id` into the payload; every search and delete is AND-ed with `tenant_id = <this tenant>`.
 *  3. Results are re-checked: a hit whose payload tenant differs is dropped (and counted), never returned.
 *  4. Qdrant stores ids and a few filter fields only. The text lives in Postgres under RLS, so a stray id from another tenant
 *     resolves to nothing when it is read back (see packages/services/src/knowledge.ts).
 *
 * Modes: VECTOR_MODE=qdrant (needs QDRANT_URL) or mock (in-process, for tests and evals; the default when no URL is set).
 */

export type VectorKind = "knowledge" | "memory";

export type VectorPayload = {
  kind: VectorKind;
  /** The Postgres row this point mirrors (knowledge chunk or memory). */
  refId: string;
  /** Set for memories: they are private to one customer. */
  customerId?: string | null;
  /** Set for knowledge chunks: which document they came from, so a document can be removed in one call. */
  docId?: string | null;
};

export type VectorPoint = { id: string; vector: number[]; payload: VectorPayload };
export type VectorHit = { id: string; score: number; payload: VectorPayload };

export type SearchOptions = {
  kind: VectorKind;
  /** Restrict to one customer's memories. Required for kind "memory". */
  customerId?: string;
  limit?: number;
};

export interface TenantVectors {
  upsert(points: VectorPoint[]): Promise<void>;
  search(vector: number[], options: SearchOptions): Promise<VectorHit[]>;
  deleteByRef(kind: VectorKind, refIds: string[]): Promise<void>;
  deleteByDoc(docId: string): Promise<void>;
  deleteByCustomer(customerId: string): Promise<void>;
}

export type VectorMode = "qdrant" | "mock";

export function vectorMode(): VectorMode {
  const mode = process.env.VECTOR_MODE as VectorMode | undefined;
  if (mode === "qdrant" || mode === "mock") return mode;
  return process.env.QDRANT_URL ? "qdrant" : "mock";
}

export function embeddingDimensions(): number {
  const n = Number(process.env.EMBEDDING_DIMENSIONS);
  if (Number.isInteger(n) && n > 0) return n;
  return embeddingMode() === "mock" ? 256 : 1536;
}

export function embeddingMode(): "openrouter" | "mock" {
  const mode = process.env.EMBEDDING_MODE;
  if (mode === "openrouter" || mode === "mock") return mode;
  return process.env.OPENROUTER_API_KEY ? "openrouter" : "mock";
}

/** One collection per vector size, so changing the embedding model never mixes dimensions. */
export function collectionName(): string {
  return `garden_vectors_${embeddingDimensions()}`;
}

export class VectorError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "VectorError";
  }
}

/** Counts hits dropped by the tenant re-check. Should always be zero; tests and the Engine can read it. */
export const vectorLeakGuard = { dropped: 0 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertTenant(tenantId: string): void {
  if (!UUID.test(tenantId)) throw new VectorError("vectorsFor needs a tenant id (uuid).");
}

/* ─────────────────────────────── Qdrant (REST) ─────────────────────────────── */

type QdrantPoint = { id: string; score?: number; payload?: Record<string, unknown> | null };

async function qdrant<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = process.env.QDRANT_URL;
  if (!base) throw new VectorError("QDRANT_URL is not set.");
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new VectorError(`Qdrant ${method} ${path} failed (${res.status}).`, json);
  return json as T;
}

let ensured: Promise<void> | null = null;

/** Creates the collection and the tenant index once per process. Safe to call repeatedly. */
export function ensureCollection(): Promise<void> {
  if (vectorMode() !== "qdrant") return Promise.resolve();
  if (ensured) return ensured;
  const name = collectionName();
  ensured = (async () => {
    try {
      await qdrant("GET", `/collections/${name}`);
    } catch {
      await qdrant("PUT", `/collections/${name}`, {
        vectors: { size: embeddingDimensions(), distance: "Cosine" },
      });
    }
    // `is_tenant` tells Qdrant to co-locate each tenant's vectors, so a tenant-filtered search stays fast and does not scan others.
    await qdrant("PUT", `/collections/${name}/index?wait=true`, {
      field_name: "tenant_id",
      field_schema: { type: "keyword", is_tenant: true },
    });
    for (const field of ["kind", "customer_id", "doc_id", "ref_id"]) {
      await qdrant("PUT", `/collections/${name}/index?wait=true`, { field_name: field, field_schema: "keyword" });
    }
  })().catch((error) => {
    ensured = null;
    throw error;
  });
  return ensured;
}

function payloadOut(p: Record<string, unknown> | null | undefined): { tenantId: string; payload: VectorPayload } {
  return {
    tenantId: String(p?.tenant_id ?? ""),
    payload: {
      kind: (p?.kind as VectorKind) ?? "knowledge",
      refId: String(p?.ref_id ?? ""),
      customerId: (p?.customer_id as string | undefined) ?? null,
      docId: (p?.doc_id as string | undefined) ?? null,
    },
  };
}

function qdrantFor(tenantId: string): TenantVectors {
  const tenantCondition = { key: "tenant_id", match: { value: tenantId } };
  const name = collectionName();
  const scoped = (extra: Array<Record<string, unknown>>) => ({ must: [tenantCondition, ...extra] });
  const eq = (key: string, value: string) => ({ key, match: { value } });
  return {
    async upsert(points) {
      if (points.length === 0) return;
      await ensureCollection();
      await qdrant("PUT", `/collections/${name}/points?wait=true`, {
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: {
            tenant_id: tenantId, // always the scoped tenant; a caller cannot choose it
            kind: p.payload.kind,
            ref_id: p.payload.refId,
            ...(p.payload.customerId ? { customer_id: p.payload.customerId } : {}),
            ...(p.payload.docId ? { doc_id: p.payload.docId } : {}),
          },
        })),
      });
    },
    async search(vector, options) {
      if (options.kind === "memory" && !options.customerId) {
        throw new VectorError("A memory search must be scoped to one customer.");
      }
      await ensureCollection();
      const filter = scoped([
        eq("kind", options.kind),
        ...(options.customerId ? [eq("customer_id", options.customerId)] : []),
      ]);
      const res = await qdrant<{ result: QdrantPoint[] }>("POST", `/collections/${name}/points/search`, {
        vector,
        filter,
        limit: Math.min(Math.max(options.limit ?? 5, 1), 20),
        with_payload: true,
      });
      const hits: VectorHit[] = [];
      for (const point of res.result) {
        const { tenantId: seen, payload } = payloadOut(point.payload);
        if (seen !== tenantId) {
          vectorLeakGuard.dropped += 1; // belt and braces: never return another tenant's hit
          continue;
        }
        hits.push({ id: String(point.id), score: point.score ?? 0, payload });
      }
      return hits;
    },
    async deleteByRef(kind, refIds) {
      if (refIds.length === 0) return;
      await ensureCollection();
      await qdrant("POST", `/collections/${name}/points/delete?wait=true`, {
        filter: { must: [tenantCondition, eq("kind", kind), { key: "ref_id", match: { any: refIds } }] },
      });
    },
    async deleteByDoc(docId) {
      await ensureCollection();
      await qdrant("POST", `/collections/${name}/points/delete?wait=true`, { filter: scoped([eq("doc_id", docId)]) });
    },
    async deleteByCustomer(customerId) {
      await ensureCollection();
      await qdrant("POST", `/collections/${name}/points/delete?wait=true`, {
        filter: scoped([eq("kind", "memory"), eq("customer_id", customerId)]),
      });
    },
  };
}

/* ───────────────────────────── Mock (tests, evals) ───────────────────────────── */

type MockRow = { id: string; vector: number[]; tenantId: string; payload: VectorPayload };
const mockRows = new Map<string, MockRow>();

export function resetMockVectors(): void {
  mockRows.clear();
  vectorLeakGuard.dropped = 0;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    na += a[i]! * a[i]!;
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function mockFor(tenantId: string): TenantVectors {
  return {
    async upsert(points) {
      for (const p of points) {
        mockRows.set(p.id, { id: p.id, vector: p.vector, tenantId, payload: { ...p.payload } });
      }
    },
    async search(vector, options) {
      if (options.kind === "memory" && !options.customerId) {
        throw new VectorError("A memory search must be scoped to one customer.");
      }
      return [...mockRows.values()]
        .filter(
          (r) =>
            r.tenantId === tenantId &&
            r.payload.kind === options.kind &&
            (!options.customerId || r.payload.customerId === options.customerId),
        )
        .map((r) => ({ id: r.id, score: cosine(vector, r.vector), payload: r.payload }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.min(Math.max(options.limit ?? 5, 1), 20));
    },
    async deleteByRef(kind, refIds) {
      for (const [id, r] of mockRows) {
        if (r.tenantId === tenantId && r.payload.kind === kind && refIds.includes(r.payload.refId)) mockRows.delete(id);
      }
    },
    async deleteByDoc(docId) {
      for (const [id, r] of mockRows) if (r.tenantId === tenantId && r.payload.docId === docId) mockRows.delete(id);
    },
    async deleteByCustomer(customerId) {
      for (const [id, r] of mockRows) {
        if (r.tenantId === tenantId && r.payload.kind === "memory" && r.payload.customerId === customerId) mockRows.delete(id);
      }
    },
  };
}

/** The single entry point. Everything the app stores in or reads from the vector database goes through this. */
export function vectorsFor(tenantId: string): TenantVectors {
  assertTenant(tenantId);
  return vectorMode() === "qdrant" ? qdrantFor(tenantId) : mockFor(tenantId);
}

/** Reachability for the Engine's Data sources page and `env:check`. Never throws. */
export async function vectorHealth(): Promise<{ mode: VectorMode; ok: boolean; detail: string }> {
  const mode = vectorMode();
  if (mode === "mock") return { mode, ok: true, detail: "in-memory (tests and local evals only)" };
  try {
    await qdrant("GET", "/collections");
    return { mode, ok: true, detail: `${process.env.QDRANT_URL}, collection ${collectionName()}` };
  } catch (error) {
    return { mode, ok: false, detail: error instanceof Error ? error.message : "unreachable" };
  }
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Isolation against a real Qdrant. Skipped unless QDRANT_URL is set and reachable, so CI without Qdrant still passes.
 * Uses its own 8-dimension collection (garden_vectors_8) and removes it afterwards.
 */
process.env.VECTOR_MODE = "qdrant";
process.env.EMBEDDING_MODE = "mock";
process.env.EMBEDDING_DIMENSIONS = "8";

const url = process.env.QDRANT_URL;
const headers = { "content-type": "application/json", ...(process.env.QDRANT_API_KEY ? { "api-key": process.env.QDRANT_API_KEY } : {}) };

async function reachable(): Promise<boolean> {
  if (!url) return false;
  try {
    return (await fetch(`${url}/collections`, { headers })).ok;
  } catch {
    return false;
  }
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const v = (...n: number[]) => [...n, ...new Array(8 - n.length).fill(0)];
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const up = await reachable();

describe.skipIf(!up)("Qdrant tenant isolation (live)", () => {
  let lib: typeof import("../../packages/integrations/src/index");
  beforeAll(async () => {
    lib = await import("../../packages/integrations/src/index");
    await lib.ensureCollection();
  });
  afterAll(async () => {
    await fetch(`${url}/collections/garden_vectors_8`, { method: "DELETE", headers });
  });

  it("a tenant never sees another tenant's points, even for the identical vector", async () => {
    await lib.vectorsFor(A).upsert([{ id: P(1), vector: v(1, 0), payload: { kind: "knowledge", refId: P(1) } }]);
    await lib.vectorsFor(B).upsert([{ id: P(2), vector: v(1, 0), payload: { kind: "knowledge", refId: P(2) } }]);
    const a = await lib.vectorsFor(A).search(v(1, 0), { kind: "knowledge" });
    const b = await lib.vectorsFor(B).search(v(1, 0), { kind: "knowledge" });
    expect(a.map((h) => h.id)).toEqual([P(1)]);
    expect(b.map((h) => h.id)).toEqual([P(2)]);
    expect(lib.vectorLeakGuard.dropped).toBe(0);
  });

  it("the payload tenant is stamped by the wrapper, not chosen by the caller", async () => {
    await lib.vectorsFor(A).upsert([
      // a hostile caller trying to smuggle a different tenant in through the payload cannot: only known fields are written
      { id: P(3), vector: v(0, 1), payload: { kind: "knowledge", refId: P(3), tenant_id: B } as never },
    ]);
    expect((await lib.vectorsFor(B).search(v(0, 1), { kind: "knowledge" })).map((h) => h.id)).not.toContain(P(3));
    expect((await lib.vectorsFor(A).search(v(0, 1), { kind: "knowledge" })).map((h) => h.id)).toContain(P(3));
  });

  it("memories are private to one customer", async () => {
    await lib.vectorsFor(A).upsert([{ id: P(4), vector: v(0, 0, 1), payload: { kind: "memory", refId: P(4), customerId: C1 } }]);
    expect(await lib.vectorsFor(A).search(v(0, 0, 1), { kind: "memory", customerId: C1 })).toHaveLength(1);
    expect(await lib.vectorsFor(A).search(v(0, 0, 1), { kind: "memory", customerId: B })).toHaveLength(0);
    expect(await lib.vectorsFor(B).search(v(0, 0, 1), { kind: "memory", customerId: C1 })).toHaveLength(0);
  });

  it("a delete in one tenant leaves the other tenant's points alone", async () => {
    await lib.vectorsFor(A).deleteByRef("knowledge", [P(1), P(2)]); // P(2) belongs to B
    expect(await lib.vectorsFor(A).search(v(1, 0), { kind: "knowledge" })).toHaveLength(1); // only P(3) remains for A
    expect((await lib.vectorsFor(B).search(v(1, 0), { kind: "knowledge" })).map((h) => h.id)).toContain(P(2));
  });

  it("is rejected without the API key", async () => {
    if (!process.env.QDRANT_API_KEY) return;
    const res = await fetch(`${url}/collections`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

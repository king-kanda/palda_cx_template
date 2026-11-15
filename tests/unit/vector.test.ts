import { beforeEach, describe, expect, it } from "vitest";
import { embedText, resetMockVectors, vectorsFor, vectorLeakGuard } from "../../packages/integrations/src/index";

process.env.VECTOR_MODE = "mock";
process.env.EMBEDDING_MODE = "mock";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CUST1 = "33333333-3333-4333-8333-333333333333";
const CUST2 = "44444444-4444-4444-8444-444444444444";
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function put(tenant: string, kind: "knowledge" | "memory", text: string, extra: { customerId?: string; docId?: string } = {}) {
  const pid = id();
  await vectorsFor(tenant).upsert([{ id: pid, vector: await embedText(text), payload: { kind, refId: pid, ...extra } }]);
  return pid;
}

describe("vector store tenant isolation (mock)", () => {
  beforeEach(() => resetMockVectors());

  it("refuses to be used without a tenant", () => {
    expect(() => vectorsFor("")).toThrow();
    expect(() => vectorsFor("not-a-uuid")).toThrow();
  });

  it("never returns another tenant's vectors, even for an identical query", async () => {
    await put(A, "knowledge", "deposit is thirty percent refundable");
    const secretB = await put(B, "knowledge", "deposit is thirty percent refundable");
    const q = await embedText("deposit is thirty percent refundable");
    const hitsA = await vectorsFor(A).search(q, { kind: "knowledge" });
    expect(hitsA).toHaveLength(1);
    expect(hitsA.map((h) => h.id)).not.toContain(secretB);
  });

  it("scopes memories to one customer and requires the customer", async () => {
    await put(A, "memory", "prefers mornings", { customerId: CUST1 });
    await put(A, "memory", "prefers evenings", { customerId: CUST2 });
    const q = await embedText("prefers");
    const mine = await vectorsFor(A).search(q, { kind: "memory", customerId: CUST1 });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload.customerId).toBe(CUST1);
    await expect(vectorsFor(A).search(q, { kind: "memory" })).rejects.toThrow(/one customer/);
  });

  it("keeps knowledge and memory apart", async () => {
    await put(A, "knowledge", "we open at nine");
    await put(A, "memory", "we open at nine", { customerId: CUST1 });
    const q = await embedText("we open at nine");
    expect((await vectorsFor(A).search(q, { kind: "knowledge" })).every((h) => h.payload.kind === "knowledge")).toBe(true);
  });

  it("deletes only inside the tenant", async () => {
    const docId = id();
    await put(A, "knowledge", "policy one", { docId });
    await put(B, "knowledge", "policy one", { docId }); // same doc id, other tenant
    await vectorsFor(A).deleteByDoc(docId);
    const q = await embedText("policy one");
    expect(await vectorsFor(A).search(q, { kind: "knowledge" })).toHaveLength(0);
    expect(await vectorsFor(B).search(q, { kind: "knowledge" })).toHaveLength(1);
  });

  it("closes a customer's memories without touching another customer or tenant", async () => {
    await put(A, "memory", "likes window seat", { customerId: CUST1 });
    await put(A, "memory", "likes window seat", { customerId: CUST2 });
    await put(B, "memory", "likes window seat", { customerId: CUST1 });
    await vectorsFor(A).deleteByCustomer(CUST1);
    const q = await embedText("likes window seat");
    expect(await vectorsFor(A).search(q, { kind: "memory", customerId: CUST1 })).toHaveLength(0);
    expect(await vectorsFor(A).search(q, { kind: "memory", customerId: CUST2 })).toHaveLength(1);
    expect(await vectorsFor(B).search(q, { kind: "memory", customerId: CUST1 })).toHaveLength(1);
    expect(vectorLeakGuard.dropped).toBe(0);
  });

  it("mock embeddings are deterministic and rank shared words higher", async () => {
    const [a, b] = [await embedText("cancel booking refund"), await embedText("cancel booking refund")];
    expect(a).toEqual(b);
    const near = await embedText("how do I cancel my booking");
    const far = await embedText("parking space availability");
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0);
    expect(dot(a, near)).toBeGreaterThan(dot(a, far));
  });
});

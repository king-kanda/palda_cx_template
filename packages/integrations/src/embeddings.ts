import { createHash } from "node:crypto";
import { embeddingDimensions, embeddingMode, VectorError } from "./vector";

/**
 * Text to vectors. Real mode calls OpenRouter's embeddings endpoint (the model is configurable; the default is OpenAI's
 * text-embedding-3-small, 1536 dimensions). Mock mode is a deterministic bag-of-words hash, good enough for tests and
 * evals: texts that share words score higher, and the same text always gives the same vector.
 */

export function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
}

/** Crude suffix stripping so "parking", "parks" and "park" (or "cancelled" and "cancellation") share a stem in mock mode. */
function stem(word: string): string {
  let w = word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.replace(/([^aeiou0-9])\1$/, "$1");
}

function mockEmbed(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
  for (const word of words) {
    const h = createHash("sha256").update(word).digest();
    const idx = h.readUInt32BE(0) % dims;
    vec[idx] = (vec[idx] ?? 0) + (h[4]! % 2 === 0 ? 1 : -1) * 0.5 + 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const dims = embeddingDimensions();
  if (embeddingMode() === "mock") return texts.map((t) => mockEmbed(t, dims));

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new VectorError("OPENROUTER_API_KEY is not set (needed for real embeddings).");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: embeddingModel(), input: batch }),
    });
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[]; error?: unknown };
    if (!res.ok || !json.data) throw new VectorError(`Embedding request failed (${res.status}).`, json.error ?? json);
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) {
      if (row.embedding.length !== dims) {
        throw new VectorError(
          `The embedding model returned ${row.embedding.length} dimensions but EMBEDDING_DIMENSIONS is ${dims}. Set them to match, then reindex.`,
        );
      }
      out.push(row.embedding);
    }
  }
  return out;
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v!;
}

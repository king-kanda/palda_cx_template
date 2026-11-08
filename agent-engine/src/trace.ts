/**
 * Best-effort Langfuse exporter. It never throws and never blocks a reply:
 * tracing is observability, not a business dependency.
 */
export type TraceExporter = {
  start(input: { name: string; metadata: Record<string, unknown> }): Promise<{ id: string }>;
  end(id: string, payload: Record<string, unknown>): Promise<void>;
};

function config() {
  const host = process.env.LANGFUSE_HOST;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!host || !publicKey || !secretKey) return null;
  return {
    endpoint: `${host.replace(/\/$/, "")}/api/public/ingestion`,
    auth: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
  };
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createLangfuseTracer(): TraceExporter {
  return {
    async start(input) {
      const traceId = id();
      const cfg = config();
      if (!cfg) return { id: traceId };
      await fetch(cfg.endpoint, {
        method: "POST",
        headers: { authorization: cfg.auth, "content-type": "application/json" },
        body: JSON.stringify({
          batch: [
            {
              id: id(),
              type: "trace-create",
              timestamp: new Date().toISOString(),
              body: { id: traceId, name: input.name, metadata: input.metadata },
            },
          ],
        }),
      }).catch(() => undefined);
      return { id: traceId };
    },

    async end(traceId, payload) {
      const cfg = config();
      if (!cfg) return;
      await fetch(cfg.endpoint, {
        method: "POST",
        headers: { authorization: cfg.auth, "content-type": "application/json" },
        body: JSON.stringify({
          batch: [
            {
              id: id(),
              type: "span-create",
              timestamp: new Date().toISOString(),
              body: {
                id: id(),
                traceId,
                name: "agent-run",
                output: payload,
                endTime: new Date().toISOString(),
              },
            },
          ],
        }),
      }).catch(() => undefined);
    },
  };
}

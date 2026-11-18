export const dynamic = "force-dynamic";

/**
 * Forwards Meta's WhatsApp webhook to the agent service, so the whole product needs ONE public address (the web app's).
 * In Meta, set the callback URL to `<APP_URL>/webhooks/whatsapp`. The body is passed through byte for byte with its
 * `X-Hub-Signature-256` header, so the agent service still verifies Meta's signature itself; nothing is trusted here.
 */
const target = () => `${(process.env.AGENT_SERVICE_URL ?? "http://localhost:3100").replace(/\/+$/, "")}/webhooks/whatsapp`;

export async function GET(request: Request): Promise<Response> {
  // Meta's one-time verification (hub.mode / hub.verify_token / hub.challenge).
  const res = await fetch(`${target()}${new URL(request.url).search}`).catch(() => null);
  if (!res) return new Response("agent service unreachable", { status: 502 });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const headers: Record<string, string> = { "content-type": request.headers.get("content-type") ?? "application/json" };
  const signature = request.headers.get("x-hub-signature-256");
  if (signature) headers["x-hub-signature-256"] = signature;
  const res = await fetch(target(), { method: "POST", headers, body }).catch(() => null);
  // Meta retries anything that isn't 2xx, so an unreachable agent service is reported as 502 and Meta delivers again later.
  if (!res) return new Response("agent service unreachable", { status: 502 });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

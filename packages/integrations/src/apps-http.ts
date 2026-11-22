import { AppApiError } from "./oauth-apps";

/** Small JSON-over-HTTPS helper for the vendor APIs: a timeout, and errors turned into AppApiError with a short reason. */
export async function appRequest<T = unknown>(
  url: string,
  init: { method?: string; token?: string; tokenPrefix?: string; headers?: Record<string, string>; json?: unknown; body?: string },
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(init.headers ?? {}) };
  if (init.token) headers.authorization = `${init.tokenPrefix ?? "Bearer"} ${init.token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetcher(url, { method: init.method ?? "GET", headers, body, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppApiError("network", "Couldn't reach the app. Please try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401) throw new AppApiError("unauthorized", "The app refused our access. The connection may need to be renewed.");
  if (!res.ok) throw new AppApiError("upstream", `The app answered with an error: ${reasonOf(data) ?? res.status}.`);
  return data as T;
}

function reasonOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const nested = d.error && typeof d.error === "object" ? (d.error as Record<string, unknown>).message : null;
  const msg = nested ?? d.message ?? d.error;
  return typeof msg === "string" ? msg.slice(0, 160) : null;
}

/** Last nine digits: enough to match a Kenyan mobile however it was typed (+2547…, 07…, 7…). */
export function phoneKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(-9);
}

export const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => {
  const x = phoneKey(a);
  return x.length === 9 && x === phoneKey(b);
};

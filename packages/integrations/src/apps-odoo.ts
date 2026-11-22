import { samePhone, sameEmail, phoneKey } from "./apps-http";
import { assertSafeUrl, safeFetch } from "./external-mcp";
import { AppApiError, integrationsMode } from "./oauth-apps";

/**
 * Odoo over its JSON-RPC API with a user's API key (Odoo > Preferences > Account Security > New API key). The Palda team enters
 * these in the Engine. The address is checked like any outside server (https, no private network) and fetched with the guarded
 * fetch, so the key can't be pointed at something inside our network.
 */

export type OdooRef = { url: string; db: string; username: string; apiKey: string };
export type OdooPerson = { name: string; email?: string | null; phone?: string | null };

const mock = () => integrationsMode() === "mock";

export function normaliseOdooUrl(raw: string): string {
  const url = assertSafeUrl(raw);
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/(web|odoo)(\/.*)?$/, "")}`;
}

async function rpc<T>(ref: OdooRef, service: "common" | "object", method: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await safeFetch(`${normaliseOdooUrl(ref.url)}/jsonrpc`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }),
    });
  } catch {
    throw new AppApiError("network", "Couldn't reach the Odoo server at that address.");
  }
  const data = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string; data?: { message?: string } } } | null;
  if (!res.ok || !data) throw new AppApiError("upstream", `Odoo answered with HTTP ${res.status}.`);
  if (data.error) {
    const msg = data.error.data?.message ?? data.error.message ?? "error";
    const denied = /access denied|wrong login|invalid|authentication/i.test(msg);
    throw new AppApiError(denied ? "unauthorized" : "upstream", `Odoo said: ${msg.slice(0, 160)}`);
  }
  return data.result as T;
}

async function uidOf(ref: OdooRef): Promise<number> {
  const uid = await rpc<number | false>(ref, "common", "authenticate", [ref.db, ref.username, ref.apiKey, {}]);
  if (!uid) throw new AppApiError("unauthorized", "Odoo didn't accept that database, username and API key.");
  return uid;
}

const call = async <T>(ref: OdooRef, model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) =>
  rpc<T>(ref, "object", "execute_kw", [ref.db, await uidOf(ref), ref.apiKey, model, method, args, kwargs]);

/** Proves the details work. Returns the company name to show in the Engine. */
export async function odooTest(ref: OdooRef): Promise<{ company: string; version: string }> {
  if (mock()) return { company: "Sample Odoo company", version: "17.0" };
  const version = await rpc<{ server_version?: string }>(ref, "common", "version", []);
  const uid = await uidOf(ref);
  const users = await rpc<{ company_id?: [number, string] }[]>(ref, "object", "execute_kw", [
    ref.db,
    uid,
    ref.apiKey,
    "res.users",
    "read",
    [[uid]],
    { fields: ["company_id"] },
  ]);
  return { company: users[0]?.company_id?.[1] ?? ref.db, version: version.server_version ?? "unknown" };
}

type Partner = { id: number; name: string; email?: string | false; phone?: string | false; mobile?: string | false };

export async function odooFindPartner(ref: OdooRef, who: OdooPerson): Promise<{ id: number; name: string } | null> {
  if (mock()) return { id: 7, name: who.name };
  const domain: unknown[] = [];
  const key = phoneKey(who.phone);
  if (who.email && key.length === 9) domain.push("|", "|", ["email", "=ilike", who.email.trim()], ["phone", "ilike", key], ["mobile", "ilike", key]);
  else if (who.email) domain.push(["email", "=ilike", who.email.trim()]);
  else if (key.length === 9) domain.push("|", ["phone", "ilike", key], ["mobile", "ilike", key]);
  else return null;
  const rows = await call<Partner[]>(ref, "res.partner", "search_read", [domain], { fields: ["name", "email", "phone", "mobile"], limit: 10 });
  const hit = rows.find(
    (p) => sameEmail(p.email || null, who.email) || samePhone(p.phone || null, who.phone) || samePhone(p.mobile || null, who.phone),
  );
  return hit ? { id: hit.id, name: hit.name } : null;
}

export async function odooSavePartner(ref: OdooRef, who: OdooPerson): Promise<{ id: number; created: boolean }> {
  if (mock()) return { id: 7, created: false };
  const existing = await odooFindPartner(ref, who);
  const values: Record<string, unknown> = { name: who.name };
  if (who.email) values.email = who.email;
  if (who.phone) values.mobile = who.phone;
  if (existing) {
    await call(ref, "res.partner", "write", [[existing.id], values]);
    return { id: existing.id, created: false };
  }
  const id = await call<number>(ref, "res.partner", "create", [values]);
  return { id, created: true };
}

export type OdooInvoice = { number: string; date: string | null; dueDate: string | null; totalKes: number; balanceKes: number; status: string };

export async function odooInvoices(ref: OdooRef, partnerId: number): Promise<OdooInvoice[]> {
  if (mock()) {
    return [
      { number: "INV/2026/00042", date: "2026-11-05", dueDate: "2026-11-20", totalKes: 12000, balanceKes: 12000, status: "not_paid" },
      { number: "INV/2026/00031", date: "2026-10-14", dueDate: "2026-10-28", totalKes: 6000, balanceKes: 0, status: "paid" },
    ];
  }
  const rows = await call<
    { name: string; invoice_date: string | false; invoice_date_due: string | false; amount_total: number; amount_residual: number; payment_state: string }[]
  >(
    ref,
    "account.move",
    "search_read",
    [[["partner_id", "child_of", partnerId], ["move_type", "=", "out_invoice"], ["state", "=", "posted"]]],
    { fields: ["name", "invoice_date", "invoice_date_due", "amount_total", "amount_residual", "payment_state"], order: "invoice_date desc", limit: 25 },
  );
  return rows.map((r) => ({
    number: r.name,
    date: r.invoice_date || null,
    dueDate: r.invoice_date_due || null,
    totalKes: Math.round(r.amount_total),
    balanceKes: Math.round(r.amount_residual),
    status: r.payment_state,
  }));
}

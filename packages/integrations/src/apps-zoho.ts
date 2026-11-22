import { appRequest, sameEmail, samePhone, phoneKey } from "./apps-http";
import { integrationsMode } from "./oauth-apps";

/**
 * Zoho Books and Zoho CRM calls used by the agent's built-in Zoho tools. `apiDomain` is the customer's data centre
 * (checked against Zoho's hosts when the connection was made). Every lookup of a person is confirmed against the exact email or
 * phone we searched for, so a fuzzy vendor search can never hand back somebody else's records.
 */

export type ZohoRef = { token: string; apiDomain: string };
export type ZohoBooksRef = ZohoRef & { organizationId: string };
export type PersonKey = { name: string; email?: string | null; phone?: string | null };

const mock = (ref: { token: string }) => integrationsMode() === "mock" || ref.token.startsWith("mock_");
const auth = (ref: ZohoRef) => ({ token: ref.token, tokenPrefix: "Zoho-oauthtoken" });

/* ─────────────────────────────── Zoho Books ─────────────────────────────── */

export async function zohoBooksOrganizations(ref: ZohoRef): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  if (mock(ref)) return [{ id: "mock-org", name: "Sample Books organisation", isDefault: true }];
  const res = await appRequest<{ organizations?: { organization_id: string; name: string; is_default_org?: boolean }[] }>(
    `${ref.apiDomain}/books/v3/organizations`,
    auth(ref),
  );
  return (res.organizations ?? []).map((o) => ({ id: String(o.organization_id), name: o.name, isDefault: Boolean(o.is_default_org) }));
}

type BooksContact = { contact_id: string; contact_name: string; email?: string; phone?: string; mobile?: string };

const books = (ref: ZohoBooksRef, path: string, params: Record<string, string> = {}) =>
  `${ref.apiDomain}/books/v3${path}?${new URLSearchParams({ organization_id: ref.organizationId, ...params }).toString()}`;

/** The Books contact that is exactly this person (by email, else phone), or null. */
export async function zohoBooksFindContact(ref: ZohoBooksRef, who: PersonKey): Promise<{ id: string; name: string } | null> {
  if (mock(ref)) return { id: "mock-contact-1", name: who.name };
  const tries: Record<string, string>[] = [];
  if (who.email) tries.push({ email: who.email.trim() });
  if (phoneKey(who.phone).length === 9) tries.push({ phone_contains: phoneKey(who.phone) });
  for (const params of tries) {
    const res = await appRequest<{ contacts?: BooksContact[] }>(books(ref, "/contacts", params), auth(ref));
    const hit = (res.contacts ?? []).find(
      (c) => sameEmail(c.email, who.email) || samePhone(c.phone, who.phone) || samePhone(c.mobile, who.phone),
    );
    if (hit) return { id: String(hit.contact_id), name: hit.contact_name };
  }
  return null;
}

export async function zohoBooksCreateContact(ref: ZohoBooksRef, who: PersonKey): Promise<{ id: string; name: string }> {
  if (mock(ref)) return { id: "mock-contact-1", name: who.name };
  const res = await appRequest<{ contact?: BooksContact }>(books(ref, "/contacts"), {
    ...auth(ref),
    method: "POST",
    json: {
      contact_name: who.name,
      contact_type: "customer",
      contact_persons: [{ first_name: who.name, email: who.email ?? undefined, mobile: who.phone ?? undefined, is_primary_contact: true }],
    },
  });
  if (!res.contact) throw new Error("Zoho Books returned no contact.");
  return { id: String(res.contact.contact_id), name: res.contact.contact_name };
}

export type BooksInvoice = {
  number: string;
  date: string;
  dueDate: string | null;
  totalKes: number;
  balanceKes: number;
  status: string;
  currency: string;
};

export async function zohoBooksInvoices(ref: ZohoBooksRef, contactId: string): Promise<BooksInvoice[]> {
  if (mock(ref)) {
    return [
      { number: "INV-000123", date: "2026-11-02", dueDate: "2026-11-30", totalKes: 15000, balanceKes: 5000, status: "partially_paid", currency: "KES" },
      { number: "INV-000101", date: "2026-10-12", dueDate: "2026-10-26", totalKes: 8500, balanceKes: 0, status: "paid", currency: "KES" },
    ];
  }
  const res = await appRequest<{
    invoices?: { invoice_number: string; date: string; due_date?: string; total: number; balance: number; status: string; currency_code?: string }[];
  }>(books(ref, "/invoices", { customer_id: contactId, sort_column: "date", sort_order: "D", per_page: "25" }), auth(ref));
  return (res.invoices ?? [])
    .filter((i) => i.status !== "void" && i.status !== "draft")
    .map((i) => ({
      number: i.invoice_number,
      date: i.date,
      dueDate: i.due_date ?? null,
      totalKes: Math.round(Number(i.total) || 0),
      balanceKes: Math.round(Number(i.balance) || 0),
      status: i.status,
      currency: i.currency_code ?? "KES",
    }));
}

export async function zohoBooksCreateInvoice(
  ref: ZohoBooksRef,
  input: { contactId: string; reference: string; itemName: string; description: string; amountKes: number },
): Promise<{ number: string; totalKes: number; status: string }> {
  if (mock(ref)) return { number: "INV-000124", totalKes: input.amountKes, status: "draft" };
  const res = await appRequest<{ invoice?: { invoice_number: string; total: number; status: string } }>(books(ref, "/invoices"), {
    ...auth(ref),
    method: "POST",
    json: {
      customer_id: input.contactId,
      reference_number: input.reference.slice(0, 50),
      line_items: [{ name: input.itemName.slice(0, 100), description: input.description.slice(0, 500), rate: input.amountKes, quantity: 1 }],
    },
  });
  if (!res.invoice) throw new Error("Zoho Books returned no invoice.");
  return { number: res.invoice.invoice_number, totalKes: Math.round(Number(res.invoice.total) || 0), status: res.invoice.status };
}

/* ─────────────────────────────── Zoho CRM ─────────────────────────────── */

export async function zohoCrmOrgName(ref: ZohoRef): Promise<string | null> {
  if (mock(ref)) return "Sample CRM organisation";
  const res = await appRequest<{ org?: { company_name?: string }[] }>(`${ref.apiDomain}/crm/v6/org`, auth(ref));
  return res.org?.[0]?.company_name ?? null;
}

type CrmLead = { id: string; First_Name?: string; Last_Name?: string; Email?: string; Phone?: string; Mobile?: string };

export async function zohoCrmFindLead(ref: ZohoRef, who: PersonKey): Promise<{ id: string } | null> {
  if (mock(ref)) return null;
  const tries: Record<string, string>[] = [];
  if (who.email) tries.push({ email: who.email.trim() });
  if (who.phone) tries.push({ phone: who.phone.trim() });
  for (const params of tries) {
    // Zoho answers 204 (empty body) when nothing matches.
    const res = await appRequest<{ data?: CrmLead[] } | null>(`${ref.apiDomain}/crm/v6/Leads/search?${new URLSearchParams(params)}`, auth(ref));
    const hit = (res?.data ?? []).find((l) => sameEmail(l.Email, who.email) || samePhone(l.Phone, who.phone) || samePhone(l.Mobile, who.phone));
    if (hit) return { id: String(hit.id) };
  }
  return null;
}

/** Creates or updates the lead for this person. Returns whether it was new. */
export async function zohoCrmSaveLead(
  ref: ZohoRef,
  who: PersonKey,
  extra: { description?: string; source?: string },
): Promise<{ id: string; created: boolean }> {
  if (mock(ref)) return { id: "mock-lead-1", created: true };
  const [first, ...rest] = who.name.trim().split(/\s+/);
  const record: Record<string, unknown> = {
    First_Name: rest.length ? first : undefined,
    Last_Name: rest.length ? rest.join(" ") : first || "Customer",
    Email: who.email ?? undefined,
    Mobile: who.phone ?? undefined,
    Lead_Source: extra.source ?? "WhatsApp",
    Description: extra.description,
  };
  const existing = await zohoCrmFindLead(ref, who);
  if (existing) {
    await appRequest(`${ref.apiDomain}/crm/v6/Leads`, { ...auth(ref), method: "PUT", json: { data: [{ id: existing.id, ...record }] } });
    return { id: existing.id, created: false };
  }
  const res = await appRequest<{ data?: { details?: { id?: string } }[] }>(`${ref.apiDomain}/crm/v6/Leads`, {
    ...auth(ref),
    method: "POST",
    json: { data: [record] },
  });
  const id = res.data?.[0]?.details?.id;
  if (!id) throw new Error("Zoho CRM returned no lead id.");
  return { id: String(id), created: true };
}

export async function zohoCrmAddNote(ref: ZohoRef, leadId: string, input: { title: string; content: string }): Promise<{ id: string }> {
  if (mock(ref)) return { id: "mock-note-1" };
  const res = await appRequest<{ data?: { details?: { id?: string } }[] }>(
    `${ref.apiDomain}/crm/v6/Leads/${encodeURIComponent(leadId)}/Notes`,
    { ...auth(ref), method: "POST", json: { data: [{ Note_Title: input.title.slice(0, 120), Note_Content: input.content.slice(0, 2000) }] } },
  );
  return { id: String(res.data?.[0]?.details?.id ?? "") };
}

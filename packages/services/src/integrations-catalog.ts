/**
 * The business apps a customer can have connected to their agent. The Palda team sets these up for the customer in the Engine
 * (the customer never handles servers, addresses or tokens). This list is what the customer SEES: a friendly name, a category
 * and a plain-language line about what it is for.
 *
 * It does not contain connection details. Each app is reached through an MCP server whose address the Palda team enters when
 * connecting it, because those addresses differ by provider and plan and are not something to guess here.
 */

export type IntegrationProvider = {
  id: string;
  name: string;
  category: "Accounting" | "Calendar and email" | "CRM" | "Documents" | "Team chat" | "Scheduling" | "Other";
  /** One plain sentence for the customer: what connecting this does for them. */
  summary: string;
  /** Suggested short name used to label this connection's tools (letters and digits). */
  defaultName: string;
};

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: "zoho_books",
    name: "Zoho Books",
    category: "Accounting",
    summary: "Keeps your invoices, payments and customers in step with your accounting.",
    defaultName: "zohobooks",
  },
  {
    id: "google_workspace",
    name: "Google Workspace",
    category: "Calendar and email",
    summary: "Connects your Google Calendar, Gmail, Drive and Docs.",
    defaultName: "googleworkspace",
  },
  {
    id: "microsoft_365",
    name: "Microsoft 365",
    category: "Calendar and email",
    summary: "Connects your Outlook calendar and email, OneDrive and Word documents.",
    defaultName: "microsoft365",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    summary: "Keeps your invoices and payments in step with QuickBooks.",
    defaultName: "quickbooks",
  },
  {
    id: "xero",
    name: "Xero",
    category: "Accounting",
    summary: "Keeps your invoices and payments in step with Xero.",
    defaultName: "xero",
  },
  {
    id: "zoho_crm",
    name: "Zoho CRM",
    category: "CRM",
    summary: "Keeps your customer records and deals in step with Zoho CRM.",
    defaultName: "zohocrm",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "CRM",
    summary: "Keeps your customer records and deals in step with HubSpot.",
    defaultName: "hubspot",
  },
  {
    id: "calendly",
    name: "Calendly",
    category: "Scheduling",
    summary: "Connects your Calendly schedule.",
    defaultName: "calendly",
  },
  {
    id: "notion",
    name: "Notion",
    category: "Documents",
    summary: "Connects your Notion pages and databases.",
    defaultName: "notion",
  },
  {
    id: "slack",
    name: "Slack",
    category: "Team chat",
    summary: "Connects your team's Slack.",
    defaultName: "slack",
  },
];

export const CUSTOM_PROVIDER_ID = "custom";

const BY_ID = new Map(INTEGRATION_PROVIDERS.map((p) => [p.id, p]));

export function isKnownProvider(id: string): boolean {
  return id === CUSTOM_PROVIDER_ID || BY_ID.has(id);
}

/** What the customer sees for a connection: the provider's name, or the label the Palda team gave a custom one. */
export function integrationDisplay(provider: string, label: string | null | undefined): {
  name: string;
  category: IntegrationProvider["category"];
  summary: string;
} {
  const known = BY_ID.get(provider);
  if (known) return { name: known.name, category: known.category, summary: known.summary };
  const name = (label ?? "").trim() || "Connected app";
  return { name, category: "Other", summary: `Connects ${name} to your assistant.` };
}

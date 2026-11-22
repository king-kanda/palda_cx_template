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

/*
 * The apps Palda CX connects to natively (its own tools, its own code). How each is connected decides who connects it:
 *  - oauth2: the business owner, from Integrations in their own app (they sign in to the app and approve access),
 *  - api_key: the Palda team, in the Engine (keys are technical and shouldn't be pasted by customers).
 * Anything else is a custom MCP server, also set up by the Palda team.
 */
export type AppId = "google_workspace" | "zoho_books" | "zoho_crm" | "odoo";

export type AppInfo = {
  id: AppId;
  name: string;
  auth: "oauth2" | "api_key";
  category: IntegrationProvider["category"];
  /** For the customer: what connecting it does. */
  summary: string;
  /** For the Engine: what the agent's tools for it can do. */
  capabilities: string;
  /** Prefix of its tool names, e.g. "zohobooks." */
  toolPrefix: string;
  /** Short brand mark for cards (no logos are shipped). */
  mark: string;
  /** Brand colour for the mark. */
  colour: string;
};

export const APPS: AppInfo[] = [
  {
    id: "google_workspace",
    name: "Google Workspace",
    auth: "oauth2",
    category: "Calendar and email",
    summary: "Lets your assistant check your Google Calendar, add bookings to it and email customers from your Gmail.",
    capabilities: "Calendar free/busy, add events for a customer's booking, email the customer (with approval).",
    toolPrefix: "google.",
    mark: "G",
    colour: "#4285F4",
  },
  {
    id: "zoho_books",
    name: "Zoho Books",
    auth: "oauth2",
    category: "Accounting",
    summary: "Lets your assistant tell customers what they owe and raise invoices in your Zoho Books.",
    capabilities: "A customer's own invoices and balance; invoice a booking (with approval).",
    toolPrefix: "zohobooks.",
    mark: "ZB",
    colour: "#E42527",
  },
  {
    id: "zoho_crm",
    name: "Zoho CRM",
    auth: "oauth2",
    category: "CRM",
    summary: "Keeps every customer who chats with your assistant as a lead in your Zoho CRM, with notes.",
    capabilities: "Save the customer as a lead (create or update) and add notes to it.",
    toolPrefix: "zohocrm.",
    mark: "ZC",
    colour: "#089949",
  },
  {
    id: "odoo",
    name: "Odoo",
    auth: "api_key",
    category: "Accounting",
    summary: "Connects your Odoo, so your assistant can see a customer's invoices and keep their contact up to date.",
    capabilities: "A customer's own invoices; save the customer as a contact.",
    toolPrefix: "odoo.",
    mark: "O",
    colour: "#714B67",
  },
];

export const APP_IDS = APPS.map((a) => a.id);
export const isAppId = (v: string): v is AppId => (APP_IDS as string[]).includes(v);
export const appInfo = (id: AppId): AppInfo => APPS.find((a) => a.id === id)!;

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

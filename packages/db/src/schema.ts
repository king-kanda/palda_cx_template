import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ────────────────────────────── Tenancy ───────────────────────────── */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull().default("venue"),
  timezone: text("timezone").notNull().default("Africa/Nairobi"),
  currency: text("currency").notNull().default("KES"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("staff"), // owner | staff
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_tenant_email_uq").on(t.tenantId, t.email)],
);

export const tenantConfig = pgTable(
  "tenant_config",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const tenantIntegrations = pgTable(
  "tenant_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // whatsapp | mpesa | mcp
    configEncrypted: text("config_encrypted").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_integrations_kind_uq").on(t.tenantId, t.kind)],
);

export const tenantVertical = pgTable("tenant_vertical", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  vertical: text("vertical").notNull(),
  presetVersion: text("preset_version").notNull().default("1.0.0"),
});

/* ─────────────────────────── Generic core ─────────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    email: text("email"),
    language: text("language").notNull().default("en"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_tenant_phone_uq").on(t.tenantId, t.phoneE164),
    index("customers_tenant_idx").on(t.tenantId),
  ],
);

export const customerSensitive = pgTable(
  "customer_sensitive",
  {
    customerId: uuid("customer_id")
      .primaryKey()
      .references(() => customers.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dataEncrypted: text("data_encrypted").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // space | staff | room | equipment
    name: text("name").notNull(),
    capacity: integer("capacity"),
    parentResourceId: uuid("parent_resource_id").references((): any => resources.id, {
      onDelete: "set null",
    }),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resources_tenant_idx").on(t.tenantId, t.kind)],
);

export const offerings = pgTable(
  "offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    resourceKind: text("resource_kind").notNull().default("space"),
    durationMin: integer("duration_min").notNull(),
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    basePriceKes: integer("base_price_kes").notNull(),
    depositPct: integer("deposit_pct"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offerings_tenant_idx").on(t.tenantId)],
);

export const addons = pgTable("addons", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceKes: integer("price_kes").notNull(),
  unit: text("unit").notNull().default("each"),
  active: boolean("active").notNull().default(true),
});

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    offeringId: uuid("offering_id")
      .notNull()
      .references(() => offerings.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    partySize: integer("party_size").notNull().default(1),
    status: text("status").notNull().default("hold"), // inquiry | hold | confirmed | completed | cancelled | no_show
    source: text("source").notNull().default("staff"), // whatsapp | staff | web | internal
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    subtotalKes: integer("subtotal_kes").notNull().default(0),
    discountKes: integer("discount_kes").notNull().default(0),
    taxKes: integer("tax_kes").notNull().default(0),
    totalKes: integer("total_kes").notNull().default(0),
    depositRequiredKes: integer("deposit_required_kes").notNull().default(0),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_tenant_start_idx").on(t.tenantId, t.startsAt),
    index("bookings_customer_idx").on(t.customerId),
    index("bookings_status_idx").on(t.tenantId, t.status),
  ],
);

export const bookingResources = pgTable(
  "booking_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "restrict" }),
    role: text("role").notNull().default("primary"),
  },
  (t) => [uniqueIndex("booking_resources_uq").on(t.bookingId, t.resourceId, t.role)],
);

/**
 * Single source of truth for overlap prevention.
 * Both bookings (hold/confirmed) and manual blocks write "active" rows here.
 * A gist exclusion constraint (added in migration 0001) makes concurrent
 * double-booking impossible, even across booking-vs-block.
 */
export const resourceOccupancy = pgTable(
  "resource_occupancy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    blockId: uuid("block_id"),
    kind: text("kind").notNull(), // booking | block
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"), // active | released
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("occupancy_resource_range_idx").on(t.resourceId, t.startsAt, t.endsAt),
    index("occupancy_booking_idx").on(t.bookingId),
  ],
);

export const bookingItems = pgTable("booking_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  addonId: uuid("addon_id").references(() => addons.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceKes: integer("unit_price_kes").notNull(),
});

export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("blocks_tenant_idx").on(t.tenantId, t.startsAt)],
);

/* ────────────────────────────── Money ─────────────────────────────── */

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    kind: text("kind").notNull().default("full"), // deposit | balance | full
    status: text("status").notNull().default("draft"), // draft|sent|partial|paid|overdue|void
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    totalKes: integer("total_kes").notNull(),
    balanceKes: integer("balance_kes").notNull(),
    pdfUrl: text("pdf_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("invoices_tenant_number_uq").on(t.tenantId, t.number)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    // Nullable so unmatched M-Pesa receipts can land in the reconciliation queue.
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "restrict" }),
    accountRef: text("account_ref"),
    method: text("method").notNull(), // mpesa | cash | bank | card | refund
    amountKes: integer("amount_kes").notNull(),
    mpesaReceipt: text("mpesa_receipt"),
    mpesaCheckoutRequestId: text("mpesa_checkout_request_id"),
    phone: text("phone"),
    status: text("status").notNull().default("pending"), // pending | succeeded | failed
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_mpesa_receipt_uq")
      .on(t.tenantId, t.mpesaReceipt)
      .where(sql`mpesa_receipt is not null`),
    uniqueIndex("payments_checkout_uq")
      .on(t.tenantId, t.mpesaCheckoutRequestId)
      .where(sql`mpesa_checkout_request_id is not null`),
  ],
);

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  amountKes: integer("amount_kes").notNull(),
  vendor: text("vendor"),
  incurredOn: timestamp("incurred_on", { withTimezone: true }).notNull(),
  receiptUrl: text("receipt_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────── Comms / ops ──────────────────────────── */

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // deposit_due | balance_due | event_minus_7d | event_minus_1d | thank_you | review_request | hold_nudge
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"), // pending | sent | failed | cancelled
    channel: text("channel").notNull().default("whatsapp"),
    template: text("template").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reminders_due_idx").on(t.status, t.sendAt)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("whatsapp"), // whatsapp | web
    state: text("state").notNull().default("open"), // open | waiting_human | closed
    handler: text("handler").notNull().default("wambo"), // wambo | human
    agentState: text("agent_state").notNull().default("new"), // booking flow state machine
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversations_tenant_idx").on(t.tenantId, t.state),
    uniqueIndex("conversations_customer_channel_uq").on(t.tenantId, t.customerId, t.channel),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // inbound | outbound
    waMessageId: text("wa_message_id"),
    type: text("type").notNull().default("text"), // text | interactive | image | audio | template | system
    body: text("body"),
    toolCalls: jsonb("tool_calls").$type<unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_wa_id_uq")
      .on(t.tenantId, t.waMessageId)
      .where(sql`wa_message_id is not null`),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    status: text("status").notNull().default("open"), // open | assigned | resolved
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("handoffs_open_idx").on(t.tenantId, t.status)],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  rating: integer("rating"),
  comment: text("comment"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  publicLinkSent: boolean("public_link_sent").notNull().default(false),
});

/* ─────────────────────────── Audit / SaaS ─────────────────────────── */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").notNull(),
    kind: text("kind").notNull(), // refund | discount | cancel_outside_policy | bulk_send | override_price | other
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | expired | executed
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_queue_idx").on(t.tenantId, t.status)],
);

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    version: integer("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("draft"), // draft | evaluating | live | retired
    evalRunId: text("eval_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_versions_uq").on(t.tenantId, t.agentId, t.version)],
);

export const agentPointers = pgTable(
  "agent_pointers",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    environment: text("environment").notNull().default("production"),
    versionId: uuid("version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.agentId, t.environment] })],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    agentVersion: integer("agent_version").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id"),
    trigger: text("trigger").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costKes: integer("cost_kes").notNull().default(0),
    toolCalls: jsonb("tool_calls").$type<unknown[]>(),
    outcome: text("outcome").notNull().default("ok"),
    flagged: boolean("flagged").notNull().default(false),
    error: text("error"),
    langfuseTraceId: text("langfuse_trace_id"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_runs_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    tool: text("tool").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_uq").on(t.tenantId, t.key, t.tool)],
);

export const counters = pgTable(
  "counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_uq").on(t.tenantId, t.source, t.externalId)],
);

export const integrationsLog = pgTable("integrations_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  direction: text("direction").notNull(),
  request: jsonb("request").$type<Record<string, unknown>>(),
  response: jsonb("response").$type<Record<string, unknown>>(),
  ok: boolean("ok").notNull().default(true),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─────────────────────────────── Types ────────────────────────────── */

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type Offering = typeof offerings.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Handoff = typeof handoffs.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;

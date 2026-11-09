# MCP tool contract

The Booking App exposes exactly one agent-facing surface: a **per-tenant MCP
server** at `POST/GET/DELETE /api/mcp`, authenticated with a bearer token that
carries the tenant, principal type and scopes. The Agent Engine knows nothing
about bookings; it only sees these tools. The server currently advertises **52
tools** (47 core + 5 vertical extras).

Source of truth: [`packages/mcp-server/src/tools.ts`](../packages/mcp-server/src/tools.ts)
(definitions) and [`packages/mcp-server/src/dispatch.ts`](../packages/mcp-server/src/dispatch.ts)
(gating, approvals, idempotency).

## Transport and auth

- Streamable HTTP, JSON responses, stateless: a fresh `McpServer` per request.
- `Authorization: Bearer <jwt>` signed with `MCP_TOKEN_SECRET`.
- Claims: `tid` (tenant), `pt` (`customer` | `staff` | `system`), `pid`, `role`,
  `scopes`, `label`.
- Issue tokens with:

```bash
# staff / owner (scopes ["*"])
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type staff --email owner@palda.co.ke

# customer (scoped to their own records)
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type customer --phone +254712345678

# system / ops agent
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type system --label wambo
```

- Tools are filtered twice: by `principalTypes` and by scope overlap. A tool the
  principal cannot see is not advertised, and calling it directly returns
  `FORBIDDEN`.

## Tiers

| Tier | Meaning | What happens |
| --- | --- | --- |
| `read` | Pure reads. | Executes immediately. |
| `write-safe` | Writes that are reversible or expected from this principal. | Executes immediately. |
| `write-sensitive` | Money movement, pricing exceptions, bulk messaging. | Customer/system principals, and non-owner staff for owner-only tools, get an **approval** instead of an execution. |
| `escalate` | Creates a human task (handoff, approval request). | Executes immediately; it never moves money or changes a booking. |

**The model never computes money, availability or dates.** Every figure the
agent may quote comes from a `read` tool (`bookings.get_quote`,
`bookings.check_availability`, `bookings.get`, `reports.dashboard`, …). The
engine's guard rejects any KES figure in a reply that does not appear in a tool
result.

## Tools

### Knowledge and catalogue (read)

| Tool | Principals | Purpose |
| --- | --- | --- |
| `knowledge.get_business_info` | customer, staff, system | Business facts, FAQ, hours, policies, labels. |
| `catalogue.list` | customer, staff, system | Resources, offerings and add-ons with prices. |

### Bookings

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `bookings.check_availability` | read | customer, staff, system | Slots or a window for an offering. |
| `bookings.get_quote` | read | customer, staff, system | Exact quote: subtotal, discount, tax, total, deposit. |
| `bookings.get` | read | customer, staff, system | One booking (customers only their own). |
| `bookings.get_customer_bookings` | read | customer | The caller's booking history. |
| `bookings.list` | read | staff, system | Filtered booking list. |
| `bookings.create_hold` | write-safe | customer, staff, system | Creates a hold; the database rejects overlaps. |
| `bookings.confirm` | write-safe | staff, system | Hold → confirmed (usually after deposit). |
| `bookings.cancel` | write-safe | customer, staff, system | Cancels within policy. |
| `bookings.reschedule` | write-safe | customer, staff, system | Moves a booking; overlap-checked. |
| `bookings.request_change` | write-safe | customer | Asks staff to change a booking. |
| `bookings.apply_discount` | write-sensitive | staff | Owner-only discount; staff requests become approvals. |
| `bookings.mark_completed` | write-safe | staff, system | Marks the event complete and schedules follow-ups. |

### Customers

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `customers.get` | read | customer, staff, system | Profile (sensitive fields excluded for customers). |
| `customers.list` | read | staff, system | Search customers. |
| `customers.upsert` | write-safe | staff, system | Create/update a customer. |
| `customers.add_note` | write-safe | staff, system | Append an internal note. |
| `customers.sensitive.get` | read | staff | Decrypt sensitive attributes (ID numbers, allergies). |
| `customers.log_complaint` | write-safe | customer, staff, system | Records a complaint and opens a handoff. |

### Money

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `payments.request` | write-safe | customer, staff, system | Sends an M-Pesa STK push / payment link. |
| `payments.record_manual` | write-safe | staff, system | Records cash/bank/card payment. |
| `payments.list` | read | staff, system | Payments for a booking or recent list. |
| `payments.list_unmatched` | read | staff, system | C2B receipts with no booking. |
| `payments.match_unmatched` | write-safe | staff, system | Attaches an unmatched receipt. |
| `payments.refund` | write-sensitive | customer, staff, system | Customer/system → approval; owner executes. |
| `invoices.generate` | write-safe | staff, system | Deposit or balance invoice. |
| `invoices.send` | write-safe | staff, system | Sends the invoice (WhatsApp + link). |
| `invoices.get` | read | staff, system | Invoice with payments and items. |
| `invoices.list` | read | staff, system | Filtered invoice list. |

### Workflow

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `approvals.list` | read | staff, system | Pending/decided approvals. |
| `approvals.request` | escalate | staff, system | Asks an owner to approve something. |
| `approvals.decide` | write-sensitive | staff | Owner decides; approved tool-backed requests execute once. |
| `reminders.list` | read | staff, system | Scheduled reminders. |
| `reminders.schedule` | write-safe | staff, system | Schedules a reminder. |
| `reviews.request` | write-safe | staff, system | Sends a review request after completion. |
| `reviews.record` | write-safe | customer, staff, system | Stores a rating/comment. |
| `handoffs.create` | escalate | customer, staff, system | Opens a human handoff (always available). |
| `handoffs.list` | read | staff, system | Handoff queue. |
| `blocks.create` | write-safe | staff | Blocks a resource (maintenance, private event). |
| `blocks.delete` | write-safe | staff | Removes a block. |
| `blocks.list` | read | staff, system | Blocks in a window. |
| `conversations.list` | read | staff, system | Inbox summaries. |
| `conversations.thread` | read | customer, staff, system | Messages (customers only their own). |
| `messages.send` | write-sensitive | staff, system | Proactive/bulk WhatsApp send; system → approval. |

### Ops

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `reports.dashboard` | read | staff, system | Today/this week: bookings, revenue, outstanding, handoffs. |
| `reports.daily_digest` | read | staff, system | The 07:00 Nairobi digest payload. |

### Vertical extras

Presets advertise extra tools as data, but these are real tools on every tenant;
the preset controls whether the agent's prompt mentions them. They are also
available to staff directly.

| Tool | Tier | Principals | Purpose |
| --- | --- | --- | --- |
| `addons.quote` | read | customer, staff, system | Prices an offering with add-ons (chairs, tents, sound, decor). |
| `meetings.create_link` | write-safe | staff, system | Creates/stores an online meeting link and sends it (consultancy). |
| `intake.send_form` | write-safe | staff, system | Sends the pre-session intake form link (consultancy). |
| `recalls.schedule` | write-safe | staff, system | Schedules a recall reminder after a completed visit (dental). |
| `walkins.join_queue` | write-safe | staff, system | Adds a walk-in client to today's queue and returns their position (salon). |

## Approvals

Sensitive calls never execute for the principals below. Instead the dispatcher
creates a row in `approvals` and returns:

```json
{
  "status": "pending_approval",
  "approvalId": "…",
  "kind": "refund",
  "message": "This action needs a human owner to approve it…"
}
```

| Requested by | Tool tier | Result |
| --- | --- | --- |
| customer | `write-sensitive` | approval (kind from the tool: refund, discount, bulk_send, …) |
| system (agent) | `write-sensitive` | approval |
| staff (non-owner) | `payments.refund`, `bookings.apply_discount` | approval |
| owner | `write-sensitive` | executes |
| staff (non-owner) | `approvals.decide` on refund/discount/override_price | `FORBIDDEN` |

Approval kinds: `refund`, `discount`, `cancel_outside_policy`, `bulk_send`,
`override_price`, `other`. Approvals expire after 24 hours. Approving a
tool-backed request runs the inner tool **once** with the approver's principal,
then marks the approval `executed`.

## Idempotency and errors

- Write tools that accept `idempotencyKey` (minimum 6 characters) cache their
  result in `idempotency_keys` per `(tenant, tool, key)`. Retries return the
  original result instead of duplicating a booking or a payment.
- Domain errors are returned, never thrown over the wire:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION` | 400 | Zod/argument/business validation failed. |
| `FORBIDDEN` | 403 | Principal type or scope not allowed. |
| `NOT_FOUND` | 404 | Entity missing in this tenant. |
| `SLOT_UNAVAILABLE` | 409 | Overlap caught by the database exclusion constraint. |
| `CONFLICT` | 409 | State conflict (already cancelled, already paid, …). |
| `POLICY` | 422 | Outside the tenant's cancellation/deposit policy. |
| `INTERNAL` | 500 | Unexpected failure; details are logged, not returned. |

`SLOT_UNAVAILABLE` is produced by mapping PostgreSQL `23P01` on
`resource_occupancy_no_overlap`, so two concurrent calls can never both win.

# WhatsApp: Embedded Signup, coexistence and routing

You configure the **Meta app once**. Each customer then connects **their own WhatsApp number** themselves, through Meta's Embedded Signup, from a private link. No per-customer credentials are ever typed in by you.

> **Status:** built and tested against mocks and a stubbed Meta Graph API (unit, integration and real-browser tests). The real Meta popup, a real Meta app and real numbers have **not** been tried yet. Treat the first real connection as the real test, and read "Not verified" below.
> Meta details below were read from Meta's developer documentation (the coexistence page is dated April 2026) while building this. Meta changes these pages often, so re-check them when you set up.

## 1. What you set up once (Meta)

1. **A Meta app of type Business**, with the WhatsApp product, belonging to a verified business. To onboard customers who are **not** part of your own business, the app must be a **Tech Provider** (or Solution Partner): Meta requires app review for `whatsapp_business_management` and `whatsapp_business_messaging` and business verification. Until that is approved the app is in development mode; see section 6 for testing before approval.
2. **Facebook Login for Business**: in the App Dashboard set *Client OAuth login*, *Web OAuth login*, *Enforce HTTPS*, *Embedded Browser OAuth Login*, *Use Strict Mode for redirect URIs* and *Login with the JavaScript SDK* to **Yes**. Add your public domain (the one customers use for their own app) to **Allowed domains** and **Valid OAuth redirect URIs**. It must be HTTPS with a valid certificate (a tunnel works for testing).
3. **An Embedded Signup configuration**: Facebook Login for Business > Configurations > create one with the *WhatsApp Embedded Signup* login variation. Select only the assets and permissions you need. Copy its **configuration id**.
4. **The webhook**: App Dashboard > WhatsApp > Configuration. Callback URL `https://<public host for port 3100>/webhooks/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN`. Subscribe to these fields: **`messages`**, **`smb_message_echoes`**, **`history`**, **`smb_app_state_sync`**, **`account_update`**. (One webhook serves every customer; messages say which number they were sent to.)
5. **`.env`** on the server:

```
WHATSAPP_MODE=cloud
WHATSAPP_GRAPH_VERSION=<a current Graph API version>
META_APP_ID=...
META_APP_SECRET=...             # also verifies the webhook signature
META_ES_CONFIG_ID=...
WHATSAPP_VERIFY_TOKEN=...
APP_URL=https://<your public host for port 3000>
```

Leave `META_ES_FEATURE_TYPE` empty for the current Embedded Signup version. Only for an older (v4) configuration set it to `whatsapp_business_app_onboarding` to enable the existing-app flow. Embedded Signup v2 and v3 are deprecated on 15 October 2026, so use a current configuration. `pnpm env:check` lists what is missing.

Not needed any more: `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`. They remain only as a development fallback for the default business when it has no connected number.

## 2. What happens per customer

1. The customer's **owner** signs in to their own app and opens **Integrations > Connect WhatsApp**. Everything customer-specific happens here, on the customer's side: the Palda team never handles their Meta login, number or token, and does not send links. (Staff can still open the customer's app from the Engine and connect with them on a call.)
2. The page (in the customer's own app and branding) has the **Connect WhatsApp** button. Meta's popup walks them through: log in, choose or create their WhatsApp Business Account, choose or add their number and verify it (a code, or a QR scan for an existing WhatsApp Business app number).
3. Meta's popup reports the account (and, for a new number, the number) and a short-lived **code** (it lives about 30 seconds). Our server exchanges it for **that customer's token**, reads the number, **claims the number for that business**, subscribes our app to its webhooks, and for a **new** number registers it with a PIN. The token is stored encrypted for that customer only.
4. From then on messages to that number reach that customer's agent, and the agent replies from that number with that customer's token.

The customer's Integrations card shows the number, status and how it is connected, with **Check connection**, **Reconnect** and **Disconnect** (owner only). The Engine's Connections page shows the same facts **read-only**, so the team can support the customer, but it has no connect, link or disconnect controls.

## 3. Coexistence (the customer keeps using the WhatsApp Business app)

If the customer already uses the WhatsApp Business app on their number, the same flow connects it **alongside** the app: they keep the app and their chats, and our agent also works on the number.

What we do differently for such a number:

- It is already registered, so we **never register it again** (that would break their app). We confirm with `is_on_biz_app` where Meta reports it.
- Within 24 hours Meta lets us request the contacts and message history **once** (`smb_app_data`, contacts then history). We request both right after connecting. They can't be requested again without the customer reconnecting. The data arrives on the `history` and `smb_app_state_sync` webhook fields; **we keep the raw payloads per business in the integration log and do not yet import them into the inbox** (see "Not built").
- When someone replies from the app or a linked device, Meta sends an **echo** (`smb_message_echoes`). We keep it in the conversation (shown as a message from the business) and **hand that conversation to a person**, so the agent never talks over them. It stays with the person until someone hands it back in the inbox. An echo of the agent's own message (same text within 15 minutes) is ignored, so the agent can't pause itself.
- Meta ends the link if the business stops using the app (`PARTNER_REMOVED` on `account_update`; reasons include the main phone idle for about 14 days, a linked device idle for about 30 days, the number changed, the account removed). We mark the connection **disconnected** and stop sending. The Engine shows it; a new connect link reconnects.

Limits Meta documents for coexistence numbers: throughput is fixed at 20 messages per second; the business must use a recent WhatsApp Business app (2.24.17 or newer); group chats, broadcast lists, disappearing and view-once messages, live location and calls are not available once coexistence is on; messages sent from the app stay free; Cloud API messages follow Cloud API pricing. A number already on the Cloud API cannot be onboarded this way, and a number registered with the consumer WhatsApp app has to be moved to the Business app first.

## 4. How routing and isolation work

- **`whatsapp_routes`** maps each WhatsApp number (Meta's `phone_number_id`) to one business. A message carries only the number it was sent to, with no business context, so this lookup must work without one. The table has no row-level security (like `login_index`) and holds no secrets. Its **primary key** means a number can only ever belong to one business, so it can't be claimed twice and used to steal messages.
- A message to a number **nobody connected is ignored**. It is never given to a default business. (Two narrow development fallbacks remain: the single number in the old environment variable belongs to the default business, and in mock mode a hand-made payload with no number goes to the default business.)
- **One webhook request can carry changes for several businesses**, so each change is routed on its own number. A failing change never blocks the others, and we always answer 200 so Meta doesn't keep retrying.
- **Sending** uses the credentials of the business the message belongs to. A business with no connected number fails cleanly and **never borrows another business's token**.
- The token is encrypted at rest, never shown in the Engine, never written to the audit log, and never appears in an error message (the code exchange puts the app secret in a URL, so errors from it are replaced with a generic message).
- Only the signed-in **owner** of a business can connect, reconnect, check or disconnect its WhatsApp, and the business always comes from their session, never from anything the browser sends. Staff accounts see the status only.

## 5. Mock mode (no Meta app needed)

With `WHATSAPP_MODE=mock` the customer's Connect WhatsApp page shows two clearly labelled **test-mode** buttons (*Simulate a new number*, *Simulate an existing WhatsApp Business app number*). They run the whole flow locally with fake data, so you can see two businesses with separate numbers, the routing, the echo behaviour and the Engine and customer screens without Meta. A simulated number id starting `mock_coex` behaves as a coexistence number.

## 6. Testing with two clients

- **Before Meta approves the app (development mode):** the Embedded Signup flow is generally limited to people with a role on your app (admins, developers, testers) and their own test businesses and numbers. That is how I understand Meta's development mode; confirm in your app's dashboard. So for a first real test, use two numbers owned by people you have added as testers, ideally one new number and one existing WhatsApp Business app number so both paths run.
- **After approval:** any customer's owner can connect from their own Integrations page.
- **Do this first:** `pnpm env:check`, then connect one number, press **Check connection**, send it a message, and watch the run in the Engine. Connect the second number and confirm each message lands in the right business. Use shadow mode for the first real messages.

## 7. Not verified (read this)

- The real Embedded Signup popup, the code exchange, and webhook subscription have not been run against Meta. They follow Meta's documentation and are tested against a stub that mirrors it.
- **Token lifetime** is not stated in the pages I read. The configuration template name suggests a 60-day token, and we record an expiry if Meta returns one (`expires_in`). **Check connection** proves a token still works. There is **no automatic renewal or scheduled check yet**; plan to check periodically until there is.
- **Country availability** of coexistence for Kenyan numbers, and any minimum period of app use, were not stated in the pages I read. Check Meta's current rules for your market.
- The **typing indicator** (best effort, silent on failure) hasn't been tried against a real number.
- **Graph API version:** `WHATSAPP_GRAPH_VERSION` defaults to `v21.0`. Set a current one.

## 8. Not built

- **Message templates per customer.** Messages sent outside the 24-hour window (reminders, confirmations, review requests) must be templates approved on **each customer's own WhatsApp account**. A new customer account has none, so those proactive messages would fail until templates are created and approved there. Customers writing to the agent first (the normal case) are unaffected. Creating templates for each connected account is a follow-up.
- **Importing coexistence history** into the inbox (the raw payloads are kept; the exact shape of the chunks was not verified).
- **Automatic token checks and renewal**, and an alert when a connection fails.
- **Delivery receipts** (sent, delivered, read).
- **Customer-facing disclosure and consent text** for coexistence history, which needs a data-protection review before real customer data is imported.

## 9. Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/whatsapp-connect.test.ts` | Parsing every webhook change per number (batched, echoes, account updates, history, junk), Meta's popup messages (origin checks, coexistence event, cancel, error), per-business sending credentials |
| `tests/integration/whatsapp-onboarding.test.ts` | Two to five businesses: separate numbers and credentials, a number can't be claimed twice, encrypted tokens, a bad code stores nothing, batched and unknown-number webhooks, a phone reply silencing the agent, duplicate and own-message echoes, history kept raw, `PARTNER_REMOVED`, disconnect. Against a stubbed Meta: the exact order of calls, coexistence never registered and synced once, failure rollback, no secret in errors, each business sends with its own token, Check connection |
| `tests/unit/env.test.ts` | Cloud mode needs only the Meta app values |

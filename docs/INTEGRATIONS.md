# Apps the agent works with (Google, Zoho, Odoo, custom MCP)

## Who connects what

| App | How it connects | Who connects it | Where |
| --- | --- | --- | --- |
| Google Workspace | OAuth2 (sign in to Google) | The business **owner** | Their app: Integrations → Your apps |
| Zoho Books | OAuth2 (sign in to Zoho) | The business **owner** | Their app: Integrations → Your apps |
| Zoho CRM | OAuth2 (sign in to Zoho) | The business **owner** | Their app: Integrations → Your apps |
| Odoo | API key | The **Palda team** | Engine → customer → Integrations |
| Anything else | Custom MCP server + token | The **Palda team** | Engine → customer → Integrations |

The rule is simple: if it signs in with OAuth, the customer connects it; if it needs a key, we do.

Connecting an app does **not** give the agent anything by itself. Every app tool starts **off**. The Palda team switches tools
on per customer in Engine → Tools (searchable, grouped "Built in · Palda CX" then one section per app), and publishes a
version. A tool is only offered to the agent while its app is connected and working.

## The agent's app tools (our own code)

| Tool | What it does | Tier |
| --- | --- | --- |
| `google.calendar_busy` | Busy times on the business calendar | read |
| `google.calendar_add_event` | Adds the customer's own booking to the calendar (invites them if they have an email) | writes |
| `google.email_customer` | Emails the customer of a booking from the business's Gmail | needs approval |
| `zohobooks.my_invoices` / `zohobooks.my_balance` | The customer's own invoices / what they owe | read |
| `zohobooks.invoice_booking` | Draft Zoho invoice for a booking, amount from Palda CX | needs approval |
| `zohocrm.save_lead` / `zohocrm.add_note` | The customer as a lead, and notes on it | writes |
| `odoo.my_invoices` / `odoo.save_contact` | The customer's own invoices / the customer as a contact | read / writes |

Safety rules: a tool only ever acts on the customer being served (matched in the app by exact email or phone), money and dates
come from the app or from Palda CX (the engine's money guard checks every figure), and "needs approval" tools are checked
(own booking, app connected) before an approval is even created, then run once when the owner approves.

## Platform setup (once, by the Palda team)

Engine → Settings → **Google & Zoho**. Leave "Apps mode" on **Mock** until the clients below exist: in mock mode owners can
"connect" without leaving the app and every tool answers with sample data.

### Google
1. Google Cloud console → new project → enable **Google Calendar API** and **Gmail API**.
2. OAuth consent screen: External, add the scopes `calendar.events`, `calendar.freebusy`, `gmail.send`, `userinfo.email`.
3. Credentials → OAuth client ID → Web application. Authorised redirect URIs: `<APP_URL>/integrations/callback/google_workspace`
   and `<APP_URL>/auth/google/callback` (the second is "Continue with Google" on the sign-in screens).
4. Paste the client ID and secret in Engine → Settings.
5. `gmail.send` is a *sensitive* scope: until Google verifies the app, only test users you list (max 100) can connect.
   Drive is deliberately not requested (its scopes are *restricted* and need a paid security assessment).

### Zoho
1. api-console.zoho.com → Add client → **Server-based Applications**.
2. Redirect URIs: `<APP_URL>/integrations/callback/zoho_books` and `<APP_URL>/integrations/callback/zoho_crm`.
3. Settings → turn on **"Use the same OAuth credentials for all data centers"** (so .eu / .in / .com.au customers work).
4. Paste the client ID (starts with `1000.`) and secret in Engine → Settings.

Then set Apps mode to **Live**. APP_URL must be the public https address customers use.

## How it works (for developers)

- Tokens / keys: `tenant_integrations` row per business per app (`kind` = app id), encrypted (`encryptJson`); `meta` holds
  only status and the account label. `packages/services/src/connections.ts`.
- OAuth: `packages/integrations/src/oauth-apps.ts`. Routes `apps/web/app/(app)/integrations/connect/[app]` and
  `callback/[app]`; a 10-minute httpOnly cookie carries the `state` and is checked against the session's business.
  Zoho's `accounts-server` and `api_domain` are only accepted if they are Zoho's own hosts.
- Token refresh happens in `withApp()` (60 s before expiry, and once on a 401). A refused refresh marks the connection
  "needs attention"; its tools are withdrawn until the owner reconnects.
- Tools: `packages/mcp-server/src/integration-tools.ts`. Runtime switch: `toolPolicy.enabledIntegrationTools` in the agent
  version; `apps/agent-service/src/agent-config.ts` blocks every app tool that isn't enabled or whose app isn't healthy.
- Tests: `tests/unit/oauth-apps.test.ts`, `tests/integration/connections.test.ts`; evals `wambo-app-balance-*`.

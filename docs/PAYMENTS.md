# Payments

Each business connects its own payment providers in **Integrations > Payments** (owner only). Keys are typed there, saved
encrypted in `tenant_integrations` (kind `payments`), checked with the provider, and only ever shown back as their last four
characters. Several providers can be on at once. They are tried **in the order shown**; if one fails, the next is used.

| Provider | M-Pesa prompt to the phone | Hosted payment link | How we learn it was paid |
| --- | --- | --- | --- |
| Tuma | yes | no | Tuma callback to `/api/mpesa/callback?tenant=<slug>` (set for you) |
| Paystack | yes, Charge API (`mobile_money`, KES, `mpesa`) | yes, card | `charge.success` webhook to `/api/payments/paystack?tenant=<slug>`, HMAC-SHA512 checked with the business's own secret key |
| Pesapal | no | yes, card or M-Pesa | IPN to `/api/payments/pesapal?tenant=<slug>`; the status is then read back from Pesapal, because the IPN proves nothing |

A business with no providers connected cannot ask anyone to pay. The platform's `MPESA_MODE` account is used only in mock mode
or for the default business (`DEFAULT_TENANT_SLUG`), never for another business.

## What the customer sees on WhatsApp

`sendPaymentOptions` picks the message from what is switched on:

- a link provider **and** an M-Pesa prompt provider: a template with a **Pay with M-Pesa** quick-reply button and a **Pay online** URL button,
- only a link provider: a template with the link,
- only an M-Pesa prompt provider: the prompt goes straight to the phone.

The URL button opens `<APP_URL>/pay/<slug>/<invoice id>`, which makes a fresh link with the first working link provider and
redirects (a link made in the last 20 minutes is reused). Tapping **Pay with M-Pesa** arrives as a button reply carrying
`pay_mpesa:<invoice id>`; the agent service answers it without the model: the prompt goes only to the number the tap came from,
and only if that number belongs to the invoice's customer. If every prompt provider fails, the customer is sent the link.

### Templates must be approved by Meta

`Set up payment messages` (Integrations > Payments) submits `payment_options_v1` and `payment_link_v1` to the business's WhatsApp
account; `Check approval` refreshes their status. Until approved, the same message goes out as plain text (works while the
customer's 24-hour window is open). The link button needs `APP_URL` to be a public `https://` address. The template body is
`BODY` in `packages/services/src/payment-providers.ts`; changing it means a new template name (`_v2`).

## Mock mode

`MPESA_MODE=mock` makes every provider simulate: prompts return a fake reference and links go to `/pay/mock/<ref>?tenant=<slug>`,
a pretend checkout with a "Pay now (demo)" button that settles the payment. Nothing leaves the machine.

## Not yet verified against the real gateways

Everything is tested with the three gateways stubbed at `fetch`, so request shapes and matching are proven, the gateways are not.
Check on first real use: Paystack accepts the placeholder email `<phone>@customers.invalid` for customers with no email; Paystack
M-Pesa for KES is enabled on the account; Pesapal's IPN reaches us and `GetTransactionStatus` returns `status_code` 1 on success;
Meta approves the two templates as UTILITY.

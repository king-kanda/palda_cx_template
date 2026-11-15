# Business branding and documents

Each customer looks like their own business. The Palda team sets this up in the Engine; it shows in the customer's app, on their public forms and on their invoices.

## Where to set it

Engine, open a customer, **Business**:

| Screen | Path | What it holds |
| --- | --- | --- |
| Branding | `/engine/<id>/business/branding` | Logo, main and accent colours, tagline, website, Instagram, Facebook, TikTok, LinkedIn, business email and phone. Has a live preview of the customer's app wearing the brand |
| Documents | `/engine/<id>/business/documents` | Brochures, price lists, terms, contracts, and quote or letter templates. Upload, download, delete |

## Colours

A brand is two colours: a **main** colour (buttons, links, the sidebar, KPI highlights) and an **accent** (marks the page you are on). The app's design uses a handful of colour variables, so a brand replaces them everywhere with no per-page work. Tints are derived from the two colours (`deriveTheme` in `packages/services/src/brand.ts`).

Colours are checked for readable contrast (WCAG 4.5:1) before anything is saved:

- white text on the main colour must be readable, so a pale "brand" colour is refused;
- the dark tint of the main colour must be readable on the accent (active menu items);
- the accent must not be almost white.

Seven ready-made palettes are offered (Forest, Ocean, Plum, Terracotta, Slate, Berry, Mustard); all pass the check. A business that has not chosen colours keeps the default Palda theme.

Safety: only validated `#RRGGBB` values ever reach the injected stylesheet. A stored colour that is malformed, tampered with, or unreadable is ignored and the default theme is used.

## Logo

PNG, JPEG or WebP, shrunk in the browser to fit (420 px) and stored as a small data URL (about 280 KB limit). SVG is refused because it can carry scripts. The invoice PDF draws PNG and JPEG logos only; a WebP logo shows in the app but is skipped on the PDF.

## Where the brand shows

- **The customer's app:** the colours throughout, and the logo in the sidebar instead of the default mark.
- **Public forms** (the session intake form): the colours and the logo.
- **Invoice PDFs:** logo, main colour, tagline, address, and a contact line (website, email, phone). The hard-coded "Karen, Nairobi, Kenya" default address was removed: it printed the wrong address on every other business's invoices. The address now comes from the business's own details and is omitted if empty.
- **Not yet applied:** the sign-in page (one email-only login for everyone, so it has no tenant at that point), WhatsApp message wording, and emails.

## Documents

Files are stored in Postgres (table `business_documents`, with row-level security), so they back up and isolate like everything else. Limits and safety:

- Allowed: PDF, Word (`.docx`), Excel (`.xlsx`), PNG, JPEG, WebP, text, Markdown, CSV. Up to 5 MB.
- The type comes from the file extension, never from what the browser says, and the contents must match it (a `.pdf` must start with `%PDF-`, an image must have a real image header, text must contain no binary). HTML, SVG, scripts and executables are not allowed.
- Filenames are cleaned (no paths, quotes, control characters or leading dots).
- Downloads are **attachments only**, with `X-Content-Type-Options: nosniff` and a sandboxing Content-Security-Policy, so a file can never run as part of the site.
- The customer downloads from `/api/documents/<id>` (tenant taken from their session), the Palda team from `/engine/download/<tenant>/<id>` (Engine sign-in required). Another business's document id returns "not found".
- The customer sees their documents under **Documents** in their app, grouped by type, read-only.

## Not built: editing message wording

WhatsApp messages sent outside the 24-hour window (reminders, confirmations, review requests) must be templates pre-approved by WhatsApp, each with a fixed body and a fixed order of variables. Editing the wording per business here would change nothing customers actually receive in production, and a different variable order would make sends fail. A safe version needs a "submit for approval" flow with WhatsApp. Until then the wording comes from the business type.

## Demo customers

`pnpm engine:demo-brands` gives the demo customers distinct brands, logos, contact details and sample documents (Palda Gardens: Terracotta, Sparkle Cleaners: Ocean). Re-runnable. For another customer: `pnpm engine:demo-brands --slug <slug> --preset Plum`.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/brand.test.ts` | Colour maths, contrast for every palette, theme variables, parsing, no CSS injection from stored values, the schema, the invoice PDF with and without a brand |
| `tests/unit/documents.test.ts` | Allowed types, content checks (renamed files rejected), filename cleaning |
| `tests/integration/branding-documents.test.ts` | Saving and reading a brand per customer, unreadable colours refused, logo set/keep/remove, document add/list/get/delete, wrong type, wrong content, empty, oversized, isolation between customers, audit |

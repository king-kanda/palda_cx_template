# Design System & Style Guide — Garden Booking OS

> Last updated: **2026-11-15**
> Source of truth for how the web app looks. The visual language is adopted **1:1 from the
> palda-homes portal** (`C:\Users\user\Desktop\palda-homes\docs\UI-SPEC.md` and
> `apps/web/src/components/**`): deep-green + lime, soft grey canvas, white rounded cards, left sidebar.
> The booking app implements it with Tailwind CSS v4 tokens plus a handful of global classes, so existing
> pages inherit it without per-page work.

Companion docs: [`claude-handoff.md`](./claude-handoff.md) (build position), [`HANDOFF.md`](./HANDOFF.md) (cold start).

---

## 1. Principles

1. **Calm and scannable.** White cards on a soft canvas, lots of whitespace, one primary accent.
2. **Money first.** Amounts are large, bold and tabular. Status is always a coloured pill with a text label.
3. **Flat.** Cards are bordered, not shadowed. Shadows are for popovers and drawers only.
4. **One accent.** Brand green is the primary; lime is the highlight (active nav, accents, progress). Do not introduce new hues.
5. **Works on a phone.** Every screen is responsive down to 360 px; the sidebar becomes a drawer below `md`.

---

## 2. Tokens

Defined once in `apps/web/app/globals.css` under `@theme`. Use the token class (`bg-brand-800`), never a hex literal.

### 2.1 Colour

| Token | Hex | Tailwind classes | Use |
|---|---|---|---|
| `brand-900` | `#163A30` | `text-brand-900` `bg-brand-900` | Darkest green: primary hover, text on lime |
| `brand-800` | `#1E4D3F` | `bg-brand-800` `text-brand-800` | **Primary**: buttons, hero tile, promo card, logo |
| `brand-700` | `#2A6352` | `text-brand-700` `border-brand-700` | Links, focus ring, input focus border |
| `brand-100` | `#E3EEE9` | `bg-brand-100` | Subtle green fills, progress track |
| `lime-400` | `#B6EB8F` | `bg-lime-400` | **Accent**: active nav item, user avatar, accent button |
| `lime-300` | `#CDF3AF` | `bg-lime-300` | Accent hover, positive trend pill |
| `lime-100` | `#EEFBE3` | `bg-lime-100` | Light accent fills (empty-state icon, tags, drop targets) |
| `canvas` | `#F4F6F4` | `bg-canvas` | App background |
| `surface` | `#FFFFFF` | `bg-surface` | Cards, tables, sidebar, popovers |
| `surface-muted` | `#F7F9F7` | `bg-surface-muted` | Table header, inputs, hover rows, icon tiles |
| `line` | `#E6EAE7` | `border-line` `divide-line` | Every 1 px border and divider |
| `ink` | `#14201B` | `text-ink` | Primary text |
| `ink-muted` | `#6B7570` | `text-ink-muted` | Secondary text, labels |
| `ink-subtle` | `#9AA39E` | `text-ink-subtle` | Placeholders, captions, axis text |
| `success-600` / `-100` | `#2F8F5B` / `#E4F5EA` | | Paid, confirmed, resolved |
| `warning-600` / `-100` | `#C27C0E` / `#FDF1DC` | | Hold, pending, partial |
| `danger-600` / `-100` | `#D64545` / `#FCE8E8` | | Overdue, cancelled, errors, needs a human |
| `info-600` / `-100` | `#2F6FD6` / `#E6EFFC` | | Inquiry, sent, informational |
| `neutral-600` / `-100` | `#5F6763` / `#EEF0EF` | | Draft, void, completed, expired |

Contrast: body text on surface ≥ 7:1, muted text ≥ 4.5:1. Status is never conveyed by colour alone; a pill
always carries a text label.

### 2.2 Typography

- **Font:** Plus Jakarta Sans via `next/font/google` (`--font-jakarta`), fallback `Inter, system-ui, sans-serif`.
  Mono (`--font-mono`) is for IDs, references and demo credentials.
- Numbers use tabular figures: `tabular-nums` (or the `.tabular` utility) in KPIs and tables.

| Style | Classes | Use |
|---|---|---|
| Top-bar title (h1) | `text-xl font-bold md:text-2xl` | Page title, set from the route in the shell |
| KPI value | `text-[28px] font-bold leading-9 tabular-nums` | Stat tiles |
| Card title (h2) | `text-lg font-semibold` | Every card/section heading |
| Body | `text-sm` | Default |
| Secondary | `text-sm text-ink-muted` | Subtitles, descriptions |
| Caption | `text-xs text-ink-muted` / `text-ink-subtle` | Hints, timestamps |
| Label | `mb-1.5 block text-sm font-medium` | Form labels (sentence case, not uppercase) |

### 2.3 Spacing, radius, elevation

- Card padding **20 px** (`p-5`); grid gaps **20 px** (`gap-5`); page padding `p-4 md:p-6`; content max width `max-w-[1440px]`.
- Radius: cards `rounded-2xl` (16 px); buttons, inputs, nav items, icon tiles `rounded-xl` (12 px); pills and avatars `rounded-full`.
- Elevation: none on cards. `shadow-lg` on menus and the mobile drawer. Hover shadow only on clickable cards.
- Icons: `lucide-react`, outline, `strokeWidth={1.75}`; **20 px** (`size-5`) in nav and tiles, 16 px (`size-4`) inline.
- Focus: global `:focus-visible` 2 px `brand-700` outline with 2 px offset. Inputs replace the outline with a brand-700 border.
- Motion: respects `prefers-reduced-motion` (all animation/transition disabled).

---

## 3. Global classes

Defined in `globals.css`. These keep their original names so pages written before the redesign pick up the new look.

| Class | Spec |
|---|---|
| `.card` | `bg-surface`, 1 px `line` border, `rounded-2xl`, flat. Add `p-5` on the element. |
| `.btn` | Inline-flex, `min-h-10`, `rounded-xl`, `px-4`, `text-sm font-semibold`, `gap-2`. Disabled = 50 % opacity, no pointer events. |
| `.btn-primary` | `bg-brand-800` white text, hover `brand-900`. **The default call-to-action.** |
| `.btn-accent` | `bg-lime-400` text `brand-900`, hover `lime-300`. Use sparingly (e.g. "Continue"). |
| `.btn-secondary` | White, `line` border, ink text, hover `surface-muted`. |
| `.btn-danger` | `danger-100` fill, `danger-600` text, `danger-600/30` border. |
| `.input` | `min-h-11`, `rounded-xl`, transparent border, `surface-muted` fill, `px-3`, `text-sm`. Focus = `brand-700` border + white fill. Works for `input`, `select` (extra right padding) and `textarea` (vertical padding). |
| `.pill` | Inline-flex, `rounded-full`, `px-2 py-0.5`, `text-xs font-medium`, 1 px border drawn from `currentColor` at 30 %. Pair with a tone (below). |
| `.table` | Muted header row (`text-xs font-medium text-ink-muted`, `surface-muted`), 12 px cell padding, 20 px outer padding on first/last column, `line` row dividers, hover `surface-muted`. |
| `.tabular` | `font-variant-numeric: tabular-nums` |

**Pill tones** (apply with `.pill`): `bg-success-100 text-success-600`, `bg-warning-100 text-warning-600`,
`bg-danger-100 text-danger-600`, `bg-info-100 text-info-600`, `bg-neutral-100 text-neutral-600`,
`bg-brand-100 text-brand-800`, `bg-lime-100 text-brand-800` (tags).

**Alert banners** follow the same recipe as the pill: `rounded-xl border border-{tone}-600/30 bg-{tone}-100 px-3 py-2 text-sm text-{tone}-600`,
with `role="alert"` for errors.

---

## 4. Components (`apps/web/components/ui.tsx`)

| Component | Notes |
|---|---|
| `LogoMark` | Four-leaf SVG mark (`currentColor`). Default `size-7 text-brand-800`; pass `className` to resize or tint (used as a `text-white/5–10` watermark). |
| `PageHeader({ title, subtitle, action })` | `h2` `text-lg font-semibold`, muted subtitle, actions right-aligned. The big page title lives in the top bar, so do not repeat it as an h1. |
| `StatusPill({ status })` | Maps a status string to a tone (table below). Unknown statuses fall back to neutral. |
| `StatCard({ label, value, hint?, icon?, accent? })` | KPI tile: 40 px `surface-muted` icon tile with `brand-800` icon, value, label. `accent` renders the **hero tile**: `bg-brand-800`, white text, lime icon. Use at most one accent tile per row. |
| `EmptyState({ title, body, href?, cta? })` | Dashed `line` border, `lime-100` 56 px icon tile, title, one sentence, optional primary button. |
| `Section({ title, children })` | `.card p-5` with an `h2` heading. |

### 4.1 Status → tone

| Tone | Statuses |
|---|---|
| success | confirmed, paid, approved, executed, resolved, whatsapp, free |
| warning | hold, partial, pending, open |
| danger | cancelled, no_show, overdue, rejected, human |
| info | inquiry, sent, web |
| neutral | completed, draft, void, expired, staff, internal, blocked |
| brand | booked, wambo |

---

## 5. App shell (`apps/web/components/shell.tsx`)

Client component `AppShell`, rendered by `app/(app)/layout.tsx`. It replaced the old `components/nav.tsx`.

- **Sidebar** — `w-64` (256 px), collapsible to a `72 px` icon rail; `bg-surface`, right `line` border, sticky full height.
  - Logo row (72 px): `LogoMark` + business name in bold caps.
  - Nav item: 44 px tall, `rounded-xl`, icon + label. **Active** = `bg-lime-400 text-brand-900`; idle = `text-ink-muted`,
    hover `surface-muted`. When collapsed, labels are replaced by a `title` tooltip.
  - Bottom: dark `brand-800` promo card (Wambo) with a leaf watermark and a lime button, then the Collapse toggle.
  - Collapsed state persists in `localStorage` key `shell:collapsed` (read through `useSyncExternalStore`; falls back
    to expanded if storage is blocked).
  - Below `md` the sidebar is an overlay drawer (`w-72`, `ink/40` scrim) opened from the top bar.
- **Top bar** — sticky, 72 px, `bg-canvas/90` with backdrop blur, bottom `line` border. Left→right: hamburger (mobile),
  page title (resolved from the pathname against the nav list), then 40 px round icon buttons (`surface-muted`):
  Wambo inbox, Approvals, and the user menu (lime avatar with initials, name and role at `xl`).
- **User menu** — `rounded-2xl` popover with name, role · business and a danger "Sign out" form action. Closes on outside
  click and Escape.
- **Main** — `mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6`. **Footer** — `text-xs text-ink-subtle`.
- **Nav list** (edit `NAV` in `shell.tsx`): Dashboard, Bookings, Calendar, Customers, Invoices & Payments, Expenses,
  Reviews, Wambo, Settings. `/approvals` is reachable from the bell and has its own title.

### Auth pages

Login (`app/login/page.tsx`) uses palda's split screen: white form column (max 24 rem) on the left; on `lg+` a
`brand-800` panel on the right with a giant `LogoMark` watermark, headline and three lime-checked bullets. The public
intake form centres a `card` under the `LogoMark`.

---

## 6. Page patterns

- **List page:** `PageHeader` (title, description, primary action) → filter bar inside the card (`border-b border-line p-3`) →
  `.table` → empty state when there are no rows.
- **Detail page:** header card (name, key facts, status pill, actions) → section cards in a `gap-5` grid.
- **Dashboard:** row of five `StatCard`s (revenue is the `accent` hero tile), then a two-column grid
  (`xl:grid-cols-[1.3fr_1fr]`) of cards: Next 7 days, revenue bars (`bg-brand-800`, rounded tops), needs-a-human card.
- **Links inside cards:** `text-sm font-medium text-brand-700 hover:underline`.
- **Money:** `KES 25,000` via `kes()` in `lib/format.ts`; amounts right-aligned and tabular in tables.
- **Dates/times:** `Africa/Nairobi` via `shortDate`, `shortTime`, `dateTime` in `lib/format.ts`.

---

## 7. The Wambo inbox (intentional exception)

The inbox (`app/(app)/wambo/`) deliberately looks like **WhatsApp Web**, not like the rest of the app, so staff
recognise the channel their customers are using. Its colours are scoped to the inbox and are **not tokens**:

| Element | Value |
|---|---|
| Chat wallpaper | `#EFEAE2` with a faint dot pattern (`.wa-wallpaper`) |
| Header / reply bar | `#F0F2F5` |
| Incoming bubble | `#FFFFFF` (`.wa-in`) |
| Outgoing bubble | `#D9FDD3` (`.wa-out`) |
| Bubble tail | `.wa-tail` on the first bubble of each run |
| Send button / take-over | `#00A884`, hover `#008069` |
| Read ticks | `#53BDEB` |
| Unread/needs-human badge | `#25D366` |
| System notice / handoff banner | `#FFF3C4` on `#54440A` |
| Text / secondary | `#111B21` / `#667781` |

Structure: two panes (`lg:grid-cols-[minmax(320px,400px)_1fr]`) — `chat-list.tsx` (server) on the left,
conversation on the right; below `lg` the list is hidden on a thread and a back arrow appears. `thread-client.tsx`
holds the two client pieces: `ThreadScroller` (opens at the newest message) and `Composer` (Enter sends,
Shift+Enter newline). Day chips (Today / Yesterday / date) separate messages.

> Known gap: outbound messages always show blue double ticks because messages carry no delivery status. Real
> sent/delivered/read ticks need a status field on `messages`.

---

## 8. Migration map (old → new)

When touching an older page, replace legacy values with tokens:

| Old | New |
|---|---|
| `#c2410c` (orange accent) | `brand-800` (`brand-700` for links) |
| `#fff7ed` (accent soft) | `lime-100` |
| `#78716c`, `#57534e` | `ink-muted` |
| `#a8a29e`, `#d6d3d1` | `ink-subtle` |
| `#1c1917` | `ink` |
| `#e7e5e0`, `#f5f5f4` | `line` |
| `#fafaf9`, `#fcfcfb` | `surface-muted` |
| `emerald-*` | `success-100` / `success-600` |
| `amber-*` | `warning-100` / `warning-600` |
| `sky-*` | `info-100` / `info-600` |
| `rose-*` | `danger-100` / `danger-600` |
| `slate-*` | `neutral-100` / `neutral-600` |
| Uppercase tracked labels | Sentence-case `text-sm font-medium` labels |
| 🌿 emoji logo | `LogoMark` |

---

## 9. Do / don't

- **Do** use tokens and the global classes; **don't** write hex literals (except the inbox palette in §7).
- **Do** use `btn-primary` for the one main action per view; **don't** put two primary buttons side by side.
- **Do** keep cards flat with a `line` border; **don't** add drop shadows to cards.
- **Do** pair every status colour with a text label; **don't** rely on colour alone.
- **Do** use sentence case and verb buttons ("Add booking", "Send as staff"); **don't** use ALL CAPS except the sidebar business name.
- **Do** use `LogoMark` for brand marks; **don't** use emoji as logos.

---

## 10. Differences from palda-homes

| palda-homes | Booking app | Why |
|---|---|---|
| ⌘K command search | Not built | Needs search data/`cmdk`; avoided a dead control |
| Org + property switchers | Not built | Booking app has one tenant per login |
| Radix `DropdownMenu`/`Popover`, `cva` Button | Plain React state + CSS button classes | The web app has no Radix menu/cva dependency; same visuals |
| Count badges, Setup card | Wambo promo card; no count badges | No per-nav counts wired yet (e.g. pending approvals) |
| Footer links (Privacy/Terms/Support) | "© 2026 {business}" | No such pages |
| Recharts charts | Hand-built CSS bars | Only one simple chart so far |

---

## 11. Files

| Concern | File |
|---|---|
| Tokens, global classes, WhatsApp inbox styles | `apps/web/app/globals.css` |
| Font + root layout | `apps/web/app/layout.tsx` |
| Shared components | `apps/web/components/ui.tsx` |
| Shell (sidebar, top bar, user menu) | `apps/web/components/shell.tsx`, `apps/web/app/(app)/layout.tsx` |
| Login | `apps/web/app/login/page.tsx` |
| Inbox | `apps/web/app/(app)/wambo/{page.tsx,[id]/page.tsx,chat-list.tsx,thread-client.tsx}` |
| Reference implementation | palda-homes: `docs/UI-SPEC.md`, `apps/web/src/app/globals.css`, `src/components/{ui,shell,dashboard}/**` |

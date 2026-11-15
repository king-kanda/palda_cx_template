# Design System & Style Guide — Palda CX

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

### Engine (`app/engine/`): the Palda team's console

**Same green palda-homes palette as the rest of the app** (section 2.1: brand green, lime accent, `#F4F6F4` canvas). There are no colour overrides for the
Engine. Its **layout** comes from the reference console screenshots: a top bar, a per-customer workspace sidebar with dropdown groups, stat cards, charts, an
activity table and a recent-runs list. The only Engine-specific styling is **monospace numerals and small labels** (JetBrains Mono, via `.engine-theme` in `globals.css`).
It is built with **shadcn/ui and Radix** (section 12).

- **Shell** (palda-homes proportions): fleet pages (`app/engine/(console)/(fleet)/`) have a full-width 72 px top bar; a workspace has a **full-height sidebar with the brand at its top** and a 72 px header over the content column only. Content is `max-w-[1440px]` with `p-4 md:p-6`, sections 20 px apart. Type: page title `text-2xl font-bold`, panel title `text-lg font-semibold`, KPI value 28 px bold tabular, with a 40 px `surface-muted` icon tile.
- **Top bar** (sticky): logo mark, "palda cx" with an `ENGINE` tag (lime), three tabs (Overview, Customers, Data sources; the active tab is `lime-400` with `brand-900` text)
  and the admin avatar, which opens a shadcn `DropdownMenu`.
- **Overview** (`/engine`): four metric cards, then **Needs a decision** (ranked list, one dot per priority: red high, amber medium, grey low), Busiest customers and In setup.
- **Customers** (`/engine/customers`): title, "N total", a primary **New customer** button, search, filter pills with counts (All, Live, Needs attention, In setup,
  Suspended) and a grid of customer cards: avatar, name, internal address in mono, status pill, TYPE / AGENT, RUNS 24H / COST 24H / ATTENTION, and the last-run time.
- **Workspace** (`/engine/<id>/…`): the **shadcn Sidebar**, full height (256 px; 72 px icon rail). Its top row is the brand (logo, `ENGINE` tag); below it the agent's picture, "WORKSPACE", the customer name with a status pill and a one-line summary.
  Items: Overview, Agent, Business, Access, Operations. **Agent, Business and Operations are dropdown groups** (shadcn `Collapsible`): they open inline with a rotating chevron, a
  hairline guide on the left and indented sub-pages (Agent: Profile & voice, Tools, Knowledge, Memory, Integrations, Runs. Business: Details & hours, Team & services. Operations: Rollout, Connections). A group starts open
  when one of its pages is current. The active item is `lime-400` with `brand-900` text; the active sub-page is `lime-100`. Footer: **Open their app**.
  The sidebar **collapses to an icon rail** (grip rail on its edge, or **Ctrl/⌘ + B**) with tooltips, and on phones becomes a **sheet** opened by a menu button.
- **Workspace Overview**: ranked "Needs a decision", four metric cards (Agent, Runs, Run attention, Hit a limit), a Today / Week / Month switch, **three bar charts** (section 11),
  an Agent activity table and Recent runs with outcome pills and Langfuse trace links.
- **Top-right call to action** on workspace pages: "Roll out →" when everything required is done, "Resume setup →" with a count when not, nothing once live.
- **Run outcome pills**: succeeded (success), handed over (info), flagged / looping (danger), blocked / hit a limit (warning).
- **New customer**: a 6-step wizard on a single card, numbered progress dots (done = brand-800 with a check, current = lime-400) and a Back / Continue footer that explains why Continue is disabled.
- **Credentials panel** after rollout or a password reset: a `lime-100` panel with a `lime-400` border, the one-time password in large mono text and copy buttons.
- **Agent avatar** (`AgentAvatar`): the picture as a circle, or initials on `lime-400`. Cropped to a square and shrunk to 256 px in the browser before upload.
- **"Acting as owner" banner**: when staff open a customer's app from the Engine, an amber bar at the top of the app offers **Back to Engine**.

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
| Radix `DropdownMenu`/`Popover`, `cva` Button | Customer app: plain React state + CSS button classes. **Engine: shadcn/ui + Radix** (section 12) | The customer shell predates shadcn; the Engine uses it for its sidebar and menus |
| Custom sidebar (palda-homes `sidebar.tsx`) | Customer app keeps a custom sidebar; Engine uses the **shadcn Sidebar** | shadcn gives dropdown groups, an icon rail and a mobile sheet for free |
| Count badges, Setup card | Wambo promo card; no count badges | No per-nav counts wired yet (e.g. pending approvals) |
| Footer links (Privacy/Terms/Support) | "© 2026 {business}" | No such pages |
| Recharts charts | Hand-built, server-rendered bars (section 11) | Three simple bar charts; no chart library needed yet |
| Plus Jakarta Sans for all numerals | Engine numerals and small labels in JetBrains Mono | Matches the reference console screenshots |

---

## 11. Charts

Every chart in the Engine is a **server-rendered, dependency-free bar chart** (`BarChart` in `apps/web/app/engine/components/ui.tsx`). There is no chart library and no client JavaScript
for charts. Colours come from the palda-homes chart palette (UI-SPEC section 2.1) and live in one constant, `CHART`; never hard-code another hex.

### 11.1 Chart palette

| Series | Token / hex | Used for |
|---|---|---|
| Runs | `brand-800` `#1E4D3F` | Runs per period (palda-homes "collected / income" colour) |
| Needs attention | `danger-600` `#D64545` | The share of each run bar that needs a person (drawn inside the bar) |
| Cost | `#4A7F6E` | Estimated agent spend per period |
| Response time | `#A6CF8B` | Typical (median) response time per period |
| Reserved (palda-homes) | `lime-400` `#B6EB8F`, `#7FB8A4`, `#D9DED9` | Second series, donut segments, neutral fill |

Order for any new multi-series chart: `brand-800`, `lime-400`, `#7FB8A4`, `#D9DED9`, `#4A7F6E`, `#A6CF8B`.

### 11.2 Bar chart spec

- **Card:** a `Panel`: title left, a muted qualifier right (for example "estimated · last 7 days"). The headline number sits above the chart in 30 px mono.
- **Plot:** 130 px tall, 3 px gap between bars, bars `rounded-t-md`, a hairline baseline (`border-line`), bars scale to the largest value in the series.
- **Empty periods stay visible:** a 3 px stub at 35 % opacity, so a quiet hour or day reads as quiet, not missing. Non-zero values are at least 5 px tall.
- **Overlay:** an optional second value drawn inside the bar from the bottom in the attention colour, proportional to its share.
- **Axis:** only the first and last label, in 12 px mono `ink-muted`. Hover (`title`) gives the exact label, value and attention count.
- **Legend:** 10 px rounded squares + 12 px muted text, under the chart, only when there is more than one series.
- **Accessibility:** `role="img"` with a label; the number above the chart and the tooltip carry the data; attention is not colour-only (it is in the legend, the tooltip and the "N to review" qualifier).
- **Empty state:** a dashed-border note under the charts ("No runs recorded last 7 days…"); charts still render their empty stubs.

### 11.3 Chart inventory

| Chart | Where | Data (per bucket) | Headline | Colour |
|---|---|---|---|---|
| **Runs** | Workspace Overview | Agent runs, with the number that need attention overlaid | Total runs; "N to review" | brand-800 + danger-600 |
| **Cost** | Workspace Overview | Estimated agent cost in KES | Total KES for the period | `#4A7F6E` |
| **Response time** | Workspace Overview | Median latency in ms | Typical time and the slowest 5 % (p95) | `#A6CF8B` |

- **Range switch:** pill tabs Today / Week / Month (links, `?range=day|week|month`; default Week). Buckets are in **Africa/Nairobi** time: Today = 24 hourly buckets, Week = 7 daily, Month = 30 daily.
- **Source:** the agent run log (see `claude-handoff.md`). Cached-prompt share is **not** charted because it is not recorded.
- **Other data visuals** that are not bar charts: the four metric cards, the Agent activity table (mono columns: runs, review, cost, typical, P95, prompt, tools), the Recent runs list with outcome pills,
  and the ranked Needs-a-decision list with priority dots.
- **Reference charts from palda-homes** (not built here yet, same palette if added): rent-collection grouped bars (brand-800 vs lime-400, 6 px rounded tops), the complaints donut
  (inner radius 70 %, centre total, legend with percentage chips) and collection-progress bars (8 px, track `brand-100`, fill `brand-800`).

---

## 12. shadcn/ui and Radix

The Engine is built with **shadcn/ui on Radix** (the unified `radix-ui` package). The components are copied into the repo (shadcn's model) and re-skinned onto the palda green tokens, so they look like the
rest of the app.

- **Config:** `apps/web/components.json` (style new-york, Tailwind v4, lucide icons). Components live in `apps/web/components/shadcn/` (not `components/ui`, which is our own `ui.tsx`).
- **Installed:** `sidebar`, `collapsible`, `dropdown-menu`, `tooltip`, `sheet`, `button`, `input`, `separator`, `skeleton`, plus `hooks/use-mobile.ts` and `lib/utils.ts` (`cn`).
  Packages: `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
- **Adding more:** `cd apps/web && npx shadcn@latest add <component>`. Then review the `globals.css` diff and the new imports. (The CLI once pointed `cn` at an unrelated npm package named `cn` because `lib/utils.ts`
  was missing. That is fixed: imports are `@/lib/utils`. Do not re-add that package.)

### 12.1 Token mapping (shadcn → palda-homes)

Defined once in `globals.css` (`@theme inline` and `:root`). Always point at palda tokens, never hex.

| shadcn token | palda token | Notes |
|---|---|---|
| `background` / `foreground` | `canvas` / `ink` | |
| `card`, `popover` (+ `-foreground`) | `surface` / `ink` | Menus and sheets are opaque white |
| `primary` / `primary-foreground` | `brand-800` / white | |
| `secondary`, `muted` | `surface-muted` | |
| `muted-foreground` | `ink-muted` | |
| `accent` / `accent-foreground` | `lime-100` / `brand-900` | Menu item hover / focus |
| `destructive` | `danger-600` | Sign out, delete |
| `border`, `input` | `line` | |
| `ring` | `brand-700` | Focus ring |
| `sidebar` | `surface` | White, with a `line` right border |
| `sidebar-foreground` | `ink` | |
| `sidebar-accent` (+ foreground) | `surface-muted` / `ink` | Hover |
| `sidebar-border` | `line` | |
| `sidebar-ring` | `brand-700` | |

The **active** sidebar item is not `sidebar-accent`: it is set on the menu buttons as `data-[active=true]:bg-lime-400 data-[active=true]:text-brand-900` (palda-homes UI-SPEC 3.1); the active sub-item is `lime-100`.

### 12.2 The workspace sidebar pattern

`apps/web/app/engine/(console)/[id]/layout.tsx` renders `SidebarProvider` + `SidebarInset`; `workspace-nav.tsx` renders `Sidebar collapsible="icon"`.
It runs full height (no offset); the header lives inside `SidebarInset` (`EngineTopbar variant="workspace"` with the `SidebarTrigger`). A base-layer rule gives every border the palette hairline colour (shadcn expects this; without it borders fall back to currentColor and show as dark lines). A dropdown group is `Collapsible` → `SidebarMenuItem` → `CollapsibleTrigger asChild` →
`SidebarMenuButton` (chevron rotates with `group-data-[state=open]/collapsible:rotate-90`) → `CollapsibleContent` → `SidebarMenuSub`. Items are 44 px tall with 12 px radius; sub-items 36 px.
From the icon rail, opening a group first expands the sidebar. On phones, `SidebarTrigger` opens the sidebar as a `Sheet`.

### 12.3 Rules

1. Use shadcn / Radix primitives for menus, dropdowns, tooltips, sheets and sidebars. Do not hand-roll popovers.
2. Style them with palda tokens and the global classes; no hex values (the only literals are the `CHART` constants).
3. Tailwind colour utilities must win on links, so the global anchor reset lives in `@layer base` (an un-layered `a { color: inherit }` silently beat every `text-*` class on a link).
4. Scope: the **Engine** uses the shadcn Sidebar and DropdownMenu. The **customer app** shell is still the custom palda-homes sidebar (section 5); it can be migrated to the shadcn Sidebar later.

---

## 13. Files

| Concern | File |
|---|---|
| Tokens, global classes, WhatsApp inbox styles | `apps/web/app/globals.css` |
| Font + root layout | `apps/web/app/layout.tsx` |
| Shared components | `apps/web/components/ui.tsx` |
| Shell (sidebar, top bar, user menu) | `apps/web/components/shell.tsx`, `apps/web/app/(app)/layout.tsx` |
| Login | `apps/web/app/login/page.tsx` |
| Inbox | `apps/web/app/(app)/wambo/{page.tsx,[id]/page.tsx,chat-list.tsx,thread-client.tsx}` |
| Engine pages, workspace sidebar, charts | `apps/web/app/engine/**` (`components/ui.tsx` has `BarChart`, `CHART`, `MetricCard`, `Panel`, `PillTabs`, `OutcomePill`, `AttentionList`) |
| shadcn components, config, helpers | `apps/web/components/shadcn/*`, `apps/web/components.json`, `apps/web/lib/utils.ts`, `apps/web/hooks/use-mobile.ts` |
| Reference implementation | palda-homes: `docs/UI-SPEC.md`, `apps/web/src/app/globals.css`, `src/components/{ui,shell,dashboard}/**` |

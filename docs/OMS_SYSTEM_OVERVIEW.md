# Creme Castle OMS — System Overview

*Written 20 Jul 2026. Purpose: a complete, self-contained description of the OMS —
how it is built, what the modules are, and how it works — so that a reader with no
prior context (a new engineer, an advisor, or a new AI chat) can reason about
whether a proposed new tool should be an extension of this system or a separate
system. Everything below is live in production unless marked otherwise.*

---

## 1. What this system is

Creme Castle is a custom-cake D2C brand in Delhi NCR. It sells through its own
website (Shopify storefront, cremecastle.in), through WhatsApp conversations with
a central customer-service team, and through B2B/corporate accounts. Cakes are
made and dispatched from **six outlets** (kitchen + dispatch points): Noida (ND),
Gurgaon (GGN), DL Janakpuri (DL), Greater Noida (GN), Faridabad (FBD), and DL
Shahpurjat (SPJ).

The OMS is the single operational system for this business. One order is entered
**once** — automatically from Shopify, or punched manually for WhatsApp/B2B —
and then flows through role-specific screens: the central team maps it to an
outlet, the outlet accepts it, prints the kitchen ticket, packs it, assigns a
rider, marks it delivered, and raises a GST tax invoice against it. Finance sees
bills, settlements and reconciliation views over the same rows.

**It replaced four things:** a Retool app (order entry/tracking), WhatsApp
message coordination between central and outlets, a Google Sheets ledger, and
re-punching orders into Petpooja POS. Petpooja remains only for Zomato/Swiggy
marketplace orders, which deliberately do NOT enter this OMS.

The system also holds the **complete order history migrated from Retool back to
June 2023** (~200,000 orders, ₹21+ crore of sales), so it is the company's
customer and revenue history database, not just a live-operations tool.

---

## 2. Architecture and stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + backend | **Next.js (App Router) + TypeScript** | One repo; screens are React server/client components, mutations are server actions, machine endpoints are route handlers |
| UI | Tailwind + shadcn/ui | Big touch targets; must work on cheap Android phones and outlet desktops with zero training |
| Database | **Supabase Postgres** | Schema applied manually from `schema.sql` (source of truth in repo). Small compute tier (2 GB) |
| Auth | Supabase Auth, email + password | ~25 individual logins; roles live in a `profiles` table |
| Files | Supabase Storage | Reference images (cake photos), payment screenshots |
| Hosting | Vercel (region pinned to Mumbai, colocated with Supabase) | Auto-deploys on push to `main` |
| Scheduled jobs | Vercel Cron → `/api/cron/*` | Shopify sweep every 15 min; catalog refresh nightly |
| AI | Anthropic API (Haiku model) | Three narrow extraction tasks (see §8). **Never load-bearing** — every AI call fails soft to null and a human verifies |

**Security model:** all data access is server-side using the Supabase service-role
key; the browser never talks to the database directly. Every mutation re-checks
the caller's role (`requireRole`) and outlet scope (an outlet login can only
touch its own outlet's rows). A `boardCaps(role)` helper decides what the UI
*draws*; the server actions independently decide what is *permitted*.

**Timezone:** all business logic is IST. Timestamps are stored as `timestamptz`
and rendered in IST everywhere.

---

## 3. The golden business rules

These are the invariants the whole system is built around. Any new tool touching
this data must respect them.

1. **One order, entered once.** Website orders arrive automatically; WhatsApp/B2B
   orders are punched once by central. Nobody re-enters an order anywhere.
2. **Customer identity = normalized mobile.** Any phone input is normalized to
   the last valid 10-digit window starting 6–9 (leading 91 stripped).
3. **No hard deletes, ever.** Orders are *cancelled* (reason required); bills are
   *voided* (reason + approver PIN required). Rows never disappear.
4. **Every mutation writes an `order_events` row** (event name, actor, data
   diff). The order's drawer shows this history to the team.
5. **Edits never reset status.** An edit raises a needs-attention flag on the
   outlet board (with a diff the outlet must explicitly accept); it never
   silently rewinds an order.
6. **Status is a side-effect of real actions.** Accept enables KOT; KOT print is
   logged; rider assignment sets out-for-delivery; delivered is one tap.
   Statuses: `new → accepted → ready → out_for_delivery → delivered` (+
   `cancelled`).
7. **Delivery slots are free-form promises** (exact window stored); boards group
   by rounds (10–1, 1–4, 4–7, 7–10) for sorting only.
8. **All cakes eggless by default** (an egg-option field exists for legacy
   classic cakes).
9. **Multi-item is normal.** `order_items` is the truth; items are never
   collapsed. Items may carry their own delivery date/window (one order, two
   cakes, two days — one payment).
10. **Money:** full advance is the norm; COD is a fallback. `total_amount` is
    the money actually charged; ₹0 totals are legal only for B2B. Since 20 Jul,
    the reconciliation identity *items − order discount = order total* is
    guaranteed in exports and pre-filled on bills.
11. **Outlet assignment is human.** The system suggests an outlet (pincode/area
    history); a person confirms. Complex cakes tend to route to Noida.
12. **Idempotent ingestion.** Webhooks upsert on `shopify_order_id`; processing
    the same event twice is harmless.
13. **Shopify variant options are read by NAME** (`Flavor (Eggless)`, `Weight`,
    …) — never by position.
14. **Secrets live in env vars only.**

---

## 4. Data model (Postgres)

The ~20 tables, grouped by concern:

**Reference data**
- `outlets` — the six kitchens (code, name, GSTIN/FSSAI identity for bills).
- `riders` — per-outlet delivery staff (own riders; Uber/other captured on the
  delivery row).
- `payment_modes` — table-driven settle modes (cash, UPI, card, website prepaid…).
- `corporate_accounts` — 39 active B2B clients (contact, billing address, GST).
- `business_settings` — legal name, HSN, GST rate, per-outlet FSSAI, and the
  billing **go-live flag** (bills before it are watermarked SPECIMEN).
- `cake_themes` / `cake_tags` — the product-analytics glossary (§7.8).

**Identity & access**
- `profiles` — one row per login: role (`admin | central | outlet | finance`),
  outlet pin, display name, per-user grants (e.g. `can_map`), reprint/void PINs.
- `user_column_prefs` — each user's board column layout.

**Customers**
- `customers` (identity = normalized mobile) and `customer_addresses` — history
  across ~3 years powers punch-time autofill and outlet suggestions.

**Orders (the core)**
- `orders` — one row per order: source (`shopify | whatsapp | b2b`), customer
  snapshot, address (line/area/city/pincode), delivery date + exact slot window,
  money (`total_amount`, `advance_amount`, `is_prepaid`), status, outlet,
  cancel fields, edit flags, `shopify_order_id` (idempotency key).
- `order_items` — one row per cake/add-on: title, SKU, variant options
  (flavour, weight, egg option), qty, unit price, `line_total`, cake message,
  reference image URL, optional per-item delivery date/slot, notes.
- `order_events` — append-only audit trail of everything (rule 4).
- `order_payments` — punch-time advances (mode, reference, screenshot).
- `deliveries` — one row per delivery *window* of an order (an order with items
  on two days has two): status, packed/kitchen/dispatch timestamps, rider or
  external provider, trip link. **Boards render deliveries, not orders.**
- `trips` — rider route bundles (R3): several deliveries leave as one trip with
  ordered stops and a printable trip slip.

**Billing**
- `bill_sequences` — gap-free invoice numbering per outlet per financial year.
- `bills` — immutable snapshot: number (`ND/26-27/000041`), line items, subtotal,
  discount, CGST/SGST (5% inclusive), total, HSN, specimen flag, void fields
  (reason, approver). A voided bill stays forever; a new bill gets a new number.
- `bill_settlements` — how a bill was paid: mode, amount, reference, who, when.
  Multiple part-settlements allowed; the ledger tracks settled/partial/unsettled.
- `statement_lines` — B2B on-account statement entries.

**Infrastructure**
- `webhook_events` — raw Shopify webhook log (replayable).
- `sync_state` — sweep cursors.
- `products_cache` — nightly-refreshed Shopify catalog for punch-form search.

---

## 5. How an order flows (end to end)

**A. Website order.** Customer orders on cremecastle.in (Shopify + Shopflo
checkout). Shopify fires a webhook → `/api/webhooks/shopify` (HMAC-verified) →
`mapShopifyOrder` parses line items (variant options by name, reference images,
cake message, per-item dates), normalizes the mobile, computes money from
Shopify's charged totals → upsert into `orders`/`order_items` (idempotent). A
15-minute cron sweep catches anything a webhook missed. The order lands in the
**Central Console's Unmapped queue** → a human maps it to an outlet (system
suggests from pincode/area history) → it appears in that outlet's **Accept
inbox** and the outlet's phone **rings** until acknowledged → outlet accepts →
prints **KOT** → bakes → **packs** (one tap) → assigns a **rider** (or bundles
several orders into a **trip**) → **delivered** (one tap) → raises the **bill**
(website orders settle as "Website Prepaid") — money identity pre-filled,
discount included. Finance sees the bill and its settlement in the ledger.

**B. WhatsApp order.** Customer chats with central → central opens **Punch V2**,
pastes the WhatsApp text — the form parses it; AI extracts area/city/pincode
from the address (with deterministic guards: a pincode prefix beats a guessed
city; bare sector numbers never decide a city); payment screenshots are read for
amount/reference/status by AI, human-verified → central picks the suggested
outlet → same lifecycle as above. Punched advances are recorded in
`order_payments`.

**C. B2B order.** Punched against a `corporate_account` — no collection at the
door, bill goes on-account, monthly statement per client.

**Cancellations** (any source) require a reason; a central cancellation throws a
**blocking pop-up** on the outlet board that the outlet must acknowledge (the
kitchen may already be baking). **Edits** write a diff; the outlet board shows an
amber "edited" flag until the outlet reviews and accepts the changes; a printed
KOT auto-reprints on accept. **Reassignment** to another outlet resets the order
to `new` so it rings at the receiving outlet like a fresh order; slot/date moves
leave a grey "→ Moved to …" tombstone on the old day's sheet, never a fake
cancellation.

---

## 6. The screens (who sees what)

| Screen | Route | Who | Job |
|---|---|---|---|
| Central Console | `/central` | central, admin (+outlet users with a `can_map` grant) | Map website orders to outlets; punch WhatsApp/B2B orders; find any order any date ("find mode"); cancel; reassign |
| Outlet Day Board | `/day-board` | outlet (pinned to own outlet), admin/central/finance (read-only + switcher) | The digitized "Cake Book": accept inbox with ring, one sheet per day grouped by rounds, per-row actions (KOT, pack, kitchen-handoff, rider/trip, delivered, bill), comments, highlights, city cell, filters, CSV export |
| Kitchen view | `/kitchen` | outlet/central/admin | Reference image front-and-center for bakers, per outlet |
| Order edit | `/orders/[id]/edit` | admin/central/outlet (outlet: money locked) | Full edit with change-tracking; every change becomes a reviewable diff |
| Finance | `/finance/*` | finance, admin | Ledger (bills + settlements), reconciliation view, B2B statements + print, pilferage |
| Admin | `/admin/*` | admin | Users/roles/PINs, Business & tax settings (go-live flip), Shopify sync monitor, Cake Tags glossary, Orders Export, D2C export |
| Dashboard / login / change-password | `/` | all | Entry points |

Printable artifacts (server-rendered HTML for 80 mm thermal printers): **KOT**
(kitchen spec + delivery details + reference photos + modifications in large
type), **Bill** (GST tax invoice with legal identity, GSTIN, FSSAI, specimen
band when not live), **Trip slip** (rider's stop list, collect-once per order),
**Day-board CSV**, **B2B statement**.

---

## 7. Module detail

### 7.1 Shopify ingestion
`/api/webhooks/shopify` (create/update events, HMAC-checked, logged raw in
`webhook_events`) plus `/api/cron/shopify-sweep` every 15 min as backstop; both
converge in one idempotent upsert path (`ingestShopifyOrder`). Parsing handles:
variant options by name, quantity-style options ("Pcs"), reference image
attachments, cake messages, per-item delivery dates (multi-day orders), partial
payments, and (known nuance) order-level discount codes — Shopify keeps line
prices pre-discount, so the OMS treats `orders.total_amount` (money actually
charged) as the truth and derives the discount where needed. Auth to Shopify is
OAuth client-credentials, token minted on demand (no static admin token).

### 7.2 Central Console — mapping
Unmapped queue with outlet **suggestions** computed from delivered-order history
by pincode, then area (only suggested when history is unanimous); orders an
outlet "sends back" return here flagged with the outlet's reason. Mapping is
always a human tap. "Find mode": a non-empty search scans the whole mapped set
(any date, any status) by order number, name, or mobile.

### 7.3 Central Console — Punch V2
One-screen form optimized for speed: WhatsApp-paste parsing, customer lookup by
mobile (3-year history: name, addresses, last order), catalog search with
flavour/weight chips backed by `products_cache`, AI address extraction, AI
payment-screenshot reading, B2B client picker with autofill, per-cake "own
date/window" toggle, outlet suggestion with reasons. Saves in ~1 s (parallelized
writes); a punch code (`W-0718-ND-30`) identifies manual orders.

### 7.4 Outlet Day Board
The heart of the outlet's day. Accept tab (with an audible **ring** for new
orders until tapped), then the sheet: rows grouped by delivery rounds, columns
configurable per user (window, order #, city, area, cake, qty, add-ons,
modifications, amount, bill no, kitchen, pack, rider, comment, status,
highlight). Everything is one tap and optimistic. Trips: select rows → "Bring
together" → a colored block with numbered stops that travels as one unit.
The board **self-heals** after deploys (stale server-action IDs trigger one
automatic reload instead of frozen buttons). Blocking pop-ups force
acknowledgement of central cancellations; moved windows render as grey
tombstones pointing to the new slot/date.

### 7.5 Billing
Raised from the board after KOT (never before accept). Bill numbers are
assigned atomically and gap-free per outlet per FY. Prices are GST-inclusive
(5%, CGST+SGST split); the draft arrives pre-filled from order items **with the
website discount pre-computed** so the invoice always equals money actually
taken. Settlement against table-driven modes, part-payments supported. Voiding
requires a reason and a supervisor PIN and leaves the void on record; a re-bill
gets a fresh number. Before the business flipped `is_live` (17 Jul 2026), all
bills printed as SPECIMEN; the flip is one-way and admin-only.

### 7.6 Finance module
Read-only views over the same rows: ledger of bills with settlement state,
reconciliation screen, B2B accounts with printable statements, pilferage view.
Finance can export the Orders CSV and any outlet's day board but can mutate
nothing (test-enforced). The **next milestone** (`specs/FINANCE_BACKEND.md`)
builds the full reconciliation backend: stored discount column, settlements CSV,
unbilled list, GST monthly summary, gateway payout matching, day cash sheet, B2B
statement exports — governed by eight money identities (I1–I8) that all
surfaces must keep true.

### 7.7 Exports
- **Orders Export** (admin+finance): one row per cake, date-ranged; order-grain
  columns (Order total, Items total, Order discount, Bill no) repeat per row and
  reconcile by construction.
- **Day-board export**: the sheet exactly as the outlet sees it.
- **D2C analysis export**: every order line joined to the cake-tags glossary
  (theme → age group / super category / gender / occasion) for revenue analysis.
- **Cake Tags download/upload**: Excel round-trip for the glossary with a
  preview-before-apply safety.

### 7.8 Cake Tags (product analytics glossary)
10,000+ cake names/SKUs mapped to 139 **themes**; four analysis tags derive from
the theme (age group, super category, gender, occasions) with per-cake
overrides and a sparse per-cake "theme detail". AI suggests a theme for anything
new; a human approves. The "New cakes" tab both accepts manually-typed new cakes
and self-fills from orders whose names the glossary doesn't recognize; new
themes can be minted inline with their four defaults. This glossary powers the
D2C revenue analysis (which theme/age-group/occasion sells).

### 7.9 AI workers (deliberately narrow)
Three extraction tasks: address → area/city/pincode (with deterministic
post-guards; the model can never invent a city from a sector number), payment
screenshot → amount/reference/success-state, cake name → suggested theme
(constrained to the existing theme list). All: small fast model, short timeout,
nulls on failure, human confirmation. AI never blocks a save and never decides
anything final.

### 7.10 History import
All Retool history to June 2023 lives in the same `orders`/`order_items` tables
(era-flagged). This gives punch-time customer memory, outlet suggestions,
lifetime value, and a 57,000-strong lapsed-customer list for retention work.

---

## 8. Operational jobs and monitoring

- Cron: Shopify sweep every 15 min (webhook backstop), catalog refresh nightly.
- `/health` endpoint for uptime checks.
- Admin → Sync screen shows ingestion state.
- Test suite (~130 tests) locks the permission wiring: every server action's
  role gate is asserted, so a refactor cannot silently open a screen to the
  wrong role.

---

## 9. What is deliberately OUTSIDE this OMS

These are separate systems today, by design:

1. **The website itself** — Shopify + Shopflo checkout (separate repo:
   `shopify-website`). The OMS only consumes its orders.
2. **Zomato/Swiggy marketplace orders** — stay in Petpooja POS entirely; they
   never enter the OMS.
3. **CC Dispatch Console** — a second repo/app for dispatch planning
   (Pawan's manual-addition workflow, delivery planning waves). Talks about the
   same physical world but currently a separate codebase and data store.
4. **Retention automation** — a third repo: LimeChat WhatsApp campaign flows
   fed by OMS order history.
5. **Accounting/books** — no double-entry ledger, no Tally/Zoho integration.
   The OMS produces reconcilable exports; the books live elsewhere.
6. **Inventory/commissary production planning** — nothing in the OMS knows
   about ingredients, stock, or production capacity.

---

## 10. Extension or separate tool? (decision guide)

When evaluating a new tool idea against this OMS:

**Strong signals it should be an OMS extension:**
- It reads or writes the *same truth* the OMS owns: orders, order items,
  deliveries, bills, settlements, customers, outlets. (Duplicating any of these
  elsewhere creates a second source of truth — the exact disease the OMS was
  built to cure.)
- Its users are the same four roles with the same logins, and it fits an
  existing screen's rhythm (a new tab, a new column, a new export).
- It must respect the golden rules anyway (no deletes, event trail, IST,
  mobile-normalized identity) — inheriting them is free inside the OMS.
- Examples that were correctly built as extensions: billing, finance views,
  cake-tags analytics, trip bundling, history import.

**Strong signals it should be separate:**
- Different primary data domain (ingredients, staffing, marketing content,
  website behavior) that only *references* OMS data via exports or a read API.
- Different user population (e.g. factory workers, marketing agency) that
  shouldn't have OMS logins.
- Different change cadence or risk profile — experimental tools shouldn't
  deploy into the codebase that prints legal tax invoices.
- Needs to survive OMS downtime or vice versa.
- Examples correctly kept separate: dispatch console, retention automation,
  website QC.

**The middle path that works well:** separate app, but it *reads* OMS data
(service-role queries or exported CSVs) and never writes to OMS tables. If it
must write, the write should go through an OMS server action so events, roles
and rules apply.

---

## 11. Current status (20 Jul 2026)

- Milestones 0 → 4.5 live: ingestion, central console, punch, day board,
  kitchen, billing (**live since 17 Jul**, real GST invoices), finance views,
  exports, cake tags, history import.
- Team fully operating on it daily across all six outlets; multiple feedback
  rounds shipped within days.
- **Next milestone: finance backend** (`specs/FINANCE_BACKEND.md`) — the
  reconciliation layer described in §7.6.
- Known open items: a 16-item team-feedback backlog (punch redesign, discounts
  UI, complimentary orders, cross-round drag…), PIN rotation at ND, handbook
  updates for recent releases.

## 12. Glossary (team language)

- **Punch** — manually enter an order (from WhatsApp/B2B).
- **Mapping** — assigning an incoming website order to an outlet.
- **KOT** — kitchen order ticket; the printed spec the baker works from.
- **Day Book / Cake Book** — the outlet's daily sheet; now the Day Board.
- **Rounds** — the four delivery windows the day is grouped into.
- **Trip** — several deliveries bundled to one rider as ordered stops.
- **Specimen** — a bill printed before billing went legally live.
- **Send back** — outlet returns a mapped order to central with a reason.
- **Tombstone** — the grey "→ Moved to …" row left where a slot used to be.
- **Theme** — the cake's analytics category in the Cake Tags glossary.

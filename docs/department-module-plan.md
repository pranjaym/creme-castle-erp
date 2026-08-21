# Department production module (Build 3a expansion): decisions and open questions

**Home:** `erp-plan/department-module-plan.md`
**Status:** LIVE IN TRIAL 20 August 2026 at https://cremecastle-kitchen.vercel.app (Pranjay: run the trial on the real thing, then a clean slate before real operations). Built 19 August 2026 (green-lit by Pranjay the same day: "start building"). Code in `~/creme-castle-erp/kitchen`. The four open questions were all deferred by Pranjay ("build the Sponge and Liquid module and get that right, then we solve for this"); they block only the Breads/Cakes/Desserts screens, not this build.
**Date:** 19 August 2026 (chef conversation 18 August, design and build session 19 August).

## What this is

The intermediates logbook (Build 3a) grows into a per-department production module covering the whole factory. Pranjay spoke to the chef on 18 August 2026 and defined the department structure. This document records the decisions made in the 19 August session, the facts learned from the paper registers, and what is still open.

## The departments (locked)

Five production departments across two factory floors:

**Second floor (mixing room, oven room, bread room):**
- **Sponges**: all sponges (Pillsbury base or scratch), made daily. Production starts 9:00 pm; closing count 8:30 pm.
- **Liquids**: all ganaches, creams, glazes, compotes. Production starts 7:00 am; closing count 6:30 am.
- **Breads**: croissants, tiramisu croissant, bombolonis, berliners (fried), hamper items (cookies, lavash, grissini), plus cheesecakes, tea cakes, brownies (they need the oven, hence second floor).

**First floor (large AC room):**
- **Cakes** and **Desserts**: receive sponges and ganaches, assemble finished cakes and desserts, send to dark stores. Work runs in evening and night shifts (per the paper layering records).

Department count is NOT hardcoded. Departments are rows in the location master (`kitchen_department` type already exists; Sponge and Ganache Dept, Cake Dept, Dessert Dept already seeded). The 18 August structure splits the old "Sponge and Ganache Dept" into Sponges and Liquids and adds Breads: a seed/data change, no schema change.

## The flow (locked)

Network, not chain:
- Sponges and Liquids feed the Cakes and Desserts departments AND the three spokes directly.
- Cakes and Desserts feed the dark stores (via dispatch).
- Breads feeds dark stores; also uses Liquids output (e.g. Cocoa Rocher Glaze for bombolonis). Breads sheet has KOT and Blinkit columns whose exact meaning is an open question below.
- Raw materials reach departments from the warehouse via SupplyNote (out of scope for the first build; a scheduled read-only fetch later, per the 22 July SupplyNote boundary).

## Architecture decisions (locked, 19 August 2026)

1. **One database, one ledger, per-department screens.** NOT one database per department. Each department gets its own screen/login/view; underneath it is the one spine ledger. Reason: a transfer is one event with two sides; matching "sent 200" against "received 195" is only possible in one shared ledger. Pranjay confirmed after discussion (his words: interlinked, like inventory management software).
2. **Handover between departments is real** (counted, physical), not a common freezer pool. Confirmed by Pranjay.
3. **Receiver confirms every transfer.** Sender logs the send; a pending receipt appears on the receiver's screen; receiver taps confirm (or corrects the number). Mismatch is recorded with both sides and flagged: date, route, both names. No hunting.
4. **Per-department day end, set in config.** No company-wide day end. Each department closes just before its own production day starts (sponges close 8:30 pm, liquids 6:30 am, per the paper sheets). Closing time per department lives in the admin backend and is changeable. Honest wall-clock `entered_at` is always stored alongside. This extends the 12 August finding that the kitchen does not use the 04:00 sales business day.
5. **Closing is a physical count, a fourth entry type,** separate from the three movement verbs (made / issued / wasted). Consumption is never entered; it is derived: `consumed = opening + made + received - sent - wasted - closing`, and the residual IS the report (miscount or unrecorded consumption).
6. **Cutting/portioning is its own production step with standard yields.** Trays are cut into miniatures/pastries (pastry sheet: 10 pastries per block, 30 for rectangle tiramisu; brownie: 54 pieces per tray). The step consumes the tray item and produces the piece item; shortfall vs standard yield = cutting waste. Standard yields per item are editable in the admin backend. 5-inch, 6-inch, trays, custom trays are all separate items counted in pieces (Pranjay, answer 3).
7. **Cakes have two stages:** layered and finished are separate countable items (per the Cakes Layering Record). The Cake dept ledger tracks layered stock as its own stage.
8. **Item master admin backend.** Pranjay (and later team members) can add items, toggle live/not-live, change par, reorder, without a developer. Items remain `skus` rows (active flag, par, sort order already exist). User roles deferred.
9. **Spokes are exactly three:** Noida 67 (SK-ND-Sector 67), Janakpuri (SK-DL-Janakpuri), Gurgaon (SK-GGN-Sikanderpur). All three already seeded; no change.

## Facts from the paper registers (19 August 2026)

Pranjay supplied the current paper system: `production-and-mezza-paper-registers.xlsx` (copied into erp-plan; original "Production and Mezza.xlsx"). Five sheets = the current per-department daily registers:

- **Mise En Place Production** (Liquids): ~34 items, par in kg, columns: par / 3 days old / 2 days old / 1 day old / in-hand 7 am / production plan 7 am / actual production. Ages are counted at closing.
- **Sponge Production**: ~14 items, same structure at 9 pm. Two par versions on the sheet (par is being revised).
- **Cakes Layering Record**: evening and night shift sections; par / in-hand / layering / total; separate finished-cakes section.
- **Pastry Layering Record**: par / in-hand / layering / total plus yield notes (10 per block, 30 rectangle tiramisu per block).
- **Cheesecake and Teacake** (Breads): cheesecakes, tea cakes, brownies; columns: par / in-hand / production / in-house transfer / KOT / Blinkit / transfer / wastage. Note: 54 brownie pieces per tray.

The item sheet `sponge-ganache-item-template.xlsx` (46 rows, chef v2) remains the intermediates list; each row must now be tagged with its making department (Sponges vs Liquids), since the old single "Sponge and Ganache" department is split.

## What was built (19 August 2026, session with Claude)

All in `~/creme-castle-erp/kitchen` (the git clone; NOT deployed). Tested end to end in the browser (desktop and phone) against the live spine the same day.

**Schema (migration `080_department_module.sql`, applied to the live spine, additive only):**
- New location `CK-LIQUID` (Liquids Dept); `CK-SPONGE` display-renamed to Sponge Dept (code unchanged, old name kept in notes).
- `department_settings`: per-department `day_start_time` and `closing_before` (sponges 21:00/20:30, liquids 07:00/06:30). No company-wide day end.
- `skus.made_by_location_id`: 14 Sponge items tagged to Sponges, 32 Ganache + Sub-component items to Liquids.
- `transfer_receipts`: the receiver's side of an issued movement; append-only, latest confirmation wins, received_qty 0 allowed.
- `closing_counts`: the physical count, age-bucketed (0/1/2/3+ days, or unsplit total); corrections supersede via corrects_id.
- Views: `v_pending_receipts` (the receiving inbox), `v_transfer_mismatches` (sent vs received differences, both names attached), `v_closing_effective`/`v_closing_totals`, and `v_dept_day_ledger` (opening + made + received - sent - wasted - closing = gap; gap stays null until both opening and closing counts exist, no invented numbers).
- `schema_migrations` bootstrapped (000..074 marked applied); `scripts/migrate.mjs` is now the migration path.

**App (Next.js, same design system):**
- `/dept/CK-SPONGE` and `/dept/CK-LIQUID`: the department hub. Five actions (Made, Sent, Waste, Closing, Receive; Hindi sub-labels), a pending-transfers banner, "Today at a glance" ledger, recent entries with honest timestamps and who entered.
- Day picker highlights the department's own open day ("your shift's day"): a sponge chef at 1 am is defaulted onto the evening's production day. Server re-validates the today/yesterday window.
- Receive: pending receipt cards, one tap "Received N" or "Different number"; a mismatch is recorded with both sides and lands in `v_transfer_mismatches`.
- Closing: per-item count, optional split by age (like the paper 3/2/1 columns) with a live sum; defaults to the day being closed by the department's own clock.
- `/admin`: department day times, add item (code auto-generated INT-SPG/GAN/SUB-next), live/off toggle (never delete), typical/day, par (effective-dated insert, history kept), sort order, move item between departments. No auth yet: MUST add before any deploy.
- Identity: a "Your name" field on every screen, stored on the device, appended to entered_by (e.g. `sponge-dept/Ramesh`). The full who-enters model is still the open decision it always was.
- `lib/dept-day.mjs` pure day-rule functions; 8 new tests, suite 27/27 green.

**Test rows on the live spine (19 Aug, labelled `test-claude`):** production_log ids 36-37 plus one more issued row, two transfer_receipts (one clean 3=3, one deliberate mismatch 4 sent/2 received), two closing_counts rows for CK-SPONGE 2026-08-18. Append-only, so they stay; they are clearly labelled and sit before any team go-live. The old combined `/log` screen still works and is marked superseded on the home page.

## Round 2, same evening (19 August 2026): requests, any-date view, design system

Pranjay's feedback on the first build: (a) a request section must exist in both directions, like inventory software (someone can raise the equivalent of a PO, and someone can also push without being asked); (b) the at-a-glance table must show any chosen date; (c) the frontend was okay but the admin backend was far below the OMS and Dispatch Console standard. All three built and tested the same evening.

**Requests (migration `090_dept_requests.sql`, applied):**
- `dept_requests`: an indent-style workflow document (requester dept, maker dept, item, qty, optional needed-by). Never deleted; the only stored transition is cancellation with a mandatory reason (withdrawn by requester or declined by maker, recorded as such).
- `production_log.request_id`: an issued movement may link back to the request it fulfils. The direct push (no request) stays first-class.
- `v_request_status`: state is DERIVED, never typed: open, partial, fulfilled (linked sends >= asked), cancelled.
- Screens: a sixth action "Request / मांग" on every department screen (pick the maker, type quantities against THEIR item list, optional needed-by Today/Tomorrow); the maker sees a green banner plus "Requests for you" cards with one-tap **Send now** (opens the Sent sheet prefilled and linked) or **Can't send** (reason required); the requester tracks "Your requests" with state chips and can withdraw with a reason. Tested end to end: request 20 raised by Liquids, fulfilled by Sponges via Send now, state derived to fulfilled, the 20 then waits in Liquids' Receive inbox (the two-sided confirm still applies).

**Any-date glance:** the department home's ledger table has a date dropdown (last 15 days; older dates via ?glance=YYYY-MM-DD in the URL).

**Design system ported:** the approved Creme Castle Design System (M2 bundle, as carried by cremecastle-oms) now lives in the kitchen app: Magalie display + Owners body fonts (files copied to kitchen/public/fonts), the console working palette, the brand wordmark. The admin backend was rebuilt as a console in the OMS finance-shell pattern: maroon 210px sidebar (horizontal tab strip on phones), header band per page, stat cards, grouped nav: Masters (Items, Departments) and Movement (Requests: all requests with derived states and a state filter; Transfers: the received-vs-sent difference register and everything still unconfirmed). Old /admin single page retired; still NO AUTH, required before any deploy.

## Round 3, same night (19 August 2026): the two-audience principle, locked

Pranjay's correction, now a standing design rule for the whole ERP:
1. **Frontend (team screens) is for grey-collar workers: simple, easy to read, easy to use.** The brand display font made it a dark wall; reverted to the plain system-font look. Brand fonts stay OUT of the team screens.
2. **Backend (admin) is for management and must match the OMS and Dispatch Console standard of nuance,** not just their skin. The missing thinking, found in the OMS's own design notes ("every card is a link into the board; the board stays the workplace, this is the compass"; "all green = the morning is over; the team never hunts"), was: a landing page that answers the day's question, numbers that are doors into their explanation, filters and CSV on every table, and a readable audit trail.

Backend rebuilt accordingly (sidebar: Daily / Watch / Masters):
- **Today** (landing): per department, for ITS own production day: made today, closing done or missing for the previous day, gap count, unconfirmed incoming transfers, open requests on it, waste today. Green/amber tiles; every tile links to the filtered view that explains it.
- **Day ledger** (new): any department, any date range, the full derived ledger grouped by day, gap count chip, CSV download (`/admin/ledger/csv`).
- **Transfers**: location + date-range filters, CSV.
- **Requests**: state + maker filters, CSV.
- **Activity** (new): spine_events, previously written but unreadable, now a filterable plain-English audit trail (entries, receipts, closings, requests, master edits, with actor and honest timestamps).
- **Items** and **Departments** under Masters (items moved from /admin to /admin/items; /admin is the compass now).

## Round 4, same night (19 August 2026): login and roles

Pranjay's directive: login screen, per-user department access, roles. Built and verified:

**Identity (migration `100_kitchen_roles.sql`, applied):** reuses the ERP portal's foundation, the SAME Supabase Auth project and public.profiles table, so ONE email + password works on both apps. New columns `kitchen_role` and `kitchen_department_location_id`; NULL kitchen_role = no kitchen access (fail closed, new accounts see nothing until provisioned).

**Roles (Pranjay's list):**
- `department`: signs in straight onto its own department screen; cannot open or write for any other.
- `exec_chef`: every department screen plus the admin Daily and Watch pages (the daily dashboard).
- `tech`: everything including master edits (items, departments).
- `super_admin`: everything tech has plus user management (/admin/users: create account, set role and department, deactivate (never delete), reset a forgotten password; all audited).

**Implementation:** the portal's proven pattern mirrored into the kitchen app: @supabase/ssr middleware (session refresh + coarse gate to /login), cookie auth client, requireKitchenUser/requireRoles/mayUseDept guards on every page AND every server action (the hidden sidebar is a courtesy; the server checks are the door). Sign out on every screen. The floor keeps the "Your name" box: the account says which department, the name says which person.

**Accounts provisioned:** pranjay@cremecastle.in = super_admin (existing portal password works). Two tablet accounts created with temp passwords (given to Pranjay in chat, to be changed): sponge.dept@ and liquid.dept@cremecastle.in, pinned to their departments. Sign-in verified end to end by script; unauthenticated requests verified to redirect to /login.

**Still open before deploy:** none blocking on auth itself now; the earlier "add auth before any deploy" flag is CLEARED. Go-live stance unchanged (Pranjay decides).

## Round 5 (20 August 2026, small hours): the production plan, BUILT

Pranjay's decisions: (1) the department chef's number is final and may vary from par minus closing (no exec approval step); (2) v1 plans from par stock only; (3) on the closing-vs-separate-screen question he asked how the industry does it.

**Research finding (Fourth/MacromatiX, Apicbase, Cybake, and SupplyNote's own prep planning):** the plan is always its OWN document/screen, generated from the latest count and demand, edited by the planner, with actuals recorded against it. Small-kitchen prep sheets (and our own paper register) put the count and the plan in one motion. Both are honored: **the plan is its own screen and saved document, and the closing flow hands off straight into it** with one button ("Plan the next production →") the moment a closing is saved. It can also be opened any time from its own card; it fetches par and the latest closing itself. This is both of Pranjay's options at once.

**Built (migration `110_production_plans.sql`, applied):**
- `production_plans`: append-only; latest row per (dept, day, item) is effective. Every suggestion input is SNAPSHOTTED on the row (par, par type, on-hand, open requests) plus the suggested and the chef's planned quantity, so every number stays reproducible forever.
- Suggestion (pure arithmetic, rule 4): fixed par: `max(0, par - on hand + open requests)`; on_demand: open requests only; ready_made: not planned. On-hand = the closing total of the planned day minus one; if that count is missing the screen says so in amber and assumes zero.
- Screen: seventh action card "Plan / प्लान"; Today/Tomorrow chips; each line shows its arithmetic spelled out ("par 1200 - in hand 0 + asked 20 = 1220") with the editable number prefilled; blank = skip; re-saving replaces (old rows stay). Saved plans audit to spine_events.
- Plan vs actual: `v_dept_day_ledger` gained a `planned` column, so the department glance table, the admin Day ledger, and its CSV all show plan vs made with zero extra screens.
- Verified end to end in the browser as the sponge department account: suggestion 1200, chef override to 1150, both stored, ledger shows plan 1150 vs made 0.

**SupplyNote idea parked for Build 3b:** their prep module auto-deducts ingredient stock when a batch is logged (recipe-linked). Ours will do the same once recipes exist; not in scope while v1 has no recipe layer.

## Open questions (deferred by Pranjay 19 Aug 2026, "build Sponge and Liquid first"; they block the NEXT departments, not this build)

1. **Cakes and Desserts closing time(s):** when is the physical count, once a day or per shift (evening/night)?
2. **Breads closing time.**
3. **Age-bucket counting from day one?** Built as OPTIONAL: the closing screen takes a single total by default, split-by-age one tap away. Whether the split becomes mandatory for sponges/ganaches stays open until the team has used it.
4. **KOT and Blinkit columns on the Breads sheet:** exact meaning (KOT = consumed against in-house orders? Blinkit = direct transfer to Blinkit dark stores bypassing dispatch?). Decides the destination list on the Breads screen.
5. **Item lists per department** beyond sponges/ganaches: Breads list, and mapping of Cakes/Desserts finished items to existing Petpooja/console item masters rather than re-collecting.

## Relationship to existing plans

- Extends `build-plans-1a-3a.md` (Build 3a). The append-only three-verb `production_log` (migration 030) is the foundation; this adds: receiver confirmation on transfers, a closing-count entry type, per-department day config, cutting yields, and the admin backend.
- Go-live stance unchanged: nothing goes live, not even a pilot, until Pranjay is convinced it is usable.
- Schema changes go through numbered ALTER migrations only (no re-baseline, ever).


## Round 6 (20 August 2026): LIVE IN TRIAL

Pranjay: "I don't have time to go to them and sit with them. Maybe we can create a live version and do the trial, and then whenever the trial is successful, we will do the clean slate, and then they can start properly." This supersedes the earlier stance of no deployment before he was convinced.

**Deployed** to https://cremecastle-kitchen.vercel.app (Vercel, project cremecastle-kitchen). The two public auth settings were added to the production environment; the two service settings were already there since July.

**The clean slate is a switch, not a delete (migration 120).** `spine_modes` holds the kitchen's mode; `data_mode` is stamped on every row of production_log, closing_counts, transfer_receipts, dept_requests and production_plans at insert; every consumer view filters to the current mode. Verified: 50 ledger rows and 12,857 units of buffer read as 0 the instant the mode flips to live, return on revert, and all 39 underlying rows are untouched throughout. Trial rows are therefore kept forever (rule 6) and counted never. The go-live control is in Masters, Departments: super admin only, needs a written reason, audited twice.

**An amber TRIAL band** sits on every team screen and across the admin console, so practice is never mistaken for real. It disappears by itself at go-live.

**Hole found and closed the same night.** Three July routes were behind login but behind no role check, so a department tablet could open them. `/log`, the superseded combined logbook, was the dangerous one: a second write path into production_log that bypassed departments, requests and receipts. It is deleted. `/buffer` and `/recon` are now management only. `/recon` is unlinked from the home page because this deployment has no OMS credentials. Verified live while signed in as the sponge tablet: /log is 404, everything else bounces back to its own screen.

**Accounts live (20 August 2026):**
| Person | Email | Role | Sees |
|---|---|---|---|
| Pranjay | pranjay@cremecastle.in | super_admin | everything, including Users and the go-live switch |
| Pawan G | pawan.g@cremecastle.in | tech | everything except Users |
| Rishabh K | rishabh.k@cremecastle.in | tech | everything except Users |
| Azeem | azeem@cremecastle.in | exec_chef | everything except Masters (items, departments, users) |
| Md Asif | md.asif@cremecastle.in | exec_chef | same |
| Sandeep | sandeep@cremecastle.in | exec_chef | same |
| Sponge tablet | sponge.dept@cremecastle.in | department | only the Sponge Dept screen |
| Liquids tablet | liquid.dept@cremecastle.in | department | only the Liquids Dept screen |

Pranjay's mapping, verified live: "admins who help me execute, see everything except users" = `tech`; "senior chefs running the Sponge and Liquid teams, see everything except masters" = `exec_chef`. All passwords are random and were handed over in chat; there is no self-service password change yet, so a reset is done by the super admin on the Users screen.

**Next:** hand the tablet logins to the two teams, let them run real days in trial mode, then use the go-live switch when Pranjay is satisfied. The D2C reconciliation page needs OMS credentials added to this deployment if it is ever wanted here.

## Round 7 (21 August 2026): the trial team's first feedback, and a naming decision

**Four defects reported by the Sponge and Liquid teams after day one, all fixed:**
1. **The cursor left the box after one digit**, so every two-digit quantity took two taps. My bug: the screen's helpers (entry sheet, header, save bar) were declared inside the component, so each keystroke created a new component type and React remounted the input, discarding focus. They are plain render functions now. The same bug was also eating the "your name" box. Verified by typing 1, 15, 150 with focus intact.
2. **"It saves but does not move to the next window."** Every successful save now returns to the department hub with a green confirmation bar naming what was saved.
3. **The stray "Plan the next production" button** after a closing count moved out from under the save bar and into that confirmation, as the next step rather than an orphan control.
4. **Reopening Plan looked like stale prefill.** It now states that a plan is already saved for that day, that these are those numbers, and offers one tap to reset to the suggestion.

**Not changed: a reason stays mandatory on Waste.** Waste without a cause is a number nobody can act on: expired, failed batch and spillage lead to three different fixes. Offered to make it one-tap buttons instead of a dropdown if the friction persists.

**Naming decision (Pranjay, 21 August 2026, after seeing the counter-evidence and reaffirming):**
- `Sent` becomes **Transfer sales**
- `Request` becomes **Purchase request**

The concern was stated and overruled, and is recorded here so it is not relitigated: SupplyNote already calls an internal inter-location request an **indent** (`#IND-`) and reserves **purchase/PO** for vendor buying, which the planned ordering module will do for real; and this spine holds the company's actual **sales** (Zomato, Swiggy, D2C, 1.65M rows), so the word now carries two meanings and mixed reports will need a footnote. Pranjay's reason: his team reads these words more easily, and the words on the team's buttons are his to choose.

**UI labels only.** The database is untouched: `production_log.action` stays `issued`, the tables stay `dept_requests` and `transfer_receipts`, the views keep their names. The schema is canonical and outlives button wording, so reversing this later costs nothing and rewrites no history.

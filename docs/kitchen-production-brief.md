# Kitchen Production Module: Brief v0.2
**Status:** Draft for Pranjay's review. Nothing here is frozen. Strike, reorder, correct.
**Home:** `erp-plan/kitchen-production-brief.md`. Companion: `cc-flow-map-v2.mermaid`.
**Date:** 21 July 2026. **Sources:** Pranjay's rambles (this project), OMS System Overview, Dispatch Console System Overview, Doc4ERP handwritten notes (transcription pending), business context doc (Doc4ERP Fundraising).

---

## 1. One-line definition

The central kitchen is the only place in the company where purchased material becomes sellable product, and it is the only node with no ledger. This module writes the missing middle ledger that joins SupplyNote (what we buy) to Petpooja (what we sell), and replaces incentives-shaped recording with reality-shaped recording, stage by stage.

## 2. The network (locked roster)

| Location | Dark store | Custom cake assembly | Direct D2C fulfillment (regular cakes, desserts) | Notes |
|---|---|---|---|---|
| Noida | via nearby DS (plan) | Yes | via co-location (plan) | Spoke currently sits inside the central kitchen and draws items directly from CK. To be moved out and merged with a nearby dark store. Direct CK draws are to stop. |
| Gurgaon | Yes | Yes | Yes, via co-located spoke | Spoke and DS on same premises; spoke pulls regular items from the DS as needed. |
| Janakpuri | Yes | Yes | Yes, via co-located spoke | Same co-location pattern as Gurgaon. |
| Shahpurjat | Yes | Open (see 10.1) | Yes, delivery boy deployed | Bill punched in Petpooja. |
| Faridabad | Yes | Open (see 10.1) | Yes, delivery boy deployed | Bill punched in Petpooja. |
| Greater Noida | Yes | Open (see 10.1) | Yes, delivery boy deployed | Bill punched in Petpooja. |
| Meerut | Yes | No (assumed) | Yes, delivery boy deployed | Not among the OMS's six original outlets; confirm OMS mapping. |
| Other dark stores (~33) | Yes | No | No | Zomato/Swiggy only. |
| Lucknow (4) | Closed | No | No | Excluded from dispatch model. Restart planned; adding stores does not change the flow design. |

Working interpretation to confirm: custom cake assembly happens only at Noida, Gurgaon, Janakpuri. SPJ, FBD, GN, Meerut fulfill regular website orders only.

## 3. Current state, told honestly

This section is the ground truth the module must fix. It is written plainly because sanitized versions of it would design the wrong system.

1. **Production is recorded on a single sheet of paper.** The only digital trace of production is the vendor jugaad: a fake vendor named "Production" inside Petpooja from whom the central kitchen "purchases" the day's finished goods. This builds CK finished-goods stock, which then flows CK to Central Dispatch to dark stores as Petpooja transfers.
2. **Intermediates run permanently negative.** Sponges and ganaches are never produced on paper in any system. They are only ever transferred out (to spokes via SupplyNote orders), so their book stock is negative everywhere and their real frozen-buffer level lives in people's heads, guided by paper par stocks set by the Executive Chef (CK) and the controls team (spokes), revised without trail or stated logic.
3. **Raw material consumption is not linked to recipes.** Warehouse-to-kitchen issues are recorded in SupplyNote, but nothing consumes that stock against production. Book RM stock at the kitchen is therefore fiction, trued up at month end when the controls team and kitchen team enter actual closing inventory, after which the system adjusts. The true-up absorbs the variance silently and is known to be misused. Games hide in this gap because it is only examined monthly and the adjustment itself is not investigated.
4. **Wastage capture follows variance checks, not reality.** Finished-product wastage is punched at dark stores because variance is checked there. The kitchen is asked to punch wastage and does so partially; nothing verifies it. Kitchen-stage wastage (failed batches, trim loss, expired frozen intermediates) mostly vanishes into the month-end true-up.
5. **The DS-to-spoke transfer route is a known leak.** Regular cakes and desserts move DS to spoke as a Petpooja transfer punched by the DS team (they punch it because unexplained shortage triggers questions from the controls team). The spoke keeps no inventory of these items and there is no receiving-side check, so a transfer can cover consumption that never reached a customer. The process to close this has not been made.
6. **Central Dispatch exists and is the right instinct.** A location called Central Dispatch was added in both Petpooja and SupplyNote. Everything from the kitchen passes through it before reaching stores, creating a send/receive accountability point. The module should build on this node, not around it.
7. **Recipes exist but outside any system,** in a rough format. They are the prerequisite for every cost number this module promises.

**Design consequence:** wherever recording exists today, it exists because a variance check created an incentive. The module's method is therefore to extend cheap, immediate recording plus visible variance to the stages that have neither, starting inside the kitchen.

## 4. Systems of record (who owns what, unchanged by this module)

| Domain | Owner | Module's relationship |
|---|---|---|
| Money, P&L, statutory | Tally | Feed it (via existing MIS bridges). Never replace. |
| Purchases, central warehouse RM stock | SupplyNote | Read issues and purchases. Do not replace in phase 1. |
| Z/S menu FG stock at stores, POS, store wastage, transfers | Petpooja | Read via report ingestion. Mirror, then gradually supersede for CK-side records. No API exists (confirmed). |
| Z/S production plan | Dispatch Console (ours) | Read plan as production target. Model never modified. Target state (per Pranjay): the console is not a floating node; its daily input feed is generated from ingested POS data (Petpooja plus OMS sales, closing stock) instead of manual upload. See build-order.md, Build 2. |
| D2C orders, spoke workflow, billing | OMS (ours, pilot; live in ~2 weeks) | Read tickets; coordinate on split-ledger (section 8). |
| Riders | TrackoField | Out of scope; OMS handles later. |
| Attendance | SalaryBox | Phase 2 input for labor productivity. |
| Kitchen conversion: production runs, intermediate stock, recipe-standard consumption, stage-wise wastage | **Nobody today. This module.** | The new ledger. |

## 5. What Pranjay sees every morning (phase 1 promise)

Five numbers, all computable from data we can capture early, valued at standard recipe cost until actuals are trustworthy:

1. **Production vs plan:** units per SKU against the Dispatch Console target, and fill rate percent.
2. **Dispatch COGS:** rupee value of goods sent CK to Central Dispatch to stores, at standard recipe cost. This is "the cost of goods actually sent."
3. **Kitchen variance:** rupees of RM issued vs recipe-standard consumption for what was actually produced. The number where month-end games currently hide, moved from monthly to daily.
4. **Wastage in rupees by stage:** kitchen, dispatch, store; today only the store stage exists.
5. **Frozen buffer vs par:** sponges and ganaches finally get a real inventory, with par adherence.

Efficiency, as requested, gets a recommendation: report plan adherence (1) and yield efficiency (inside 3) in phase 1; labor productivity (units per man-hour from SalaryBox) in phase 2, which also feeds the automation payback narrative.

## 6. Scope: phase 1

1. **Masters:** SKU master with type (raw material, intermediate, finished good) and lifecycle state (drop, graduated, retired); location master including Central Dispatch; units of measure.
2. **Recipe/BOM, two-stage:** RM to intermediate (sponge, ganache batches with expected yields), and RM plus intermediates to finished goods. Standard cost computed per SKU from recipe plus current purchase rates.
3. **Production logging at the moment of work:** batch-level entries for intermediates (what was made, yield, into the freezer) and finished goods (against plan). Entry must be doable by kitchen staff on a phone or cheap tablet in under a minute per batch: big buttons, minimal typing, Hindi labels where useful. If entry is slower than the paper sheet, the paper sheet wins and the module dies.
4. **Frozen buffer ledger:** intermediates in, intermediates out (to FG production, to spoke shipments), expiry-based aging.
5. **Dispatch capture:** what left CK for Central Dispatch and what Central Dispatch sent onward, reconciled against Petpooja transfer reports.
6. **Kitchen and dispatch wastage capture,** reason-coded, with the same low-friction entry.
7. **Petpooja and SupplyNote ingestion:** automated report ingestion into our database (see section 7).
8. **The morning view:** the five numbers, per day, on Pranjay's phone.

**Explicit non-goals for phase 1:** actual (as opposed to standard) unit cost; spoke-side consumption tracking for custom cakes; labor productivity; replacing Petpooja or SupplyNote anywhere; solving the split-ledger problem in full (but see section 8, which cannot wait); purchase price management; Lucknow.

## 7. Getting data out of closed systems

Petpooja has no usable API (confirmed by Pranjay). Two ingestion patterns, in order of preference:

1. **Scheduled report emails:** Petpooja (and SupplyNote if supported) auto-emails reports to a dedicated mailbox; a parser loads them into our database on arrival. Stable, no UI dependency.
2. **Browser agent:** logs in on schedule, exports reports, loads them. Works, but breaks whenever the vendor changes screens. Fallback only.

Claude Code verification tasks: enumerate which Petpooja reports can be auto-emailed or exported, at what granularity and frequency (needed at minimum: sales by outlet by item by day, transfers, wastage entries, purchase entries from the vendor "Production"); same for SupplyNote (issues, POs, GRNs, stock).

## 8. The split-ledger problem (two-week fuse)

Today, all retail bills (spoke custom cakes and the four D2C fulfillment dark stores' website orders) are punched in Petpooja, so Petpooja stock depletes correctly and the Dispatch Console's sales feed sees real demand. When OMS billing goes live (~2 weeks), any bill that moves to OMS makes Petpooja stock silently overstate and blinds the dispatch model to that demand.

Decision needed before OMS billing switches on, options:
1. **Feed fix:** the Dispatch Console's daily feed adds OMS sales per outlet per item alongside Petpooja sales. Cheapest, protects the model immediately, leaves Petpooja stock drifting until phase 2.
2. **Mirror fix:** OMS bills are also written into Petpooja (manually or via report-driven adjustment) until our own ledger supersedes Petpooja at these nodes.
3. **Sequence fix:** OMS goes live for order workflow but billing stays in Petpooja until option 1 is built.

Recommendation: option 1, with option 3 as the stopgap if option 1 is not ready on go-live day. Owner: this module plus OMS jointly. This is the first concrete integration between the two existing systems and the new module.

## 9. Design covenants

1. Reality-shaped recording: capture at the moment of work, by the person doing the work, cheaper than paper.
2. Visible variance at every stage; no silent true-ups. Month-end physical counts remain, but the adjustment becomes a reviewed, reason-coded event, not an overwrite.
3. Standard cost first, actual cost only when the underlying logging has earned trust.
4. Every number reproducible; AI never load-bearing (same covenant as the Dispatch Console).
5. Our DB is designed as the future inventory source of truth; Petpooja is mirrored during transition and shrinks toward the Z/S order channel. (Pranjay's ERP position noted: a Microsoft/SAP class system may eventually take over; everything here doubles as the requirements document and clean data for that migration, so nothing is wasted either way.)
6. Ties to Bridge 1 (Outlet P&L to Finance MIS): every rupee figure this module produces must be reconcilable to the MIS, or it is a liability.
7. Verified figures only; estimates labeled.
8. No em dashes or en dashes in any output.

## 10. Open questions

1. **Roster cell:** do SPJ and FBD (and GN) assemble custom cakes at all, or regular fulfillment only? (Section 2 table.)
2. **Meerut in OMS:** Meerut was not among the OMS's six outlets; confirm how OMS maps Meerut website orders.
3. **Month-end true-up review:** who signs off the adjustment today, and is the adjustment size reported to anyone? (Needed to design the reviewed-adjustment flow in covenant 2.)
4. **Recipes:** Pranjay to share the existing recipe documents in current form; recipe normalization becomes workstream zero.
5. **Kitchen staffing for entry:** who exactly would make production entries (names/roles/shifts), and what devices exist in the kitchen today?
6. **SupplyNote capabilities:** export/report options (Claude Code task, section 7).
7. **Petpooja report inventory:** which reports, what granularity (Claude Code task, section 7).
8. **Noida spoke relocation timing:** affects when direct CK draws stop; module should not hard-code the current co-location.

## 11. Handoff to Claude Code (when Pranjay freezes this brief)

First prompt, verbatim:

"Read erp-plan/kitchen-production-brief.md and erp-plan/cc-flow-map-v2.mermaid. Verify every integration assumption in sections 4, 7, and 8 against the actual schemas and code of the OMS and Dispatch Console repos. Correct what is wrong and write the corrected assumptions into erp-plan/integration-notes.md. Enumerate Petpooja and SupplyNote export/report capabilities as specified in section 7 and append findings. Do not propose a build plan until integration-notes.md exists and Pranjay has seen it."

## 12. Sequencing after freeze

Note: sequencing now lives in `erp-plan/build-order.md` (v0.1), which supersedes the list below. This section is kept as the phase summary.

1. **Workstream zero (parallel, starts now):** recipe collection and normalization into the two-stage BOM; masters drafted.
2. **Phase 0 decision:** split-ledger option chosen before OMS billing go-live.
3. **Phase 1 build:** sections 5 and 6.
4. **Phase 2 candidates (not committed):** actual costing, spoke consumption for custom cakes, labor productivity, receiving-side checks on DS-to-spoke transfers, reviewed month-end adjustments replacing silent true-ups.

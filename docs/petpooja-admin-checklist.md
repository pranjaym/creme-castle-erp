# Petpooja + SupplyNote Admin Session Checklist
**Time needed:** about 45 minutes in the back office of both systems. **Who:** whoever holds admin access. **Output:** answers written against each item and sent back. No changes to live settings except where marked SETUP.
**Why:** the answers here decide the D2C punch mechanism (Step 0), the data ingestion mechanism (Build 1), and the console feed source (Build 2). Everything currently pending funnels through this one sitting.

## Part A: D2C punch mechanism (Petpooja)

1. **NC / complimentary order check.** Create a test NC (non-chargeable / complimentary) order at any dark store location for any item. Answer three things: (a) did the item's stock quantity reduce? (b) does the NC order appear in the item-wise sales or order export, marked identifiably as NC? (c) is there a remarks or reference field on the NC order, and does it appear in the export?
2. **Transfer check.** On the stock transfer screen: (a) is there a remarks or reference field, and does it appear in the transfer report export? (b) does the receiving location have to accept the transfer before stock moves, or does it move on send?
3. **Virtual location check.** Can we create a new location (not a real store) to act as a transfer destination? Any license or cost implication per location?

**Decision rule:** if 1(a), 1(b), and 1(c) are all yes, we use NC bills. Otherwise we use transfers to a single new virtual location named "D2C Dispatch."

**SETUP (only after decision):** if the sink route is chosen, create "D2C Dispatch" and, if missing, a destination for Meerut.

## Part B: report automation (Petpooja)

4. Can Petpooja schedule automatic report emails or exports? If yes: which reports, what frequency, what format (Excel/CSV/PDF), to any email address?
5. Reports we need daily at minimum, item-wise and outlet-wise: sales by outlet by item by day; closing stock; transfers (all locations); wastage entries; purchase entries (including the vendor "Production"). For each: available via scheduled email, manual export only, or not available at that granularity?
6. If no scheduling exists: note the exact manual export path (menu clicks) for each report above, for the browser-agent fallback.

## Part C: report automation (SupplyNote)

7. Same as Part B for SupplyNote: scheduled email/export capability, and availability of: purchases/GRNs; warehouse-to-kitchen issues; spoke orders/indents (sponges, ganache, packaging, design items); warehouse stock.

## Part D: today's console feed

8. Who compiles the Dispatch Console's daily input feed today, and from exactly which reports (names of the reports, from which system)? Attach one day's example files if possible.

## Part E: send back

Reply with answers against numbers 1 to 8. The NC-versus-sink decision, the go-live staff rule, and the first build all start the moment these answers land.

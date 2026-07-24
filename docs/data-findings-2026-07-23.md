# Data Findings: SupplyNote and Petpooja exports, 23 July 2026
**Home:** `erp-plan/data-findings-2026-07-23.md`. Read with `build-order.md` v0.4 and `integration-notes.md`.
**Source files:** SupplyNote products (1,011), locations (53), suppliers (211), GRN purchase reports (central warehouse May 2026, and all locations Apr to May 2026), invoice-wise sales. Petpooja material purchase, daily stock summary, and two transfer reports, all for 22 July 2026.

---

## 1. Findings that change the current build

### 1.1 The three departments exist, under confusing legacy names (CONFIRMED by Pranjay 23 July)

| SupplyNote location | Is actually | Receipts Apr to May | What it draws |
|---|---|---|---|
| ND-CK-Bread Dept | **Sponge and ganache department** | 3,248 | premix and baking (960), kitchen general (506), dairy (420), chocolates (372), fillings (314) |
| ND-CK-Desserts Dept | **Dessert department** | 1,561 | packaging (422), premix (179), grocery (143), dairy (140) |
| Central Kitchen Noida | **Cake department** | 1,882 | fillings (374), kitchen general (324), maintenance (249), dairy (205), chocos cookies and fruits (176) |

The material patterns corroborate the mapping: premix, chocolate and dairy into sponge; fillings, chocos, cookies and fruits into cake assembly; packaging into desserts.

**Residual problem:** because the cake department is named generically as "Central Kitchen Noida", it also absorbs maintenance and housekeeping (249 maintenance lines, plus garbage bags, scrub pads, floor dusters, spray bottles). Consumption computed for the cake department will be contaminated unless those categories are excluded or the location is renamed and a separate housekeeping location created. Recommended: rename to ND-CK-Cake Dept and route non-production consumables elsewhere.

### 1.2 The gap is precisely located: production and internal handoffs are recorded nowhere

Queried across April and May 2026:

- **Department-to-department transfers: zero lines.** The sponge department's handoff to cake and dessert is recorded in no system at all.
- **Sponge department output that IS recorded:** ND-CK-Bread Dept to SK-ND-Sector 67, 605 lines (232 sponges, 323 semi-finish).
- **An anomaly that explains the negative stock:** Central Kitchen Noida (the cake department) ships 797 sponge lines and 752 semi-finish lines out to SK-DL-Janakpuri (949) and SK-GGN-Sikanderpur (914). The cake department does not make sponges or ganaches. So it is issuing out goods that never entered it on paper. That is the mechanical cause of permanently negative intermediate stock: material leaves locations it was never issued into.

**Consequence for Build 3a, restated precisely.** Three distinct movements, three different current states:
1. Production (made): recorded nowhere. 3a creates the record.
2. Sponge department to cake department, and to dessert department: recorded nowhere, zero lines. 3a creates the record.
3. Sponge department to spokes: recorded in SupplyNote as GRNs, but attributed to the cake department on two of the three spoke routes. 3a's send-side log corrects the attribution and gives a two-sided check against the receive-side GRN.

**Open process question:** spoke shipments are currently routed inconsistently, Sector 67 from the sponge department and Janakpuri plus Sikanderpur from the cake department. Decide one convention, ideally shipping intermediates from the department that makes them.

### 1.3 Petpooja production entries carry no department
The in-house production entry (vendor "In House Production Noida Bakery", 56 finished SKUs on 22 July) has these fields: supplier, invoice date, raw material, quantity, unit, purchase price, net amount, category. **No department.** Category values are product families (Cakes, Pastry, Cheese Cakes, Brownies, Crossiant, Jar, Tea Cake), so department must be derived by mapping category or item to department. That mapping must be explicit and stored, not inferred in code.

### 1.4 Petpooja exports are HTML tables named .xls
All four Petpooja files are HTML documents with a .xls extension, not real Excel workbooks. They parse cleanly with pandas.read_html, with a fixed preamble (report name, restaurant name, address, date range) and the header on row 5. Ingestion must be built for this, not for openpyxl.

---

## 2. Standard costs already exist (workstream zero does not start from zero)

Both systems already carry a price per unit that functions as a crude standard cost:

- **Petpooja finished goods:** every production line has a unit price (Almond Croissant 79, Banoffee Pie 63, Basque Cheesecake Slice 52, Black Forest Cake 500g 200). Transfers carry the same price, so the value of goods moving CK to Central Dispatch to store is already computed today.
- **SupplyNote intermediates:** 47 items across sponges, semi-finish and semi-pastries carry a rupee rate (COD-16 Truffle Ganache 433.24/kg, Malai Cream 363/kg, Chocolate Sponge Tray 937.67, Caramalized Hazelnuts 2,362/kg).

These are a starting baseline for the BOM exercise and a cross-check on any cost we compute. Their provenance and last-updated date are unknown and should be treated as unverified.

**Nine intermediates have no cost at all:** Chocolate Pistachio Disc, Cream (For Malai Kulfi), Tiramisu Mousse, Belgian Chocolate Mousse, Hazelnut Paste, Pistachio Paste, Coffee Syrup Tiramisu Cake, Water, Dark Pouring Ganache.

---

## 3. Item master condition (1,011 products)

**Status flag is not maintained:** 996 active, 15 inactive. Given known discontinuations, the active flag cannot be trusted. Use transaction recency instead.

**Sponges are split across two categories:** 11 items in "sponges" and 6 more sponge items sitting in "semi-finish" (Chocolate Sponge 6 Inch, Vanilla Sponge 6 Inch, and the three 8-inch pastry sponges). Same type of item, two categories.

**Category and sub-category hygiene:** "fruits and vegitables", "fruits & vegitables" and "vegetables" are three categories for one thing. Typos in "houskeeping", "chcoos cookies and fruits", and (in Petpooja) "Crossiant". Sub-categories carry trailing spaces ("designers ", "finished ") and 37 items have the literal string "null".

**One SKU code is the product name:** the row for cake mix improver (purix cake gel) has the product title in the SKU field.

**Unit of measurement is the real recipe blocker:** 694 of 1,011 items are "piece". Many are weight or volume packs sold as pieces, for example BISCOFF SPREAD (8 KG), Del Pine Slice 3Kg, Lotus Biscoff Spread (400 Gm), Filling Dark Cherry 2.7 Kg. A recipe needs grams. Every such item needs a pack-size conversion (piece to kg or litre) before consumption can be computed. This is the single largest data preparation task standing between here and real COGS, and it is unavoidable in any system, ours or SupplyNote's.

**Chef's 46-item list versus SupplyNote's 47 intermediates:** neither is a superset. Present in SupplyNote but not on the chef's list: Macaron Filling, Macaroon Shells, Red Velvet Sponge (500 Gm), Red Velvet Sponge (1 Kg), Milk Chocolate Hazelnut Ganache, Rocher Glaze, Strawberry Jam, Chocolate Pistachio Disc, Cream (For Malai Kulfi), Tiramisu Mousse, Belgian Chocolate Mousse, Hazelnut Paste, Pistachio Paste, Coffee Syrup Tiramisu Cake, Water. Present on the chef's list but absent from SupplyNote semi-finish: Butter Cream, Almond Flakes, Butterscotch Whip, Butterscotch Chunk Glaze, Mango Compote, White Chocolate Ganache, Vanilla Custard Cream, Salted Caramel (Overcooked), Milk Chocolate Almond Ganache. Name conflicts to resolve: SupplyNote "VHP- 46.5% Whipped Cream Ganache" versus chef "whipped Chocolate Ganache"; SupplyNote "Milk Chocolate Hazelnut Ganache" versus chef "Milk Chocolate Almond Ganache"; SupplyNote "Dark Pouring Ganache" versus chef "Pouring Ganache".

---

## 4. Location master condition (53 locations)

- **Active flag is unusable:** all 53 are marked active, including the four Lucknow stores that are closed.
- **Outlet Code is not unique** and cannot be a key: CC-LKO appears four times, CC-CHD twice, ND-CK twice, CC-DL on several rows. Three locations have no code at all (Central Kitchen Noida, CC-ND-Alpha 2, SK-GGN-Sikanderpur).
- **Store Noida is the central warehouse.** All external vendor purchases deliver here (3,632 lines in May), and it is the pickup point for 19,008 internal issue lines.
- **Spelling:** "Central Dispatach-Noida" is misspelled in SupplyNote. Petpooja names the same node "Central Dispatch Noida". They must be aliased to one canonical location.
- **CC-UP-Meerut** has city recorded as New Delhi.
- Three spoke kitchens appear in SupplyNote: SK-ND-Sector 67, SK-DL-Janakpuri, SK-GGN-Sikanderpur.

---

## 5. Central Dispatch is working as described

Petpooja, 22 July 2026: Central Kitchen issued 84 transfer lines, almost all to Central Dispatch Noida, with a few direct to SK-ND-Sector 67. Central Dispatch then issued 1,559 lines out to individual stores. The two-stage accountability Pranjay described is real and traceable in the data, and both legs carry values.

---

## 6. Actions arising

1. **Decide the department split** (section 1.1). Blocks the consumption engine, not Build 3a.
2. **Seed locations with both the legacy name and the true role:** ND-CK-Bread Dept (sponge and ganache), ND-CK-Desserts Dept (dessert), Central Kitchen Noida (cake), Central Dispatch, and the three spokes. Carry the SupplyNote name as an alias and the role as the display name, so nobody has to remember that Bread means sponge.
3. **Rename or split the cake department location** so maintenance and housekeeping stop landing in production consumption.
4. **Decide one spoke shipping convention** (section 1.2) so intermediates ship from the department that makes them.
5. **Reconcile 3a's spoke sends** against SupplyNote GRNs as a two-sided check rather than treating them as new data.
4. **Store the category-to-department mapping** for Petpooja production explicitly.
5. **Build Petpooja ingestion for HTML tables**, not Excel.
6. **Start the pack-size conversion table** for the 694 piece-unit items. This is workstream zero's first real task and the largest single blocker to costing.
7. **Reconcile the chef's 46 against SupplyNote's 47** and produce one canonical intermediate list with agreed names.
8. **Treat existing prices as an unverified baseline**, and fill the nine intermediates that have no cost.

---

## 7. Proposed SOP: intermediate movement out of the kitchen (for Pranjay's approval)

**Rule 1. Intermediates ship from the department that makes them.** Sponges and ganaches leave from the sponge department (ND-CK-Bread Dept). The cake department stops appearing in this flow entirely. This ends the negative-stock mechanism, because nothing is issued from a location that never received it.

**Rule 2. Spoke indents are raised on the sponge department, not on "Central Kitchen Noida".** The spoke teams currently order sponges and ganaches through SupplyNote against a par stock. That indent must be addressed to the making department. This is a SupplyNote configuration change, not a code change.

**Rule 3. Route through Central Dispatch only if Central Dispatch physically handles the goods.** The accountability logic that created Central Dispatch (separating stock responsibility from production efficiency) applies equally to intermediates. But booking a movement through a node that never touches the goods is fiction, which is what we are removing. So the physical route decides the booking:
- If the dispatch team consolidates and sends spoke shipments, and has frozen storage capacity: sponge department to Central Dispatch to spoke. Preferred, because it matches the finished goods flow and gives one rule for everything leaving the kitchen.
- If shipments go straight from the sponge department freezer to the spoke vehicle: sponge department to spoke, direct.

**Open operational question that decides Rule 3:** does Central Dispatch have frozen storage and the capacity to hold bulk intermediates? If yes, route everything through it. If no, direct, and revisit when dispatch capacity changes.

**Rule 4. One convention, no per-spoke exceptions.** Today Sector 67 is served from the sponge department and Janakpuri plus Sikanderpur from the cake department. Whichever route is chosen applies to all three spokes. The Sector 67 co-location with the central kitchen is not a reason to book it differently; it is a reason to move that spoke out, which is already planned.

**Rule 5. Every intermediate movement is recorded at the moment it happens,** in Build 3a by the sponge department (send side), and in SupplyNote by the receiving spoke (GRN, receive side). The two are reconciled daily. Neither replaces the other.

## 8. Unit of measurement design (confirmed direction)

Staff enter quantities in the unit they actually handle. The system converts. Design:

- Every item carries a **base unit** (gram, millilitre, or piece) and a **pack unit** with a **conversion factor** to base. An 8 kg Biscoff tin is pack unit "piece", base unit "gram", factor 8,000.
- **Recipes are always written in base units.** Purchases and issues may be in pack units. Consumption is computed in base units and valued from the base-unit rate.
- **Conversion factors must be dated and versioned.** Vendors change pack sizes (an 8 kg tin becomes 5 kg), and a silently edited factor would retrospectively corrupt every historical consumption figure. Either version the factor with an effective date, or capture pack size on the purchase record itself so history stays intact.
- **Owner required.** The conversion table needs one named owner who approves changes, or it will drift like the item master has.
- **Scope:** 694 of 1,011 items are recorded in "piece". Not all need conversion (a cake box is genuinely a piece). The task is to identify the weight and volume packs among them and record their pack sizes. This is workstream zero's first task and it is the largest single blocker to real COGS.

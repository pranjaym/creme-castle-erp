# Claude Code Kickoff Prompt
Paste everything below the line as your first message in Claude Code, opened at the repo root. Before pasting, make sure the erp-plan/ folder in the repo contains: the business context doc (Doc4ERP Fundraising), kitchen-production-brief.md, cc-flow-map-v2.mermaid, build-order.md, petpooja-admin-checklist.md, and simple-flow.mermaid.

---

We are building Creme Castle's internal systems toward an eventual ERP. All planning has been done in a separate Claude chat; the conclusions live as documents in erp-plan/. Your first job is to absorb them, verify them against the real code, and prepare the ground. Do not build anything yet.

**Step 1: read, in this order.**
1. erp-plan/ business context document (Doc4ERP Fundraising): the company, the network, the constraints.
2. erp-plan/kitchen-production-brief.md: the kitchen module, current-state reality, scope.
3. erp-plan/cc-flow-map-v2.mermaid: the material and software flow map.
4. erp-plan/build-order.md (v0.3): the agreed sequence. PRECEDENCE RULE: where this conflicts with the brief, build-order v0.3 wins. In particular, brief section 8's options are superseded: the decision is made, and the mechanism is a vendor named "OMS" in Petpooja to which D2C fulfillment stock is punched out, reconciled daily against OMS order data.
5. erp-plan/petpooja-admin-checklist.md: the fact-finding session whose answers are pending; several of your designs must stay flexible until they arrive.

**Step 2: repo check.** Confirm whether the OMS and the Dispatch Console live in this one repository. If they are in separate repos, say so and propose the consolidation into a monorepo (one Supabase project, one folder per module, erp-plan/ at root) before anything else, per build-order operating principle 4.

**Step 3: verify, then write integration-notes.md.** Check every integration assumption in the brief (sections 4, 7, 8) and the build order against the actual schemas and code of the OMS and the Dispatch Console. Specifically establish and document:
1. Where OMS orders live (tables, fields), and whether outlet and item identifiers align with anything Petpooja exports; note that Meerut's mapping in OMS is an open question.
2. The Dispatch Console's exact input format today (the manually uploaded feed): columns, granularity, upload mechanism. This is the target format for the future autofeed (Build 2), which will be generated from the database, since the console and OMS link only through the shared database, never directly.
3. What the canonical SKU master and location master should look like, drafted as actual schema, given both systems' existing conventions. Build 3a (intermediates logbook) must sit on this schema from day one.
4. Ingestion architecture for Petpooja and SupplyNote reports (email-parser preferred, browser agent fallback), with placeholders where the admin checklist answers are still pending.
Write all of it into erp-plan/integration-notes.md. Flag every assumption you could not verify.

**Step 4: create the root CLAUDE.md** pointing to erp-plan/ and stating: the planning documents are authoritative; build-order.md carries precedence; decisions made in build sessions must be written back into these documents; the Dispatch Console's model is never modified; the database schema is canonical and apps are disposable.

**Step 5: only after Pranjay has reviewed integration-notes.md,** propose build plans for the two parallel first builds and nothing else:
1. Build 1a: the D2C reconciliation report (OMS orders vs Petpooja vendor-OMS punch-outs, matched by order number in remarks, three exception buckets, per store, daily).
2. Build 3a: the intermediates logbook (sponges and ganaches only, four actions, under one minute per entry, phone-first, Hindi labels where useful, on the canonical schema, no-consequences pilot).

Rules throughout: every number reproducible, AI never load-bearing in any calculation, verified data only, no em dashes or en dashes in any output, and any decision made with Pranjay during your sessions gets written back into erp-plan/ documents the same day.

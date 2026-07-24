# Claude Code Prompt: execute Build 1a and Build 3a

Paste below the line as your next message in Claude Code (same repo, after it has already produced integration-notes.md). Make sure erp-plan/ now also contains the updated integration-notes (with section 9), build-plans-1a-3a.md, intermediate-sku-master.xlsx, and Outlet_Master.xlsx.

---

Read erp-plan/integration-notes.md (including the new section 9 on the existing Petpooja pipeline) and erp-plan/build-plans-1a-3a.md. These supersede any earlier assumptions. Then execute the two green-lit builds, following the three-layer design (landing zone, canonical spine, consumers) described in the build plans.

Locked decisions, do not re-litigate (all in the build plans): business day is 4:00 to 3:59 IST; spine is a new third Supabase project with OMS and console untouched; D2C punch mechanism is a Petpooja vendor "OMS" with the OMS order number in the invoice-number field; the four D2C stores map SPJ=CC-DL-Shahpurjat, FBD=CC-FBD-Sector 15, GN=CC-ND-Alpha 2, Meerut=CC-UP-Meerut; reconcile on orders not bills.

Important constraints:
1. Do NOT import petpooja_pipeline.py or its code. It contains live secrets and is not ours to carry. Use it only as reference for which two Petpooja reports to pull (online_orders_report_all, order_summary_item) and the vetted metric definitions and business-day rule. Build our own ingestion into the landing zone. Any secret in any code you write goes to environment variables, never a literal.
2. Seed the canonical SKU master from erp-plan/intermediate-sku-master.xlsx (45 intermediate rows) and locations from erp-plan/Outlet_Master.xlsx. Shelf-life and par-stock data arrives later and must load without a schema change.
3. Build 3a writes our own production data into the spine and has no ingestion dependency; it can proceed immediately and in parallel with 1a.
4. Build 1a: build landing + canonical Petpooja tables, then the three-bucket reconciliation matcher (normalise both order-number shapes, 171643 and CC-<id>); first cut may match at order-total and line-count level, deferring strict per-item matching until the SKU alias map for the four stores is seeded.

Before writing code, produce a short build plan for each (files you will create, tables/migrations, and the order you will build in) and show it to me. Do not start coding until I have seen both plans. Write every architecture decision back into erp-plan/ the same day, per the covenant. The Dispatch Console model is never modified. Every number reproducible; AI never load-bearing in any calculation. No em dashes or en dashes in any output.

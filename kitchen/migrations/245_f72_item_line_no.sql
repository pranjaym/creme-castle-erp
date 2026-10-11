-- ============================================================
-- Migration 245: keep every line of the Petpooja item report (F72, 11 Oct 2026)
--
-- Pranjay, 11 Oct 2026: "yes to all three, build it" (plan in
-- erp-plan/f72-duplicate-item-lines-plan.md).
--
-- One bill can carry the same item, price and quantity on two separate lines
-- (9 Oct 2026: invoice 19357, Chocolate Truffle Cake (500 Gm), Rs 599 x1, twice).
-- Both unique rules on landing.petpooja_order_summary_item rejected the second
-- line: the natural key (052) has no line number, and identical lines share a
-- row_hash (010/050). The loaders insert with `on conflict do nothing`, so the
-- line vanished without a word: 61 lines on 37 of the 81 days judged from
-- 21 Jul to 9 Oct 2026, plus an uncounted number in the history loaded before.
--
-- 1. line_no: 1 for the first copy of a line, 2 for an identical second, and so
--    on. Every existing row becomes line 1, so no stored value or row_hash
--    changes and nothing reading the table sees a difference.
-- 2. Both unique rules gain line_no, and both now ignore voided rows. A voided
--    row stays as history (no hard deletes), and a line Petpooja removes and
--    later restores lands again as a new live row instead of being skipped by
--    the same silent conflict.
-- The views (v_report_order_summary_item, v_settled_items) list their columns,
-- so the portal download layout is unchanged; a repeat line is one more row.
--
-- LOCKS. Apply as TWO transactions, outside 07:15 to 08:45, 04:30, 14:30, 15:15:
--   part 1 (the column) is a catalogue change and takes a moment;
--   part 2 builds the new rules under temporary names first (about a minute on
--   1.5 GB, blocking writes but NOT reads), then drops the old rules and renames
--   the new ones at the very end, so the brief exclusive lock lasts milliseconds.
--   Portal queries time out after 8 s on a lock, so never drop the old rules
--   first inside a long transaction.
-- ============================================================

-- ---------- part 1 ----------
alter table landing.petpooja_order_summary_item
  add column if not exists line_no smallint not null default 1;

comment on column landing.petpooja_order_summary_item.line_no is
  'F72: 1 for the first copy of a line, 2 for an identical second copy on the same bill and day, and so on. Part of both unique rules.';

-- ---------- part 2 ----------
create unique index if not exists uq_pp_item_natural_245
  on landing.petpooja_order_summary_item
     (business_date, restaurant_name, invoice_no, item_name, item_price, item_quantity, line_no)
  where voided_at is null;

create unique index if not exists uq_pp_item_hash_245
  on landing.petpooja_order_summary_item (business_date, row_hash, line_no)
  where voided_at is null;

drop index if exists landing.uq_pp_item_natural;
drop index if exists landing.uq_pp_item_hash;
alter index landing.uq_pp_item_natural_245 rename to uq_pp_item_natural;
alter index landing.uq_pp_item_hash_245 rename to uq_pp_item_hash;

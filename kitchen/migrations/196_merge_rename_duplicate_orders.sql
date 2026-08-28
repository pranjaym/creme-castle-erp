-- 196: merge the duplicate orders created when Petpooja renamed an outlet.
--
-- WHY (F40, found 28 Aug 2026). Petpooja's ITEM report and its ONLINE ORDER report
-- switched to a renamed outlet's new name on DIFFERENT dates. The core.orders loader
-- matches an item-report order to its order-report twin on outlet NAME plus invoice,
-- so while the two exports disagreed the match failed and a phantom order was minted
-- under the second name, with source='pos_items_only'.
--
-- Confirmed on three outlet pairs and only three, all of them known renames or
-- relocations. The discriminator is amount agreement, NOT invoice number: across the
-- network there are 9,481 invoice+date collisions between unrelated outlets, of which
-- 0% to 1.9% agree on amount, against 99.8% to 100% for these three.
--
--   CC-GGN-Udyog Vihar -> CC-DL-South Campus   1,930 orders  Rs 892,844  28 Feb to 20 Jul 2026
--   CC-GGN-Sector 37   -> CC-GGN-Sector 52       640 orders  Rs 279,441   1 Feb to 11 Feb 2026
--   CC-ND-Gaur City 1  -> CC-ND-Diamond Plaza    103 orders  Rs  51,185  23 Feb to 25 Feb 2026
--
-- THIS IS A MERGE, NOT A DELETE. 3,658 item lines exist ONLY on the phantom rows, so
-- dropping them would destroy five months of what those stores actually sold. The item
-- lines are relinked onto the surviving order-report row first, the survivor's item
-- totals are recomputed, and only then is the emptied phantom superseded with a reason.
-- No row disappears (canonical rule 6).

begin;

-- ---------- 1. the supersede mechanism, mirroring landing.zomato_order_details ----------
alter table core.orders add column if not exists superseded_at     timestamptz;
alter table core.orders add column if not exists superseded_reason text;
create index if not exists core_orders_live_idx on core.orders (business_date)
  where superseded_at is null;

-- ---------- 2. the pairs, resolved once ----------
create temporary table _dupe_pairs on commit drop as
with pairs as (
  select a.id as survivor_id, b.id as phantom_id,
         a.outlet_raw as survivor_name, b.outlet_raw as phantom_name,
         row_number() over (partition by b.id order by a.id) as rn_b,
         row_number() over (partition by a.id order by b.id) as rn_a
  from core.orders a
  join core.orders b
    on  b.invoice_no    = a.invoice_no
    and b.business_date = a.business_date
    and round(b.order_total) = round(a.order_total)
  where a.source = 'online_report'
    and b.source = 'pos_items_only'
    and a.superseded_at is null
    and b.superseded_at is null
    -- The survivor must hold NO item lines of its own. Two pairs (invoices 4931 and
    -- 4932 on 24 Jun 2026) have item lines on BOTH sides carrying the same value,
    -- where merging would double the basket against an order total that already does
    -- not agree with it. Two orders out of 2,673 is not worth a guess: they are left
    -- exactly as they are and listed in F40 as a known residue.
    and coalesce(a.items_linked, false) = false
    and (a.outlet_raw, b.outlet_raw) in (
          ('CC-GGN-Udyog Vihar', 'CC-DL-South Campus'),
          ('CC-GGN-Sector 37',   'CC-GGN-Sector 52'),
          ('CC-ND-Gaur City 1',  'CC-ND-Diamond Plaza')))
select survivor_id, phantom_id, survivor_name, phantom_name
from pairs
where rn_b = 1 and rn_a = 1;          -- strict 1:1 only; anything ambiguous is left alone

-- ---------- 3. move the item lines onto the surviving order ----------
update core.order_items i
   set order_id    = p.survivor_id,
       location_id = s.location_id
  from _dupe_pairs p
  join core.orders s on s.id = p.survivor_id
 where i.order_id = p.phantom_id;

-- ---------- 4. recompute the survivor's item totals from what it now holds ----------
update core.orders o
   set items_count  = t.n,
       items_total  = t.total,
       items_linked = true
  from (select i.order_id, count(*) n, sum(i.item_total) total
          from core.order_items i
         where i.order_id in (select survivor_id from _dupe_pairs)
         group by i.order_id) t
 where o.id = t.order_id;

-- ---------- 5. supersede the emptied phantom ----------
update core.orders o
   set superseded_at    = now(),
       superseded_reason = 'F40 migration 196: duplicate of order ' || p.survivor_id
         || '. Petpooja item report called this outlet ' || p.phantom_name
         || ' while the order report still called it ' || p.survivor_name
         || '; the loader matched on outlet name and minted this phantom. Item lines'
         || ' were relinked to the surviving order before this row was superseded.',
       items_count  = 0,
       items_total  = 0,
       items_linked = false
  from _dupe_pairs p
 where o.id = p.phantom_id;

-- ---------- 6. the only dependent view must not serve superseded rows ----------
create or replace view mart.customer_orders as
 select oc.customer_id, oc.tier as identity_tier, o.id, o.source, o.channel,
        o.location_id, o.outlet_raw, o.business_date, o.invoice_no, o.aggregator_order_no,
        o.landing_order_id, o.order_ts_raw, o.order_type, o.payment_type, o.status,
        o.customer_name, o.customer_phone_raw, o.customer_address, o.pos_area,
        o.subtotal, o.discount_total, o.charges_total, o.order_total, o.cancelled_by,
        o.cancel_reason, o.zomato_customer_id, o.zomato_subzone, o.zomato_city,
        o.zomato_rating, o.zomato_review, o.zomato_complaint_tag,
        o.zomato_discount_construct, o.items_count, o.items_total, o.items_linked,
        o.refreshed_at
   from identity.order_customer oc
   join core.orders o on o.id = oc.order_id
  where o.superseded_at is null;

commit;

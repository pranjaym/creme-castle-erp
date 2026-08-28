-- 197: correct the two orders that migration 196 double counted.
--
-- WHY. 196 relinks a phantom order's item lines onto its surviving twin. That is right
-- wherever the survivor held no lines of its own, which was 2,671 of the 2,673 pairs.
-- Two pairs (invoices 4931 and 4932, business date 24 Jun 2026, CC-GGN-Udyog Vihar)
-- held item lines on BOTH sides for the same sale, because Petpooja's item report
-- briefly emitted the SAME line under both the old and the new outlet name. 196 moved
-- the second copy onto the survivor, so each of those two orders now carries its item
-- twice: Banoffee Pie 1 x 229 twice, and Dubai Viral Chocolate Kunafa 1 x 319 twice.
--
-- 196 has since been given a guard (coalesce(a.items_linked,false) = false) so it can
-- never do this again. This migration repairs the two rows it already touched.
--
-- The redundant line is NOT deleted (canonical rule 6). It is returned to the phantom
-- order it arrived on, which is already superseded, so every consumer that filters
-- superseded orders stops counting it while the row itself remains for audit.

update core.order_items i
   set order_id    = v.phantom_id,
       location_id = (select location_id from core.orders where id = v.phantom_id)
  from (values (4303957::bigint, 4348059::bigint),
               (4303958::bigint, 4348060::bigint)) as v(item_id, phantom_id)
 where i.id = v.item_id;

update core.orders o
   set items_count  = t.n,
       items_total  = t.total,
       items_linked = (t.n > 0)
  from (select i.order_id, count(*) n, sum(i.item_total) total
          from core.order_items i
         where i.order_id in (3187671, 3187647)
         group by i.order_id) t
 where o.id = t.order_id;

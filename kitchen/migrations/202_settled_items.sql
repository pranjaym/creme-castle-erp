-- 202_settled_items.sql
-- The item side of a settled day, shaped exactly like intraday.v_items_now, so a
-- category on a festival can be laid against the same category on a normal day with
-- one set of arithmetic and no second definition to keep in step.
--
-- Item value here is the item's own line total, GROSS of the order level discounts.
-- It therefore does NOT foot to order level Net Sales, and the report says so on the
-- face of the category section rather than leaving someone to discover it. The
-- alternative, apportioning each order's discount across its lines, is an allocation
-- and would have to be labelled an estimate; a gross number that is exactly what
-- Petpooja reports is the better basis for a like-for-like category comparison.

create or replace view intraday.v_settled_items as
select business_date, restaurant_name, invoice_no, item_name, category_name,
       status, order_type, area,
       intraday.ts(order_ts)         as placed_at,
       intraday.money(item_quantity) as qty,
       intraday.money(item_total)    as item_value,
       intraday.money(total)         as order_total
from landing.petpooja_order_summary_item;

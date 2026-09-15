-- 228: food_cost_list (226) computed "with packaging" against the packaging charge alone
-- when an item has no selling price (Cup Cake read 238%). Both percentages are now null
-- until a selling price exists; the item still lists, so the gap is visible.
create or replace view recipes.food_cost_list as
  with s as (select
      (select value from recipes.setting where key = 'wastage_allowance_pct') as allowance_pct,
      (select value from recipes.setting where key = 'target_food_cost_pct') as target_pct)
  select lc.recipe_id, lc.code, lc.name, lc.book, lc.status,
         lc.unit_cost                                   as material_per_unit,
         lc.unit_cost * (1 + s.allowance_pct / 100)     as material_with_allowance,
         lc.packaging_cost                              as packaging_per_unit,
         cp.selling_price, cp.packaging_charge,
         case when cp.selling_price > 0
              then lc.unit_cost * (1 + s.allowance_pct / 100) / cp.selling_price end                as food_cost_pct,
         case when cp.selling_price > 0
              then (lc.unit_cost * (1 + s.allowance_pct / 100) + lc.packaging_cost)
                   / (cp.selling_price + coalesce(cp.packaging_charge, 0)) end                        as food_cost_with_packaging_pct,
         s.target_pct / 100 as target_pct,
         lc.missing_rates, lc.version_id
  from recipes.live_cost lc
  cross join s
  left join recipes.current_price cp on cp.recipe_id = lc.recipe_id and cp.channel = 'aggregator'
  where lc.kind = 'finished';

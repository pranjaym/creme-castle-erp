-- ============================================================
-- Migration 009: SEED config maps (hand-maintained, not generated)
-- Depends on: 000_foundation.sql, 005_seed_locations.sql
-- ============================================================

-- Non-production categories: excluded from cake-department consumption until a
-- separate housekeeping location exists (Pranjay, 23 Jul 2026). This is the
-- temporary filter; removing a row here re-includes that category later.
insert into category_map (system, source_category, canonical_category, is_non_production, note) values
  ('supplynote','maintenance items','maintenance',true,'non-production consumable'),
  ('supplynote','houskeeping','housekeeping',true,'non-production consumable (source typo)'),
  ('supplynote','housekeeping','housekeeping',true,'non-production consumable'),
  ('supplynote','utensils','utensils',true,'non-production consumable'),
  ('supplynote','printing stationery','printing stationery',true,'non-production consumable')
on conflict (system, source_category) do nothing;

-- A few obvious category normalisations (the full 31-category clean-up is a
-- workstream-zero data task; these are seeds and examples of the pattern).
insert into category_map (system, source_category, canonical_category, default_sku_type, note) values
  ('supplynote','fruits and vegitables','vegetables',null,'source typo/dupe'),
  ('supplynote','fruits & vegitables','vegetables',null,'source typo/dupe'),
  ('supplynote','vegetables','vegetables',null,null),
  ('supplynote','chcoos cookies and fruits','chocos cookies and fruits',null,'source typo'),
  ('supplynote','sponges','sponge','intermediate'::sku_type,'sponges are intermediates'),
  ('supplynote','semi-finish','intermediate','intermediate'::sku_type,'some sponges live here too'),
  ('supplynote','semi pastries','intermediate','intermediate'::sku_type,null)
on conflict (system, source_category) do nothing;

-- category_department_map is deliberately left EMPTY. Petpooja production entries
-- carry a product Category (Cakes, Pastry, Cheese Cakes, Brownies, Crossiant, Jar,
-- Tea Cake) but no department. Which category maps to which department is a
-- decision for Pranjay; fill this table when that mapping is agreed. Example shape:
--   insert into category_department_map (source_category, department_location_id)
--     select 'Cakes', id from locations where code = 'CK-CAKE';

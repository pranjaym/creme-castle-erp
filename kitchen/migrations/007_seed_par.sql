-- Migration 007: SEED par stocks (generated, chef v2). par_qty null for non-numeric par.

insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1000, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 240, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 100, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 50, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 28, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 26, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 18, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 14, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 14, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 8, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 350, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 180, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 50, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 25, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, null, 'on_demand', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 8, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-015' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-016' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 70, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 100, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 40, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 30, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 20, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-015' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, null, 'ready_made', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-016' and l.code = 'FREEZER-CK'
  on conflict do nothing;


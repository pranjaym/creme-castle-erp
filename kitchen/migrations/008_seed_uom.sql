-- Migration 008: SEED default entry-unit conversions to base (generated).
-- One default conversion per intermediate (kg->gram 1000, piece->piece 1, tray->piece 1).
-- The 694 piece-unit pack conversions for raw materials are a workstream-zero task.

insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-015'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-016'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-015'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-016'
  on conflict do nothing;


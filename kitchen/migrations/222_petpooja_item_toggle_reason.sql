-- ============================================================
-- Migration 222: the automatic item switch names its cause (9 September 2026)
--
-- Seen on the first real load (Janakpuri, 5 Sep 2026): when Petpooja's stock
-- rule switches an item off, the log names the RAW MATERIAL that ran out and
-- the stock levels, e.g. "Fresh Fruit Cake (500 Gm) via Real time inventory,
-- based on stock affected of raw materials Fresh Fruit Eggless Cake (500 Gms)
-- [ Real-Time Stock : 0 Piece , At par Stock : 1 Piece ]". That is the
-- "what happened" Pranjay asked to always be able to see, so it gets its own
-- columns instead of living inside item_names. Additive only.
-- ============================================================
alter table landing.petpooja_item_toggle_log
  add column if not exists reason          text,
  add column if not exists stock_item      text,
  add column if not exists stock_realtime  text,
  add column if not exists stock_par       text;
comment on column landing.petpooja_item_toggle_log.reason is
  'Petpooja''s own wording after the item name, e.g. "via Real time inventory, based on stock affected of raw materials ..."; null on manual switches.';
comment on column landing.petpooja_item_toggle_log.stock_item is
  'The stock (raw material) item whose level triggered an automatic switch.';

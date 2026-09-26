-- 236: two new portal roles for the role redraw (Pranjay, 26 Sep 2026; the full
-- map is erp-plan/portal-access-matrix.md).
--   operations  the Operations Head: every store, every area, questions; nothing else
--   none        no portal pages at all; for kitchen staff whose work is in the kitchen app
-- Added on their own because Postgres will not let a new enum value be used in
-- the same transaction that adds it; 237 uses them.
alter type portal_role add value if not exists 'operations';
alter type portal_role add value if not exists 'none';

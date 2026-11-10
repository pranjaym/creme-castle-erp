-- ============================================================
-- Migration 253: SUPPLYNOTE INGEST FUNCTIONS (inventory module, build step 1b)
-- 10 November 2026, Pranjay's go ("Yes, apply it"). Staged first in
-- erp-plan/migrations-staging/ (F41). Proven in a rolled-back transaction,
-- then applied and recorded in schema_migrations the same moment.
--
-- Target: the spine Supabase project. Additive only: four helper functions,
-- three entry points and one view. No table is created or altered. No
-- begin/commit in this file: the caller owns the transaction.
-- Design record: erp-plan/inventory-module-plan.md, section "The SupplyNote
-- sync moves to the portal".
--
-- Why. Pranjay, 10 Nov 2026: SupplyNote has an API, so the sync must not
-- depend on the Mac; the portal does it, about hourly. The portal reaches the
-- spine through the Supabase REST client, which cannot see the private
-- landing schema. So the loading rule moves INTO the database, in one place:
--   public.supplynote_ingest(report_key, rows, ...)
-- takes SupplyNote's rows exactly as the API sent them (a JSON array) and does
-- the insert-or-supersede itself. The portal route and the Mac worker both
-- call it, so there is one loading rule, not two.
--
-- The rule (unchanged from 252 and the sibling loaders):
--   * a key not yet present is inserted;
--   * a key whose source row differs from the current row: the old row is
--     superseded (superseded_at, superseded_by) and the new row inserted;
--   * a key whose source row is identical is left alone;
--   * nothing is updated in place and nothing is deleted (CLAUDE.md rule 6).
-- "Differs" is decided on the stored source row itself (raw, jsonb equality),
-- not on row_hash, so rows loaded by the Mac worker on 10 Nov 2026 and rows
-- loaded by this function compare correctly with each other. row_hash is
-- still filled (sha256 of the row's jsonb text) as a fingerprint.
--
-- A batch with an empty key, or the same key twice, is refused whole.
-- Same pattern as 250: security definer, search_path pinned, execute granted
-- to service_role only.
-- ============================================================

-- ------------------------------------------------------------
-- Helpers. SupplyNote sends UTC timestamps with no zone suffix.
-- ------------------------------------------------------------
create or replace function landing.sn_ts(v text)
returns timestamptz language sql immutable as $fn$
  select case
    when v is null or btrim(v) = '' then null
    when btrim(v) ~ '(Z|[+-]\d\d(:?\d\d)?)$' then btrim(v)::timestamptz
    else (btrim(v)::timestamp at time zone 'UTC')
  end
$fn$;

create or replace function landing.sn_num(v text)
returns numeric language sql immutable as $fn$
  select case when btrim(v) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then btrim(v)::numeric end
$fn$;

create or replace function landing.sn_bool(v text)
returns boolean language sql immutable as $fn$
  select case lower(btrim(v)) when 'true' then true when 'false' then false end
$fn$;

-- ------------------------------------------------------------
-- Run log entry points (landing.ingest_runs is not visible to REST).
-- ------------------------------------------------------------
create or replace function public.supplynote_run_open(p_report_key text, p_window_from date, p_window_to date, p_note text default null)
returns bigint language plpgsql security definer set search_path = landing, public as $fn$
declare v_id bigint;
begin
  insert into landing.ingest_runs (source_system, report_key, window_from, window_to, status, note)
  values ('supplynote', p_report_key, p_window_from, p_window_to, 'started', p_note)
  returning id into v_id;
  return v_id;
end
$fn$;

create or replace function public.supplynote_run_close(p_run_id bigint, p_row_count integer, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = landing, public as $fn$
begin
  if p_status not in ('loaded', 'failed') then
    raise exception 'supplynote_run_close: status must be loaded or failed, got %', p_status;
  end if;
  update landing.ingest_runs
     set status = p_status, row_count = p_row_count, note = p_note, finished_at = now()
   where id = p_run_id and source_system = 'supplynote';
end
$fn$;

-- ------------------------------------------------------------
-- The loader. p_rows is a JSON array of SupplyNote rows as the API sent them.
-- p_snapshot_date and p_pulled_at are used by stock_daily only.
-- Returns {"rows": n, "new": n, "changed": n, "unchanged": n}.
-- ------------------------------------------------------------
create or replace function public.supplynote_ingest(
  p_report_key    text,
  p_rows          jsonb,
  p_run_id        bigint default null,
  p_snapshot_date date default null,
  p_pulled_at     timestamptz default null)
returns jsonb language plpgsql security definer set search_path = landing, public, pg_temp as $fn$
declare
  v_table   text;
  v_keys    text[];
  v_sel     text;      -- "expression as column" list, read from r (one source row)
  v_cols    text;      -- the same columns, names only
  v_icols   text;      -- the same columns, prefixed i.
  v_join_t  text;      -- current row t against incoming i, on the key
  v_join_o  text;      -- retired row o against incoming i, on the key
  v_keycsv  text;
  v_empty   text;
  n_in      integer;
  n_bad     integer;
  n_changed integer;
  n_ins     integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'supplynote_ingest: p_rows must be a JSON array';
  end if;

  case p_report_key
    when 'products' then
      v_table := 'landing.supplynote_products';
      v_keys  := array['product_id'];
      v_sel   := $q$ r->>'product_id' as product_id, r->>'sku_code' as sku_code, r->>'product_title' as product_title,
                    r->>'category' as category, r->>'sub_category' as sub_category, r->>'base_unit' as base_unit,
                    r->>'brand' as brand, r->>'hsn_code' as hsn_code, landing.sn_num(r->>'tax_pct') as tax_pct,
                    landing.sn_bool(r->>'is_active') as is_active $q$;
      v_cols  := 'product_id, sku_code, product_title, category, sub_category, base_unit, brand, hsn_code, tax_pct, is_active';
    when 'stock_daily' then
      if p_snapshot_date is null or p_pulled_at is null then
        raise exception 'supplynote_ingest: stock_daily needs p_snapshot_date and p_pulled_at';
      end if;
      v_table := 'landing.supplynote_stock_daily';
      v_keys  := array['snapshot_date', 'outlet_id', 'product_id'];
      v_sel   := $q$ $2::date as snapshot_date, $3::timestamptz as pulled_at, r->>'outlet_id' as outlet_id,
                    r->>'product_id' as product_id, r->>'outlet_product_id' as outlet_product_id,
                    landing.sn_num(r->>'current_stock') as current_stock,
                    landing.sn_num(r->>'last_purchased_price') as last_purchased_price,
                    landing.sn_num(r->>'last_weighted_average_price') as last_weighted_average_price,
                    landing.sn_bool(r->>'is_active') as is_active $q$;
      v_cols  := 'snapshot_date, pulled_at, outlet_id, product_id, outlet_product_id, current_stock, last_purchased_price, last_weighted_average_price, is_active';
    when 'inventory_log' then
      v_table := 'landing.supplynote_inventory_log';
      v_keys  := array['log_id'];
      v_sel   := $q$ r->>'log_id' as log_id, r->>'outlet_id' as outlet_id, r->>'product_id' as product_id,
                    landing.sn_ts(r->>'transaction_at') as transaction_at, r->>'transaction_type' as transaction_type,
                    r->>'reason' as reason, r->>'wastage_reason' as wastage_reason, r->>'reference_no' as reference_no,
                    r->>'invoice_id' as invoice_id, landing.sn_num(r->>'quantity_adjusted') as quantity_adjusted,
                    landing.sn_num(r->>'stock_before') as stock_before, landing.sn_num(r->>'stock_after') as stock_after,
                    landing.sn_num(r->>'unit_price') as unit_price, landing.sn_num(r->>'weighted_avg_price') as weighted_avg_price,
                    landing.sn_bool(r->>'is_accounting_update') as is_accounting_update,
                    landing.sn_ts(r->>'_updated_at') as source_updated_at $q$;
      v_cols  := 'log_id, outlet_id, product_id, transaction_at, transaction_type, reason, wastage_reason, reference_no, invoice_id, quantity_adjusted, stock_before, stock_after, unit_price, weighted_avg_price, is_accounting_update, source_updated_at';
    when 'purchase_orders' then
      v_table := 'landing.supplynote_purchase_orders';
      v_keys  := array['purchase_order_id'];
      v_sel   := $q$ r->>'purchase_order_id' as purchase_order_id, r->>'purchase_order_no' as purchase_order_no,
                    r->>'direction' as direction, r->>'outlet_id' as outlet_id, r->>'outlet_name' as outlet_name,
                    r->>'seller_id' as seller_id, r->>'seller_name' as seller_name,
                    landing.sn_ts(r->>'po_saved_at') as po_saved_at, landing.sn_ts(r->>'po_dated_at') as po_dated_at,
                    landing.sn_ts(r->>'confirmed_at') as confirmed_at, landing.sn_ts(r->>'delivery_due_at') as delivery_due_at,
                    r->>'status' as status, landing.sn_num(r->>'total_amount') as total_amount,
                    landing.sn_bool(r->>'is_open_po') as is_open_po, landing.sn_bool(r->>'is_closed') as is_closed,
                    landing.sn_bool(r->>'is_finished') as is_finished, landing.sn_bool(r->>'is_void') as is_void,
                    landing.sn_ts(r->>'created_at') as source_created_at, landing.sn_ts(r->>'_updated_at') as source_updated_at $q$;
      v_cols  := 'purchase_order_id, purchase_order_no, direction, outlet_id, outlet_name, seller_id, seller_name, po_saved_at, po_dated_at, confirmed_at, delivery_due_at, status, total_amount, is_open_po, is_closed, is_finished, is_void, source_created_at, source_updated_at';
    when 'purchase_order_lines' then
      v_table := 'landing.supplynote_purchase_order_lines';
      v_keys  := array['purchase_order_line_id'];
      v_sel   := $q$ r->>'purchase_order_line_id' as purchase_order_line_id, r->>'purchase_order_id' as purchase_order_id,
                    r->>'direction' as direction, r->>'outlet_id' as outlet_id, r->>'product_id' as product_id,
                    r->>'seller_id' as seller_id, landing.sn_num(r->>'quantity_ordered') as quantity_ordered,
                    landing.sn_num(r->>'quantity_confirmed') as quantity_confirmed, landing.sn_num(r->>'quantity_invoiced') as quantity_invoiced,
                    landing.sn_num(r->>'quantity_delivered') as quantity_delivered, landing.sn_num(r->>'quantity_received') as quantity_received,
                    landing.sn_num(r->>'quantity_cancelled') as quantity_cancelled, landing.sn_num(r->>'quantity_returned') as quantity_returned,
                    r->>'unit' as unit, r->>'base_unit' as base_unit, landing.sn_num(r->>'unit_conversion') as unit_conversion,
                    landing.sn_num(r->>'unit_price') as unit_price, landing.sn_num(r->>'tax_pct') as tax_pct $q$;
      v_cols  := 'purchase_order_line_id, purchase_order_id, direction, outlet_id, product_id, seller_id, quantity_ordered, quantity_confirmed, quantity_invoiced, quantity_delivered, quantity_received, quantity_cancelled, quantity_returned, unit, base_unit, unit_conversion, unit_price, tax_pct';
    else
      raise exception 'supplynote_ingest: unknown report_key %', p_report_key;
  end case;

  select string_agg('i.' || btrim(c), ', ') into v_icols from unnest(string_to_array(v_cols, ',')) as c;
  select string_agg(format('t.%1$I = i.%1$I', k), ' and '), string_agg(format('o.%1$I = i.%1$I', k), ' and '),
         string_agg(format('%I', k), ', '), string_agg(format('(%1$I is null or %1$I::text = '''')', k), ' or ')
    into v_join_t, v_join_o, v_keycsv, v_empty
    from unnest(v_keys) as k;

  drop table if exists pg_temp._sn_in;
  execute format('create temp table _sn_in on commit drop as select %s, r as raw from jsonb_array_elements($1) as e(r)', v_sel)
    using p_rows, p_snapshot_date, p_pulled_at;
  select count(*) into n_in from _sn_in;
  if n_in = 0 then
    return jsonb_build_object('rows', 0, 'new', 0, 'changed', 0, 'unchanged', 0);
  end if;

  execute format('select count(*) from _sn_in where %s', v_empty) into n_bad;
  if n_bad > 0 then
    raise exception 'supplynote_ingest(%): % row(s) with an empty key; batch refused', p_report_key, n_bad;
  end if;
  execute format('select count(*) from (select 1 from _sn_in group by %s having count(*) > 1) d', v_keycsv) into n_bad;
  if n_bad > 0 then
    raise exception 'supplynote_ingest(%): % key(s) appear more than once; batch refused', p_report_key, n_bad;
  end if;

  -- 1. retire the current row of every key whose source row has changed
  execute format('update %s t set superseded_at = now() from _sn_in i where %s and t.superseded_at is null and t.raw is distinct from i.raw',
                 v_table, v_join_t);
  get diagnostics n_changed = row_count;

  -- 2. insert every incoming row that now has no current row (new keys, and the keys retired in step 1)
  execute format('insert into %s (%s, raw, row_hash, ingest_run_id) '
                 'select %s, i.raw, encode(sha256(convert_to(i.raw::text, ''UTF8'')), ''hex''), $1 from _sn_in i '
                 'where not exists (select 1 from %s t where %s and t.superseded_at is null)',
                 v_table, v_cols, v_icols, v_table, v_join_t)
    using p_run_id;
  get diagnostics n_ins = row_count;

  -- 3. point each row retired in step 1 at the row that replaced it
  if n_changed > 0 then
    execute format('update %1$s o set superseded_by = t.id from _sn_in i join %1$s t on %2$s and t.superseded_at is null '
                   'where %3$s and o.superseded_at is not null and o.superseded_by is null and o.id <> t.id',
                   v_table, v_join_t, v_join_o);
  end if;

  drop table if exists pg_temp._sn_in;
  return jsonb_build_object('rows', n_in, 'new', n_ins - n_changed, 'changed', n_changed, 'unchanged', n_in - n_ins);
end
$fn$;

-- ------------------------------------------------------------
-- "Last synced", for the screens: the latest loaded run and the latest failed
-- run per dataset.
-- ------------------------------------------------------------
create or replace view public.v_supplynote_sync_status as
select report_key,
       max(finished_at) filter (where status = 'loaded') as last_loaded_at,
       max(started_at)  filter (where status = 'failed') as last_failed_at,
       (array_agg(note order by started_at desc) filter (where status = 'failed'))[1] as last_failure_note,
       count(*) filter (where status = 'loaded' and finished_at > now() - interval '24 hours') as loads_last_24h
  from landing.ingest_runs
 where source_system = 'supplynote'
 group by report_key;

revoke all on function public.supplynote_run_open(text, date, date, text) from public, anon, authenticated;
revoke all on function public.supplynote_run_close(bigint, integer, text, text) from public, anon, authenticated;
revoke all on function public.supplynote_ingest(text, jsonb, bigint, date, timestamptz) from public, anon, authenticated;
grant execute on function public.supplynote_run_open(text, date, date, text) to service_role;
grant execute on function public.supplynote_run_close(bigint, integer, text, text) to service_role;
grant execute on function public.supplynote_ingest(text, jsonb, bigint, date, timestamptz) to service_role;
revoke all on public.v_supplynote_sync_status from public, anon, authenticated;
grant select on public.v_supplynote_sync_status to service_role;

-- 229: Recipe module, the workflow in the database (Steps B to E foundations).
-- Pranjay 15 Sep 2026 evening: "build the rest of the tool for now".
-- Everything an app needs to draft, check, approve, price and snapshot lives here as
-- functions, so the portal is a thin window and a future ERP inherits the rules
-- (canonical rule 1). Every mutation writes recipes.event (rule 6).

-- ---------- roles: the two people the workflow names ----------
alter type portal_role add value if not exists 'chef';
alter type portal_role add value if not exists 'controls';

-- ---------- cost of ANY version (draft or live), sub-recipes at their approved version ----------
create or replace function recipes.cost_of_version(p_version_id bigint)
returns table (batch_cost numeric, unit_cost numeric, packaging_cost numeric, missing_rates int, output_qty numeric, output_unit text)
language plpgsql stable as $$
#variable_conflict use_column
declare v record; l record; r numeric; sub record;
        b numeric := 0; p numeric := 0; miss int := 0;
begin
  select * into v from recipes.recipe_version rv where rv.id = p_version_id;
  if not found then return; end if;
  for l in select * from recipes.recipe_line rl where rl.version_id = v.id order by rl.line_no loop
    if l.ingredient_sku_id is not null then
      select cr.rate_per_base into r from recipes.current_rate cr where cr.sku_id = l.ingredient_sku_id;
      if r is null then miss := miss + 1; r := 0; end if;
    else
      select * into sub from recipes.cost_of_recipe(l.sub_recipe_id, 1);
      if sub.unit_cost is null then miss := miss + 1; r := 0; else r := sub.unit_cost; miss := miss + coalesce(sub.missing_rates, 0); end if;
    end if;
    if l.role = 'packaging' then p := p + l.qty * r; else b := b + l.qty * r; end if;
  end loop;
  return query select b, b / v.output_qty, p, miss, v.output_qty, v.output_unit;
end $$;

-- ---------- where a recipe or ingredient is used, at the live version ----------
create or replace view recipes.where_used as
  select l.ingredient_sku_id, l.sub_recipe_id, l.qty, l.unit, l.role,
         r.id as used_by_recipe_id, r.code as used_by_code, r.name as used_by_name, r.kind as used_by_kind
  from recipes.recipe_line l
  join recipes.recipe_version v on v.id = l.version_id and v.state = 'approved'
  join recipes.recipe r on r.id = v.recipe_id and r.retired_at is null;

-- ---------- explode a live recipe to raw materials, per one output unit ----------
create or replace function recipes.explode(p_recipe_id bigint)
returns table (sku_id bigint, qty numeric, cost numeric)
language sql stable as $$
  with recursive walk(sku_id, sub_recipe_id, qty, depth) as (
    select l.ingredient_sku_id, l.sub_recipe_id, l.qty / v.output_qty, 1
    from recipes.recipe_version v
    join recipes.recipe_line l on l.version_id = v.id and l.role = 'material'
    where v.recipe_id = p_recipe_id and v.state = 'approved'
    union all
    select l.ingredient_sku_id, l.sub_recipe_id, w.qty * l.qty / v.output_qty, w.depth + 1
    from walk w
    join recipes.recipe_version v on v.recipe_id = w.sub_recipe_id and v.state = 'approved'
    join recipes.recipe_line l on l.version_id = v.id and l.role = 'material'
    where w.sub_recipe_id is not null and w.depth < 12
  )
  select w.sku_id, sum(w.qty), sum(w.qty * coalesce(cr.rate_per_base, 0))
  from walk w
  left join recipes.current_rate cr on cr.sku_id = w.sku_id
  where w.sku_id is not null
  group by w.sku_id;
$$;

-- ---------- state machine ----------
-- A new draft copies the live version (or the latest version if none is live).
create or replace function recipes.new_draft(p_recipe_id bigint, p_actor text, p_note text default null)
returns bigint language plpgsql as $$
declare src record; vid bigint; n int;
begin
  if exists (select 1 from recipes.recipe_version where recipe_id = p_recipe_id and state in ('draft','checked')) then
    raise exception 'this recipe already has a draft waiting; open it instead of starting another';
  end if;
  select * into src from recipes.recipe_version where recipe_id = p_recipe_id and state = 'approved';
  if not found then
    select * into src from recipes.recipe_version where recipe_id = p_recipe_id order by version_no desc limit 1;
  end if;
  select coalesce(max(version_no), 0) + 1 into n from recipes.recipe_version where recipe_id = p_recipe_id;
  insert into recipes.recipe_version (recipe_id, version_no, state, output_qty, output_unit, sold_weight_g, drafted_by, chef_note, source)
  values (p_recipe_id, n, 'draft', coalesce(src.output_qty, 1), coalesce(src.output_unit, 'gram'), src.sold_weight_g, p_actor, p_note, 'chef screen')
  returning id into vid;
  if src.id is not null then
    insert into recipes.recipe_line (version_id, line_no, role, ingredient_sku_id, sub_recipe_id, qty, unit, note)
    select vid, line_no, role, ingredient_sku_id, sub_recipe_id, qty, unit, note from recipes.recipe_line where version_id = src.id;
  end if;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', vid, 'draft created', p_actor, jsonb_build_object('recipe_id', p_recipe_id, 'version_no', n, 'copied_from', src.id));
  return vid;
end $$;

-- A brand-new recipe (identity + first draft).
create or replace function recipes.new_recipe(p_name text, p_kind text, p_book text, p_output_qty numeric, p_output_unit text, p_actor text, p_note text default null)
returns bigint language plpgsql as $$
declare rid bigint; vid bigint; prefix text; n int;
begin
  prefix := case when p_kind = 'finished' then 'FG' else 'SEMI' end;
  select coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1 into n from recipes.recipe where code like prefix || '-%';
  insert into recipes.recipe (code, name, kind, book, status, created_by, note)
  values (prefix || '-' || lpad(n::text, 4, '0'), trim(p_name), p_kind, p_book, 'upcoming', p_actor, p_note) returning id into rid;
  insert into recipes.recipe_alias (recipe_id, system, external_name, note) values (rid, 'workbook', trim(p_name), 'name at creation');
  insert into recipes.recipe_version (recipe_id, version_no, state, output_qty, output_unit, drafted_by, chef_note, source)
  values (rid, 1, 'draft', p_output_qty, p_output_unit, p_actor, p_note, 'chef screen') returning id into vid;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('recipe', rid, 'created', p_actor, jsonb_build_object('name', p_name, 'kind', p_kind, 'version_id', vid));
  return vid;
end $$;

create or replace function recipes.submit_for_check(p_version_id bigint, p_actor text, p_note text default null)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state <> 'draft' then raise exception 'only a draft can be sent for checking (this one is %)', v.state; end if;
  if not exists (select 1 from recipes.recipe_line where version_id = p_version_id and role = 'material') then
    raise exception 'a recipe needs at least one ingredient line before it can be checked';
  end if;
  update recipes.recipe_version set state = 'checked', checked_by = null, checked_at = null,
         chef_note = coalesce(p_note, chef_note) where id = p_version_id;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'sent for check', p_actor, jsonb_build_object('note', p_note));
end $$;

-- Narendra confirms the costing: records who checked; the version stays 'checked' and now waits for approval.
create or replace function recipes.mark_checked(p_version_id bigint, p_actor text, p_note text default null)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state <> 'checked' then raise exception 'only a version sent for checking can be marked checked (this one is %)', v.state; end if;
  update recipes.recipe_version set checked_by = p_actor, checked_at = now(), checker_note = coalesce(p_note, checker_note) where id = p_version_id;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'checked', p_actor, jsonb_build_object('note', p_note));
end $$;

create or replace function recipes.send_back(p_version_id bigint, p_actor text, p_reason text)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state <> 'checked' then raise exception 'only a version waiting for check or approval can be sent back'; end if;
  update recipes.recipe_version set state = 'draft', checked_by = null, checked_at = null, checker_note = p_reason where id = p_version_id;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'sent back', p_actor, jsonb_build_object('reason', p_reason));
end $$;

create or replace function recipes.reject_version(p_version_id bigint, p_actor text, p_reason text)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state not in ('draft','checked') then raise exception 'only a draft or checked version can be rejected'; end if;
  update recipes.recipe_version set state = 'rejected', rejected_reason = p_reason where id = p_version_id;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'rejected', p_actor, jsonb_build_object('reason', p_reason));
end $$;

-- Approval: the previous live version is superseded, this one goes live from a date,
-- and a snapshot freezes the cost and the price list it used.
create or replace function recipes.approve_version(p_version_id bigint, p_actor text, p_effective_from date default null, p_note text default null)
returns void language plpgsql as $$
declare v record; c record; prices jsonb;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state <> 'checked' then raise exception 'only a checked version can be approved (this one is %)', v.state; end if;
  update recipes.recipe_version set state = 'superseded', superseded_at = now()
   where recipe_id = v.recipe_id and state = 'approved' and id <> p_version_id;
  update recipes.recipe_version set state = 'approved', approved_by = p_actor, approved_at = now(),
         effective_from = coalesce(p_effective_from, (now() at time zone 'Asia/Kolkata')::date),
         checker_note = coalesce(p_note, checker_note)
   where id = p_version_id;
  update recipes.recipe set status = 'active' where id = v.recipe_id and status = 'upcoming';
  select * into c from recipes.cost_of_version(p_version_id);
  select jsonb_object_agg(cr.sku_id::text, cr.rate_per_base) into prices
    from recipes.current_rate cr
    where cr.sku_id in (select sku_id from recipes.explode(v.recipe_id));
  insert into recipes.cost_snapshot (version_id, snapshot_kind, as_of, batch_cost, unit_cost, packaging_cost, missing_rates, price_list)
  values (p_version_id, 'approval', (now() at time zone 'Asia/Kolkata')::date, c.batch_cost, c.unit_cost, c.packaging_cost, c.missing_rates, prices);
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'approved', p_actor, jsonb_build_object('effective_from', p_effective_from, 'unit_cost', c.unit_cost, 'note', p_note));
end $$;

-- ---------- lines on a draft ----------
create or replace function recipes.set_lines(p_version_id bigint, p_actor text, p_lines jsonb, p_output_qty numeric, p_output_unit text, p_sold_weight_g numeric default null)
returns void language plpgsql as $$
-- p_lines: [{role, ingredient_sku_id | sub_recipe_id, qty, unit, note}], replaces the draft's lines wholesale.
declare v record; l jsonb; n int := 0;
begin
  select * into v from recipes.recipe_version where id = p_version_id for update;
  if v.state <> 'draft' then raise exception 'only a draft can be edited (this version is %)', v.state; end if;
  delete from recipes.recipe_line where version_id = p_version_id;   -- a draft's lines are working state, not history; history is the version row
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into recipes.recipe_line (version_id, line_no, role, ingredient_sku_id, sub_recipe_id, qty, unit, note)
    values (p_version_id, n, coalesce(l->>'role', 'material'),
            nullif(l->>'ingredient_sku_id', '')::bigint, nullif(l->>'sub_recipe_id', '')::bigint,
            (l->>'qty')::numeric, coalesce(l->>'unit', 'gram'), l->>'note');
  end loop;
  update recipes.recipe_version set output_qty = p_output_qty, output_unit = p_output_unit, sold_weight_g = p_sold_weight_g where id = p_version_id;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'lines saved', p_actor, jsonb_build_object('lines', n, 'output_qty', p_output_qty, 'output_unit', p_output_unit));
end $$;

-- ---------- the price list ----------
create or replace function recipes.set_rate(p_sku_id bigint, p_rate_per_base numeric, p_source text, p_as_of date, p_actor text, p_note text default null,
                                            p_purchase_unit text default null, p_purchase_price numeric default null, p_pack_base_units numeric default null)
returns bigint language plpgsql as $$
declare bu base_unit; rid bigint; prev numeric;
begin
  select base_unit into bu from public.skus where id = p_sku_id;
  if bu is null then raise exception 'sku % has no base unit', p_sku_id; end if;
  select rate_per_base into prev from recipes.current_rate where sku_id = p_sku_id;
  update recipes.ingredient_rate set superseded_at = now() where sku_id = p_sku_id and superseded_at is null;
  insert into recipes.ingredient_rate (sku_id, rate_per_base, base_unit, purchase_unit, purchase_price, pack_base_units, source, as_of, set_by, note)
  values (p_sku_id, p_rate_per_base, bu, p_purchase_unit, p_purchase_price, p_pack_base_units, p_source, p_as_of, p_actor, p_note) returning id into rid;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('rate', p_sku_id, 'rate set', p_actor, jsonb_build_object('from', prev, 'to', p_rate_per_base, 'source', p_source, 'as_of', p_as_of, 'note', p_note));
  return rid;
end $$;

create or replace function recipes.set_price(p_recipe_id bigint, p_channel text, p_selling_price numeric, p_packaging_charge numeric, p_effective_from date, p_actor text, p_note text default null)
returns void language plpgsql as $$
begin
  update recipes.channel_price set superseded_at = now() where recipe_id = p_recipe_id and channel = p_channel and superseded_at is null;
  insert into recipes.channel_price (recipe_id, channel, selling_price, packaging_charge, effective_from, set_by, note)
  values (p_recipe_id, p_channel, p_selling_price, p_packaging_charge, p_effective_from, p_actor, p_note);
  insert into recipes.event (entity, entity_id, action, actor, data) values ('price', p_recipe_id, 'price set', p_actor, jsonb_build_object('channel', p_channel, 'selling_price', p_selling_price, 'packaging_charge', p_packaging_charge, 'effective_from', p_effective_from));
end $$;

create or replace function recipes.set_setting(p_key text, p_value numeric, p_actor text, p_note text default null)
returns void language plpgsql as $$
declare prev numeric;
begin
  select value into prev from recipes.setting where key = p_key;
  insert into recipes.setting (key, value, note, updated_by) values (p_key, p_value, p_note, p_actor)
  on conflict (key) do update set value = excluded.value, note = coalesce(excluded.note, recipes.setting.note), updated_by = excluded.updated_by, updated_at = now();
  insert into recipes.event (entity, action, actor, data) values ('setting', 'setting changed', p_actor, jsonb_build_object('key', p_key, 'from', prev, 'to', p_value));
end $$;

create or replace function recipes.retire_recipe(p_recipe_id bigint, p_actor text, p_reason text)
returns void language plpgsql as $$
begin
  update recipes.recipe set status = 'retired', retired_at = now(), retired_reason = p_reason where id = p_recipe_id and retired_at is null;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('recipe', p_recipe_id, 'retired', p_actor, jsonb_build_object('reason', p_reason));
end $$;

-- ---------- month-end snapshot for the P&L (Step E) ----------
create or replace function recipes.month_end_snapshot(p_as_of date default null)
returns int language plpgsql as $$
declare d date := coalesce(p_as_of, ((now() at time zone 'Asia/Kolkata')::date - 1)); n int := 0; r record; c record;
begin
  for r in select v.id as version_id, v.recipe_id from recipes.recipe_version v join recipes.recipe rc on rc.id = v.recipe_id
           where v.state = 'approved' and rc.retired_at is null loop
    if exists (select 1 from recipes.cost_snapshot where version_id = r.version_id and snapshot_kind = 'month_end' and as_of = d) then continue; end if;
    select * into c from recipes.cost_of_version(r.version_id);
    insert into recipes.cost_snapshot (version_id, snapshot_kind, as_of, batch_cost, unit_cost, packaging_cost, missing_rates)
    values (r.version_id, 'month_end', d, c.batch_cost, c.unit_cost, c.packaging_cost, c.missing_rates);
    n := n + 1;
  end loop;
  insert into recipes.event (entity, action, actor, data) values ('snapshot', 'month end', 'pg_cron', jsonb_build_object('as_of', d, 'rows', n));
  return n;
end $$;

-- Runs at 00:30 IST on the 1st (19:00 UTC on the last day), server-side (F21: long jobs never from a laptop).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'recipes_month_end_snapshot') then perform cron.unschedule('recipes_month_end_snapshot'); end if;
    perform cron.schedule('recipes_month_end_snapshot', '0 19 28-31 * *',
      $j$ select recipes.month_end_snapshot() where (now() at time zone 'Asia/Kolkata' + interval '1 day')::date = date_trunc('month', (now() at time zone 'Asia/Kolkata' + interval '1 day'))::date $j$);
  end if;
end $$;

-- ---------- version history, readable ----------
create or replace view recipes.version_history as
  select v.id as version_id, v.recipe_id, r.code, r.name, r.kind, v.version_no, v.state,
         v.output_qty, v.output_unit, v.sold_weight_g,
         v.drafted_by, v.drafted_at, v.checked_by, v.checked_at, v.approved_by, v.approved_at,
         v.effective_from, v.superseded_at, v.chef_note, v.checker_note, v.rejected_reason, v.source,
         (select count(*) from recipes.recipe_line l where l.version_id = v.id) as line_count,
         (select s.unit_cost from recipes.cost_snapshot s where s.version_id = v.id and s.snapshot_kind in ('approval','import') order by s.created_at desc limit 1) as unit_cost_at_approval
  from recipes.recipe_version v
  join recipes.recipe r on r.id = v.recipe_id;

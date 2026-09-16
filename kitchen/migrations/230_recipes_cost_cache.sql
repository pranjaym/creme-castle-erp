-- 230: cost cache. Pranjay 16 Sep 2026: "it is very very slow". The list pages
-- recomputed every recipe's cost recursively on every request, several times over
-- (live_cost inside food_cost_list inside the home counts). Costs now live in
-- recipes.cost_cache, rebuilt in one set-based pass (bottom up, deepest chain 4)
-- whenever something that changes a live cost happens: an approval, a rate, a
-- retirement, an import. cost_of_recipe stays for ad-hoc checks and drafts.

create table if not exists recipes.cost_cache (
  recipe_id      bigint primary key references recipes.recipe(id),
  version_id     bigint not null references recipes.recipe_version(id),
  output_qty     numeric not null,
  output_unit    text not null,
  batch_cost     numeric not null default 0,
  unit_cost      numeric not null default 0,
  packaging_cost numeric not null default 0,
  missing_rates  int not null default 0,
  computed_at    timestamptz not null default now()
);
alter table recipes.cost_cache enable row level security;

create or replace function recipes.refresh_costs() returns int language plpgsql as $$
declare changed int; pass int := 0; done_n int;
begin
  drop table if exists _rc;
  create temp table _rc (recipe_id bigint primary key, version_id bigint, output_qty numeric, output_unit text,
                         batch numeric default 0, pack numeric default 0, missing int default 0, done boolean default false);
  insert into _rc (recipe_id, version_id, output_qty, output_unit)
    select r.id, v.id, v.output_qty, v.output_unit
    from recipes.recipe r join recipes.recipe_version v on v.recipe_id = r.id and v.state = 'approved'
    where r.retired_at is null;
  loop
    pass := pass + 1;
    with ready as (
      select c.recipe_id, c.version_id from _rc c
      where not c.done and not exists (
        select 1 from recipes.recipe_line l join _rc s on s.recipe_id = l.sub_recipe_id
        where l.version_id = c.version_id and not s.done)
    ), agg as (
      select rd.recipe_id,
        coalesce(sum(case when l.role = 'material'  then l.qty * coalesce(cr.rate_per_base, s.batch / nullif(s.output_qty, 0), 0) end), 0) as batch,
        coalesce(sum(case when l.role = 'packaging' then l.qty * coalesce(cr.rate_per_base, s.batch / nullif(s.output_qty, 0), 0) end), 0) as pack,
        coalesce(sum(case when l.ingredient_sku_id is not null and cr.rate_per_base is null then 1
                          when l.sub_recipe_id is not null and s.recipe_id is null then 1 else 0 end), 0)
          + coalesce(sum(s.missing), 0) as missing
      from ready rd
      left join recipes.recipe_line l on l.version_id = rd.version_id
      left join recipes.current_rate cr on cr.sku_id = l.ingredient_sku_id
      left join _rc s on s.recipe_id = l.sub_recipe_id
      group by rd.recipe_id)
    update _rc c set batch = a.batch, pack = a.pack, missing = a.missing, done = true from agg a where a.recipe_id = c.recipe_id;
    get diagnostics changed = row_count;
    exit when changed = 0 or pass > 25;
  end loop;
  delete from recipes.cost_cache where recipe_id not in (select recipe_id from _rc where done);
  insert into recipes.cost_cache (recipe_id, version_id, output_qty, output_unit, batch_cost, unit_cost, packaging_cost, missing_rates, computed_at)
    select recipe_id, version_id, output_qty, output_unit, batch, batch / nullif(output_qty, 0), pack, missing, now() from _rc where done
  on conflict (recipe_id) do update set version_id = excluded.version_id, output_qty = excluded.output_qty, output_unit = excluded.output_unit,
    batch_cost = excluded.batch_cost, unit_cost = excluded.unit_cost, packaging_cost = excluded.packaging_cost, missing_rates = excluded.missing_rates, computed_at = now();
  select count(*) into done_n from _rc where done;
  drop table _rc;
  return done_n;
end $$;

-- the views now read the cache
create or replace view recipes.live_cost as
  select r.id as recipe_id, r.code, r.name, r.kind, r.book, r.status,
         c.version_id, c.output_qty, c.output_unit, c.batch_cost, c.unit_cost, c.packaging_cost, c.missing_rates
  from recipes.recipe r
  join recipes.cost_cache c on c.recipe_id = r.id
  where r.retired_at is null;

-- refresh after anything that moves a live cost
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
  perform recipes.refresh_costs();
  select * into c from recipes.cost_of_version(p_version_id);
  select jsonb_object_agg(cr.sku_id::text, cr.rate_per_base) into prices
    from recipes.current_rate cr
    where cr.sku_id in (select sku_id from recipes.explode(v.recipe_id));
  insert into recipes.cost_snapshot (version_id, snapshot_kind, as_of, batch_cost, unit_cost, packaging_cost, missing_rates, price_list)
  values (p_version_id, 'approval', (now() at time zone 'Asia/Kolkata')::date, c.batch_cost, c.unit_cost, c.packaging_cost, c.missing_rates, prices);
  insert into recipes.event (entity, entity_id, action, actor, data) values ('version', p_version_id, 'approved', p_actor, jsonb_build_object('effective_from', p_effective_from, 'unit_cost', c.unit_cost, 'note', p_note));
end $$;

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
  perform recipes.refresh_costs();
  return rid;
end $$;

create or replace function recipes.retire_recipe(p_recipe_id bigint, p_actor text, p_reason text)
returns void language plpgsql as $$
begin
  update recipes.recipe set status = 'retired', retired_at = now(), retired_reason = p_reason where id = p_recipe_id and retired_at is null;
  insert into recipes.event (entity, entity_id, action, actor, data) values ('recipe', p_recipe_id, 'retired', p_actor, jsonb_build_object('reason', p_reason));
  perform recipes.refresh_costs();
end $$;

-- helpful indexes for the list pages
create index if not exists idx_recipe_line_version_role on recipes.recipe_line (version_id, role);
create index if not exists idx_recipe_version_recipe_state on recipes.recipe_version (recipe_id, state);
create index if not exists idx_channel_price_live on recipes.channel_price (recipe_id, channel) where superseded_at is null;
create index if not exists idx_ingredient_rate_live on recipes.ingredient_rate (sku_id) where superseded_at is null;

select recipes.refresh_costs();

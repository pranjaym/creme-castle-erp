-- 226: Recipe and food cost module, Step A (schema only).
-- Authorised by Pranjay 15 Sep 2026 ("structure looks right", "go with step A").
-- Design: erp-plan/recipe-costing-module-plan.md. One rule for every recipe:
--   unit cost = sum(line qty x line rate) / what the batch makes.
-- Purchased ingredients are skus rows (sku_type raw_material) keyed by the
-- SupplyNote sku_code; recipes have one identity and dated versions; only the
-- approved version is ever read; rates live on an effective-dated price list;
-- nothing is deleted; a loop cannot be saved.
-- The importer (kitchen/workers/recipes/import_workbook.py) loads the 17 Aug
-- 2026 workbook as version 1 of every recipe.

create schema if not exists recipes;

-- ---------- recipe identity ----------
create table if not exists recipes.recipe (
  id             bigint generated always as identity primary key,
  code           text unique not null,                       -- SEMI-0001 / FG-0001
  name           text not null,
  kind           text not null check (kind in ('intermediate','finished')),
  book           text,                                       -- workbook family: sub_mesa | cake | pastry
  sku_id         bigint references public.skus(id),         -- link to the department module's item, set by hand later
  status         text not null default 'active' check (status in ('active','inactive','upcoming','retired')),
  created_by     text,
  created_at     timestamptz not null default now(),
  retired_at     timestamptz,
  retired_reason text,
  note           text
);
create unique index if not exists uq_recipe_live_name on recipes.recipe (lower(name)) where retired_at is null;
comment on table recipes.recipe is 'One row per recipe identity, forever. Versions carry the lines. Retire with a reason; never delete.';

-- every other name a recipe is known by (workbook block, item_glossary item, SupplyNote recipe)
create table if not exists recipes.recipe_alias (
  id            bigint generated always as identity primary key,
  recipe_id     bigint not null references recipes.recipe(id),
  system        text not null,                              -- workbook | item_glossary | supplynote | petpooja
  external_name text not null,
  note          text,
  created_at    timestamptz not null default now(),
  unique (system, external_name)
);

-- ---------- versions: the state machine ----------
create table if not exists recipes.recipe_version (
  id              bigint generated always as identity primary key,
  recipe_id       bigint not null references recipes.recipe(id),
  version_no      int not null,
  state           text not null default 'draft'
                  check (state in ('draft','checked','approved','superseded','rejected')),
  output_qty      numeric(14,4) not null check (output_qty > 0),   -- what this batch makes
  output_unit     text not null check (output_unit in ('gram','millilitre','piece','set')),
  sold_weight_g   numeric(12,2),                                    -- finished goods: the sold size, for display
  chef_note       text,
  checker_note    text,
  drafted_by      text,
  drafted_at      timestamptz not null default now(),
  checked_by      text,
  checked_at      timestamptz,
  approved_by     text,
  approved_at     timestamptz,
  effective_from  date,
  superseded_at   timestamptz,
  rejected_reason text,
  source          text,                                             -- workbook import | chef screen | bulk upload
  unique (recipe_id, version_no)
);
create unique index if not exists uq_recipe_one_approved on recipes.recipe_version (recipe_id) where state = 'approved';
create index if not exists idx_recipe_version_recipe on recipes.recipe_version (recipe_id, version_no desc);
comment on column recipes.recipe_version.output_qty is
  'For a semi-finished batch: grams, millilitres or pieces the batch makes. For a finished good: sold units the batch makes (1 cake, 10 slices). Yield % is derived from lines, never stored.';

-- ---------- lines ----------
create table if not exists recipes.recipe_line (
  id                bigint generated always as identity primary key,
  version_id        bigint not null references recipes.recipe_version(id),
  line_no           int not null,
  role              text not null default 'material' check (role in ('material','packaging')),
  ingredient_sku_id bigint references public.skus(id),
  sub_recipe_id     bigint references recipes.recipe(id),
  qty               numeric(14,4) not null check (qty >= 0),
  unit              text not null check (unit in ('gram','millilitre','piece','set')),
  note              text,
  check ((ingredient_sku_id is null) <> (sub_recipe_id is null)),  -- exactly one reference
  unique (version_id, line_no)
);
create index if not exists idx_recipe_line_version on recipes.recipe_line (version_id);
create index if not exists idx_recipe_line_sub on recipes.recipe_line (sub_recipe_id) where sub_recipe_id is not null;
create index if not exists idx_recipe_line_ing on recipes.recipe_line (ingredient_sku_id) where ingredient_sku_id is not null;
comment on column recipes.recipe_line.role is 'material lines are the food; packaging lines (box, base, sleeve, bag as a set) sit outside the food line and are costed separately.';

-- a recipe may never contain itself through any chain
create or replace function recipes.guard_recipe_loop() returns trigger language plpgsql as $$
declare parent bigint;
begin
  if new.sub_recipe_id is null then return new; end if;
  select recipe_id into parent from recipes.recipe_version where id = new.version_id;
  if parent = new.sub_recipe_id then
    raise exception 'recipe % cannot use itself', parent;
  end if;
  if exists (
    with recursive down(rid) as (
      select new.sub_recipe_id
      union
      select l.sub_recipe_id
      from recipes.recipe_line l
      join recipes.recipe_version v on v.id = l.version_id
      join down d on v.recipe_id = d.rid
      where l.sub_recipe_id is not null and v.state in ('draft','checked','approved')
    )
    select 1 from down where rid = parent
  ) then
    raise exception 'recipe loop: recipe % would contain itself through recipe %', parent, new.sub_recipe_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_recipe_loop on recipes.recipe_line;
create trigger trg_guard_recipe_loop before insert or update on recipes.recipe_line
  for each row execute function recipes.guard_recipe_loop();

-- ---------- the price list (effective-dated, never overwritten) ----------
create table if not exists recipes.ingredient_rate (
  id              bigint generated always as identity primary key,
  sku_id          bigint not null references public.skus(id),
  rate_per_base   numeric(16,6) not null check (rate_per_base >= 0),  -- rupees per gram / millilitre / piece
  base_unit       base_unit not null,
  purchase_unit   text,                                                -- kg, piece, tray, litre (as bought)
  purchase_price  numeric(14,4),                                       -- rupees per purchase unit
  pack_base_units numeric(14,4),                                       -- usable base units in one purchase unit
  source          text not null check (source in ('workbook_baseline','supplynote_last_purchase','manual_verified')),
  as_of           date not null,
  set_by          text,
  note            text,
  superseded_at   timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ingredient_rate_sku on recipes.ingredient_rate (sku_id, as_of desc, id desc);
comment on table recipes.ingredient_rate is 'Rates are never typed on a recipe line. The current rate of an ingredient is the latest not-superseded row. workbook_baseline is an unverified baseline (rule 5).';

create or replace view recipes.current_rate as
  select distinct on (sku_id) *
  from recipes.ingredient_rate
  where superseded_at is null
  order by sku_id, as_of desc, id desc;

-- ---------- selling price per channel ----------
create table if not exists recipes.channel_price (
  id               bigint generated always as identity primary key,
  recipe_id        bigint not null references recipes.recipe(id),
  channel          text not null default 'aggregator' check (channel in ('aggregator','d2c','blinkit')),
  selling_price    numeric(12,2),
  packaging_charge numeric(12,2),
  effective_from   date not null,
  superseded_at    timestamptz,
  set_by           text,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_channel_price on recipes.channel_price (recipe_id, channel, effective_from desc);
comment on table recipes.channel_price is 'Pranjay 15 Sep 2026: one price for now, the Zomato and Swiggy price (channel aggregator). Blinkit and website may differ later; that is a row, not a schema change.';

create or replace view recipes.current_price as
  select distinct on (recipe_id, channel) *
  from recipes.channel_price
  where superseded_at is null
  order by recipe_id, channel, effective_from desc, id desc;

-- ---------- settings (named, not hidden in a formula) ----------
create table if not exists recipes.setting (
  key        text primary key,
  value      numeric not null,
  note       text,
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into recipes.setting (key, value, note, updated_by) values
  ('wastage_allowance_pct', 10, 'Added to material cost before comparing with price; the workbook''s hidden +10%. Pranjay to refine the auxiliary-item rule (15 Sep 2026).', 'migration 226'),
  ('target_food_cost_pct', 30, 'PLACEHOLDER. Pranjay: the target is a rule involving packaging charge, not one number; to be replaced when he explains it.', 'migration 226')
on conflict (key) do nothing;

-- ---------- cost snapshots for the P&L ----------
create table if not exists recipes.cost_snapshot (
  id             bigint generated always as identity primary key,
  version_id     bigint not null references recipes.recipe_version(id),
  snapshot_kind  text not null check (snapshot_kind in ('approval','month_end','import')),
  as_of          date not null,
  batch_cost     numeric(14,4),
  unit_cost      numeric(16,6),
  packaging_cost numeric(14,4),
  missing_rates  int not null default 0,
  price_list     jsonb,                                  -- {sku_id: rate_per_base} the figures used
  created_at     timestamptz not null default now()
);
create index if not exists idx_cost_snapshot on recipes.cost_snapshot (version_id, as_of desc);

-- ---------- readable audit ----------
create table if not exists recipes.event (
  id         bigint generated always as identity primary key,
  entity     text not null,           -- recipe | version | line | rate | price | setting
  entity_id  bigint,
  action     text not null,
  actor      text,
  data       jsonb,
  at         timestamptz not null default now()
);

-- ---------- the costing engine, in the database, app-independent ----------
-- Cost of one approved recipe per output unit, recursing through sub-recipes.
-- missing_rates counts lines whose ingredient has no current rate (costed at 0, never silently).
create or replace function recipes.cost_of_recipe(p_recipe_id bigint, p_depth int default 0)
returns table (batch_cost numeric, unit_cost numeric, packaging_cost numeric, missing_rates int, output_qty numeric, output_unit text, version_id bigint)
language plpgsql stable as $$
declare v record; l record; r numeric; sub record;
        b numeric := 0; p numeric := 0; miss int := 0;
begin
  if p_depth > 12 then return; end if;
  select * into v from recipes.recipe_version where recipe_id = p_recipe_id and state = 'approved';
  if not found then return; end if;
  for l in select * from recipes.recipe_line where version_id = v.id order by line_no loop
    if l.ingredient_sku_id is not null then
      select cr.rate_per_base into r from recipes.current_rate cr where cr.sku_id = l.ingredient_sku_id;
      if r is null then miss := miss + 1; r := 0; end if;
    else
      select * into sub from recipes.cost_of_recipe(l.sub_recipe_id, p_depth + 1);
      if sub.unit_cost is null then miss := miss + 1; r := 0; else r := sub.unit_cost; miss := miss + coalesce(sub.missing_rates, 0); end if;
    end if;
    if l.role = 'packaging' then p := p + l.qty * r; else b := b + l.qty * r; end if;
  end loop;
  return query select b, b / v.output_qty, p, miss, v.output_qty, v.output_unit, v.id;
end $$;

-- The live version of every recipe with its cost
create or replace view recipes.live_cost as
  select r.id as recipe_id, r.code, r.name, r.kind, r.book, r.status,
         c.version_id, c.output_qty, c.output_unit, c.batch_cost, c.unit_cost, c.packaging_cost, c.missing_rates
  from recipes.recipe r
  cross join lateral recipes.cost_of_recipe(r.id) c
  where r.retired_at is null;

-- The food cost list: every finished good, costed today, with the settings applied
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
         case when coalesce(cp.selling_price,0) + coalesce(cp.packaging_charge,0) > 0
              then (lc.unit_cost * (1 + s.allowance_pct / 100) + lc.packaging_cost)
                   / (coalesce(cp.selling_price,0) + coalesce(cp.packaging_charge,0)) end            as food_cost_with_packaging_pct,
         s.target_pct / 100 as target_pct,
         lc.missing_rates, lc.version_id
  from recipes.live_cost lc
  cross join s
  left join recipes.current_price cp on cp.recipe_id = lc.recipe_id and cp.channel = 'aggregator'
  where lc.kind = 'finished';

-- ---------- RLS, same stance as the rest of the spine: service role only ----------
alter table recipes.recipe          enable row level security;
alter table recipes.recipe_alias    enable row level security;
alter table recipes.recipe_version  enable row level security;
alter table recipes.recipe_line     enable row level security;
alter table recipes.ingredient_rate enable row level security;
alter table recipes.channel_price   enable row level security;
alter table recipes.setting         enable row level security;
alter table recipes.cost_snapshot   enable row level security;
alter table recipes.event           enable row level security;
